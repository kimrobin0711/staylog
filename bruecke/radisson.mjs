// stayLOG-Bruecke: Radisson
//
// Radisson laeuft auf Nuxt und liefert seine Zimmer im Zustand der Seite mit
// (`window.__NUXT__`). Es wird also keine Schnittstelle aufgerufen — die Seite
// wird geoeffnet und gelesen.
//
// Aufruf:  node radisson.mjs                (Haeuser aus stayLOG)
//          node radisson.mjs --alle          (auch schon erfasste, zum Auffrischen)
//          node radisson.mjs --trocken       (nichts speichern, nur zeigen)
//          node radisson.mjs --datei adressen.txt   (eine Adresse je Zeile)

import { chromium, firefox } from 'playwright';
import readline from 'node:readline/promises';
import fs from 'node:fs';

const BASIS = process.env.STAYLOG_URL || 'https://staylog.pages.dev';
const NUTZER = process.env.STAYLOG_USER || '';
const PASSWORT = process.env.STAY_PASSWORD || '';

const alle = process.argv.includes('--alle');
const trocken = process.argv.includes('--trocken');
const adressdatei = (() => {
  const i = process.argv.indexOf('--datei');
  return i >= 0 ? process.argv[i + 1] : null;
})();

if (adressdatei && !fs.existsSync(adressdatei)) {
  console.error('\n' + adressdatei + ' gibt es nicht.\n'
    + 'Eine Adresse je Zeile, z. B.\n'
    + '  https://www.radissonhotels.com/de-de/hotels/radisson-blu-hamburg\n');
  process.exit(1);
}

const warte = (ms) => new Promise((f) => setTimeout(f, ms));

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

// ---------------------------------------------------------------- Anmeldung

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const nutzer = NUTZER || await rl.question('E-Mail (Verwaltung): ');
const passwort = PASSWORT || await rl.question('STAY_PASSWORD: ');
rl.close();
const kopf = { 'x-stay-pass': passwort.trim(), 'x-stay-user': nutzer.trim() };

// ------------------------------------------------------------------- Haeuser

let haeuser = [];

if (adressdatei) {
  haeuser = fs.readFileSync(adressdatei, 'utf8').split(/\r?\n/)
    .map((z) => z.trim())
    .filter((z) => z && !z.startsWith('#') && /radissonhotels\.com/i.test(z))
    .map((adresse) => ({
      id: null,
      zimmerseite: adresse.replace(/\/+$/, '').replace(/\/(zimmer|rooms)$/i, '') + '/zimmer',
    }));
  console.log('\n' + haeuser.length + ' Adressen aus ' + adressdatei + '.');
} else {
  const res = await fetch(BASIS + '/api/hotels/offen?kette=radisson' + (alle ? '&alle=1' : ''),
    { headers: kopf });
  if (!res.ok) {
    console.error('Liste fehlgeschlagen: HTTP ' + res.status + ' ' + await res.text());
    process.exit(1);
  }
  const d = await res.json();
  haeuser = d.haeuser.filter((h) => h.zimmerseite);

  const ohne = d.haeuser.filter((h) => !h.zimmerseite);
  console.log('\n' + d.haeuser.length + ' Radisson-Haeuser, ' + haeuser.length + ' mit Adresse.');
  if (ohne.length) {
    console.log('\nOhne Radisson-Adresse in der Datenbank, uebersprungen:');
    for (const h of ohne) console.log('  #' + h.id + '  ' + h.name);
  }
}

if (!haeuser.length) process.exit(0);

// ---------------------------------------------------------------------- Lauf

const browser = await starteBrowser();
const kontext = await browser.newContext({ locale: 'de-DE' });
const page = await kontext.newPage();

