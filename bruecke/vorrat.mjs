// stayLOG-Bruecke: Vorrat
//
// Legt die Zimmerkategorien ganzer Regionen an, unabhaengig davon, ob jemand
// dort schon war. Trägt später jemand ein Hilton ein, sind die Kategorien
// sofort da – ohne Recherche, ohne Modell, ohne diesen Rechner.
//
// Aufruf:  node vorrat.mjs                 (Europa)
//          node vorrat.mjs --land DE,AT,CH
//          node vorrat.mjs --nur-liste     (nur zaehlen, nichts abrufen)
//          node vorrat.mjs --neu           (auch Haeuser auffrischen, die schon drin sind)

import { chromium, firefox } from 'playwright';
import readline from 'node:readline/promises';
import fs from 'node:fs';

const BASIS = process.env.STAYLOG_URL || 'https://staylog.pages.dev';
const NUTZER = process.env.STAYLOG_USER || '';
const PASSWORT = process.env.STAY_PASSWORD || '';

const nurListe = process.argv.includes('--nur-liste');
// Die Ernte ist der empfindliche Teil – Hilton drosselt sie hart. Deshalb wird
// sie einmal gemacht und in haeuser.json abgelegt. --frisch erntet neu.
const frisch = process.argv.includes('--frisch');
const ABLAGE = 'haeuser.json';

// Kennungen aus einer Textdatei? Dann braucht es die Ernte gar nicht. Eine
// Kennung oder eine Hilton-Adresse je Zeile. Name, Marke, Stadt und Land holt
// der Server sich aus der Zimmerantwort selbst.
const kennungsdatei = (() => {
  const i = process.argv.indexOf('--datei');
  return i >= 0 ? process.argv[i + 1] : null;
})();

// Vor allem anderen pruefen – sonst geht erst der Browser auf und dann nichts.
if (kennungsdatei && !fs.existsSync(kennungsdatei)) {
  console.error('\n' + kennungsdatei + ' gibt es nicht.\n\n'
    + 'Die Datei enthaelt eine Kennung oder eine Hilton-Adresse je Zeile:\n'
    + '  FRAHITW\n'
    + '  https://www.hilton.com/de/hotels/berhitw-hilton-berlin/\n');
  process.exit(1);
}
const auffrischen = process.argv.includes('--neu');

const laenderArg = (() => {
  const i = process.argv.indexOf('--land');
  return i >= 0 && process.argv[i + 1]
    ? process.argv[i + 1].toUpperCase().split(',').map((s) => s.trim()).filter(Boolean)
    : null;
})();

// Europa einschliesslich Tuerkei, Russland und der kleinen Gebiete.
const EUROPA = ['AL', 'AD', 'AT', 'BY', 'BE', 'BA', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE',
  'FI', 'FR', 'GE', 'DE', 'GR', 'HU', 'IS', 'IE', 'IT', 'XK', 'LV', 'LI', 'LT', 'LU',
  'MT', 'MD', 'MC', 'ME', 'NL', 'MK', 'NO', 'PL', 'PT', 'RO', 'RU', 'SM', 'RS', 'SK',
  'SI', 'ES', 'SE', 'CH', 'TR', 'UA', 'GB', 'VA', 'GI', 'JE', 'GG', 'IM', 'FO'];

const LAENDER = new Set(laenderArg || EUROPA);
const warte = (ms) => new Promise((f) => setTimeout(f, ms));

// Hilton drosselt die Suchabfrage haerter als die Zimmerabfrage.
const PAUSE_ERNTE = Number(process.env.PAUSE_ERNTE || 2500);
const PAUSE_ZIMMER = Number(process.env.PAUSE_ZIMMER || 1200);

// ------------------------------------------------------------------ Abfragen

const Q_QUADRANTEN = `query hotelQuadrants {
  hotelQuadrants { id countries { code } }
}`;

const Q_HAEUSER = `query hotelSummaryOptions($language: String!, $input: HotelSummaryOptionsInput) {
  hotelSummaryOptions(language: $language, input: $input) {
    hotels {
      ctyhocn
      name
      brandCode
      address { city country countryName }
      facilityOverview { homeUrlTemplate }
      localization { coordinate { latitude longitude } }
    }
  }
}`;

