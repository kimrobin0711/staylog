# stayLOG — Übergabe an einen neuen Chat

Stand: 14. September 2026

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

Drei Ketten, drei völlig verschiedene Wege. Das ist kein Wildwuchs, sondern
Folge dessen, was jede Kette zulässt — wer daran etwas vereinheitlichen will,
sollte erst die Begründungen hier lesen.

### Marriott — vollständig gelöst, ohne Brücke

Die einzige Kette, bei der **der Server alles allein kann**. Kein Browser, kein
Rechner, der laufen muss.

```
Sitemap → MARSHA-Kennung → roomCards aus Cloudflare → Vorrat
```

Das Verzeichnis kommt aus Marriotts eigenen Sitemaps, die in `robots.txt`
ausdrücklich genannt sind und auf `/content/dam/` ohne Bot-Prüfung liegen:

```
https://www.marriott.com/content/dam/marriott-hws/sitemap-xmls/<sprache>-sitemap-hws-<1..7>.xml
```

Die Kennung steht in jeder Adresse: `/hotels/amsel-element-amsterdam/` → `AMSEL`.
Fünf Sprachfassungen (de, en-gb, fr, it, es) ergeben zusammen **3.608 Kennungen
mit Slug**; eine allein deckt nur einen Teil ab. Die Liste liegt als
`bruecke/marriott-slugs.csv`.

Die Kategorien holt dann `/chain/marriott` selbst, 20 bis 30 Häuser je Aufruf.
Stand: **2.951 Häuser, 21.378 Kategorien.** Die Differenz zu 3.608 sind Häuser
ohne verwertbare Kategorien — geschlossene und solche mit nur ein oder zwei
Zimmerarten, die unter der Untergrenze von drei bleiben.

Die Einzelabfrage `roomCards` funktioniert weiterhin für Häuser außerhalb des
Vorrats:

```
https://www.marriott.com/services/marriott-hws/roomCards/?marsha={CODE}&locale=de-DE
```

**Die Suchseiten von Marriott sind Akamai-geschützt** und für gesteuerte Browser
gesperrt. Das spielt keine Rolle — sie werden nicht gebraucht.

### Hilton — Vorrat über die Brücke

`hotel.roomTypes` per GraphQL, Kennung ist der CTYHOCN aus der Adresse
(`FRAHITW`), dazu `roomTypeCategories` mit den Gruppen `guest`, `executive`,
`suites`.

**Aus Cloudflare heraus geht das nicht.** Akamai antwortet mit
`HTTP 200, text/html, "Success"` — die Anfrage erreicht den Server nie. Der
Browserdienst hilft auch nicht, Cloudflare weist ihn laut eigener Dokumentation
über nicht änderbare Kopfzeilen als Bot aus. Deshalb die **Brücke** in
`bruecke/`: ein echter Browser auf dem eigenen Rechner.

Hilton hat zusätzlich die Suchabfrage `hotelSummaryOptions` nach dem ersten
Durchlauf gesperrt. Die Häuserliste kommt seitdem aus dem **Seitenzustand** —
`__NEXT_DATA__` jeder Standortseite trägt ihre Hotels und die Verweise auf alle
Städte des Landes. Seitenaufrufe drosselt Hilton nicht. `bruecke/ernte.mjs`
läuft diesen Weg, 563 Aufrufe für Europa.

Stand: **938 Häuser, rund 7.400 Kategorien.** Lücken: fünf Vacation Clubs ohne
Zimmerkategorien, Russland (keine Länderseite mehr), Türkei unvollständig
(95 statt 108).

### Radisson — nur die eigenen Häuser, kein Vorrat

Läuft auf Nuxt, die Zimmer stehen in `window.__NUXT__`.
`bruecke/radisson.mjs` öffnet die Zimmerseite und liest sie aus. Die Hauskennung
(`DEHAM1`) steht nur im Zustand, nicht in der Adresse. Die **englische** Seite
`/en-us/.../rooms` ist erste Wahl — bei „Radisson Individuals"-Häusern liefert
die deutsche keine Zimmerdaten.

