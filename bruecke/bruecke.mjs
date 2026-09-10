// stayLOG-Bruecke
//
// Holt die Zimmerkategorien der Hilton-Haeuser ueber einen echten Browser auf
// diesem Rechner und schickt sie an stayLOG.
//
// Hintergrund: Hilton laesst Anfragen nur durch, wenn ein Cookie vorliegt, das
// Akamais Pruefskript im Browser selbst erzeugt. Cloudflare kommt deshalb nicht
// heran. Dieses Skript baut nichts nach – es oeffnet die Seite, laesst sie ihre
// eigene Abfrage machen und liest die Antwort mit.
//
// Aufruf:  node bruecke.mjs
//          node bruecke.mjs --alle        (auch Haeuser, die schon Namen haben)
//          node bruecke.mjs --trocken     (nichts speichern, nur zeigen)

import { chromium, firefox } from 'playwright';
import readline from 'node:readline/promises';

const BASIS = process.env.STAYLOG_URL || 'https://staylog.pages.dev';
const NUTZER = process.env.STAYLOG_USER || '';
const PASSWORT = process.env.STAY_PASSWORD || '';

const alle = process.argv.includes('--alle');
const trocken = process.argv.includes('--trocken');

const warte = (ms) => new Promise((f) => setTimeout(f, ms));

// ---------------------------------------------------------------- Anmeldung

async function frageAb() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const nutzer = NUTZER || await rl.question('E-Mail (Verwaltung): ');
  const passwort = PASSWORT || await rl.question('STAY_PASSWORD: ');
  rl.close();
  return { nutzer: nutzer.trim(), passwort: passwort.trim() };
}

// ------------------------------------------------------------------ Abfrage

// Die schlanke Fassung: nur Inhalt, kein Datum, kleine Antwort.
const ABFRAGE_KURZ = `query hotel_roomTypes($ctyhocn: String!, $language: String!) {
  hotel(ctyhocn: $ctyhocn, language: $language) {
    roomTypeCategories { category roomTypes { roomTypeCode } }
    roomTypes {
      accommodationCode
      roomTypeCode
      roomTypeName @toTitleCase
      desc: customDescription
      highlights: features(first: 8) { name }
    }
  }
}`;

// Rueckfall: die Fassung, die die Seite selbst schickt. Braucht ein Datum.
const ABFRAGE_VOLL = `query hotel_shopPropAvail($ctyhocn: String!, $arrivalDate: String!, $departureDate: String!, $numRooms: Int!, $numAdults: Int!, $numChildren: Int!, $language: String!) {
  hotel(ctyhocn: $ctyhocn, language: $language) {
    shopAvail(
      input: {arrivalDate: $arrivalDate, departureDate: $departureDate, numRooms: $numRooms, numAdults: $numAdults, numChildren: $numChildren}
    ) { currencyCode }
    roomTypeCategories { category roomTypes { roomTypeCode } }
    roomTypes {
      accommodationCode
      roomTypeCode
      roomTypeName @toTitleCase
      desc: customDescription
    }
  }
}`;

// Laeuft im Seitenkontext: gleiche Herkunft, Cookies gehen automatisch mit.
async function holeImBrowser(page, ctyhocn) {
  return page.evaluate(async ({ ctyhocn, kurz, voll }) => {
    const tag = (plus) => new Date(Date.now() + plus * 86400000).toISOString().slice(0, 10);

    const versuch = async (name, query, variables) => {
      const url = '/graphql/customer?appName=dx-property-ui'
        + '&appVersion=dx-property-ui%3A1024021'
        + '&operationName=' + name
        + '&originalOpName=getHotelRooms&bl=de&language=de';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'dx-platform': 'web' },
        body: JSON.stringify({ operationName: name, query, variables }),
      });
      const roh = await res.text();
      let daten = null;
      try { daten = JSON.parse(roh); } catch {
        return { fehler: 'HTTP ' + res.status + ', kein JSON: ' + roh.slice(0, 150) };
      }
      if (daten?.errors?.length) {
        return { fehler: daten.errors.map((f) => f?.message).join(' | ').slice(0, 200) };
      }
      const h = daten?.data?.hotel;
      return h?.roomTypes?.length ? { hotel: h } : { fehler: 'keine roomTypes in der Antwort' };
    };

    let a = await versuch('hotel_roomTypes', kurz, { ctyhocn, language: 'de' });
    if (a.hotel) return a;

    const b = await versuch('hotel_shopPropAvail', voll, {
      ctyhocn, language: 'de',
      arrivalDate: tag(30), departureDate: tag(31),
      numRooms: 1, numAdults: 1, numChildren: 0,
    });
    return b.hotel ? b : { fehler: a.fehler + ' / ' + b.fehler };
  }, { ctyhocn, kurz: ABFRAGE_KURZ, voll: ABFRAGE_VOLL });
}

// ------------------------------------------------------------------ Browser

