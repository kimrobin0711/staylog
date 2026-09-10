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

---

## Vorrat für ganze Regionen

`vorrat.mjs` legt die Kategorien aller Hilton-Häuser einer Region an — auch für
Häuser, in denen niemand aus der Runde je war. Trägt später jemand ein Hilton
ein, sind die Kategorien sofort da: kein Abruf, kein Modell, dieser Rechner
muss nicht laufen.

Der Vorrat liegt in eigenen Tabellen (`chain_hotels`, `chain_rooms`),
geschlüsselt nach der Kennung. Die Hotelliste der App bleibt davon unberührt.

**Vorher einmalig** die Tabellen anlegen:

```powershell
cd ..
npx wrangler d1 execute staylog --remote --file=.\migration-vorrat.sql
cd bruecke
```

Dann:

```powershell
node vorrat.mjs --nur-liste   # nur zählen, nichts abrufen
node vorrat.mjs               # Europa
node vorrat.mjs --land DE,AT,CH
node vorrat.mjs --neu         # auch schon vorhandene auffrischen
```

### Wie die Häuser gefunden werden

Hilton teilt die Weltkarte in Quadranten. Eine Abfrage liefert alle Quadranten
mit den enthaltenen Ländern, eine zweite je Quadrant alle Häuser darin — mit
Kennung, Name, Marke, Stadt, Land und Koordinaten. Für Europa sind das 33
Abfragen statt hunderter Seitenaufrufe.

Ein zweiter Lauf holt nur, was noch fehlt. Fehlgeschlagene Häuser stehen am
Ende und kommen beim nächsten Mal wieder dran.

### Alterung

Jeder Eintrag trägt ein Datum. Häuser benennen ihre Kategorien um, deshalb
gehört der Vorrat gelegentlich aufgefrischt — `--neu` holt alles neu.

### Drosselung

Hilton drosselt die Suchabfrage: Der erste Aufruf geht durch, kurz danach folgende
kommen als `Forbidden` zurück. Die Ernte wartet deshalb standardmäßig 5 Sekunden
zwischen den Quadranten, bei `Forbidden` zusätzlich 20 Sekunden und baut im
dritten Anlauf die Sitzung neu auf.

Zu knapp bemessen? Beide Pausen lassen sich hochsetzen:

```powershell
$env:PAUSE_ERNTE = "10000"
$env:PAUSE_ZIMMER = "2500"
node vorrat.mjs
```

### Die Hausliste wird gespeichert

Die Ernte ist der empfindliche Teil — Hilton drosselt die Suchabfrage hart und
lässt sie zeitweise gar nicht zu. Deshalb legt das Skript die gefundenen Häuser
nach jedem Quadranten in `haeuser.json` ab und benutzt diese Datei bei jedem
weiteren Lauf, statt neu zu ernten.

```powershell
node vorrat.mjs            # nimmt haeuser.json, falls vorhanden
node vorrat.mjs --frisch   # erntet neu (nur nötig, wenn Häuser dazugekommen sind)
```

Bricht die Ernte mittendrin ab, bleibt der bis dahin gefundene Teil erhalten;
ein erneuter Aufruf mit `--frisch` ergänzt ihn.

Die Zimmerabfragen sind **nicht** gedrosselt. Liegt `haeuser.json` vor, läuft
ein Durchgang also ohne die problematische Suchabfrage.

### Ohne Ernte: Kennungen aus einer Datei

Hilton drosselt die Suchabfrage zeitweise so hart, dass die Ernte gar nicht
läuft. Die Zimmerabfrage ist davon nicht betroffen. Liegt eine Liste von
Kennungen vor, geht es also auch ganz ohne:

```powershell
node vorrat.mjs --datei kennungen.txt
```

Eine Kennung je Zeile:

```
FRAHITW
BERHITW
MUCHITW
```

Name, Marke, Stadt und Land holt der Server aus der Zimmerantwort selbst — es
braucht keine Stammdaten in der Datei.

### Sondierung: was liefert eine Seite von sich aus?

`erkunde.mjs` öffnet eine Seite und zeigt, was im ausgelieferten HTML steckt —
ohne einen einzigen Aufruf an die Schnittstelle.

```powershell
node erkunde.mjs https://www.hilton.com/de/locations/germany/
node erkunde.mjs https://www.hilton.com/de/hotels/frahitw-hilton-frankfurt-city-centre/rooms/ --voll
```

Es durchsucht `__NEXT_DATA__` und verwandte Zustände nach Objekten mit
Kennung, liest zusätzlich alle Verweise auf Hotelseiten aus dem sichtbaren
Baum und schreibt alle Fundstücke nach `kennungen.txt`. Die lässt sich direkt
weiterverwenden:

```powershell
node vorrat.mjs --datei kennungen.txt
```

Mit `--voll` wird der gefundene Zustand komplett als JSON abgelegt.

**Befund vom 10.9.:** Die Zimmerseite trägt `props.pageProps.hotelRoomsSchema`
mit allen Kategorien samt Beschreibung, Bettart und Bildern, dazu
`hotelRoomTypeCategories` mit der Einteilung. Für Zimmerdaten braucht es also
gar keinen Aufruf — sie stehen im Dokument.

---

## Die Ernte ohne Schnittstelle

`ernte.mjs` sammelt die Häuser, indem es die Standortseiten ganz normal öffnet
und liest, was die Seite selbst mitbringt. **Es wird keine Schnittstelle
aufgerufen** — die Suchabfrage ist gedrosselt, Seitenaufrufe sind es nicht.

```powershell
node ernte.mjs                        # Europa
node ernte.mjs --land germany         # ein Land (Hilton-Schreibweise, englisch)
node ernte.mjs --tempo 4000           # Pause zwischen Seiten in ms
```

Jede Länderseite zeigt nur die ersten 20 Häuser, verlinkt aber alle ihre Städte
(Deutschland: 32). Die Städte haben selten mehr als 20 — über sie wird das Land
vollständig. Für Europa sind das etwa 550 Seitenaufrufe, gut anderthalb Stunden.

Das Ergebnis landet in `haeuser.json` und wird **nach jedem Land** gesichert.
Ein erneuter Aufruf ergänzt die Datei, statt sie zu ersetzen — ein Abbruch
kostet also nichts.

Danach wie gehabt:

```powershell
node vorrat.mjs
```