// Rueckfall: genau die Abfrage, die Hiltons Suchseite selbst schickt.
const Q_HAEUSER_VOLL = `query hotelSummaryOptions($language: String!, $input: HotelSummaryOptionsInput) {
  hotelSummaryOptions(language: $language, input: $input) {
    hotels {
      amenityIds
      brandCode
      ctyhocn
      distance
      distanceFmt
      externalResSystem
      facilityOverview {
        allowAdultsOnly
        homeUrlTemplate
        isRecentlyRenovated
      }
      name
      display {
        open
        openDate
        preOpenMsg
        resEnabled
        resEnabledDate
        seasonallyClosed
        seasonalReopenDate
        treatments
      }
      contactInfo {
        phoneNumber
      }
      disclaimers {
        desc
        type
      }
      address {
        addressLine1
        city
        country
        countryName
        state
        stateName
        _id
      }
      localization {
        currencyCode
        coordinate {
          latitude
          longitude
        }
      }
      images {
        master(ratios: [threeByTwo]) {
          altText
          ratios {
            size
            url
          }
        }
        carousel(ratios: [threeByTwo]) {
          altText
          ratios {
            url
            size
          }
        }
      }
      tripAdvisorLocationSummary {
        numReviews
        rating
        ratingFmt(decimal: 1)
        ratingImageUrl
      }
      leadRate {
        lowest {
          cmaTotalPriceIndicator
          feeTransparencyIndicator
          rateAmount(currencyCode: "USD")
          rateAmountFmt(decimal: 0, strategy: ceiling)
          ratePlanCode
          ratePlan {
            ratePlanName @toTitleCase
            ratePlanDesc
          }
        }
        hhonors {
          lead {
            dailyRmPointsRate
            dailyRmPointsRateNumFmt: dailyRmPointsRateFmt(hint: number)
            ratePlan {
              ratePlanName @toTitleCase
              ratePlanDesc
            }
          }
          max {
            rateAmount
            rateAmountFmt
            dailyRmPointsRate
            dailyRmPointsRateRoundFmt: dailyRmPointsRateFmt(hint: round)
            dailyRmPointsRateNumFmt: dailyRmPointsRateFmt(hint: number)
            ratePlan {
              ratePlanCode
            }
          }
          min {
            rateAmount
            rateAmountFmt
            dailyRmPointsRate
            dailyRmPointsRateRoundFmt: dailyRmPointsRateFmt(hint: round)
            dailyRmPointsRateNumFmt: dailyRmPointsRateFmt(hint: number)
            ratePlan {
              ratePlanCode
            }
          }
        }
      }
    }
  }
}`;

// Ohne Stammdaten – falls Hilton die Felder am hotel-Typ nicht anbietet.
const Q_ZIMMER_SCHLANK = `query hotel_roomTypes($ctyhocn: String!, $language: String!) {
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

const Q_ZIMMER = `query hotel_roomTypes($ctyhocn: String!, $language: String!) {
  hotel(ctyhocn: $ctyhocn, language: $language) {
    name
    brandCode
    address { city country }
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

// Hilton laesst manche Abfragen nur mit passender App-Fassung zu. Ohne
// appVersion antwortet die Schnittstelle mit "Forbidden".
const APP_VERSION = {
  'dx_shop_search_app': 'dx-shop-search-ui:1030775',
  'dx-property-ui': 'dx-property-ui:1024021',
};

// Laeuft im Seitenkontext: gleiche Herkunft, Cookies gehen automatisch mit.
async function frage(page, app, name, query, variables) {
  const fassung = APP_VERSION[app] || '';
  return page.evaluate(async ({ app, name, query, variables, fassung }) => {
    const url = '/graphql/customer?appName=' + app
      + (fassung ? '&appVersion=' + encodeURIComponent(fassung) : '')
      + '&operationName=' + name + '&originalOpName=' + name + '&bl=de&language=de';
    // Die Seite schickt bei jeder Abfrage ihre Besucherkennung mit. Sie steht
    // im Cookie visitorId. Ohne sie laesst die Schnittstelle genau einen
    // Aufruf zu und antwortet danach mit "Forbidden".
    const besucher = (document.cookie.match(/(?:^|;\s*)visitorId=([^;]+)/) || [])[1] || '';
    const zufall = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, '0')).join('');

    const kopfzeilen = { 'content-type': 'application/json', 'dx-platform': 'web' };
    if (besucher) {
      kopfzeilen.visitorid = besucher;
      kopfzeilen.hltclientmessageid = besucher + '-' + zufall;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: kopfzeilen,
      body: JSON.stringify({ operationName: name, query, variables }),
    });
    const roh = await res.text();
    try {
      const d = JSON.parse(roh);
      if (d?.errors?.length) return { fehler: d.errors.map((f) => f?.message).join(' | ').slice(0, 200) };
      return { daten: d?.data };
    } catch {
      return { fehler: 'HTTP ' + res.status + ', kein JSON: ' + roh.slice(0, 120) };
    }
  }, { app, name, query, variables, fassung });
}