// Liest die Zimmerobjekte aus dem Zustand der Seite.
async function zimmerLesen(adresse) {
  for (let versuch = 1; versuch <= 2; versuch += 1) {
    try {
      await page.goto(adresse, { waitUntil: 'commit', timeout: 45000 });
    } catch (err) {
      if (versuch === 2) return { fehler: String(err.message || err).split('\n')[0] };
      await warte(4000);
      continue;
    }

    try {
      await page.waitForFunction(() => {
        const z = window.__NUXT__;
        if (!z) return false;
        let treffer = false;
        (function geh(o) {
          if (treffer || !o || typeof o !== 'object') return;
          if (!Array.isArray(o) && o.tmsRoomCode) { treffer = true; return; }
          for (const v of Object.values(o)) geh(v);
        })(z);
        return treffer;
      }, { timeout: 25000 });
    } catch {
      if (versuch === 2) return { fehler: 'keine Zimmer im Seitenzustand' };
      await warte(4000);
      continue;
    }

    // Nur die Zimmerobjekte herausschneiden – der ganze Zustand waere 1,5 MB.
    const ergebnis = await page.evaluate(() => {
      const zimmer = [];
      let haus = null;
      (function geh(o) {
        if (!o || typeof o !== 'object') return;
        if (Array.isArray(o)) { o.forEach(geh); return; }
        if (o.tmsRoomCode) {
          zimmer.push({
            tmsRoomCode: o.tmsRoomCode,
            size: o.size,
            metric: o.metric,
            occupancy: o.occupancy,
            bedType: o.bedType,
            text: o.text ? { description: o.text.description } : null,
          });
          if (!haus && o.tmsHotelCode) {
            haus = { key: o.tmsHotelCode.key, name: o.tmsHotelCode.description };
          }
        }
        for (const v of Object.values(o)) geh(v);
      })(window.__NUXT__);
      return { zimmer, haus, titel: document.title };
    }).catch(() => null);

    if (!ergebnis?.zimmer?.length) {
      if (versuch === 2) return { fehler: 'Zimmerobjekte nicht lesbar' };
      await warte(4000);
      continue;
    }
    return ergebnis;
  }
  return { fehler: 'unbekannt' };
}

let fertig = 0;
const fehler = [];

for (const [i, h] of haeuser.entries()) {
  process.stdout.write('[' + (i + 1) + '/' + haeuser.length + '] '
    + (h.name || h.zimmerseite.replace(/.*\/hotels\//, '')) + ' ... ');

  const a = await zimmerLesen(h.zimmerseite);

  if (a.fehler) {
    console.log('FEHLER: ' + a.fehler);
    fehler.push({ ...h, grund: a.fehler });
    await warte(2000);
    continue;
  }

  const info = {
    code: a.haus?.key || null,
    name: a.haus?.name || h.name || null,
    city: h.city || null,
    website: h.zimmerseite,
  };

  if (trocken) {
    console.log(a.zimmer.length + ' Objekte, Haus ' + (info.code || '?')
      + ' (trocken, nicht gespeichert)');
    fertig += 1;
    await warte(2000);
    continue;
  }

  if (!info.code) {
    console.log('FEHLER: keine Hauskennung im Zustand');
    fehler.push({ ...h, grund: 'keine Hauskennung' });
    await warte(2000);
    continue;
  }

  // In den Vorrat, damit auch andere Haeuser davon haben.
  const res = await fetch(BASIS + '/api/chain/radisson', {
    method: 'POST',
    headers: { ...kopf, 'content-type': 'application/json' },
    body: JSON.stringify({ info, zimmer: a.zimmer }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.log('Speichern fehlgeschlagen: HTTP ' + res.status + ' ' + text.slice(0, 160));
    fehler.push({ ...h, grund: 'Speichern: ' + text.slice(0, 100) });
  } else {
    const d = await res.json();
    console.log(a.zimmer.length + ' roh -> ' + d.gespeichert + ' (' + info.code + ')');
    fertig += 1;

    // Haengt ein Hotel aus stayLOG daran, gleich dessen Recherche anstossen –
    // die greift dann auf den eben gefuellten Vorrat zu.
    if (h.id) {
      await fetch(BASIS + '/api/hotels/' + h.id + '/enrich', { method: 'POST', headers: kopf })
        .catch(() => null);
    }
  }

  await warte(2000);
}

await browser.close();

console.log('\n--------------------------------------------');
console.log('Fertig: ' + fertig + ' erledigt, ' + fehler.length + ' offen.');
for (const f of fehler) console.log('  ' + (f.name || f.zimmerseite) + ' — ' + f.grund);
