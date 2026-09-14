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

// Nur Haeuser, deren Name diesen Text enthaelt – zum gezielten Pruefen.
const nurText = (() => {
  const i = process.argv.indexOf('--nur');
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1].toLowerCase() : null;
})();

if (adressdatei && !fs.existsSync(adressdatei)) {
  console.error('\n' + adressdatei + ' gibt es nicht.\n'
    + 'Eine Adresse je Zeile, z. B.\n'
    + '  https://www.radissonhotels.com/de-de/hotels/radisson-blu-hamburg\n');
  process.exit(1);
}

// Radisson sperrt bei zu vielen Aufrufen kurz hintereinander. Lieber langsam
// als gesperrt – bei einer Handvoll Haeuser faellt die Wartezeit nicht ins
// Gewicht.
// --tempo ist der Mindestabstand nach einem erfolgreichen Abruf. Nach
// uebersprungenen oder zwischengespeicherten Haeusern wird gar nicht gewartet.
const PAUSE = Number((() => {
  const i = process.argv.indexOf('--tempo');
  return i >= 0 ? process.argv[i + 1] : 0;
})() || 12000);

// Zwischenspeicher, damit sich Aenderungen am Parser ohne neuen Abruf pruefen
// lassen. --frisch umgeht ihn.
const ABLAGE = 'cache/radisson';
const frisch = process.argv.includes('--frisch');
fs.mkdirSync(ABLAGE, { recursive: true });

