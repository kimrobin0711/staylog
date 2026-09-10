// Sondierung
//
// Oeffnet eine Hilton-Seite und zeigt, was im ausgelieferten HTML an Daten
// steckt – ohne irgendeinen Aufruf an die Schnittstelle. Damit laesst sich
// pruefen, ob eine Seite ihre Hotelliste oder Zimmerdaten selbst mitbringt.
//
// Aufruf:
//   node erkunde.mjs https://www.hilton.com/de/locations/germany/
//   node erkunde.mjs https://www.hilton.com/de/hotels/frahitw-hilton-frankfurt-city-centre/rooms/
//   node erkunde.mjs <adresse> --voll     (gefundene Objekte ausgeben)

import { chromium, firefox } from 'playwright';
import fs from 'node:fs';

const ziel = process.argv[2];
const voll = process.argv.includes('--voll');

if (!ziel || !/^https?:\/\//.test(ziel)) {
  console.error('Aufruf: node erkunde.mjs <adresse> [--voll]');
  process.exit(1);
}

const warte = (ms) => new Promise((f) => setTimeout(f, ms));

async function starteBrowser() {
  for (const kanal of ['chrome', 'msedge']) {
    try { return await chromium.launch({ channel: kanal, headless: false }); } catch { /* weiter */ }
  }
  try { return await chromium.launch({ headless: false }); } catch { /* weiter */ }
  return firefox.launch({ headless: false });
}

const browser = await starteBrowser();
const kontext = await browser.newContext({ locale: 'de-DE' });
const page = await kontext.newPage();

console.log('Oeffne ' + ziel + ' ...');
try {
  await page.goto(ziel, { waitUntil: 'commit', timeout: 45000 });
} catch (err) {
  console.error('Seitenaufbau fehlgeschlagen: ' + String(err.message || err).split('\n')[0]);
  await browser.close();
  process.exit(1);
}
await warte(12000);

// Alles einsammeln, was nach eingebettetem Zustand aussieht.
const roh = await page.evaluate(() => {
  const teile = {};

  const next = document.getElementById('__NEXT_DATA__');
  if (next) teile.__NEXT_DATA__ = next.textContent;

  for (const schluessel of ['__APOLLO_STATE__', '__NUXT__', '__INITIAL_STATE__', '__PRELOADED_STATE__']) {
    if (window[schluessel]) {
      try { teile[schluessel] = JSON.stringify(window[schluessel]); } catch { /* egal */ }
    }
  }

  // Adressen von Hotelseiten aus dem sichtbaren Baum – der zweite Weg.
  const verweise = [...document.querySelectorAll('a[href*="/hotels/"]')]
    .map((a) => a.getAttribute('href'))
    .filter(Boolean);

  return { teile, verweise, titel: document.title, laenge: document.documentElement.outerHTML.length };
});

console.log('\nTitel: ' + roh.titel);
console.log('Seitengroesse: ' + roh.laenge + ' Zeichen');

// Kennungen aus den Verweisen
const ausVerweisen = new Set();
for (const v of roh.verweise) {
  const k = (v.match(/\/hotels\/([a-z0-9]{5,8})-/i) || [])[1];
  if (k) ausVerweisen.add(k.toUpperCase());
}
console.log('\nVerweise auf Hotelseiten: ' + roh.verweise.length
  + ', darin ' + ausVerweisen.size + ' verschiedene Kennungen');
if (ausVerweisen.size) console.log('  ' + [...ausVerweisen].slice(0, 20).join(' '));

// Eingebetteten Zustand durchsuchen
const interessant = ['ctyhocn', 'roomTypeName', 'hotelSummaryOptions', 'hotelRoomsSchema'];

for (const [name, text] of Object.entries(roh.teile)) {
  console.log('\n--- ' + name + ' (' + text.length + ' Zeichen) ---');
  for (const w of interessant) {
    const n = text.split(w).length - 1;
    if (n) console.log('  ' + w + ': ' + n + 'x');
  }

  let daten = null;
  try { daten = JSON.parse(text); } catch { console.log('  (kein gueltiges JSON)'); continue; }

  // Baum ablaufen und alles sammeln, was eine Kennung traegt.
  const kennungen = new Map();
  const pfade = new Set();
  (function geh(o, pfad) {
    if (Array.isArray(o)) {
      o.forEach((v, i) => geh(v, pfad + '[' + (i < 3 ? i : 'n') + ']'));
    } else if (o && typeof o === 'object') {
      if (typeof o.ctyhocn === 'string' && /^[A-Z0-9]{5,8}$/.test(o.ctyhocn)) {
        kennungen.set(o.ctyhocn, o.name || o.hotelName || null);
        pfade.add(pfad);
      }
      for (const [k, v] of Object.entries(o)) geh(v, pfad + '.' + k);
    }
  })(daten, '');

  console.log('  Objekte mit Kennung: ' + kennungen.size);
  if (kennungen.size) {
    console.log('  Fundstellen: ' + [...pfade].slice(0, 6).join('  '));
    for (const [k, n] of [...kennungen].slice(0, 15)) console.log('    ' + k + '  ' + (n || ''));
  }

  if (voll) {
    const datei = name.replace(/[^a-z0-9_]/gi, '') + '.json';
    fs.writeFileSync(datei, text);
    console.log('  vollstaendig abgelegt in ' + datei);
  }
}

// Alle gefundenen Kennungen als Datei fuer vorrat.mjs --datei
const alle = new Set(ausVerweisen);
for (const [name, text] of Object.entries(roh.teile)) {
  for (const t of text.match(/"ctyhocn"\s*:\s*"([A-Z0-9]{5,8})"/g) || []) {
    alle.add(t.match(/"([A-Z0-9]{5,8})"$/)[1]);
  }
}
if (alle.size) {
  fs.writeFileSync('kennungen.txt', [...alle].join('\n') + '\n');
  console.log('\n' + alle.size + ' Kennungen in kennungen.txt geschrieben.');
  console.log('Weiter mit:  node vorrat.mjs --datei kennungen.txt');
} else {
  console.log('\nKeine Kennungen gefunden.');
}

await browser.close();
