# stayLOG — Übergabe an einen neuen Chat

Stand: 9. September 2026

---

## Worum es geht

Eine Web-App für eine Runde von 40 bis 50 Vielreisenden. Sie tragen ihre
Hotelaufenthalte ein und sehen dadurch, was ihr Treuestatus in einem
bestimmten Haus tatsächlich bringt: welches Zimmer gebucht, welches bekommen,
welche Benefits es dazu gab.

- Adresse: https://staylog.pages.dev
- Quellcode: `C:\Users\Administrator\Desktop\stayLOG`, GitHub `kimrobin0711/staylog`
- Cloudflare Pages, D1-Datenbank, R2-Bilderspeicher
- Veröffentlichen: `.\build.ps1`

**Die technischen Einzelheiten stehen in `TECHNIK.md` im Projektordner** —
alle Schnittstellen, Variablen, fremden Dienste und das Datenbankschema.
Bitte dort nachlesen statt neu zu erfragen.

---

## Arbeitsweise

- Nach jeder Änderung **das vollständige Projekt-ZIP** liefern, nicht nur die
  geänderten Dateien. **Mit Zeitstempel im Dateinamen**, sonst entstehen im
  Download-Ordner gleichnamige Dateien und es wird versehentlich ein altes
  Paket entpackt. Das ist passiert und hat eine Stunde gekostet.
- Dazu die passenden Git-Befehle, Nachrichten kurz halten.
- **Windows mit PowerShell**, keine Bash-Syntax.
- Änderungen an Cloudflare-Variablen greifen **erst nach einem Deploy**.
- `Expand-Archive -Force` überschreibt auch die `package.json`.
- Nach dem Entpacken prüfen, ob die Änderung angekommen ist:
  `Select-String -Path .\public\app.js -Pattern "..." | Measure-Object`

---

## Zimmerrecherche — das große Thema

Vier Stufen, Einzelheiten in `TECHNIK.md`, Abschnitt 4.

**Gelöst: Marriott.** Eine offene Abfrage liefert alle Kategorien mit den
offiziellen Namen, kostenlos und in Sekunden:

```
https://www.marriott.com/services/marriott-hws/roomCards/?marsha={CODE}&locale=de-DE
```

Der Code steht in jeder Marriott-Adresse (`vlcva-ac-hotel-valencia` → `VLCVA`)
und wird auch in den Quelladressen gefundener Kategorien gesucht. Damit
funktionieren auch weiche Marken wie Autograph und Tribute Portfolio.

**Gelöst: schema.org.** Viele Ketten legen ihre Kategorien als
`"@type":"HotelRoom"` ins HTML. Wichtig: über Cloudflares `/content`-Endpunkt
holen, nicht `/markdown` — die Markdown-Fassung wirft die Blöcke weg.

**Gebaut: Hilton.** Aus einem HAR-Mitschnitt kam die Abfrage:

```
POST https://www.hilton.com/graphql/customer?...&operationName=hotel_roomTypes
```

Sie liefert `hotel.roomTypes` mit den offiziellen deutschen Namen, ohne Datum,
dazu `roomTypeCategories` mit den Gruppen `guest`, `executive`, `suites` als
Grobsortierung. Kennung ist der CTYHOCN aus der Adresse (`FRAHITW`).

**Aus Cloudflare heraus geht sie nicht.** Akamai antwortet mit
`HTTP 200, text/html, "Success"` — die Anfrage erreicht den Server nie. Der
Browserdienst hilft auch nicht, Cloudflare weist ihn laut eigener Dokumentation
über nicht änderbare Kopfzeilen als Bot aus. Deshalb läuft der Abruf über die
**Brücke** in `bruecke/`: ein echter Browser auf dem eigenen Rechner, einmal
angemeldet, dann alle Häuser hintereinander. Siehe `TECHNIK.md`, Abschnitt 8.

**Vorrat.** `bruecke/vorrat.mjs` legt die Kategorien ganzer Regionen an, auch
für Häuser, in denen niemand war. Sie liegen in `chain_hotels`/`chain_rooms`,
geschlüsselt nach Kennung, getrennt von der Hotelliste. Trägt jemand später ein
Hilton ein, sind die Kategorien sofort da — ohne Abruf. Europa sind rund 900
Häuser und etwa eine halbe Stunde.

**Offen: Radisson.** Dort liegen die Kategorien weder im HTML noch als
schema.org-Block; die Liste wird ebenfalls per JSON nachgeladen. Die Abfrage
ist noch nicht mitgeschnitten. Gleicher Weg: Zimmerseite öffnen,
Entwicklerwerkzeuge, HAR mitschneiden. Die Brücke bekommt Radisson dann als
zweite Kette dazu.

---

## Namen der Zimmerkategorien