**Radisson sperrt gesteuerte Browser** („Your access has been restricted ...
automated detection"). Einzelne Aufrufe gehen durch, mehrere hintereinander
nicht. Auch ein einfacher Abruf mit PowerShell wird mit 403 abgewiesen. Am
Erkennungsmechanismus vorbeizubauen wäre das Aushebeln einer Schutzmaßnahme
und ist bewusst unterlassen.

Eine Content-Quelle hinter den Seiten gibt es nicht: CMS ist SDL Tridion, der
Redaktionsserver ist nicht öffentlich, die einzige Schnittstelle (`/webapps-api`)
ist das Buchungs-SDK. **Diese Suche ist erledigt — bitte nicht wiederholen.**

Deshalb kein Vorrat für Regionen, nur die Häuser der eigenen Runde. Neue Häuser
bekommen ihre Kategorien erst beim nächsten Brücken-Lauf.

### schema.org als Rückfall

Viele Ketten legen ihre Kategorien als `"@type":"HotelRoom"` ins HTML. Über
Cloudflares `/content`-Endpunkt holen, nicht `/markdown` — die Markdown-Fassung
wirft die Blöcke weg.

---

## Fallstricke, die Zeit gekostet haben

**Cloudflares D1-Tagesgrenze.** 100.000 Schreibvorgänge. Ein Vorratslauf über
tausende Häuser reißt sie, und dann sperrt Cloudflare den Zugriff für die App
**und** für `wrangler` (Fehler 7403, dazu 503 an allen Endpunkten). Das hat
einen Abend gekostet. Vorratsläufe deshalb in Etappen von etwa tausend Häusern
je Tag.

**Blockgröße.** 30 Häuser je Aufruf laufen in die Zeitgrenze, wenn viele davon
nichts liefern — dann entfällt das Speichern und es werden 30 Abrufe ohne Pause
gemacht. 20 sind sicher.

**Wer die Bereinigung ändert, muss den Vorrat nachziehen.** `vorrat.mjs`
überspringt, was schon drinsteht. Ohne `--neu` behalten vorhandene Häuser
stillschweigend die alten Namen, und der Fehler zeigt sich erst, wenn jemand ein
Hotel anlegt. Das ist bei Hilton zweimal passiert.

**Regeln an mehreren Häusern prüfen, nicht an einem.** Die Loungeregel war an
Berlin entwickelt, wo der Zusatz am Gedankenstrich hängt. Tatsächlich hängt er
meist an „und" oder „mit" — 135 Einträge blieben falsch.

**Die Verwaltungsadresse ist `kimhoehe@email.de`**, nicht `web.de`. Mit der
falschen kommt 403 ohne Inhalt.

**`Select-String` auf `functions/api/[[path]].js` braucht `-LiteralPath`**,
sonst deutet PowerShell die eckigen Klammern als Platzhalter und meldet
stillschweigend null Treffer.

**Aus einem ZIP entpackte Skripte sind blockiert.** `Get-ChildItem -Recurse |
Unblock-File` vor `.\build.ps1`, sonst verweigert PowerShell die Ausführung.

---

## Zuordnung Hotel → Vorrat

`vorratKennung` sucht Kandidaten über Stadt **oder** Name, dann in zwei Stufen:
erst deckungsgleicher Name, dann Teilmenge der bedeutungstragenden Wörter.
Passt mehr als ein Haus, wird nichts zugeordnet.

Der Fehler, der lange unbemerkt blieb: Die Suche lief nur über die Stadt, und im
Marriott-Vorrat ist `city` leer, weil `roomCards` sie nicht liefert. Dadurch
fand die Abfrage nie Kandidaten — selbst bei identischen Namen.

Was weiterhin nicht zugeordnet wird, sind Namen ohne Ortsangabe wie „Courtyard
by Marriott". Das ist Absicht: eine Zuordnung wäre geraten.

---

## Offen

- **Radisson ohne Automatik.** Neue Häuser bekommen Kategorien nur, wenn die
  Brücke läuft. Zwei Verbesserungen sind besprochen, aber nicht gebaut: die
  Kettenadresse beim Anlegen speichern, auch wenn die Recherche scheitert, und
  die Brücke als geplante Aufgabe nachts laufen lassen.
- **Gemischte Sprachen.** Hilton deutsch, Radisson englisch, Marriott teils
  englisch. Marriotts `locale=de-DE` wird nicht überall befolgt.
- **Englische Marriott-Häuser werden schlechter bereinigt.** `canonicalRoomName`
  ist auf deutsche Muster gebaut. Bei US-Häusern stehen
  Ausstattungsmerkmale als eigene „Zimmer" (`Hydrotherapy Shower`,
  `Window Alcove`). Für Europa ohne Belang, deshalb bewusst nicht weiter
  verfolgt.
- **Marriott-Vorrat ohne Stadt und Land.** Eine Einschränkung auf Regionen ist
  damit nicht möglich; es liegen alle 2.951 Häuser drin, auch außereuropäische.

---

## Namen der Zimmerkategorien

Manche Häuser führen jede Bettvariante als eigene Kategorie. Für die
Upgrade-Leiter ist das falsch. Deshalb wird beim Speichern vereinheitlicht:

- Bettangaben, Schlafraumangaben und „Zugang zur Executive Lounge" werden
  abgeschnitten
- **Der Ausblick bleibt eine eigene Kategorie** — Meerblick ist laut Nutzer
  eine echte Aufwertung
- Doppelte werden zusammengefasst, Bettarten mit „oder" verbunden

Je Kette gibt es eigene Regeln, weil jede anders schreibt — `hiltonRoomName`
und `hiltonSchluessel`, `marriottRoomName` und `bettSaeubern`,
`radissonZimmerAusObjekten`. Was für eine Kette gebaut wird, gehört **nicht**
in `canonicalRoomName`: dort ändert es alle drei gleichzeitig.

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
