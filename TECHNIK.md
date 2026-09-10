# stayLOG — Technische Dokumentation

Stand: 9. September 2026

---

## 1. Aufbau

| Teil | Technik | Ort |
|---|---|---|
| Oberfläche | reines HTML, CSS, JavaScript, keine Bibliotheken | `public/` |
| Server | Cloudflare Pages Functions | `functions/api/[[path]].js` |
| Datenbank | Cloudflare D1 (SQLite) | Bindung `DB`, Name `staylog` |
| Bilder | Cloudflare R2 | Bindung `PHOTOS`, Bucket `staylog-photos` |
| Adresse | https://staylog.pages.dev | |
| Veröffentlichen | `.\build.ps1` | vergibt Version, deployt |

Die Bindungen stehen seit dem 8.9. in `wrangler.toml` und **nicht mehr** im
Dashboard. Geheimnisse und Textvariablen bleiben im Dashboard.

---

## 2. Geheimnisse und Variablen

| Name | Art | Zweck | Pflicht |
|---|---|---|---|
| `STAY_PASSWORD` | Secret | gemeinsames Passwort der Runde | ja |
| `ADMIN_PASSWORD` | Secret | Protokoll und Löschfunktionen | ja |
| `ADMIN_EMAIL` | Secret | Adresse, die den Verwaltungsbereich sieht | ja |
| `ANTHROPIC_API_KEY` | Secret | Zimmerrecherche | ja |
| `ANTHROPIC_MODEL` | Secret | z. B. `claude-haiku-4-5-20251001` | nein |
| `WEB_SEARCH_TOOL` | Secret | `web_search_20250305` | nein |
| `GOOGLE_API_KEY` | Secret | Bewertung, Bilder, Hotelnamenssuche | nein |
| `GOOGLE_MONTHLY_LIMIT` | Secret | Vorgabe 800 | nein |
| `CF_ACCOUNT_ID` | Secret | Browserdienst | nein |
| `CF_BROWSER_TOKEN` | Secret | Token mit Berechtigung *Browser Run → Edit* | nein |
| `BROWSER_MONTHLY_LIMIT` | Secret | Vorgabe 600 | nein |
| `SCRAPINGBEE_API_KEY` | Secret | nur für das Prüfwerkzeug `/probe` | nein |
| `OPEN_MODE` | Text | `read` oder `full`; leer = nur mit Passwort | nein |

**Wichtig:** Änderungen an Variablen greifen erst nach einem Deploy.

---

## 3. Eigene Schnittstellen

Alle unter `/api/`. Anmeldung über die Kopfzeilen `x-stay-pass` und
`x-stay-user`, außer wo anders vermerkt.

### Ohne Anmeldung

| Weg | Art | Zweck |
|---|---|---|
| `/health` | GET | Prüfseite: welche Geheimnisse hinterlegt sind, ob Datenbank und Bilderspeicher verbunden sind |
| `/geo/ping?q=` | GET | Ortssuche testen |
| `/photos/:key` | GET | Bild ausliefern |

### Anmeldung und Konto

| Weg | Art | Zweck |
|---|---|---|
| `/login` | POST | Anmelden oder registrieren. Antwort enthält Name, Adresse, Statuslevel, Betriebsart und `is_admin` |
| `/me/status` | GET, PUT | eigene Statuslevel je Programm |
| `/people` | GET | alle Mitglieder |

### Orte und Hotels