// ------------------------------------------------------------------- Browser

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

// ---------------------------------------------------------------------- Lauf

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const nutzer = NUTZER || await rl.question('E-Mail (Verwaltung): ');
const passwort = PASSWORT || await rl.question('STAY_PASSWORD: ');
rl.close();
const kopf = { 'x-stay-pass': passwort.trim(), 'x-stay-user': nutzer.trim() };

console.log('\nLaender: ' + [...LAENDER].join(', '));

const browser = await starteBrowser();
const kontext = await browser.newContext({ locale: 'de-DE' });
const page = await kontext.newPage();

// Zwei Seiten: Die Suchabfragen sind nur von einer Standortseite aus erlaubt,
// die Zimmerabfrage von einer Hotelseite. Deshalb wird zwischendurch gewechselt.
const SUCHSEITE = 'https://www.hilton.com/de/locations/germany/';
const HOTELSEITE = 'https://www.hilton.com/de/hotels/frahitw-hilton-frankfurt-city-centre/rooms/';

let aktuelleSeite = null;

// Hiltons Seiten laden hunderte Fremdskripte; "domcontentloaded" kann dabei
// ausbleiben. "commit" wartet nur, bis die Antwort da ist – danach geben wir
// der Seite Zeit, damit Akamais Pruefskript durchlaeuft. Ein Fehlschlag darf
// den Lauf nicht abbrechen.
async function sitzungAufbauen(ziel) {
  aktuelleSeite = ziel;
  for (let versuch = 1; versuch <= 3; versuch += 1) {
    try {
      await page.goto(ziel, { waitUntil: 'commit', timeout: 45000 });
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

console.log('\nSitzung aufbauen (Suchseite) ...');
if (!await sitzungAufbauen(SUCHSEITE)) {
  console.error('Die Standortseite laesst sich nicht oeffnen. Spaeter erneut versuchen.');
  await browser.close();
  process.exit(1);
}

// 0. Liegt die Hausliste schon auf der Platte? Dann Ernte ueberspringen.
const haeuser = new Map();

if (kennungsdatei) {
  // Kennung direkt oder aus einer Adresse: .../hotels/frahitw-hilton-.../
  for (const zeile of fs.readFileSync(kennungsdatei, 'utf8').split(/\r?\n/)) {
    const roh = zeile.trim();
    if (!roh || roh.startsWith('#')) continue;
    const k = /^[A-Za-z0-9]{5,8}$/.test(roh)
      ? roh.toUpperCase()
      : (roh.match(/\/hotels\/([a-z0-9]{5,8})-/i) || [])[1]?.toUpperCase();
    if (k) haeuser.set(k, { ctyhocn: k });
    else console.log('  uebersprungen: ' + roh.slice(0, 60));
  }

  if (!haeuser.size) {
    console.error('\nKeine brauchbaren Kennungen in ' + kennungsdatei + '.');
    process.exit(1);
  }
  console.log('\n' + haeuser.size + ' Kennungen aus ' + kennungsdatei + '.');
} else if (!frisch && fs.existsSync(ABLAGE)) {
  try {
    const abgelegt = JSON.parse(fs.readFileSync(ABLAGE, 'utf8'));
    for (const h of abgelegt) if (LAENDER.has(h.country)) haeuser.set(h.ctyhocn, h);
    console.log('\n' + haeuser.size + ' Haeuser aus ' + ABLAGE
      + ' (--frisch erntet neu).');
  } catch {
    console.log('\n' + ABLAGE + ' ist unbrauchbar, es wird neu geerntet.');
  }
}

function ablegen() {
  try {
    const vorhanden = fs.existsSync(ABLAGE)
      ? JSON.parse(fs.readFileSync(ABLAGE, 'utf8')) : [];
    const zusammen = new Map(vorhanden.map((h) => [h.ctyhocn, h]));
    for (const [k, v] of haeuser) zusammen.set(k, v);
    fs.writeFileSync(ABLAGE, JSON.stringify([...zusammen.values()], null, 1));
  } catch (err) {
    console.log('  Ablage fehlgeschlagen: ' + String(err.message || err));
  }
}

// 1. Quadranten holen: Hiltons eigene Einteilung der Weltkarte.
if (!haeuser.size) {
  console.log('Quadranten holen ...');
const q = await frage(page, 'dx_shop_search_app', 'hotelQuadrants', Q_QUADRANTEN, {});
if (!q.daten?.hotelQuadrants) {
  console.error('Quadranten fehlgeschlagen: ' + q.fehler);
  await browser.close();
  process.exit(1);
}

const quadranten = q.daten.hotelQuadrants.filter(
  (x) => (x.countries || []).some((c) => LAENDER.has(c.code))
);
console.log(quadranten.length + ' Quadranten betreffen diese Laender.');

// 2. Haeuser je Quadrant. Danach nach Land sieben und Doppelte entfernen.
for (const [i, quad] of quadranten.entries()) {
  process.stdout.write('  [' + (i + 1) + '/' + quadranten.length + '] ' + quad.id + ' ... ');
  const eingabe = { language: 'de', input: { quadrantId: quad.id, guestLocationCountry: 'DE' } };

  // Hilton drosselt diese Abfrage: der erste Aufruf geht durch, die folgenden
  // kommen als "Forbidden" zurueck. Also mit Geduld und notfalls neuer Sitzung.
  let a = null;
  for (const versuch of [0, 1, 2]) {
    if (versuch === 1) {
      process.stdout.write('gedrosselt, 20 s ... ');
      await warte(20000);
    }
    if (versuch === 2) {
      process.stdout.write('Sitzung erneuern ... ');
      await sitzungAufbauen(SUCHSEITE);
    }

    a = await frage(page, 'dx_shop_search_app', 'hotelSummaryOptions', Q_HAEUSER, eingabe);
    if (a.daten?.hotelSummaryOptions?.hotels) break;

    // Liegt es nicht an der Drosselung, einmal die Originalabfrage versuchen.
    if (!/forbidden/i.test(a.fehler || '')) {
      a = await frage(page, 'dx_shop_search_app', 'hotelSummaryOptions', Q_HAEUSER_VOLL, eingabe);
      if (a.daten?.hotelSummaryOptions?.hotels) break;
    }
  }

  const liste = a?.daten?.hotelSummaryOptions?.hotels;
  if (!liste) { console.log('FEHLER: ' + a?.fehler); continue; }

  let neu = 0;
  for (const h of liste) {
    const land = h.address?.country;
    if (!h.ctyhocn || !LAENDER.has(land) || haeuser.has(h.ctyhocn)) continue;
    haeuser.set(h.ctyhocn, {
      ctyhocn: h.ctyhocn,
      name: h.name,
      brand: h.brandCode || null,
      city: h.address?.city || null,
      country: land,
      website: (h.facilityOverview?.homeUrlTemplate || '').replace(/\/+$/, '') || null,
      lat: h.localization?.coordinate?.latitude ?? null,
      lon: h.localization?.coordinate?.longitude ?? null,
    });
    neu += 1;
  }
  console.log(liste.length + ' Haeuser, ' + neu + ' neu');
  if (neu) ablegen();          // sofort sichern, die Ernte ist zu teuer zum Wiederholen
  await warte(PAUSE_ERNTE);
}
}

console.log('\n' + haeuser.size + ' Haeuser insgesamt.');
if (!haeuser.size) {
  console.error('Keine Haeuser. Hilton drosselt die Suchabfrage gerade – spaeter erneut.');
  await browser.close();
  process.exit(1);
}

const nachLand = {};
for (const h of haeuser.values()) nachLand[h.country] = (nachLand[h.country] || 0) + 1;
console.log(Object.entries(nachLand).sort((a, b) => b[1] - a[1])
  .map(([l, n]) => l + ':' + n).join('  '));

if (nurListe) { await browser.close(); process.exit(0); }

// 3. Was liegt schon im Vorrat?
let bekannt = new Set();
if (!auffrischen) {
  const res = await fetch(BASIS + '/api/chain/bekannt?kette=hilton', { headers: kopf });
  if (res.ok) {
    const d = await res.json();
    bekannt = new Set(d.bekannt.map((b) => b.ctyhocn));
    console.log(bekannt.size + ' davon liegen schon im Vorrat.');
  } else {
    console.log('Vorrat nicht abfragbar (HTTP ' + res.status + '), es werden alle geholt.');
  }
}

const offen = [...haeuser.values()].filter((h) => !bekannt.has(h.ctyhocn));
console.log(offen.length + ' Haeuser zu holen. Geschaetzte Dauer: '
  + Math.ceil(offen.length * 1.6 / 60) + ' Minuten.\n');

// 4. Zimmerkategorien je Haus. Dafuer auf eine Hotelseite wechseln.
console.log('Auf die Hotelseite wechseln ...');
if (!await sitzungAufbauen(HOTELSEITE)) {
  console.error('Die Hotelseite laesst sich nicht oeffnen. Spaeter erneut versuchen.');
  await browser.close();
  process.exit(1);
}

let fertig = 0;
const fehler = [];

for (const [i, h] of offen.entries()) {
  process.stdout.write('[' + (i + 1) + '/' + offen.length + '] '
    + (h.country ? h.country + ' ' : '') + (h.name || h.ctyhocn)
    + ' (' + h.ctyhocn + ') ... ');

  const holen = (q) => frage(page, 'dx-property-ui', 'hotel_roomTypes', q,
    { ctyhocn: h.ctyhocn, language: 'de' }).catch((e) => ({ fehler: String(e.message || e) }));

  let a = await holen(Q_ZIMMER);
  // Fehlen die Stammdatenfelder im Schema, die schlanke Fassung nehmen.
  if (!a.daten?.hotel?.roomTypes?.length && !/forbidden/i.test(a.fehler || '')) {
    a = await holen(Q_ZIMMER_SCHLANK);
  }

  // Akamai frischt die Sitzung nach einigen Minuten auf. Dann neu laden.
  if (!a.daten?.hotel?.roomTypes?.length) {
    process.stdout.write('Sitzung erneuern ... ');
    await warte(5000);
    await sitzungAufbauen(aktuelleSeite || HOTELSEITE);
    a = await holen(Q_ZIMMER);
  }

  const hotelObjekt = a.daten?.hotel;
  if (!hotelObjekt?.roomTypes?.length) {
    console.log('keine Kategorien' + (a.fehler ? ': ' + a.fehler : ''));
    fehler.push({ ...h, grund: a.fehler || 'keine roomTypes' });
    await warte(PAUSE_ZIMMER);
    continue;
  }

  const res = await fetch(BASIS + '/api/chain/hilton', {
    method: 'POST',
    headers: { ...kopf, 'content-type': 'application/json' },
    body: JSON.stringify({ info: h, antwort: hotelObjekt }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.log('Speichern fehlgeschlagen: HTTP ' + res.status + ' ' + text.slice(0, 140));
    fehler.push({ ...h, grund: 'Speichern: ' + text.slice(0, 100) });
  } else {
    const d = await res.json();
    console.log(hotelObjekt.roomTypes.length + ' roh -> ' + d.gespeichert);
    fertig += 1;
  }

  await warte(PAUSE_ZIMMER);
}

await browser.close();

console.log('\n--------------------------------------------');
console.log('Vorrat: ' + fertig + ' Haeuser aufgenommen, ' + fehler.length + ' offen.');
if (fehler.length) {
  console.log('\nOffen geblieben:');
  for (const f of fehler.slice(0, 40)) {
    console.log('  ' + f.ctyhocn + '  ' + f.name + ' — ' + f.grund);
  }
  if (fehler.length > 40) console.log('  ... und ' + (fehler.length - 40) + ' weitere');
  console.log('\nErneut aufrufen holt nur die offenen nach.');
}
