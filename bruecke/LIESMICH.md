# stayLOG-Brücke

Holt die Zimmerkategorien der Hilton-Häuser über einen echten Browser auf
diesem Rechner und schickt sie an stayLOG.

## Warum

Hilton lässt Anfragen nur durch, wenn ein Cookie vorliegt, das Akamais
Prüfskript im Browser selbst erzeugt. Cloudflare kommt deshalb nicht heran —
der Dienst weist sich über nicht änderbare Kopfzeilen als Bot aus.

Die Brücke baut nichts nach. Sie öffnet die Zimmerseite, lässt die Seite ihre
eigene Abfrage machen und liest die Antwort mit. Bereinigt und gespeichert wird
auf dem Server, mit derselben Funktion wie bei Marriott.

## Einrichten (einmalig)

```powershell
cd C:\Users\Administrator\Desktop\stayLOG\bruecke
npm install
```

Playwright benutzt Dein installiertes Chrome oder Edge. Falls keines von beiden
da ist, lädt es sich beim ersten Lauf selbst einen Browser:

```powershell
npx playwright install chromium
```

## Laufen lassen

```powershell
node bruecke.mjs
```

E-Mail und Passwort werden abgefragt. Die E-Mail muss die aus `ADMIN_EMAIL`
sein — nur die Verwaltung darf schreiben.

Ohne Nachfragen, wenn die Werte in der Umgebung stehen:

```powershell
$env:STAYLOG_USER = "kimhoehe@web.de"
$env:STAY_PASSWORD = "..."
node bruecke.mjs
```

## Schalter

| Schalter | Wirkung |
|---|---|
| *(keiner)* | nur Häuser ohne amtliche Kategorien |
| `--alle` | auch Häuser, die schon amtliche Namen haben — zum Auffrischen |
| `--trocken` | abfragen und zählen, aber nichts speichern |

## Ablauf

1. Liste der offenen Häuser von `/api/hotels/offen?kette=hilton`
2. Browser auf, eine Zimmerseite öffnen — dabei läuft Akamais Skript und das
   Cookie steht für `hilton.com` insgesamt
3. Je Haus eine Abfrage aus der laufenden Seite heraus, 1,5 Sekunden Pause
4. Antwort an `/api/hotels/:id/import`, dort wird bereinigt, sortiert und
   gespeichert

Der Seitenaufbau fällt einmal an, nicht pro Haus. Läuft die Sitzung ab, lädt
die Brücke die Seite neu und macht weiter.

## Häuser ohne Kennung

Steht in stayLOG keine hilton.com-Adresse, fehlt der CTYHOCN und das Haus wird
übersprungen. Es wird am Ende aufgelistet. Abhilfe: die Webseite im
Verwaltungsbereich auf die Adresse der Kette setzen, dann beim nächsten Lauf
mitnehmen.
