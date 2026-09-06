# stayLOG

Aufenthaltsbuch für Hotelstatus. Trag ein, was du gebucht hast und was du bekommen hast —
die App rechnet daraus aus, was der Status tatsächlich gebracht hat, und du kannst den
Eintrag als fertigen Textblock in die WhatsApp-Gruppe schieben.

## Wie es funktioniert

Land → Stadt → Hotel läuft über OpenStreetMap (Nominatim für Orte, Overpass für Hotels),
beides ohne Schlüssel und ohne Kosten.

Sobald ein Hotel zum ersten Mal angelegt wird, startet im Hintergrund eine Recherche über
die Claude API mit eingeschaltetem Web-Search-Werkzeug. Sie liefert die Zimmerkategorien
mit Rangfolge, die Kette, die Marke, das Treueprogramm und einen Hinweis zur Lounge.
Das Ergebnis erscheint als **Vorschlagsliste mit Häkchen** — erst was du bestätigst, wird
zum Katalog des Hotels. Der Aufruf läuft genau einmal pro Hotel, nicht pro Aufenthalt.

Die Rangfolge ist der Punkt, an dem alles hängt: nur mit einer geordneten Leiter lässt sich
sagen, ob ein Upgrade eine oder drei Kategorien gebracht hat.

## Einrichten

```powershell
cd C:\Users\Administrator\Desktop\stayLOG
npm install -D wrangler

# Datenbank anlegen und die ausgegebene database_id in wrangler.toml eintragen
npx wrangler d1 create staylog
npx wrangler d1 execute staylog --remote --file=.\schema.sql

# Bilderspeicher
npx wrangler r2 bucket create staylog-photos

# Pages-Projekt anlegen und hochladen
npx wrangler pages project create staylog
npx wrangler pages deploy public

# Geheimnisse setzen
npx wrangler pages secret put ANTHROPIC_API_KEY
npx wrangler pages secret put STAY_PASSWORD
npx wrangler pages secret put ADMIN_PASSWORD
```

`STAY_PASSWORD` ist ein gemeinsames Passwort für die ganze Runde. Wer es hat, kommt rein.
Beim ersten Anmelden trägt jeder zusätzlich seinen Namen ein — der steht später unter
seinen Einträgen und wird im Gerät gemerkt. Der Name ist keine zweite Hürde, sondern nur
die Unterschrift: über den eigenen Namen in der Kopfzeile lässt er sich jederzeit ändern.

Alle sehen alle Einträge, löschen kann jeder nur seine eigenen.

`ADMIN_PASSWORD` gehört nur dir. Es öffnet unter *Auswertung* das Zugriffsprotokoll.

## Zugriffsprotokoll

Mitgeschrieben werden Anmeldungen (auch fehlgeschlagene), angelegte Hotels, eingetragene
und gelöschte Aufenthalte und hochgeladene Bilder — jeweils mit Zeitpunkt, Name, IP-Adresse,
Ort, Netzbetreiber und Browserkennung. Ort und Netz liefert Cloudflare gleich mit.

Nach zehn Fehlversuchen von derselben IP-Adresse innerhalb einer Viertelstunde ist das
Anmelden von dort für eine Viertelstunde gesperrt.

Einträge älter als 30 Tage werden automatisch gelöscht. IP-Adressen sind personenbezogene
Daten: sag der Runde, dass mitprotokolliert wird.

Bindings für D1 und R2 musst du im Cloudflare-Dashboard unter
*Workers & Pages → staylog → Settings → Functions* einmalig zuordnen
(`DB` auf die Datenbank, `PHOTOS` auf den Bucket), sonst greift die API ins Leere.

## Kosten

OpenStreetMap ist kostenlos. Cloudflare D1 und R2 liegen bei diesem Volumen im Freikontingent.
Die Claude API kostet 10 Dollar pro 1.000 Suchen plus Token, bei höchstens vier Suchen je
Hotel und einem Aufruf pro Hotel. Zweihundert Hotels bleiben damit im einstelligen Bereich.

## Variablen und Geheimnisse

| Name | Art | Zweck |
|---|---|---|
| `STAY_PASSWORD` | Secret | gemeinsames Passwort der Runde |
| `ADMIN_PASSWORD` | Secret | öffnet Protokoll und Verwaltung |
| `ADMIN_EMAIL` | Text | Adresse, die den Verwaltungsbereich sieht |
| `ANTHROPIC_API_KEY` | Secret | für die Zimmerrecherche |
| `ANTHROPIC_MODEL` | Text | z. B. `claude-haiku-4-5-20251001` |
| `WEB_SEARCH_TOOL` | Text | `web_search_20250305` |
| `GOOGLE_API_KEY` | Secret | optional, Bewertung und Bilder |
| `OPEN_MODE` | Text | `read` oder `full`, sonst leer lassen |

## Veröffentlichen

```powershell
.\build.ps1
```

Das Skript vergibt eine Version, schreibt sie in `version.json`, in die Pfade von
`app.js` und `styles.css` und in den Zwischenspeicher — dann lädt es hoch. Angemeldete
Nutzer bekommen daraufhin oben eine Leiste mit dem Hinweis auf die neue Fassung.

## Später

- Aliase für Zimmerkategorien mit eigener Oberfläche
- Booking.com Demand API als zusätzliche Quelle, falls der Affiliate-Zugang kommt