// Erst das installierte Chrome oder Edge, sonst Playwrights eigenes Chromium,
// zuletzt Firefox. Ein echter Browser faellt weniger auf als ein mitgelieferter.
async function starteBrowser() {
  for (const kanal of ['chrome', 'msedge']) {
    try {
      const b = await chromium.launch({ channel: kanal, headless: false });
      console.log('Browser: ' + kanal);
      return b;
    } catch { /* naechster */ }
  }
  try {
    const b = await chromium.launch({ headless: false });
    console.log('Browser: mitgeliefertes Chromium');
    return b;
  } catch { /* dann Firefox */ }
  const b = await firefox.launch({ headless: false });
  console.log('Browser: Firefox');
  return b;
}

// --------------------------------------------------------------------- Lauf

const { nutzer, passwort } = await frageAb();
const kopf = { 'x-stay-pass': passwort, 'x-stay-user': nutzer };

console.log('\nHole die offenen Haeuser von ' + BASIS + ' ...');
const listeRes = await fetch(
  BASIS + '/api/hotels/offen?kette=hilton' + (alle ? '&alle=1' : ''),
  { headers: kopf }
);
if (!listeRes.ok) {
  console.error('Liste fehlgeschlagen: HTTP ' + listeRes.status + ' ' + await listeRes.text());
  process.exit(1);
}
const { haeuser } = await listeRes.json();

const machbar = haeuser.filter((h) => h.ctyhocn);
const ohneKennung = haeuser.filter((h) => !h.ctyhocn);

console.log(haeuser.length + ' Haeuser, davon ' + machbar.length + ' mit Kennung.');
if (ohneKennung.length) {
  console.log('\nOhne Hilton-Adresse in der Datenbank, uebersprungen:');
  for (const h of ohneKennung) console.log('  #' + h.id + '  ' + h.name);
  console.log('  (Webseite im Verwaltungsbereich auf die hilton.com-Adresse setzen)');
}
if (!machbar.length) process.exit(0);

const browser = await starteBrowser();
const kontext = await browser.newContext({ locale: 'de-DE' });
const page = await kontext.newPage();

// Einmal anmelden: eine beliebige Zimmerseite oeffnen, damit Akamais Skript
// laeuft und das Cookie fuer hilton.com steht.
// "commit" statt "domcontentloaded": Hiltons Seiten laden hunderte
// Fremdskripte, das Ereignis kann ausbleiben. Ein Fehlschlag bricht den Lauf
// nicht ab, sondern wird bis zu dreimal wiederholt.
async function sitzungAufbauen(seite) {
  console.log('\nSitzung aufbauen: ' + seite);
  for (let versuch = 1; versuch <= 3; versuch += 1) {
    try {
      await page.goto(seite, { waitUntil: 'commit', timeout: 45000 });
      await warte(12000);
      return true;
    } catch (err) {
      console.log('  Seitenaufbau fehlgeschlagen (' + versuch + '/3): '
        + String(err.message || err).split('\n')[0]);
      await warte(5000 * versuch);
    }
  }
  return false;
}

await sitzungAufbauen(machbar[0].zimmerseite);

const erfolge = [];
const fehler = [];

for (const [i, h] of machbar.entries()) {
  process.stdout.write('[' + (i + 1) + '/' + machbar.length + '] ' + h.name + ' (' + h.ctyhocn + ') ... ');

  let a = await holeImBrowser(page, h.ctyhocn).catch((e) => ({ fehler: String(e.message || e) }));

  // Akamai frischt die Sitzung nach einigen Minuten auf. Dann neu laden.
  if (!a.hotel) {
    process.stdout.write('Sitzung erneuern ... ');
    await sitzungAufbauen(h.zimmerseite);
    a = await holeImBrowser(page, h.ctyhocn).catch((e) => ({ fehler: String(e.message || e) }));
  }

  if (!a.hotel) {
    console.log('FEHLER: ' + a.fehler);
    fehler.push({ ...h, grund: a.fehler });
    continue;
  }

  const anzahl = a.hotel.roomTypes.length;

  if (trocken) {
    console.log(anzahl + ' Kategorien (trocken, nicht gespeichert)');
    erfolge.push(h);
    await warte(1500);
    continue;
  }

  const res = await fetch(BASIS + '/api/hotels/' + h.id + '/import', {
    method: 'POST',
    headers: { ...kopf, 'content-type': 'application/json' },
    body: JSON.stringify({ kette: 'hilton', quelle: h.zimmerseite, antwort: a.hotel }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.log('SPEICHERN FEHLGESCHLAGEN: HTTP ' + res.status + ' ' + text.slice(0, 200));
    fehler.push({ ...h, grund: 'Speichern: ' + text.slice(0, 120) });
  } else {
    const antwort = await res.json();
    console.log(anzahl + ' roh -> ' + antwort.gespeichert + ' gespeichert'
      + (antwort.sortiert_vom_modell ? '' : ' (Reihenfolge geschaetzt)'));
    erfolge.push(h);
  }

  await warte(1500);   // der Seite Luft lassen
}

await browser.close();

console.log('\n--------------------------------------------');
console.log('Fertig: ' + erfolge.length + ' erledigt, ' + fehler.length + ' offen.');
if (fehler.length) {
  for (const f of fehler) console.log('  #' + f.id + '  ' + f.name + ' — ' + f.grund);
}