const ablageWeg = (url) =>
  ABLAGE + '/' + ((String(url).match(/\/hotels\/([^/?#]+)/i) || [])[1] || 'unbekannt') + '.json';

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

if (nurText) {
  haeuser = haeuser.filter((h) => (h.name || h.zimmerseite || '').toLowerCase().includes(nurText));
  console.log(haeuser.length + ' Haeuser passen auf "' + nurText + '".');
}

if (!haeuser.length) process.exit(0);

// ---------------------------------------------------------------------- Lauf

const browser = await starteBrowser();
const kontext = await browser.newContext({ locale: 'de-DE' });
const page = await kontext.newPage();

// Aus der stayLOG-Adresse den Slug ziehen und daraus die Seitenkandidaten.
// Englisch zuerst, damit die Namen einheitlich in Radissons Originalform
// stehen; danach die lokale Zimmerseite, zuletzt die Hotelhauptseite.
function seitenKandidaten(adresse) {
  const slug = (String(adresse).match(/\/hotels\/([^/?#]+)/i) || [])[1];
  if (!slug) return [String(adresse)];
  const b = 'https://www.radissonhotels.com';
  return [
    b + '/en-us/hotels/' + slug + '/rooms',
    b + '/de-de/hotels/' + slug + '/zimmer',
    b + '/en-us/hotels/' + slug,
  ];
}

// Erkennt Radissons Sperrseiten. Wird getrennt gemeldet, damit "keine Zimmer
// gefunden" nur bei einer echten Inhaltsseite erscheint.
const SPERRMUSTER =
  /access has been restricted|access denied|zugriff wurde eingeschr|are you a human|captcha|request blocked|unusual traffic/i;

// Ein Name gilt nur als Zimmerkategorie, wenn er auch nach einer klingt.
// Das verhindert, dass Navigation, Angebote oder Preise hereinrutschen – und
// dass aus dem Hotelnamen etwas abgeleitet wird.
const ZIMMERWORT = /\b(room|suite|studio|apartment|apartement|villa|zimmer|penthouse|loft|cabin|residence)\b/i;
const UNWORT =
  /\b(book|booking|buchen|reserv|rate|price|preis|from|ab\s|per night|pro nacht|angebot|offer|member|newsletter|gift|voucher|meeting|event|restaurant|spa|gym|parking|check|faq|kontakt|contact)\b/i;

function taugtAlsZimmer(name) {
  const n = String(name || '').replace(/\s+/g, ' ').trim();
  if (n.length < 4 || n.length > 70) return null;
  if (!ZIMMERWORT.test(n)) return null;
  if (UNWORT.test(n)) return null;
  if (/[€$£]|\d{2,}\s*(€|eur|usd)/i.test(n)) return null;
  return n;
}

// Holt eine Seite und probiert der Reihe nach alle Fundstellen durch.
async function seiteAuswerten(adresse) {
  let antwort = null;
  try {
    antwort = await page.goto(adresse, { waitUntil: 'commit', timeout: 45000 });
  } catch (err) {
    return { fehler: String(err.message || err).split('\n')[0], url: adresse };
  }

  const status = antwort ? antwort.status() : 0;
  const retryAfter = antwort ? Number(antwort.headers()['retry-after']) || null : null;

  // 403 und 429 sind Sperren, auch ohne erkennbaren Text auf der Seite.
  if (status === 403 || status === 429) {
    return { gesperrt: true, url: adresse, status, retryAfter };
  }

  // Der Seite kurz Zeit geben, ihren Inhalt aufzubauen.
  await page.waitForFunction(() => document.readyState !== 'loading', { timeout: 20000 })
    .catch(() => null);
  await warte(6000);

  const bericht = await page.evaluate((muster) => {
    const sperre = new RegExp(muster, 'i');
    const text = document.body ? document.body.innerText || '' : '';
    if (sperre.test(text)) return { gesperrt: true, titel: document.title };

    const ergebnis = {
      titel: document.title,
      nuxt: Boolean(window.__NUXT__),
      roh: 0,
      domKarten: 0,
      quelle: null,
      zimmer: [],
      haus: null,
    };

    // ---- 1. Seitenzustand (bewaehrt bei Radisson Blu und Park Inn)
    if (window.__NUXT__) {
      const gefunden = [];
      (function geh(o) {
        if (!o || typeof o !== 'object') return;
        if (Array.isArray(o)) { o.forEach(geh); return; }
        if (o.tmsRoomCode) {
          gefunden.push({
            tmsRoomCode: o.tmsRoomCode,
            size: o.size,
            metric: o.metric,
            occupancy: o.occupancy,
            bedType: o.bedType,
            text: o.text ? { description: o.text.description } : null,
          });
          if (!ergebnis.haus && o.tmsHotelCode) {
            ergebnis.haus = { key: o.tmsHotelCode.key, name: o.tmsHotelCode.description };
          }
        }
        for (const v of Object.values(o)) geh(v);
      })(window.__NUXT__);

      ergebnis.roh = gefunden.length;
      if (gefunden.length) {
        ergebnis.quelle = 'NUXT';
        ergebnis.zimmer = gefunden;
        return ergebnis;
      }
    }

    // ---- 2. Sichtbarer Baum: Ueberschriften im Zimmerbereich
    const namen = [];
    const merke = (t) => {
      const n = String(t || '').replace(/\s+/g, ' ').trim();
      if (n && !namen.includes(n)) namen.push(n);
    };

    // Bereich suchen, dessen Ueberschrift nach Zimmern klingt.
    const bereiche = [...document.querySelectorAll('section, div[id], main')]
      .filter((el) => {
        const h = el.querySelector('h1, h2, h3');
        return h && /rooms?|zimmer|room types|zimmerkategorien|suites/i.test(h.textContent || '');
      });

    const quellen = bereiche.length ? bereiche : [document.body];
    for (const bereich of quellen) {
      for (const el of bereich.querySelectorAll('h2, h3, h4, [data-testid*="room" i], a[href*="/rooms"], a[href*="/zimmer"]')) {
        merke(el.textContent);
      }
      for (const img of bereich.querySelectorAll('img[alt]')) merke(img.getAttribute('alt'));
    }
    ergebnis.domKarten = namen.length;

    // ---- 3. Strukturierte Daten
    const ausLd = [];
    for (const sk of document.querySelectorAll('script[type="application/ld+json"]')) {
      let daten = null;
      try { daten = JSON.parse(sk.textContent); } catch { continue; }
      (function geh(o) {
        if (!o || typeof o !== 'object') return;
        if (Array.isArray(o)) { o.forEach(geh); return; }
        const typ = String(o['@type'] || '');
        if (/HotelRoom|Room|Suite|Accommodation/i.test(typ) && o.name) ausLd.push(String(o.name));
        for (const v of Object.values(o)) geh(v);
      })(daten);
    }

    // ---- 4. Sonstiges eingebettetes JSON, nur nach derselben Zimmerstruktur
    const ausJson = [];
    for (const sk of document.querySelectorAll('script[type="application/json"]')) {
      let daten = null;
      try { daten = JSON.parse(sk.textContent); } catch { continue; }
      (function geh(o) {
        if (!o || typeof o !== 'object') return;
        if (Array.isArray(o)) { o.forEach(geh); return; }
        if (o.tmsRoomCode && o.tmsRoomCode.description) ausJson.push(String(o.tmsRoomCode.description));
        for (const v of Object.values(o)) geh(v);
      })(daten);
    }

    ergebnis.roheNamen = { dom: namen, ld: ausLd, json: ausJson };
    return ergebnis;
  }, SPERRMUSTER.source).catch(() => null);

  if (!bericht) return { fehler: 'Seite nicht auswertbar', url: adresse, status };
  if (bericht.gesperrt) {
    return { gesperrt: true, url: adresse, status, retryAfter, titel: bericht.titel };
  }

  bericht.url = adresse;
  bericht.status = status;

  // Aus dem Zustand kommen fertige Objekte, sonst nur Namen – gesiebt.
  if (bericht.quelle === 'NUXT') return bericht;

  const r = bericht.roheNamen || { dom: [], ld: [], json: [] };
  for (const [quelle, liste] of [['JSON_LD', r.ld], ['JSON', r.json], ['DOM', r.dom]]) {
    const sauber = [];
    for (const n of liste || []) {
      const ok = taugtAlsZimmer(n);
      if (ok && !sauber.some((x) => x.name.toLowerCase() === ok.toLowerCase())) {
        sauber.push({ name: ok });
      }
    }
    if (sauber.length >= 2) {
      bericht.quelle = quelle;
      bericht.zimmer = sauber;
      return bericht;
    }
  }

  bericht.quelle = null;
  bericht.zimmer = [];
  return bericht;
}

// Geht die Seitenkandidaten durch, bis eine Kategorien liefert.
async function zimmerLesen(adresse) {
  const weg = ablageWeg(adresse);
  if (!frisch && fs.existsSync(weg)) {
    try {
      const a = JSON.parse(fs.readFileSync(weg, 'utf8'));
      if (a?.zimmer?.length) return { ...a, ausAblage: true };
    } catch { /* unbrauchbar, dann eben neu holen */ }
  }

  const kandidaten = seitenKandidaten(adresse);
  let letzter = null;

  for (const [i, url] of kandidaten.entries()) {
    const a = await seiteAuswerten(url);
    letzter = a;

    if (a.gesperrt) return a;
    if (a.zimmer && a.zimmer.length) {
      try { fs.writeFileSync(weg, JSON.stringify(a, null, 1)); } catch { /* egal */ }
      return a;
    }

    if (trocken) {
      console.log('\n      ' + url);
      console.log('      HTTP: ' + (a.status ?? '?') + '   NUXT: '
        + (a.nuxt ? 'vorhanden' : 'fehlt') + '   Rohobjekte: ' + (a.roh ?? 0)
        + '   DOM-Kandidaten: ' + (a.domKarten ?? 0));
      if (a.fehler) console.log('      Fehler: ' + a.fehler);
    }

    if (i < kandidaten.length - 1) await warte(Math.min(PAUSE, 10000));
  }

  return letzter || { fehler: 'keine Seite auswertbar' };
}

let fertig = 0;
let sperren = 0;
const fehler = [];

// Gewartet wird nur, wenn wirklich ein Abruf stattgefunden hat. Nach einem
// uebersprungenen oder zwischengespeicherten Haus gibt es nichts zu schonen.
async function halt(i, sekunden, grund) {
  if (i >= haeuser.length - 1) return;
  if (!sekunden) return;
  console.log('      WAIT ' + sekunden + 's – ' + grund);
  await warte(sekunden * 1000);
}

const BACKOFF = [60, 180];   // Sekunden, falls Radisson kein Retry-After nennt

for (const [i, h] of haeuser.entries()) {
  process.stdout.write('[' + (i + 1) + '/' + haeuser.length + '] '
    + (h.name || h.zimmerseite.replace(/.*\/hotels\//, '')) + ' ... ');

  if (h.amtlich && !alle) {
    console.log('SKIP – bereits gespeichert');
    continue;
  }

  const a = await zimmerLesen(h.zimmerseite);
  if (a.ausAblage) console.log('CACHE – kein HTTP-Aufruf');

  if (a.gesperrt) {
    sperren += 1;
    console.log('GESPERRT (HTTP ' + (a.status ?? '?') + ')');
    fehler.push({ ...h, grund: 'gesperrt (HTTP ' + (a.status ?? '?') + ')' });

    // Zweite Sperre im selben Lauf: aufhoeren, statt weiter anzuklopfen.
    if (sperren >= 2) {
      console.log('\nABBRUCH – zweite Sperre in diesem Lauf.');
      console.log('Spaeter erneut versuchen; erledigte Haeuser werden uebersprungen.\n');
      break;
    }

    const wartezeit = a.retryAfter || BACKOFF[Math.min(sperren - 1, BACKOFF.length - 1)];
    await halt(i, wartezeit, 'Radisson ' + (a.status ?? 'Sperre')
      + (a.retryAfter ? ' (Retry-After)' : ''));
    continue;
  }

  if (a.fehler) {
    console.log('FEHLER: ' + a.fehler);
    fehler.push({ ...h, grund: a.fehler });
    await halt(i, PAUSE / 1000, 'normal');
    continue;
  }

  if (!a.zimmer || !a.zimmer.length) {
    console.log('KEINE ZIMMERKATEGORIEN GEFUNDEN');
    console.log('      geprueft: Seitenzustand, strukturierte Daten, eingebettetes JSON, Baum');
    // HTTP 200, aber nichts gefunden: kein erneuter Versuch, nur vermerken.
    fehler.push({ ...h, grund: 'keine Zimmerkategorien' });
    await halt(i, PAUSE / 1000, 'normal');
    continue;
  }

  const info = {
    code: a.haus?.key || null,
    // Der Name aus stayLOG hat Vorrang: Die Zuordnung laeuft spaeter ueber
    // Name und Stadt, und Radissons interne Bezeichnung weicht oft ab.
    name: h.name || a.haus?.name || a.titel || null,
    city: h.city || null,
    website: h.zimmerseite,
  };

  if (trocken) {
    console.log('');
    console.log('      URL:     ' + a.url);
    console.log('      HTTP:    ' + (a.status ?? '?') + '   Titel: ' + (a.titel || '?'));
    console.log('      NUXT:    ' + (a.nuxt ? 'vorhanden' : 'fehlt')
      + '   Rohobjekte: ' + (a.roh ?? 0) + '   DOM-Kandidaten: ' + (a.domKarten ?? 0));
    console.log('      Quelle:  ' + a.quelle + '   Haus: ' + (info.code || '–'));
    console.log('      Zimmer:  ' + a.zimmer.length);
    for (const z of a.zimmer) {
      console.log('        - ' + (z.tmsRoomCode?.description || z.name));
    }
    fertig += 1;
    await halt(i, a.ausAblage ? 0 : PAUSE / 1000, 'normal');
    continue;
  }

  // Ohne Seitenzustand gibt es keine Hauskennung. Dann dient der Slug als
  // Schluessel – er ist bei Radisson eindeutig und stabil.
  if (!info.code) {
    const slug = (String(h.zimmerseite).match(/\/hotels\/([^/?#]+)/i) || [])[1];
    if (slug) info.code = slug.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  }

  if (!info.code) {
    console.log('FEHLER: keine Hauskennung ermittelbar');
    fehler.push({ ...h, grund: 'keine Hauskennung' });
    await halt(i, PAUSE / 1000, 'normal');
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
    console.log(a.zimmer.length + ' roh -> ' + d.gespeichert
      + ' (' + info.code + ', Quelle ' + a.quelle + ')');
    fertig += 1;

    // Haengt ein Hotel aus stayLOG daran, gleich dessen Recherche anstossen –
    // die greift dann auf den eben gefuellten Vorrat zu.
    if (h.id) {
      await fetch(BASIS + '/api/hotels/' + h.id + '/enrich', { method: 'POST', headers: kopf })
        .catch(() => null);
    }
  }

  await halt(i, a.ausAblage ? 0 : PAUSE / 1000, 'normal');
}

await browser.close();

console.log('\n--------------------------------------------');
console.log('Fertig: ' + fertig + ' erledigt, ' + fehler.length + ' offen.');
if (fehler.some((f) => f.grund === 'gesperrt')) {
  console.log('\nGesperrte Haeuser spaeter erneut versuchen, mit groesserer Pause:');
  console.log('  node radisson.mjs --tempo 120000');
}
for (const f of fehler) console.log('  ' + (f.name || f.zimmerseite) + ' — ' + f.grund);