| Weg | Art | Zweck |
|---|---|---|
| `/geo/cities?country=&q=` | GET | Ortssuche |
| `/geo/hotels?lat=&lon=&radius=` | GET | Umkreissuche. Liefert zuerst die Häuser, die stayLOG schon kennt (`known: true`), danach neue aus OpenStreetMap |
| `/geo/hotel-search?q=&lat=&lon=&city=` | GET | Namenssuche |
| `/hotels` | GET, POST | Liste, Anlegen mit Deduplizierung |
| `/hotels/:id` | GET | Hoteldetails samt Zimmerkategorien |
| `/hotels/:id/community` | GET | Auswertung des Hauses: Quoten je Statuslevel, Upgrade-Wege, Benefits, alle Aufenthalte |
| `/hotels/:id/images` | GET | Bild und Bewertung. Beides liegt in der Datenbank, Google wird höchstens einmal im Monat je Haus gefragt |
| `/hotels/:id/enrich?wait=1` | POST | Zimmerrecherche, wartend. Einmal im Monat je Haus, sofern schon drei Kategorien vorliegen |
| `/hotels/:id/enrich?debug=1` | POST | Diagnose ohne Speichern: gelesene Seiten, Rohantwort des Modells, gefundene Namen, `marsha`, `ctyhocn`, `hilton_fehler` |
| `/hotels/:id/rooms` | POST | Kategorien bestätigen, sortieren, umbenennen (`{rename:{von,nach}}`), ergänzen, entfernen |
| `/hotels/status` | GET | Zustand aller Recherchen |
| `/hotels/offen?kette=hilton&alle=` | GET | Liste für die Brücke: Häuser einer Kette samt CTYHOCN und Zimmerseite. Nur Verwaltung |
| `/hotels/:id/import` | POST | Nimmt die Rohantwort der Brücke entgegen, bereinigt, sortiert, speichert. Nur Verwaltung |
| `/chain/bekannt?kette=hilton` | GET | Welche Kennungen liegen im Vorrat. Nur Verwaltung |
| `/chain/hilton` | POST | Nimmt ein Haus in den Vorrat auf. Nur Verwaltung |
| `/hotels/unstick` | POST | hängende Läufe freigeben |

### Aufenthalte

| Weg | Art | Zweck |
|---|---|---|
| `/stays?program=&author=&status=&hotel=&land=&city=&upgraded=` | GET | Liste |
| `/stays` | POST | anlegen. Setzt nebenbei das Programm beim Hotel, falls dort noch keins steht |
| `/stays/:id` | PUT, DELETE | ändern, löschen (nur eigene) |
| `/photos?stay_id=&caption=` | POST | Bild hochladen |
| `/filters` | GET | Filterwerte samt Anzahl der Aufenthalte je Hotel |
| `/stats?author=` | GET | Auswertung je Programm und Statuslevel |
| `/tree` | GET | Baumdaten, derzeit ungenutzt |

### Verwaltung

Nur für die Adresse aus `ADMIN_EMAIL`.

| Weg | Art | Zweck |
|---|---|---|
| `/admin/summary` | GET | Zahlen und Verbrauch bei Google und Browser |
| `/admin/merge` | POST | doppelte Hotels zusammenführen |
| `/admin/reset` | POST | alles löschen. Verlangt zusätzlich `x-stay-admin` und `{confirm:"LOESCHEN"}` |
| `/log` | GET | Zugriffsprotokoll, verlangt `x-stay-admin` |
| `/hotels/:id/probe` | POST | Prüfwerkzeug für Buchungsansichten, speichert nichts |
| `/hotels/:id/playwright` | POST | Prüfwerkzeug über Cloudflares Rendern, speichert nichts |

---

## 4. Fremde Dienste

### Zimmerkategorien — die Kernfunktion

Die Recherche läuft in dieser Reihenfolge. Sobald eine Stufe eine
**verbindliche Liste** liefert, gilt sie; das Modell sortiert dann nur noch.

**Stufe 1 — Marriott, offene Abfrage.** Funktioniert, kostenlos.

```
GET https://www.marriott.com/services/marriott-hws/roomCards/
      ?marsha={CODE}&locale=de-DE&acrsEnabled=false
```

Der fünfstellige Code steht in jeder Marriott-Adresse:
`/hotels/vlcva-ac-hotel-valencia/` ergibt `VLCVA`. Gefunden wird er in der
gespeicherten Webseite, in der vom Modell gemeldeten Kettenadresse oder in den
Quelladressen der gefundenen Kategorien.

Die Antwort ist GraphQL: `data.property.roomTypes.edges[].node` mit `name`,
`description`, `roomTypeCode`, `maxOccupancy`, `longDescription`. Daraus lesen
wir Name, Beschreibung, Zimmercode, Größe, Bettentyp und Belegung.

Nötig sind eine Browser-Kennung und eine `referer`-Kopfzeile.

**Stufe 1b — Hilton, offene Abfrage.** Gleiche Rolle wie bei Marriott.

```
POST https://www.hilton.com/graphql/customer
     ?appName=dx-property-ui&appVersion=dx-property-ui%3A1024021
     &operationName=hotel_roomTypes&bl=de&language=de
```

Kennung ist der CTYHOCN aus der Adresse:
`/de/hotels/frahitw-hilton-frankfurt-city-centre/` ergibt `FRAHITW`.

