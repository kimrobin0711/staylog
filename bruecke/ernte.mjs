// Ernte
//
// Sammelt die Hilton-Häuser einer Region, indem sie die Standortseiten ganz
// normal im Browser öffnet und liest, was die Seite selbst mitbringt
// (`__NEXT_DATA__` → `pageData.hotelSummaryOptions.hotels`).
//
// Es wird keine Schnittstelle aufgerufen. Die Suchabfrage `hotelSummaryOptions`
// ist gedrosselt, Seitenaufrufe sind es nicht.
//
// Jede Länderseite zeigt nur die ersten 20 Häuser, verlinkt aber alle ihre
// Städte. Die Städte haben selten mehr als 20 – über sie wird das Land
// vollständig.
//
// Aufruf:
//   node ernte.mjs                          (Europa)
//   node ernte.mjs --land germany,france    (Hilton-Schreibweise, englisch)
//   node ernte.mjs --tempo 4000             (Pause zwischen Seiten, Standard 2500)
//
// Ergebnis: haeuser.json — dieselbe Datei, die vorrat.mjs benutzt.

import { chromium, firefox } from 'playwright';
import fs from 'node:fs';

const ABLAGE = 'haeuser.json';
const BASIS = 'https://www.hilton.com/de/';

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
};

const PAUSE = Number(arg('--tempo') || 2500);
const warte = (ms) => new Promise((f) => setTimeout(f, ms));

// Hiltons Schreibweise der Länder, englisch und kleingeschrieben.
const EUROPA = ['albania', 'andorra', 'austria', 'belarus', 'belgium', 'bosnia-and-herzegovina',
  'bulgaria', 'croatia', 'cyprus', 'czech-republic', 'denmark', 'estonia', 'finland', 'france',
  'georgia', 'germany', 'greece', 'hungary', 'iceland', 'ireland', 'italy', 'kosovo', 'latvia',
  'lithuania', 'luxembourg', 'malta', 'moldova', 'monaco', 'montenegro', 'netherlands',
  'north-macedonia', 'norway', 'poland', 'portugal', 'romania', 'russia', 'serbia', 'slovakia',
  'slovenia', 'spain', 'sweden', 'switzerland', 'turkey', 'ukraine', 'united-kingdom'];

const laender = (arg('--land') || '').trim()
  ? arg('--land').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean)
  : EUROPA;

// ------------------------------------------------------------------- Ablage

const haeuser = new Map();

if (fs.existsSync(ABLAGE)) {
  try {
    for (const h of JSON.parse(fs.readFileSync(ABLAGE, 'utf8'))) haeuser.set(h.ctyhocn, h);
    console.log(haeuser.size + ' Haeuser bereits in ' + ABLAGE + '.');
  } catch { console.log(ABLAGE + ' ist unbrauchbar und wird ersetzt.'); }
}

function ablegen() {
  try {
    fs.writeFileSync(ABLAGE, JSON.stringify([...haeuser.values()], null, 1));
  } catch (err) {
    console.log('  Ablage fehlgeschlagen: ' + String(err.message || err));
  }
}

// ------------------------------------------------------------------ Browser

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

const browser = await starteBrowser();
const kontext = await browser.newContext({ locale: 'de-DE' });
const page = await kontext.newPage();