Manche Häuser führen jede Bettvariante als eigene Kategorie. Für die
Upgrade-Leiter ist das falsch. Deshalb wird beim Speichern vereinheitlicht:

- Bettangaben, Schlafraumangaben und „Zugang zur Executive Lounge" werden
  abgeschnitten
- **Der Ausblick bleibt eine eigene Kategorie** — Meerblick ist laut Nutzer
  eine echte Aufwertung
- Doppelte werden zusammengefasst, Bettarten mit „oder" verbunden

Aus 22 Einträgen werden so etwa 9. Achtung: Es gibt zwei Speicherwege — die
Recherche und der Endpunkt `/hotels/:id/rooms` aus der Oberfläche. Beide
müssen bereinigen, sonst kommen Doppelte durch die Hintertür zurück.

---

## Offene Punkte

**Aufräumen.** Im Code liegen Prüfwerkzeuge von der Fehlersuche:
`functions/api/hotels/[id]/playwright.js`, der Unterweg `/probe`, der
ScrapingBee-Zweig, dazu die ungenutzten Endpunkte `/tree` und `/geo/ping`.

**Restliche Häuser.** Einige stehen auf `pending` und werden erst beim Öffnen
recherchiert.

**Doppelte Hotels.** Der Knopf „Doppelte Hotels zusammenführen" im
Verwaltungsbereich räumt sie auf.

**Weitere Ketten.** Für IHG und Accor ist ungeklärt, ob es dort eine offene
Abfrage wie bei Marriott gibt. Weg dahin: Zimmerseite im Browser öffnen,
Entwicklerwerkzeuge, Netzwerkanalyse, nach einem echten Zimmernamen im
Antwortinhalt filtern.

---

## Drei Lehren aus der Fehlersuche

**Erst die Rohantwort ansehen, dann ändern.** Ein Fehler hat Stunden gekostet,
weil der Reihe nach Vermutungen umgebaut wurden. Die Ursache war eine Zeile:
Das Einlesen der Modellantwort probierte alle Reparaturvarianten außer der
einfachsten — JSON mit angehängtem Text. Sichtbar wurde das erst, als die
vollständige Antwort auf dem Tisch lag.

**Eine Änderung, ein Test.** Mehrere Umbauten gleichzeitig haben dreimal neue
Fehler eingeschleppt: eine undefinierte Variable, eine Variable mit zwei
Bedeutungen, eine fehlende Datenbankspalte.

**Prüfen, ob die Änderung überhaupt online ist.** Zweimal wurde an Symptomen
gesucht, während schlicht ein altes Paket lief oder der Deploy fehlte.

---

## Nützliche Befehle

```powershell
cd C:\Users\Administrator\Desktop\stayLOG

# Veröffentlichen
.\build.ps1

# Welche Fassung ist online?
(Invoke-WebRequest -Uri "https://staylog.pages.dev/version.json" -UseBasicParsing).Content

# Zustand aller Häuser
npx wrangler d1 execute staylog --remote --command "SELECT h.name, h.enrich_status, (SELECT COUNT(*) FROM room_types r WHERE r.hotel_id = h.id) AS kategorien FROM hotels h ORDER BY kategorien"

# Ein Haus neu recherchieren lassen
npx wrangler d1 execute staylog --remote --command "DELETE FROM room_types WHERE hotel_id = 24"
npx wrangler d1 execute staylog --remote --command "UPDATE hotels SET enrich_status = 'pending', enriched_at = NULL WHERE id = 24"

# Diagnose: gelesene Seiten und vollständige Rohantwort des Modells
$pass = Read-Host -AsSecureString "STAY_PASSWORD"
$p = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($pass))
Invoke-RestMethod -Method Post -Uri "https://staylog.pages.dev/api/hotels/24/enrich?debug=1" -Headers @{
  "x-stay-pass" = $p; "x-stay-user" = "kimhoehe@web.de"
} | ConvertTo-Json -Depth 5

# Verbrauch bei Google und Browser
npx wrangler d1 execute staylog --remote --command "SELECT * FROM usage_counter"

# Prüfseite: welche Geheimnisse sind hinterlegt
# https://staylog.pages.dev/api/health
```

---

## Kosten

- **Claude:** rund 10 Cent je neues Hotel mit Haiku. Guthaben auf
  console.anthropic.com, automatisches Nachladen einrichten.
- **Google:** 5.000 freie Namenssuchen im Monat, 1.000 freie Bildabrufe.
  Eigener Zähler bei 800, einstellbar über `GOOGLE_MONTHLY_LIMIT`.
- **Cloudflare:** kostenloser Plan reicht. Browser: 10 Minuten am Tag, drei
  gleichzeitige Sitzungen, neue Sitzung etwa alle 20 Sekunden.