Genutzt wird `hotel.roomTypes` — das ist **Inhalt, keine Verfügbarkeit**, es
braucht also kein Datum. Je Eintrag kommen `roomTypeName`, `roomTypeCode`,
`accommodationCode` (STD, EXEC, STE) und `customDescription` als HTML.
Zusätzlich ordnet `roomTypeCategories` jeden Code einer Gruppe zu: `guest`,
`executive`, `suites`. Das ist eine belastbare Grobsortierung für die
Upgrade-Leiter; das Modell muss nur noch innerhalb der Gruppen ordnen.

Nötig sind Browser-Kennung, `origin`, `referer` und `dx-platform: web`.
Cookies werden nicht mitgeschickt. Geht die schlanke Abfrage nicht durch,
folgt automatisch die Fassung, die die Seite selbst schickt
(`hotel_shopPropAvail`, mit Datum, sehr große Antwort).

Hilton führt jede Bettvariante als eigene Kategorie. `hiltonRoomName`
schneidet „mit King-Size-Bett" ab, setzt „Zweibettzimmer" auf „Zimmer" und
entfernt den angehängten Loungezugang („– Zutritt zur Lounge"), der ohnehin
schon in der Kategorie steckt. Die Bettarten landen mit „oder" verbunden im
Feld `bed_type`.

`hiltonSchluessel` gleicht zusätzlich die Schreibweisen des Ausblicks an:
Hilton übersetzt uneinheitlich, „Zimmer und Domblick", „Zimmer mit Domblick"
und „Zimmer mit Blick auf den Dom" sind dasselbe. Für den Vergleich werden
„und" zu „mit", „Blick auf den X" zu „X" und das Wort „blick" entfernt.
Angezeigt wird weiterhin die Schreibweise, die zuerst kam.

Frankfurt: 17 Einträge werden zu 13. Berlin: 29 werden zu 25 — dort gibt es
tatsächlich so viele Kategorien.

Prüfen ohne Deploy: `.\test-hilton.ps1 FRAHITW`

**Stufe 2 — schema.org.** Viele Ketten legen ihre Kategorien als
`"@type":"HotelRoom"` ins HTML. Bei Hilton stehen dort Name, Beschreibung,
Bettentyp und Größe. Erst wird die Zimmerseite normal abgerufen, bei einer
Sperre über Cloudflares Browser als **rohes HTML** (`/content`, nicht
`/markdown` — die Markdown-Fassung wirft die Blöcke weg).

**Stufe 3 — Seitentext.** Bei Marriott zusätzlich Galerie und Übersicht, sonst
nur die Zimmerseite. Wird über Cloudflares Browser gerendert, mit 22 Sekunden
Pause zwischen den Abrufen wegen der Ratenbegrenzung.

**Stufe 4 — eingegrenzte Suche.** Claude mit Websuche, beschränkt auf die
Domain der Kette. Findet das nichts, im zweiten Durchgang zusätzlich die
Portale booking.com, hotels.com, Expedia und Agoda. Deren Namen werden als
`portal_provisional` gekennzeichnet und in der Oberfläche als „vorläufig"
markiert. Metasuchen, Sammelseiten und PDFs sind ausgeschlossen.

Weniger als drei Kategorien gelten als unvollständig; dann wird nichts
gespeichert und die Oberfläche bietet das Selbsteintragen an.

**Sperren:** Marriott liefert eine abgespeckte Fassung an Rechenzentren,
deshalb die offene Abfrage. Bei **Hilton** blockt Akamai die Zimmerseite; ob
auch die GraphQL-Abfrage betroffen ist, zeigt `hilton_fehler` in der Diagnose.
**Radisson** ist weiterhin offen — dort liegt kein schema.org-Block im HTML,
die Liste wird ebenfalls per JSON nachgeladen. Die Abfrage ist noch nicht
mitgeschnitten.

### Ortssuche

| Dienst | Zweck | Kosten |
|---|---|---|
| Open-Meteo Geocoding | Städte | frei |
| Nominatim | Städte als Rückfall, Hotels nach Namen | frei |
| Overpass (zwei Spiegel) | Hotels im Umkreis | frei |
| Photon (Komoot) | Hotels nach Namen | frei |
| Google Places Text Search | Hotels nach Namen, aktuelle Marken | 5.000 frei im Monat |

Die Umkreissuche begrenzt Photon über einen Kasten und siebt anschließend alles
über 60 Kilometer aus.

### Bilder und Bewertung

Google Places, höchstens **ein** Bild je Haus. Beides wird in der Datenbank
gespeichert; die Bewertung wird höchstens einmal im Monat je Haus aufgefrischt.
Zusätzlich das Vorschaubild der Hotelseite und Wikimedia Commons als Rückfall.

### Claude

`https://api.anthropic.com/v1/messages` mit dem Werkzeug `web_search`. Zwei
Aufrufarten: die große Recherche mit 8.000 Token Antwortbudget, und ein
kleiner Sortieraufruf mit 1.500 Token ohne Websuche.

**Wichtig beim Einlesen:** Das Modell setzt seine Antwort oft in einen
Codeblock. Die Reparaturfunktion `parseLoose` probiert deshalb zuerst das
reine Abschneiden hinter der letzten Klammer, bevor sie Ergänzungen anhängt.
Fehlt das, scheitert jede saubere Antwort mit angehängtem Text.

---

## 5. Verbrauchszähler

Tabelle `usage_counter`, je Dienst und Monat. Gezählt werden `google` und
`browser`. Beide haben eine Obergrenze; ist sie erreicht, läuft alles weiter,
nur ohne den jeweiligen Dienst. Der Stand steht im Verwaltungsbereich.

---

## 6. Datenbank

Tabellen: `hotels`, `room_types`, `stays`, `photos`, `members`, `access_log`,
`usage_counter`, `chain_hotels`, `chain_rooms`.

`chain_hotels` und `chain_rooms` sind der **Vorrat**: Zimmerkategorien
geschlüsselt nach der Kennung der Kette, unabhängig von der Hotelliste. Dort
stehen auch Häuser, in denen niemand war. `verbindlicheListe` sieht zuerst dort
nach — liegt das Haus im Vorrat, gibt es gar keinen Abruf nach außen.

Erwähnenswerte Spalten:

- `hotels.enrich_status` — `pending`, `running`, `ready`, `incomplete`, `failed`
- `hotels.rank_reliable` — 0 heißt, die Reihenfolge ist geschätzt; die
  Oberfläche zeigt dann eine Warnung
- `hotels.image_url`, `rating`, `rating_count`, `rating_at` — gespeicherte
  Bilder und Bewertungen
- `room_types.confirmed` — von Hand bestätigt, wird nie überschrieben
- `room_types.provisional` — Name stammt von einem Buchungsportal
- `room_types.source` — `official_chain_api`, `official_schema_org`,
  `official_chain_site`, `search_snippet_official`, `portal_provisional`, `user`

Migrationen liegen als `migration-*.sql` bei und müssen einzeln ausgeführt
werden:

```powershell
npx wrangler d1 execute staylog --remote --file=.\migration-name.sql
```

---

## 7. Bekannte Grenzen

- **Radisson** ist über Cloudflare nicht erreichbar (Akamai) und liefert keine
  schema.org-Blöcke. Die JSON-Abfrage fehlt noch.
- **Hilton** ist aus Cloudflare heraus nicht erreichbar. Akamai antwortet auf die
  GraphQL-Abfrage mit `HTTP 200, text/html, "Success"` — die Anfrage kommt am
  Server nie an. Der Browserdienst hilft nicht: Cloudflare weist ihn laut eigener
  Dokumentation über nicht änderbare Kopfzeilen als Bot aus. Deshalb die Brücke
  (Abschnitt 8). In der Praxis spielt das kaum noch eine Rolle — der Vorrat
  deckt Europa ab, ein neu angelegtes Haus wird ohne Netzzugriff bedient.
- **Marriott-Zimmerseiten** laden ihre Liste erst bei einer
  Verfügbarkeitsabfrage; die offene Abfrage umgeht das.
- **Playwright** funktioniert in Pages Functions nicht (`fs.mkdtemp` fehlt).
  Die Datei `functions/api/hotels/[id]/playwright.js` nutzt deshalb den
  REST-Zugang.
- Die Prüfwerkzeuge `/probe` und `/playwright` sind Entwicklungsreste und
  können entfernt werden.
- `/tree` und `/geo/ping` werden von der Oberfläche nicht mehr aufgerufen.

---

## 8. Die Brücke

Liegt in `bruecke/`, läuft auf dem eigenen Rechner, gehört **nicht** zum Deploy.

Playwright startet das installierte Chrome oder Edge, öffnet eine
Hilton-Zimmerseite und lässt Akamais Prüfskript laufen. Danach steht das Cookie
für `hilton.com` insgesamt — jedes weitere Haus braucht nur noch eine Abfrage
aus der laufenden Seite heraus, kein neuer Seitenaufbau. Dreißig Häuser dauern
gut eine Minute.

Es wird nichts nachgebaut: Die Seite macht ihre eigene Abfrage, die Brücke liest
mit. Bereinigt, sortiert und gespeichert wird auf dem Server über
`/hotels/:id/import` — dort läuft dieselbe Funktion `hiltonZimmerAusAntwort`
wie beim normalen Abruf. Es gibt also weiterhin **eine** Bereinigung, nicht zwei.

```powershell
cd bruecke
npm install
node bruecke.mjs            # nur Häuser ohne amtliche Kategorien
node bruecke.mjs --alle     # auch zum Auffrischen
node bruecke.mjs --trocken  # abfragen, nichts speichern
```

Anmeldung mit der Adresse aus `ADMIN_EMAIL` und `STAY_PASSWORD`; beides lässt
sich über `$env:STAYLOG_USER` und `$env:STAY_PASSWORD` vorgeben.

Häuser ohne hilton.com-Adresse in der Datenbank haben keinen CTYHOCN und werden
übersprungen; sie stehen am Ende in der Zusammenfassung.

Einzelheiten in `bruecke/LIESMICH.md`.

### Vorrat füllen

`bruecke/vorrat.mjs`, ebenfalls über den Browser auf dem eigenen Rechner.

Hilton teilt die Weltkarte in Quadranten. `hotelQuadrants` liefert alle
Quadranten samt der enthaltenen Länder, `hotelSummaryOptions` je Quadrant alle
Häuser darin — mit `ctyhocn`, Name, Marke, Stadt, Land und Koordinaten. Für
Europa reichen 33 Abfragen; danach folgt je Haus die bekannte Zimmerabfrage.

Beide laufen unter `appName=dx_shop_search_app`, die Zimmerabfrage unter
`dx-property-ui`.

Sortiert wird im Vorrat **nicht** vom Modell — das wäre bei hunderten Häusern zu
langsam. Es gilt Hiltons eigene Einteilung (`guest`, `executive`, `suites`). Erst
wenn ein Haus tatsächlich in stayLOG landet, sortiert das Modell einmalig.

Tabellen vorher anlegen:

```powershell
npx wrangler d1 execute staylog --remote --file=.\migration-vorrat.sql
```

### Was im HTML der Seiten steht

Die entscheidende Erkenntnis vom 10.9.: Hiltons Seiten liefern ihre Daten im
Dokument mit, in `<script id="__NEXT_DATA__">`. Es braucht dafür **keinen
Aufruf an die Schnittstelle**.

| Seite | Fundstelle | Inhalt |
|---|---|---|
| Zimmerseite | `props.pageProps.hotelRoomsSchema` | alle Kategorien mit Beschreibung, Bettart, Bildern |
| Zimmerseite | `props.pageProps.hotelRoomTypeCategories` | Einteilung guest / executive / suites |
| Standortseite | `pageData.hotelSummaryOptions.hotels` | bis zu 20 Häuser mit Kennung, Marke, Ort, Koordinaten |
| Standortseite | `pageData.location.pageInterlinks` | Verweise auf alle Städte des Landes |

Das ist der Grund, warum die Ernte funktioniert, obwohl Hilton die Abfrage
`hotelSummaryOptions` gesperrt hat: Seitenaufrufe sind nicht gedrosselt.

Sollte irgendwann auch die Zimmerabfrage fallen, liegt der Rückweg bereit —
die Kategorien stehen im HTML jeder Zimmerseite.

`bruecke/erkunde.mjs` zeigt für eine beliebige Seite, was sie mitbringt.

### Stand des Vorrats

938 europäische Häuser, 7.623 Kategorien (10.9.2026). Nicht erfasst: fünf
Vacation Clubs ohne `roomTypes` sowie Russland, dessen Länderseite Hilton
nicht mehr führt. Die Türkei ist unvollständig (95 statt 108) — dort sind
Häuser in Städten, die die Länderseite nicht verlinkt.