// Liest den eingebetteten Zustand einer Standortseite aus.
async function seiteLesen(adresse) {
  for (let versuch = 1; versuch <= 2; versuch += 1) {
    try {
      await page.goto(adresse, { waitUntil: 'commit', timeout: 45000 });
    } catch (err) {
      if (versuch === 2) return { fehler: String(err.message || err).split('\n')[0] };
      await warte(4000);
      continue;
    }

    // Das Element ist da, bevor sein Inhalt vollstaendig ist. Deshalb warten,
    // bis sich der Zustand tatsaechlich lesen laesst, statt nur bis er existiert.
    try {
      await page.waitForFunction(() => {
        const el = document.getElementById('__NEXT_DATA__');
        if (!el || !el.textContent) return false;
        try { JSON.parse(el.textContent); return true; } catch { return false; }
      }, { timeout: 25000 });
    } catch {
      if (versuch === 2) return { fehler: 'Zustand nicht lesbar geworden' };
      await warte(4000);
      continue;
    }

    const roh = await page.evaluate(() => {
      const el = document.getElementById('__NEXT_DATA__');
      return el ? el.textContent : null;
    }).catch(() => null);

    let daten = null;
    try { daten = JSON.parse(roh || ''); } catch {
      if (versuch === 2) return { fehler: 'Zustand ist kein gueltiges JSON' };
      await warte(4000);
      continue;
    }

    const pd = daten?.props?.pageProps?.pageData || {};
    const hotels = pd.hotelSummaryOptions?.hotels || [];

    // Nur die Staedtegruppe. Die Seiten nach Marke und Ausstattung fuehren zu
    // denselben Haeusern und wuerden die Zahl der Aufrufe fast verdoppeln.
    const gruppen = pd.location?.pageInterlinks || [];
    const staedtegruppe = gruppen.filter((g) => /stadt|städte|staedte|city|cities/i.test(g.title || ''));
    const weiter = [];
    for (const gruppe of (staedtegruppe.length ? staedtegruppe : gruppen)) {
      for (const l of gruppe.links || []) {
        if (l?.uri && /^locations\//.test(l.uri)) weiter.push(l.uri);
      }
    }

    return { hotels, weiter, name: pd.location?.name || null, art: pd.location?.category || null };
  }
  return { fehler: 'unbekannt' };
}

function aufnehmen(hotels) {
  let neu = 0;
  for (const h of hotels) {
    if (!h?.ctyhocn || haeuser.has(h.ctyhocn)) continue;
    haeuser.set(h.ctyhocn, {
      ctyhocn: h.ctyhocn,
      name: h.name,
      brand: h.brandCode || null,
      city: h.address?.city || null,
      country: h.address?.country || null,
      website: (h.facilityOverview?.homeUrlTemplate || '').replace(/\/+$/, '') || null,
      lat: h.localization?.coordinate?.latitude ?? null,
      lon: h.localization?.coordinate?.longitude ?? null,
    });
    neu += 1;
  }
  return neu;
}

// ---------------------------------------------------------------------- Lauf

console.log('\n' + laender.length + ' Laender, Pause ' + PAUSE + ' ms.\n');

const gesehen = new Set();
let seiten = 0;
const fehlgeschlagen = [];

for (const [i, land] of laender.entries()) {
  const landAdresse = BASIS + 'locations/' + land + '/';
  process.stdout.write('[' + (i + 1) + '/' + laender.length + '] ' + land + ' ... ');

  const a = await seiteLesen(landAdresse);
  seiten += 1;

  if (a.fehler) {
    console.log('FEHLER: ' + a.fehler);
    fehlgeschlagen.push(land + ' — ' + a.fehler);
    await warte(PAUSE);
    continue;
  }

  let neu = aufnehmen(a.hotels);

  // Die Städteseiten dieses Landes. Marken- und Ausstattungsseiten führen zu
  // denselben Häusern, kosten aber Aufrufe – sie bleiben aussen vor.
  const staedte = [...new Set(a.weiter)].filter((u) => !gesehen.has(u));

  console.log(a.hotels.length + ' auf der Landesseite, ' + staedte.length + ' Staedte');

  for (const uri of staedte) {
    gesehen.add(uri);
    const b = await seiteLesen(BASIS + uri.replace(/^\/+/, ''));
    seiten += 1;

    if (b.fehler) {
      console.log('      ' + uri + ' FEHLER: ' + b.fehler);
      fehlgeschlagen.push(uri + ' — ' + b.fehler);
    } else {
      const n = aufnehmen(b.hotels);
      neu += n;
      if (n) process.stdout.write('      ' + uri + ': +' + n + '\n');
    }
    await warte(PAUSE);
  }

  if (neu) ablegen();
  console.log('    ' + land + ': ' + neu + ' neu, insgesamt ' + haeuser.size + '\n');
}

await browser.close();
ablegen();

const nachLand = {};
for (const h of haeuser.values()) nachLand[h.country] = (nachLand[h.country] || 0) + 1;

console.log('--------------------------------------------');
console.log(haeuser.size + ' Haeuser aus ' + seiten + ' Seitenaufrufen in ' + ABLAGE + '.');
console.log(Object.entries(nachLand).sort((a, b) => b[1] - a[1])
  .map(([l, n]) => l + ':' + n).join('  '));

if (fehlgeschlagen.length) {
  console.log('\n' + fehlgeschlagen.length + ' Seiten nicht gelesen:');
  for (const f of fehlgeschlagen.slice(0, 30)) console.log('  ' + f);
  console.log('\nErneut aufrufen ergaenzt die Datei, statt sie zu ersetzen.');
}

console.log('\nWeiter mit:  node vorrat.mjs');
