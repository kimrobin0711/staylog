// stayLOG – API. Laeuft als Cloudflare Pages Function unter /api/*
// Bindings: DB (D1), PHOTOS (R2)
// Secrets:  STAY_PASSWORD (gemeinsames Passwort), ADMIN_PASSWORD, ANTHROPIC_API_KEY
//           CF_ACCOUNT_ID und CF_BROWSER_TOKEN fuer den Browserdienst
//           GOOGLE_API_KEY (optional, fuer Bewertung und Bilder)
// Vars:     OPEN_MODE = "read" (jeder darf schauen) oder "full" (jeder darf auch
//           eintragen). Nicht gesetzt heisst: nur mit Passwort.
//           ADMIN_EMAIL = Adresse, die den Verwaltungsbereich sehen darf.
//           GOOGLE_MONTHLY_LIMIT = Obergrenze fuer Google-Aufrufe pro Monat (Vorgabe 800).

const UA = 'stayLOG/1.0 (persoenliches Hotel-Aufenthaltsbuch)';

/* ---------------------------------------------------------------- Helfer */

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const fail = (message, status = 400) => json({ error: message }, status);

const now = () => new Date().toISOString();

// Benefits sind {name, value}. Aeltere Eintraege sind reine Zeichenketten.
function normalizeBenefits(raw) {
  let list = raw;
  if (typeof raw === 'string') {
    try { list = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(list)) return [];
  return list
    .map((b) => (typeof b === 'string'
      ? { name: b, value: null }
      : { name: String(b.name || '').trim(), value: b.value ? String(b.value).trim() : null }))
    .filter((b) => b.name);
}

// Das gemeinsame Passwort oeffnet die Tuer. Wer zum ersten Mal kommt, legt sich
// mit Adresse und Namen selbst an – danach ist die Adresse die feste Kennung.

function passwordOk(request, env) {
  const pass = (request.headers.get('x-stay-pass') || '').trim();
  const expected = (env.STAY_PASSWORD || '').trim();
  return Boolean(expected) && pass === expected;
}

function loginEmail(request) {
  try {
    const raw = decodeURIComponent(request.headers.get('x-stay-user') || '');
    return raw.trim().toLowerCase().slice(0, 120);
  } catch {
    return '';
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const openMode = (env) => (env.OPEN_MODE || '').trim().toLowerCase();

const isAdmin = (env, user) =>
  Boolean(user?.email) && user.email === (env.ADMIN_EMAIL || '').trim().toLowerCase();

// Gibt das Mitglied zurueck, einen Gast im offenen Betrieb, oder null.
async function whoami(request, env) {
  if (!passwordOk(request, env)) {
    const mode = openMode(env);
    if (mode === 'read' || mode === 'full') {
      return { email: null, name: 'Gast', guest: true, mode };
    }
    return null;
  }
  const email = loginEmail(request);
  if (!email || !EMAIL_RE.test(email)) return null;

  const row = await env.DB.prepare('SELECT email, name, statuses FROM members WHERE email = ?')
    .bind(email).first();
  return row || null;
}

/* ----------------------------------------------------------- Protokoll */

const LOG_DAYS = 30;
const FAIL_WINDOW_MIN = 15;
const FAIL_LIMIT = 10;

function visitor(request) {
  const cf = request.cf || {};
  return {
    ip: request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || null,
    country: cf.country || null,
    city: cf.city || null,
    network: cf.asOrganization || null,
    user_agent: (request.headers.get('user-agent') || '').slice(0, 200) || null,
  };
}

async function logEvent(env, request, event, name, detail) {
  const v = visitor(request);
  try {
    await env.DB.prepare(
      `INSERT INTO access_log (ts, event, name, ip, country, city, network, user_agent, detail)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).bind(now(), event, name || null, v.ip, v.country, v.city, v.network, v.user_agent, detail || null).run();
  } catch { /* Protokoll darf die App nie ausbremsen */ }
}

async function prune(env) {
  const cutoff = new Date(Date.now() - LOG_DAYS * 86400000).toISOString();
  try {
    await env.DB.prepare('DELETE FROM access_log WHERE ts < ?').bind(cutoff).run();
  } catch { /* egal */ }
}

// Zu viele Fehlversuche von derselben Adresse blockieren das Anmelden.
async function tooManyFailures(env, request) {
  const ip = visitor(request).ip;
  if (!ip) return false;
  const since = new Date(Date.now() - FAIL_WINDOW_MIN * 60000).toISOString();
  try {
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM access_log WHERE ip = ? AND event = 'login_fail' AND ts > ?"
    ).bind(ip, since).first();
    return (row?.n || 0) >= FAIL_LIMIT;
  } catch {
    return false;
  }
}

function nightsBetween(a, b) {
  if (!a || !b) return null;
  const ms = Date.parse(b) - Date.parse(a);
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.round(ms / 86400000));
}

/* ------------------------------------------------- Marke -> Programm-Rat */
// Schnelle Erstzuordnung aus dem OSM-brand-Tag. Das LLM korrigiert spaeter.

const BRAND_HINTS = [
  [/marriott|sheraton|westin|courtyard|renaissance|ritz.?carlton|st\.? ?regis|w hotel|aloft|moxy|ac hotel|le m[eé]ridien|autograph|delta hotels|four points|residence inn|fairfield|springhill|towneplace|element |tribute|edition|luxury collection|gaylord|protea/i, 'Marriott Bonvoy'],
  [/hilton|doubletree|hampton|embassy suites|waldorf|conrad|canopy|curio|tapestry|tru by|homewood|home2|motto|signia|lxr/i, 'Hilton Honors'],
  [/holiday inn|intercontinental|crowne plaza|staybridge|candlewood|kimpton|hotel indigo|even hotels|voco|regent|six senses|avid|vignette collection|garner hotel|ruby hotel/i, 'IHG One Rewards'],
  [/hyatt|andaz|thompson hotels|alila|park hyatt|grand hyatt|caption by|urcove|jdv by|destination by hyatt|unbound collection|the standard/i, 'World of Hyatt'],
  [/accor|novotel|ibis|mercure|sofitel|pullman|swiss[oô]tel|m[oö]venpick|raffles|fairmont|banyan tree|mama shelter|25hours|adagio|mgallery|tribe hotel|handwritten collection|emblems collection|orient express/i, 'Accor ALL'],
  [/radisson|park inn|park plaza|country inn|prizeotel|art\'?otel|radisson individuals|radisson collection/i, 'Radisson Rewards'],
  [/wyndham|ramada|days inn|super 8|travelodge|la quinta|howard johnson|tryp by/i, 'Wyndham Rewards'],
  [/comfort inn|quality inn|clarion|sleep inn|econo lodge|cambria|ascend/i, 'Choice Privileges'],
  [/best western|surestay|aiden by|sadie hotel|glo by/i, 'Best Western Rewards'],
  [/mel[ií][aá]|innside|sol by|paradisus|gran mel/i, 'Meliá Rewards'],
  [/nh hotel|nh collection|nhow|anantara|avani|tivoli|elewana/i, 'GHA Discovery'],
  [/scandic/i, 'Scandic Friends'],
  [/motel one/i, 'One Lounge'],
  [/leonardo hotel|nyx hotel/i, 'Leonardo Advantage'],
  [/premier inn/i, 'Premier Inn'],
  [/citizenm/i, 'citizenM'],
];

function guessProgram(text) {
  if (!text) return null;
  for (const [re, program] of BRAND_HINTS) if (re.test(text)) return program;
  return null;
}

/* --------------------------------------------------------- Ortssuche OSM */

// Open-Meteo findet auch Wortanfaenge, Nominatim nicht. Faellt Open-Meteo aus,
// springt Nominatim ein – das findet dann nur vollstaendige Namen.
async function citiesFromOpenMeteo(country, q) {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', q);
  url.searchParams.set('count', '25');
  url.searchParams.set('language', 'de');
  url.searchParams.set('format', 'json');

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error('Open-Meteo antwortet mit ' + res.status);
  const data = await res.json();

  let rows = data.results || [];
  if (country) rows = rows.filter((r) => (r.country_code || '').toUpperCase() === country.toUpperCase());

  return rows.slice(0, 10).map((r) => ({
    name: r.name,
    country: r.country || null,
    country_code: (r.country_code || '').toUpperCase() || null,
    region: [r.admin1, r.admin2].filter(Boolean)[0] || null,
    lat: r.latitude,
    lon: r.longitude,
  }));
}

async function citiesFromNominatim(country, q) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '10');
  url.searchParams.set('addressdetails', '1');
  if (country) url.searchParams.set('countrycodes', country.toLowerCase());

  const res = await fetch(url.toString(), { headers: { 'user-agent': UA, 'accept-language': 'de,en' } });
  if (!res.ok) throw new Error('Nominatim antwortet mit ' + res.status);
  const rows = await res.json();

  return rows.map((r) => ({
    name: r.address?.city || r.address?.town || r.address?.village || r.name || r.display_name.split(',')[0],
    country: r.address?.country || null,
    country_code: (r.address?.country_code || '').toUpperCase() || null,
    region: r.address?.state || null,
    lat: Number(r.lat),
    lon: Number(r.lon),
  }));
}

async function searchCities(country, q) {
  try {
    const rows = await citiesFromOpenMeteo(country, q);
    if (rows.length) return rows;
  } catch { /* dann eben Nominatim */ }
  try {
    return await citiesFromNominatim(country, q);
  } catch {
    return [];
  }
}

// Alle Hotels im Umkreis. Zwei Spiegel, falls einer klemmt.
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

async function searchHotels(lat, lon, radius = 15000) {
  const query = `[out:json][timeout:30];
(
  node["tourism"~"^(hotel|resort)$"]["name"](around:${radius},${lat},${lon});
  way["tourism"~"^(hotel|resort)$"]["name"](around:${radius},${lat},${lon});
);
out tags center 400;`;

  let data = null;
  let lastError = null;

  for (const endpoint of OVERPASS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA },
        body: 'data=' + encodeURIComponent(query),
      });
      if (!res.ok) { lastError = 'Antwort ' + res.status; continue; }
      const parsed = await res.json();
      if (parsed.remark) { lastError = parsed.remark; continue; }
      data = parsed;
      break;
    } catch (err) {
      lastError = String(err.message || err);
    }
  }

  if (!data) throw new Error('Hotelsuche nicht erreichbar: ' + (lastError || 'unbekannt'));

  const seen = new Set();
  const out = [];
  for (const element of data.elements || []) {
    const tags = element.tags || {};
    // Lateinische Schreibweise bevorzugen, Original als Zusatz behalten.
    const name = tags['name:en'] || tags['name:de'] || tags.int_name || tags.name;
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const brand = tags['brand:en'] || tags.brand || tags.operator || null;
    out.push({
      source: 'osm',
      source_id: element.type + '/' + element.id,
      name,
      local_name: tags.name && tags.name !== name ? tags.name : null,
      brand,
      program: guessProgram(brand) || guessProgram(name),
      lat: element.lat ?? element.center?.lat ?? null,
      lon: element.lon ?? element.center?.lon ?? null,
      street: [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ') || null,
    });
  }
  out.sort((a, b) => (b.program ? 1 : 0) - (a.program ? 1 : 0) || a.name.localeCompare(b.name));
  return out;
}

// Namenssuche waehrend des Tippens. Photon kann Wortanfaenge und laesst sich
// auf Hotels einschraenken; Nominatim springt ein, wenn Photon ausfaellt.

async function hotelsFromPhoton(q, lat, lon) {
  const url = new URL('https://photon.komoot.io/api/');
  url.searchParams.set('q', q);
  url.searchParams.set('limit', '25');
  url.searchParams.set('lang', 'en');   // liefert name:en, sonst stehen dort Schriftzeichen
  url.searchParams.append('osm_tag', 'tourism:hotel');
  if (lat && lon) {
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lon', String(lon));
    // Koordinaten sind fuer Photon nur ein Hinweis. Der Kasten begrenzt wirklich.
    const d = 0.55;
    url.searchParams.set('bbox', [lon - d, lat - d, lon + d, lat + d].join(','));
  }

  const res = await fetch(url.toString(), { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error('Photon antwortet mit ' + res.status);
  const data = await res.json();

  const treffer = (data.features || [])
    .map((f) => {
      const props = f.properties || {};
      const name = props.name;
      if (!name) return null;
      const [lng, lat2] = f.geometry?.coordinates || [];
      return {
        source: 'osm',
        source_id: (props.osm_type === 'W' ? 'way' : props.osm_type === 'R' ? 'relation' : 'node') + '/' + props.osm_id,
        name,
        brand: null,
        program: guessProgram(name),
        lat: lat2 ?? null,
        lon: lng ?? null,
        street: [props.street, props.housenumber].filter(Boolean).join(' ') || null,
        place: props.city || props.district || null,
      };
    })
    .filter(Boolean);

  // Zur Sicherheit noch einmal nach Entfernung sieben: hoechstens 60 km.
  if (!lat || !lon) return treffer;
  return treffer.filter((h) => metersApart({ lat, lon }, h) < 60000);
}

async function hotelsFromNominatim(q, lat, lon) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '15');
  url.searchParams.set('extratags', '1');
  url.searchParams.set('namedetails', '1');
  url.searchParams.set('addressdetails', '1');
  if (lat && lon) {
    const d = 0.4;
    url.searchParams.set('viewbox', [lon - d, lat + d, lon + d, lat - d].join(','));
    url.searchParams.set('bounded', '1');
  }

  const res = await fetch(url.toString(), { headers: { 'user-agent': UA, 'accept-language': 'de,en' } });
  if (!res.ok) return [];
  const rows = await res.json();

  return rows
    .filter((r) => r.category === 'tourism' || r.type === 'hotel' || r.extratags?.tourism)
    .map((r) => {
      const brand = r.extratags?.brand || r.extratags?.operator || null;
      const names = r.namedetails || {};
      const name = names['name:en'] || names['name:de'] || names.int_name
        || r.name || r.display_name.split(',')[0];
      return {
        source: 'osm',
        source_id: (r.osm_type || 'node') + '/' + r.osm_id,
        name,
        local_name: names.name && names.name !== name ? names.name : null,
        place: r.address?.city || r.address?.town || r.address?.village || null,
        brand,
        program: guessProgram(brand) || guessProgram(name),
        lat: Number(r.lat),
        lon: Number(r.lon),
        street: null,
      };
    });
}

// Google kennt die aktuellen Namen. OpenStreetMap hinkt bei Markenwechseln nach.
async function hotelsFromGoogle(env, q, lat, lon, city) {
  const key = env.GOOGLE_API_KEY;
  if (!key) return null;

  const limit = Number(env.GOOGLE_MONTHLY_LIMIT || 800);
  if (await usageCount(env, 'google') >= limit) return null;

  const body = {
    // "hotel" im Text hilft Google, Wohnheime und Ferienwohnungen auszusortieren.
    textQuery: [q, 'hotel', city].filter(Boolean).join(' '),
    maxResultCount: 15,
    languageCode: 'de',
  };
  if (lat && lon) {
    body.locationBias = { circle: { center: { latitude: lat, longitude: lon }, radius: 30000 } };
  }

  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Goog-Api-Key': key,
      // Nur Name, Adresse und Lage – das bleibt in der guenstigen Stufe.
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.primaryType,places.types',
    },
    body: JSON.stringify(body),
  });

  await usageAdd(env, 'google', 1);
  if (!res.ok) return null;

  // Nur Beherbergungsbetriebe, keine Wohnheime, Campingplaetze oder Ferienwohnungen.
  const erlaubt = new Set([
    'hotel', 'resort_hotel', 'motel', 'extended_stay_hotel', 'inn',
    'bed_and_breakfast', 'guest_house', 'hostel', 'japanese_inn', 'budget_japanese_inn',
  ]);

  const daten = await res.json();
  return (daten.places || []).map((place) => {
    const name = place.displayName?.text;
    if (!name) return null;

    const typen = [place.primaryType, ...(place.types || [])].filter(Boolean);
    if (typen.length && !typen.some((typ) => erlaubt.has(typ))) return null;

    return {
      source: 'google',
      source_id: 'google/' + place.id,
      name,
      brand: null,
      program: guessProgram(name),
      lat: place.location?.latitude ?? null,
      lon: place.location?.longitude ?? null,
      street: null,
      place: (place.formattedAddress || '').split(',').slice(-2, -1)[0]?.trim() || city || null,
      aktuell: true,
    };
  }).filter(Boolean);
}

async function searchHotelsByName(env, q, lat, lon, city) {
  const withCity = city && !q.toLowerCase().includes(city.toLowerCase()) ? q + ' ' + city : q;

  // Zuerst Google: aktuelle Namen, aktuelle Marken.
  try {
    const google = await hotelsFromGoogle(env, q, lat, lon, city);
    if (google?.length) return google;
  } catch { /* dann die freien Quellen */ }

  try {
    const found = await hotelsFromPhoton(withCity, lat, lon);
    if (found.length) return found;
  } catch { /* dann Nominatim */ }

  try {
    return await hotelsFromNominatim(withCity, lat, lon);
  } catch {
    return [];
  }
}

/* ------------------------------------------- Zimmerkategorien per Claude */

// Merkt sich, warum der Browser nichts geliefert hat – nur fuer die Diagnose.
let letzterBrowserfehler = null;

const warte = (ms) => new Promise((fertig) => setTimeout(fertig, ms));

// Stufe zwei: die Seite in Cloudflares Browser laden, damit JavaScript laeuft.
// Marriott und Hilton bauen ihre Zimmerlisten erst im Browser auf.
async function browserMarkdown(env, url, schonGewartet = false) {
  const konto = (env.CF_ACCOUNT_ID || '').trim();
  const token = (env.CF_BROWSER_TOKEN || '').trim();
  if (!konto || !token || !url) return null;

  const limit = Number(env.BROWSER_MONTHLY_LIMIT || 600);
  if (await usageCount(env, 'browser') >= limit) return null;

  try {
    const res = await fetch(
      'https://api.cloudflare.com/client/v4/accounts/' + konto + '/browser-rendering/markdown',
      {
        method: 'POST',
        signal: AbortSignal.timeout(45000),
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + token,
        },
        // Ohne Zusatzoptionen: "networkidle0" wird auf Kettenseiten nie erreicht,
        // die Anfrage lief dadurch in den Zeitueberlauf.
        body: JSON.stringify({ url }),
      }
    );

    await usageAdd(env, 'browser', 1);

    if (res.status === 429 && !schonGewartet) {
      // Cloudflare begrenzt die Abrufe pro Minute. Einmal warten, dann erneut.
      letzterBrowserfehler = 'Ratenbegrenzung, warte 25 Sekunden';
      await warte(25000);
      return browserMarkdown(env, url, true);
    }

    if (!res.ok) {
      letzterBrowserfehler = 'HTTP ' + res.status + ': ' + (await res.text()).slice(0, 300);
      return null;
    }

    const daten = await res.json();
    const text = typeof daten.result === 'string'
      ? daten.result
      : (daten.result?.markdown || daten.result?.content || null);

    if (!text) {
      letzterBrowserfehler = 'Keine Nutzdaten: ' + JSON.stringify(daten).slice(0, 300);
      return null;
    }
    if (text.length < 800) {
      letzterBrowserfehler = 'Nur ' + text.length + ' Zeichen: ' + text.slice(0, 200);
      return null;
    }

    letzterBrowserfehler = null;
    return { url, text: text.slice(0, 20000), quelle: 'browser' };
  } catch (err) {
    letzterBrowserfehler = String(err.message || err);
    return null;
  }
}

// Viele Ketten legen ihre Zimmerkategorien nach dem schema.org-Standard als
// "HotelRoom" ins HTML. Hilton tut das, andere ebenfalls. Das ist die sauberste
// Quelle ueberhaupt: offiziell, vollstaendig, in der Sprache der Seite.
function hotelRoomsFromSchema(html, quelle) {
  if (!html) return null;

  const zimmer = [];
  const gesehen = new Set();

  // Die Bloecke stehen als JSON im Seitentext, oft mehrfach und verschachtelt.
  const muster = /"@type"\s*:\s*"HotelRoom"\s*,\s*"name"\s*:\s*"((?:[^"\\]|\\.)+)"/g;
  let treffer;

  while ((treffer = muster.exec(html)) && zimmer.length < 40) {
    let name;
    try {
      name = JSON.parse('"' + treffer[1] + '"').trim();
    } catch {
      continue;
    }
    if (!name || name.length > 90) continue;

    const schluessel = slug(name);
    if (gesehen.has(schluessel)) continue;
    gesehen.add(schluessel);

    // Im Umfeld des Namens stehen Beschreibung, Bett und Groesse.
    const umfeld = html.slice(treffer.index, treffer.index + 4000);

    const beschreibung = (umfeld.match(/"description"\s*:\s*"((?:[^"\\]|\\.){10,400})"/) || [])[1];
    const bettart = (umfeld.match(/"typeOfBed"\s*:\s*"([^"]{2,40})"/) || [])[1];
    const bettzahl = (umfeld.match(/"numberOfBeds"\s*:\s*(\d+)/) || [])[1];
    const flaeche = (umfeld.match(/"floorSize"[^}]*?"value"\s*:\s*"?(\d+)/) || [])[1];
    const belegung = (umfeld.match(/"occupancy"[^}]*?"value"\s*:\s*"?(\d+)/) || [])[1];

    let text = null;
    if (beschreibung) {
      try { text = JSON.parse('"' + beschreibung + '"').slice(0, 300); } catch { /* egal */ }
    }

    zimmer.push({
      name,
      description: text,
      type: /suite/i.test(name) ? 'suite' : 'room',
      size_sqm: flaeche ? Number(flaeche) : null,
      bed_type: bettart ? (bettzahl ? bettzahl + ' ' + bettart : bettart) : null,
      max_occupancy: belegung ? Number(belegung) : null,
      source: 'official_schema_org',
      source_url: quelle,
      confidence: 'high',
    });
  }

  return zimmer.length >= 3 ? zimmer : null;
}

// Marriott stellt die Zimmerkategorien als offene Abfrage bereit. Die Kennung
// des Hauses steckt in der Adresse: .../hotels/vlcva-ac-hotel-valencia/
function marshaCode(website) {
  const treffer = (website || '').match(/\/hotels\/([a-z0-9]{5})-/i);
  return treffer ? treffer[1].toUpperCase() : null;
}

// Sucht die Marriott-Seite eines Hauses, dessen Adresse woanders liegt.
// Weiche Marken wie Tribute Portfolio treten oft unter eigener Domain auf.
async function findMarriottPage(hotel) {
  const suche = [hotel.name, hotel.city, 'marriott hotel'].filter(Boolean).join(' ');
  try {
    const res = await fetch(
      'https://duckduckgo.com/html/?q=' + encodeURIComponent('site:marriott.com ' + suche),
      {
        signal: AbortSignal.timeout(12000),
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
            + '(KHTML, like Gecko) Chrome/125.0 Safari/537.36',
        },
      }
    );
    if (!res.ok) return null;

    const html = await res.text();
    // Erste Adresse der Form /hotels/xxxxx-name/ herausziehen.
    const treffer = html.match(/marriott\.com(?:%2F|\/)[a-z-]{2,5}(?:%2F|\/)hotels(?:%2F|\/)([a-z0-9]{5})-/i);
    return treffer ? treffer[1].toUpperCase() : null;
  } catch {
    return null;
  }
}

async function marriottRoomCards(hotel, marshaVorgabe) {
  const marsha = marshaVorgabe || marshaCode(hotel.website);
  if (!marsha) return null;

  const url = 'https://www.marriott.com/services/marriott-hws/roomCards/'
    + '?marsha=' + marsha + '&locale=de-DE&acrsEnabled=false';

  const verweis = hotel.website && /marriott\.com/i.test(hotel.website)
    ? hotel.website.replace(/\/+$/, '') + '/rooms/'
    : 'https://www.marriott.com/';

  const res = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
        + '(KHTML, like Gecko) Chrome/125.0 Safari/537.36',
      accept: 'application/json',
      referer: verweis,
    },
  });
  if (!res.ok) return null;

  const daten = await res.json().catch(() => null);
  const kanten = daten?.data?.property?.roomTypes?.edges;
  if (!Array.isArray(kanten) || !kanten.length) return null;

  const zimmer = [];
  for (const kante of kanten) {
    const k = kante?.node;
    if (!k?.name) continue;

    // Groesse und Bett stehen in der Langbeschreibung und in den Merkmalen.
    const lang = k.longDescription || '';
    const groesse = Number((lang.match(/(\d+)\s*m²/) || [])[1]) || null;
    const bett = (lang.match(/(\d+\s*(?:Kingsize|Queensize|Twinsize|Einzel|Doppel)[^,]*)/i) || [])[1]
      || (k.description || '').split(',').slice(1).join(',').trim() || null;

    const istSuite = /suite/i.test(k.name) || /suite/i.test(k.description || '');

    zimmer.push({
      name: k.name.trim(),
      code: k.roomTypeCode || null,
      description: k.description || null,
      type: istSuite ? 'suite' : 'room',
      size_sqm: groesse,
      bed_type: bett,
      max_occupancy: k.maxOccupancy || null,
      source: 'official_chain_api',
      source_url: url,
      confidence: 'high',
    });
  }

  return zimmer.length ? { marsha, url, zimmer } : null;
}

// Holt das rohe HTML einer Seite ueber den Browser. Nur so kommen wir an die
// schema.org-Bloecke – die Markdown-Fassung wirft sie weg.
async function browserContent(env, url, schonGewartet = false) {
  const konto = (env.CF_ACCOUNT_ID || '').trim();
  const token = (env.CF_BROWSER_TOKEN || '').trim();
  if (!konto || !token || !url) return null;

  const limit = Number(env.BROWSER_MONTHLY_LIMIT || 600);
  if (await usageCount(env, 'browser') >= limit) return null;

  try {
    const res = await fetch(
      'https://api.cloudflare.com/client/v4/accounts/' + konto + '/browser-rendering/content',
      {
        method: 'POST',
        signal: AbortSignal.timeout(60000),
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
        body: JSON.stringify({ url }),
      }
    );
    await usageAdd(env, 'browser', 1);

    if (res.status === 429 && !schonGewartet) {
      await warte(20000);
      return browserContent(env, url, true);
    }
    if (!res.ok) {
      letzterBrowserfehler = 'HTTP ' + res.status;
      return null;
    }
    const daten = await res.json();
    const html = typeof daten.result === 'string' ? daten.result : null;
    return html && html.length > 2000 ? html : null;
  } catch (err) {
    letzterBrowserfehler = String(err.message || err);
    return null;
  }
}

// Versucht der Reihe nach, die Kategorien aus schema.org-Bloecken zu lesen.
async function schemaRooms(env, hotel) {
  const ziel = subUrl(hotel.website, 'rooms') || hotelBaseUrl(hotel.website);
  if (!ziel) return null;

  // Der einfache Abruf ist in Sekunden erledigt und kostet nichts.
  try {
    const res = await fetch(ziel, {
      signal: AbortSignal.timeout(10000),
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
          + '(KHTML, like Gecko) Chrome/125.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'de-DE,de;q=0.9,en;q=0.8',
      },
    });
    if (res.ok) {
      const zimmer = hotelRoomsFromSchema(await res.text(), ziel);
      if (zimmer) return { url: ziel, zimmer };
    }
  } catch { /* dann der Browser */ }

  // Sonst genau EIN Browserabruf. Mehr lohnt nicht: klappt es dort nicht,
  // liefert die Seite die Bloecke schlicht nicht.
  const html = await browserContent(env, ziel);
  const zimmer = hotelRoomsFromSchema(html, ziel);
  return zimmer ? { url: ziel, zimmer } : null;
}

// Sammelt mehrere offizielle Unterseiten zu einem gemeinsamen Text. Bei Marriott
// stehen die Kategorienamen etwa in den Bildbeschreibungen der Galerie.
async function officialCorpus(env, hotel, kette) {
  // Die Galerie zuerst: dort stehen die Kategorienamen in den Bildbeschreibungen.
  // Nur Marriott hat Galerie und Uebersicht unter eigenen Adressen. Bei anderen
  // Ketten liefern diese Pfade Fehlerseiten und kosten nur Zeit.
  const seiten = (kette || '').includes('marriott.com')
    ? ['photos', 'rooms', 'overview']
    : ['rooms'];

  const teile = [];
  const quellen = [];

  for (const name of seiten) {
    const url = subUrl(hotel.website, name);
    if (!url) continue;

    // Zwischen den Abrufen Luft lassen, sonst greift die Ratenbegrenzung.
    if (kette && teile.length) await warte(22000);

    const seite = kette
      ? await browserMarkdown(env, url)
      : await roomPageText(url).catch(() => null);

    if (!seite?.text) continue;
    teile.push('### Seite: ' + url + '\n' + seite.text.slice(0, 12000));
    quellen.push(url);

    // Zwei Seiten reichen meist. Die dritte nur, wenn bisher wenig zusammenkam.
    if (teile.length >= 2 && teile.join('').length > 14000) break;
    if (teile.length >= 3) break;
  }

  if (!teile.length) return null;
  return {
    url: quellen[0],
    quellen,
    quelle: kette ? 'browser' : 'fetch',
    text: teile.join('\n\n').slice(0, 30000),
  };
}

// Stufe eins: die Zimmerseite des Hauses direkt lesen. Viele Kettenseiten
// blocken fremde Zugriffe oder laden per JavaScript nach – dann geht es ohne weiter.
async function roomPageText(website) {
  if (!website) return null;

  const basis = website.replace(/\/+$/, '');
  const kandidaten = [roomsUrl(website), basis + '/zimmer/', basis].filter(Boolean);

  for (const url of kandidaten) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(12000),
        headers: {
          'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
            + '(KHTML, like Gecko) Chrome/125.0 Safari/537.36',
          'accept': 'text/html,application/xhtml+xml',
          'accept-language': 'de,en;q=0.8',
        },
      });
      if (!res.ok) continue;

      const html = await res.text();
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      // Lang genug allein reicht nicht: Kettenseiten liefern ein Geruest voller
      // Navigationstext. Es muss auch nach Zimmern aussehen.
      const treffer = (text.match(/\b(room|rooms|zimmer|suite|suites)\b/gi) || []).length;
      if (text.length > 1500 && treffer >= 6) return { url, text: text.slice(0, 14000) };
    } catch { /* naechster Versuch */ }
  }
  return null;
}

// Domain der Kette, damit die Suche gar nicht erst auf Portalen landet.
const PROGRAMM_DOMAIN = {
  'Marriott Bonvoy': 'marriott.com',
  'Hilton Honors': 'hilton.com',
  'IHG One Rewards': 'ihg.com',
  'World of Hyatt': 'hyatt.com',
  'Accor ALL': 'all.accor.com',
  'Radisson Rewards': 'radissonhotels.com',
  'Wyndham Rewards': 'wyndhamhotels.com',
  'Choice Privileges': 'choicehotels.com',
  'Best Western Rewards': 'bestwestern.com',
  'GHA Discovery': 'ghadiscovery.com',
  'Melia Rewards': 'melia.com',
  'Meliá Rewards': 'melia.com',
  'Scandic Friends': 'scandichotels.com',
};

// Buchungsportale liefern eigene Zimmernamen. Sie sind der letzte Rueckfall,
// wenn die offiziellen Seiten nichts hergeben – und werden dann als vorlaeufig
// gekennzeichnet, damit die Runde sie korrigiert. Metasuchen bleiben tabu.
const PORTALE = ['booking.com', 'hotels.com', 'expedia.com', 'expedia.de', 'agoda.com'];
const istPortal = (url) => {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return PORTALE.some((d) => host === d || host.endsWith('.' + d));
  } catch {
    return false;
  }
};

// Schneidet bekannte Unterseiten ab und liefert die Basisadresse des Hauses.
function hotelBaseUrl(website) {
  if (!website) return null;
  try {
    const url = new URL(website);
    const teile = url.pathname.split('/').filter(Boolean);
    const unterseiten = ['rooms', 'zimmer', 'suites', 'photos', 'overview', 'gallery',
      'dining', 'experiences', 'events'];
    while (teile.length && unterseiten.includes(teile[teile.length - 1])) teile.pop();
    url.pathname = teile.length ? '/' + teile.join('/') + '/' : '/';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

// Baut aus der Hotelseite eine Unterseite. Verhindert /rooms/rooms/.
// Jede Kette schreibt die Sprache anders in die Adresse. Marriott nutzt
// /en-us/, Hilton /en/ oder /de/, Radisson /de-de/. Blind umschreiben fuehrt
// ins Leere – deshalb nur dort, wo wir das Muster kennen.
const SPRACHMUSTER = [
  { host: 'marriott.com',       suche: /\/[a-z]{2}(-[a-z]{2})?\/hotels\//, ersatz: '/en-us/hotels/' },
  { host: 'hilton.com',         suche: /\/[a-z]{2}(-[a-z]{2})?\/hotels\//, ersatz: '/de/hotels/' },
  { host: 'radissonhotels.com', suche: /\/[a-z]{2}-[a-z]{2}\/hotels\//,    ersatz: '/de-de/hotels/' },
];

function subUrl(website, unterseite) {
  const basis = hotelBaseUrl(website);
  if (!basis) return null;

  let adresse = basis;
  for (const muster of SPRACHMUSTER) {
    if (adresse.includes(muster.host) && muster.suche.test(adresse)) {
      adresse = adresse.replace(muster.suche, muster.ersatz);
      break;
    }
  }
  return adresse + unterseite + '/';
}

const roomsUrl = (website) => subUrl(website, 'rooms');

// Die eigene Domain eines unabhaengigen Hauses ist ebenfalls offiziell.
function eigeneDomain(hotel) {
  if (!hotel.website) return null;
  try {
    return new URL(hotel.website).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function chainDomain(hotel) {
  if (hotel.website) {
    try {
      const host = new URL(hotel.website).hostname.replace(/^www\./, '');
      // Nur nehmen, wenn es keine Eigendomain des einzelnen Hauses ist.
      if (Object.values(PROGRAMM_DOMAIN).some((d) => host.endsWith(d))) return host;
    } catch { /* egal */ }
  }
  return PROGRAMM_DOMAIN[hotel.program] || null;
}

const VERBINDLICH_ZUSATZ = (seite) => `

Die folgende Liste stammt unmittelbar vom Betreiber und ist VERBINDLICH.
Groesse, Beschreibung und Bett kennen wir bereits – du sollst sie NICHT wiederholen.

Gib das Feld "rooms" als LEERES Array zurueck und stattdessen ein Feld
"rooms_order" mit den Namen in der richtigen Reihenfolge:

  "rooms": [],
  "rooms_order": ["einfachste Kategorie", "...", "hochwertigste Kategorie"],
  "rank_reliable": true

Regeln dazu:
- Nimm jeden Namen genau einmal auf, wortgetreu wie unten geschrieben.
- Lass keinen weg und ergaenze keinen. Die Anzahl muss genau uebereinstimmen.
- Sortiere von der einfachsten zur hochwertigsten Kategorie. Nutze Groesse,
  Bettentyp, Belegung und die Bezeichnung. Suiten stehen ueber gewoehnlichen
  Zimmern, Praesidenten- und Penthouse-Suiten ganz oben.
- Suche NICHT im Netz nach weiteren Kategorien.

Die uebrigen Felder zum Hotel fuellst du wie gewohnt aus.

${seite.text}`;

const SEITEN_ZUSATZ = (seite) => `

Der Inhalt der offiziellen Zimmerseite liegt dir hier vor. Nimm die Kategorienamen
AUSSCHLIESSLICH aus diesem Text und setze als source_url ${seite.url}.

Der Text kann mehrere Unterseiten desselben Hauses enthalten, jeweils mit
"### Seite:" eingeleitet. Werte sie GEMEINSAM aus und fuehre die Kategorien zusammen.

Wichtig zur Fundstelle: Kettenseiten laden ihre Zimmerliste oft erst bei einer
Verfuegbarkeitsabfrage. Die /rooms/-Seite nennt dann nur eine Anzahl. Die Namen
stehen aber in den Bildbeschreibungen der Galerie. Beispiel:
![Standard Plus King Guest Room](...) ergibt die Kategorie "Standard Plus King Guest Room".
Durchsuche den Text ausdruecklich nach solchen Bildbeschreibungen.

WORTGETREU UEBERNEHMEN – das ist die wichtigste Regel:
Schreibe den Namen exakt so ab, wie er im Text steht. Kuerze nicht, fasse nicht
zusammen, uebersetze nicht und vereinheitliche nichts.
- "Standard Twin/Twin Guest Room" bleibt "Standard Twin/Twin Guest Room".
  NICHT "Standard Twin Room" und nicht "Standard Twin".
- "Standard Plus King Guest Room" bleibt vollstaendig stehen.
  NICHT "Standard Plus King".
Der Zusatz "Guest Room" gehoert zum Namen und wird nie weggelassen.

Was als Kategorie zaehlt:
- Vollstaendige Bezeichnungen einer Zimmerart, etwa "Standard Twin/Twin Guest Room",
  "Family Guest Room", "Junior Suite", "Standard Plus King Guest Room".

Was NICHT als Kategorie zaehlt:
- Bildunterschriften zu Ausschnitten eines Zimmers: "Guest Room Bathroom",
  "Junior Suite - Living Area", "Sleeping Area", "Guest Room View", "Balcony".
- Allgemeines wie "Hotel Room", "Rooms", "Accommodations".
- Namen aus dem Fliesstext oder aus Werbeabsaetzen. Nur was als Bezeichnung eines
  Bildes oder als Ueberschrift einer Zimmerart dasteht, zaehlt.

Beschreibt eine Bildunterschrift einen Ausschnitt, steht der Kategoriename davor und
der Ausschnitt dahinter, getrennt durch Bindestrich: "Junior Suite King - Sleeping Area"
ergibt "Junior Suite King". Schneide nur diesen Ausschnittteil ab, sonst nichts.
Erscheint dieselbe Kategorie mehrfach, nimm sie genau einmal auf.
Erfinde keine Varianten: Wenn nur "Family Twin/Twin Guest Room" dasteht, gibt es kein
zusaetzliches "Family King".

Plausibilitaetspruefung: Nennt eine der Seiten eine Anzahl, etwa "You can choose from
6 types of rooms", vergleiche sie mit deiner Liste. Stimmen die Zahlen ueberein, setze
"confidence": "high". Weichen sie stark ab, suche weiter, bevor du antwortest.

Suche nur dann zusaetzlich im Netz, wenn der Text keine Zimmerkategorien enthaelt.

--- Beginn der Seite ---
${seite.text}
--- Ende der Seite ---`;

const ENRICH_PROMPT = (hotel) => `Recherchiere die Zimmerkategorien dieses Hotels:

Hotel: ${hotel.name}
Stadt: ${hotel.city || 'unbekannt'}
Land: ${hotel.country || 'unbekannt'}
${hotel.brand ? 'Marke laut Kartendaten: ' + hotel.brand : ''}

Vorgehen:
1. Finde zuerst die offizielle Webseite genau dieses Hauses. Gehoert das Haus zu einer Kette,
   liegt sie auf deren eigener Domain, etwa marriott.com, hilton.com, ihg.com, hyatt.com,
   accor.com, radissonhotels.com, melia.com, nh-hotels.com. Die Zimmerseite endet dort meist
   auf /rooms oder /zimmer.
2. Lies genau diese Seite und uebernimm die Kategorienamen exakt so, wie das Hotel sie schreibt.
3. Die Zimmerseiten der Ketten werden oft per JavaScript nachgeladen. Dann suche gezielt
   mit einer Einschraenkung auf die Domain der Kette, etwa:
   site:marriott.com "AC Hotel Valencia" rooms
   Auch die Ausschnitte aus den Suchergebnissen offizieller Seiten sind zulaessig.
4. Findest du auf offiziellen Seiten nichts, nimm als letzten Rueckfall die grossen
   Buchungsportale booking.com, hotels.com, expedia oder agoda und setze bei diesen
   Kategorien "confidence": "medium". Ihre Namen werden als vorlaeufig gekennzeichnet.
   Metasuchen, Sammelseiten, PDFs und Reiseblogs bleiben ausgeschlossen.

Zulaessig sind ausschliesslich:
- die offizielle Seite der Kette, etwa marriott.com, hilton.com, ihg.com, hyatt.com,
  all.accor.com, radissonhotels.com, in jeder Sprachfassung
- die eigene Seite eines unabhaengigen Hauses
- Ausschnitte aus Suchergebnissen, die von einer dieser Seiten stammen

Nur als letzter Rueckfall, wenn offizielle Seiten nichts hergeben:
- Buchungsportale booking.com, hotels.com, expedia, agoda

Unzulaessig – unter keinen Umstaenden verwenden:
- Metasuchen wie kayak, trivago, momondo, skyscanner
- Bewertungsseiten wie tripadvisor
- Stadt- und Sammelportale wie valencia-hotels.org
- PDF-Verkaufsunterlagen, Reisebueros, Archivseiten, Reiseblogs

Diese Seiten erfinden Sammelbezeichnungen wie "Standard Room", "Queen Room" oder
"Triple Room", die das Hotel selbst gar nicht verwendet. Solche Namen sind fuer uns
schlechter als gar keine Angabe. Lieber eine leere Liste als erfundene Kategorien.

Pruefe die Aktualitaet: Klingen die Namen nach einer aelteren Markenfassung oder passen sie
nicht zu den heutigen Marken der Kette, suche weiter statt sie zu uebernehmen.

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt, ohne Markdown, ohne Vor- oder Nachtext:

{
  "found": true,
  "official_name": "aktueller offizieller Name des Hauses, mit Markenzusatz",
  "renamed": false,
  "chain": "Marriott International",
  "brand": "Sheraton",
  "program": "Marriott Bonvoy",
  "lounge": true,
  "breakfast_note": "kurzer Satz zur Fruehstuecksregelung fuer Statusgaeste, sonst null",
  "address": "Strasse Hausnummer, PLZ Ort, Land",
  "website": "https://... offizielle Seite genau dieses Hauses",
  "description": "zwei bis drei Saetze: Lage, Groesse, was das Haus ausmacht",
  "rank_reliable": true,
  "rooms": [
    {
      "name": "Superior Room",
      "type": "room",
      "rank": 1,
      "source": "official_chain_site",
      "source_url": "https://...",
      "confidence": "high",
      "size_sqm": 26,
      "bed_type": "King oder zwei Einzelbetten",
      "max_occupancy": 2,
      "description": "ein Satz, sonst null"
    }
  ]
}

Regeln zur Reihenfolge – das ist der wichtigste Teil:
- "rank" ist die Rangfolge, 1 ist die einfachste Kategorie. Gleicher Rang ist erlaubt,
  wenn zwei Kategorien gleichwertig sind.
- Leite die Reihenfolge NUR aus belegbaren Angaben ab: der Reihenfolge auf der Hotelseite,
  Quadratmetern, Preisstaffelung, Etage, Ausstattung oder ausdruecklichen Hinweisen.
- Rate die Reihenfolge NIEMALS allein aus dem Namen. Klingt eine Kategorie hochwertiger,
  heisst das nichts.
- Kannst du die Reihenfolge nicht belegen, setze "rank_reliable": false und vergib die
  Raenge in der Reihenfolge, in der die Kategorien auf der Seite stehen.

Regeln zum Namen:
- "official_name" ist der Name, unter dem das Haus heute auftritt, samt Markenzusatz.
- Haeuser wechseln die Marke. Weicht der heutige Name vom oben genannten ab, setze
  "renamed": true und gib den aktuellen Namen an. Beispiel: aus einem "Best Western
  Premier Hotel X" wird ein "Radisson Blu Hotel X".
- Bist du dir beim Namen nicht sicher, setze "official_name": null.

Regeln zum Treueprogramm:
- "program" ist das Programm, in dem der Aufenthalt zaehlt. Moegliche Werte sind
  "Marriott Bonvoy", "Hilton Honors", "IHG One Rewards", "World of Hyatt", "Accor ALL",
  "Radisson Rewards", "Wyndham Rewards", "Choice Privileges", "Best Western Rewards",
  "GHA Discovery", "Melia Rewards", "Scandic Friends".
- Achte besonders auf weiche Marken. Viele eigenstaendig klingende Haeuser gehoeren ueber
  eine Mitgliedschaft zu einer Kette. Typische Zusaetze im offiziellen Namen sind
  "a member of Radisson Individuals", "Autograph Collection", "Tribute Portfolio",
  "Curio Collection by Hilton", "Tapestry Collection", "Vignette Collection", "MGallery",
  "Handwritten Collection", "The Unbound Collection by Hyatt", "JdV by Hyatt",
  "Worldhotels", "Ascend Hotel Collection", "BW Premier Collection".
- Laesst der Alltagsname keine Kette erkennen, suche ausdruecklich nach so einer
  Zugehoerigkeit. Der offizielle Name traegt den Zusatz oft, der gebraeuchliche nicht.
- Nur wenn das Haus zu keiner Kette und keinem Programm gehoert, setze null.

Weitere Regeln:
- "type" ist "room" oder "suite".
- "source" ist "official_chain_site" bei der Kettenseite, "official_hotel_website" bei
  der eigenen Seite des Hauses oder "search_snippet_official" bei einem Ausschnitt aus
  den Suchergebnissen einer offiziellen Seite.
- "confidence" ist "high" bei einer offiziellen Seite, "medium" bei einem Ausschnitt
  daraus. Alles darunter gibst du nicht an.
- Achte auf die URL: Haenge kein zweites /rooms/ an eine Adresse, die bereits darauf endet.
- Optionale Felder duerfen null sein. Erfinde nichts, um sie zu fuellen.
- Jede Kategorie braucht die Quell-URL, aus der sie stammt. Zulaessig sind die Domain der
  Kette und grosse Buchungsportale. Unzulaessig bleiben PDFs, Vermittlerseiten und Archive.

Wann "found" auf true steht:
- Sobald du das Haus zweifelsfrei identifiziert hast, setze "found": true – auch dann, wenn
  du nur wenige oder gar keine Zimmerkategorien findest. Gib in dem Fall Adresse, Webseite
  und Beschreibung an und lasse "rooms" leer oder unvollstaendig.
- "found": false gilt nur, wenn du nicht sicher bist, WELCHES Haus gemeint ist, etwa weil
  es in der Stadt mehrere Haeuser dieser Marke gibt und der Name nicht eindeutig ist.`;

async function enrichHotel(env, hotel, seite, nurDomain) {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY ist nicht gesetzt');

  const werkzeug = {
    type: env.WEB_SEARCH_TOOL || 'web_search_20250305',
    name: 'web_search',
    max_uses: nurDomain ? 4 : 5,
  };
  // Durchgang eins: nur offizielle Seiten. Durchgang zwei: dazu die Portale.
  const offiziell = [chainDomain(hotel), eigeneDomain(hotel)].filter(Boolean);
  if (nurDomain) werkzeug.allowed_domains = [nurDomain];
  else if (offiziell.length) werkzeug.allowed_domains = [...new Set([...offiziell, ...PORTALE])];

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: AbortSignal.timeout(90000),   // haengt der Aufruf, brechen wir sauber ab
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      max_tokens: 8000,
      messages: [{
        role: 'user',
        content: ENRICH_PROMPT(hotel)
          + (seite ? (seite.verbindlich ? VERBINDLICH_ZUSATZ(seite) : SEITEN_ZUSATZ(seite)) : ''),
      }],
      tools: [werkzeug],
    }),
  });

  if (!res.ok) throw new Error('Claude API: ' + res.status + ' ' + (await res.text()).slice(0, 300));

  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  // Fuer die Diagnose: was hat das Modell wirklich getan?
  const blocks = (data.content || []).map((b) => b.type);
  const searches = (data.content || []).filter((b) => b.type === 'server_tool_use').length;
  const queries = (data.content || [])
    .filter((b) => b.type === 'server_tool_use')
    .map((b) => b.input?.query)
    .filter(Boolean);

  const diagnose = { blocks, searches, queries, stop: data.stop_reason, text: text.slice(0, 600) };

  const start = text.indexOf('{');
  if (start === -1) {
    const err = new Error('Keine verwertbare Antwort erhalten');
    err.diagnose = diagnose;
    throw err;
  }

  const parsed = parseLoose(text.slice(start));
  if (!parsed) {
    const err = new Error('Antwort liess sich nicht einlesen');
    err.diagnose = diagnose;
    throw err;
  }
  parsed._diagnose = diagnose;
  return parsed;
}

// Bricht die Antwort mitten in der Kategorienliste ab, schneiden wir hinter dem
// letzten vollstaendigen Eintrag ab und schliessen die Klammern selbst.
function parseLoose(raw) {
  try {
    return JSON.parse(raw);
  } catch { /* dann reparieren */ }

  const suffixes = [']}', '"}]}', '}]}', '"}}', '}}', '}'];
  let cut = raw.lastIndexOf('}');
  for (let attempts = 0; cut > 0 && attempts < 40; attempts += 1) {
    const head = raw.slice(0, cut + 1);
    for (const suffix of suffixes) {
      try {
        const value = JSON.parse(head + suffix);
        if (value && typeof value === 'object') return value;
      } catch { /* naechster Versuch */ }
    }
    cut = raw.lastIndexOf('}', cut - 1);
  }
  return null;
}

// Ein Lauf gilt als steckengeblieben, wenn er ohne Startzeit dasteht (Rest aus
// der alten Hintergrundverarbeitung) oder seit ueber drei Minuten laeuft.
function isStuck(hotel) {
  if (hotel.enrich_status !== 'running') return false;
  if (!hotel.enriched_at) return true;
  return Date.now() - Date.parse(hotel.enriched_at) > 180000;
}

// Zurueck auf "pending", damit der Browser die Recherche neu anstossen kann.
async function unstick(env, hotelId) {
  await env.DB.prepare(
    "UPDATE hotels SET enrich_status = 'pending', enrich_error = NULL WHERE id = ?"
  ).bind(hotelId).run();
}

// Fehlt ein Zahlenwert, soll er leer bleiben – nicht zu einer Null werden.
function optionalNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Nur uebernehmen, wenn der neue Name erkennbar dasselbe Haus meint.
function nameFitsHotel(alt, neu) {
  if (!neu || neu.length < 4) return false;
  const stopp = new Set(['hotel', 'the', 'by', 'a', 'member', 'of', 'and', 'resort', 'spa', 'am', 'im']);
  const teile = (s) => new Set(slug(s).split(' ').filter((w) => w.length > 2 && !stopp.has(w)));
  const a = teile(alt);
  const b = teile(neu);
  if (!a.size || !b.size) return false;
  for (const wort of a) if (b.has(wort)) return true;   // ein tragendes Wort genuegt
  return false;
}

async function runEnrichment(env, hotelId) {
  const hotel = await env.DB.prepare('SELECT * FROM hotels WHERE id = ?').bind(hotelId).first();
  if (!hotel) return;

  // enriched_at dient hier als Startzeit, damit haengende Laeufe erkennbar sind.
  await env.DB.prepare(
    "UPDATE hotels SET enrich_status = 'running', enrich_error = NULL, enriched_at = ? WHERE id = ?"
  ).bind(now(), hotelId).run();

  try {
    // Mehrstufig. Bei Kettenseiten lohnt der einfache Abruf nicht: die bauen ihre
    // Zimmerlisten erst im Browser auf. Dort also gleich Stufe zwei.
    const ziel = roomsUrl(hotel.website);
    const kette = Boolean(chainDomain(hotel));

    // Marriott zuerst: die offene Abfrage liefert die verbindlichen Namen.
    let karten = null;
    const istMarriott = (chainDomain(hotel) || '').includes('marriott.com')
      || hotel.program === 'Marriott Bonvoy'
      || /marriott|autograph|tribute|moxy|aloft|element|westin|sheraton|meridien|renaissance|courtyard|residence inn|fairfield|ac hotel|st\.? regis|luxury collection|w hotel|delta hotels/i
        .test([hotel.name, hotel.brand, hotel.chain].filter(Boolean).join(' '));

    if (istMarriott) {
      // Steht keine Marriott-Adresse in der Datenbank, suchen wir sie zuerst.
      const marsha = marshaCode(hotel.website) || await findMarriottPage(hotel).catch(() => null);
      if (marsha) karten = await marriottRoomCards(hotel, marsha).catch(() => null);
    }
    // Zweitbeste Quelle: die schema.org-Bloecke der Hotelseite.
    if (!karten) {
      const schema = await schemaRooms(env, hotel).catch(() => null);
      if (schema) karten = { marsha: null, url: schema.url, zimmer: schema.zimmer };
    }

    // Liegt eine verbindliche Liste vor, sparen wir uns Galerie und Suche.
    let seite = karten ? {
      url: karten.url,
      quellen: [karten.url],
      quelle: karten.marsha ? 'marriott-api' : 'schema-org',
      verbindlich: true,
      text: 'Verbindliche Zimmerkategorien des Hauses, direkt vom Betreiber:\n'
        + karten.zimmer.map((z, i) =>
            (i + 1) + '. ' + z.name
            + ' | ' + (z.description || '')
            + (z.code ? ' | Code ' + z.code : '')
            + ' | ' + (z.size_sqm ? z.size_sqm + ' m²' : 'Größe unbekannt')
            + ' | Bett: ' + (z.bed_type || 'unbekannt')
            + ' | bis ' + (z.max_occupancy || '?') + ' Personen'
          ).join('\n'),
    } : await officialCorpus(env, hotel, kette);
    if (!seite && kette) seite = await browserMarkdown(env, hotel.website);
    if (!seite && !kette) seite = await roomPageText(hotel.website).catch(() => null);

    // Durchgang eins: nur die Domain der Kette. Erst wenn das zu wenig bringt,
    // wird offen gesucht – dann eben mit Namen von Buchungsportalen.
    const domain = chainDomain(hotel);
    let result = null;
    if (domain && !seite) {
      result = await enrichHotel(env, hotel, seite, domain).catch(() => null);
      const genug = result?.found && (result.rooms || []).length >= 3;
      if (!genug) result = null;
    }
    if (!result) result = await enrichHotel(env, hotel, seite, null);

    const stamp = now();

    // Hat das Modell erst jetzt die Kettenadresse gefunden, holen wir die
    // verbindliche Liste nach und lassen sie in einem zweiten, kurzen Aufruf
    // nur noch sortieren.
    if (!karten && result.chain_url) {
      const nachtraeglich = { ...hotel, website: result.chain_url, program: result.program };
      const marsha = marshaCode(result.chain_url);

      if (marsha) karten = await marriottRoomCards(nachtraeglich, marsha).catch(() => null);
      if (!karten) {
        const schema = await schemaRooms(env, nachtraeglich).catch(() => null);
        if (schema) karten = { marsha: null, url: schema.url, zimmer: schema.zimmer };
      }

      if (karten) {
        const zweite = {
          url: karten.url,
          verbindlich: true,
          text: karten.zimmer.map((z, i) =>
            (i + 1) + '. ' + z.name + ' | ' + (z.description || '')).join('\n'),
        };
        const sortierung = await enrichHotel(env, nachtraeglich, zweite, null).catch(() => null);
        if (sortierung?.rooms_order) result.rooms_order = sortierung.rooms_order;
        if (!result.website) result.website = result.chain_url;
      }
    }

    let rooms = Array.isArray(result.rooms) ? result.rooms : [];

    // Steht eine verbindliche Liste bereit, gilt sie – das Modell liefert nur
    // die Reihenfolge. So bleibt seine Antwort kurz und kann nicht abbrechen.
    if (karten?.zimmer?.length) {
      const reihenfolge = Array.isArray(result.rooms_order) ? result.rooms_order : [];
      const offen = [...karten.zimmer];
      const sortiert = [];

      for (const name of reihenfolge) {
        const i = offen.findIndex((z) => slug(z.name) === slug(String(name)));
        if (i >= 0) sortiert.push(offen.splice(i, 1)[0]);
      }
      sortiert.push(...offen);   // was das Modell vergessen hat, kommt hinten an

      rooms = sortiert.map((z, i) => ({ ...z, rank: i + 1 }));
    }

    // Auch ohne Zimmerliste sind Adresse, Webseite und Beschreibung etwas wert.
    if (!result.found || rooms.length === 0) {   // Haus nicht sicher zugeordnet
      await env.DB.prepare(
        `UPDATE hotels SET enrich_status = 'failed', enrich_error = ?, enriched_at = ?,
           chain = COALESCE(?, chain), brand = COALESCE(?, brand),
           program = COALESCE(?, program), lounge = COALESCE(?, lounge),
           breakfast_note = COALESCE(?, breakfast_note),
           address = COALESCE(?, address), website = COALESCE(?, website),
           description = COALESCE(?, description)
         WHERE id = ?`
      ).bind(
        (result.found
          ? 'Hotel gefunden, aber keine Zimmerkategorien'
          : 'Das Haus liess sich nicht eindeutig zuordnen')
          + ' (' + (result._diagnose?.searches ?? 0) + ' Suchen, Stopp: '
          + (result._diagnose?.stop || 'unbekannt') + ')',
        stamp,
        result.chain || null, result.brand || null, result.program || null,
        result.lounge === true ? 1 : result.lounge === false ? 0 : null,
        result.breakfast_note || null, result.address || null,
        result.website || null, result.description || null,
        hotelId
      ).run();
      return;
    }

    // Zugelassen sind nur die Kette und wenige grosse Portale. Alles andere –
    // Metasuchen, Stadtportale, PDFs – liefert erfundene oder veraltete Namen.
    const offizielleQuellen = [
      chainDomain(hotel),
      eigeneDomain(hotel),
      ...Object.values(PROGRAMM_DOMAIN),
    ].filter(Boolean);
    // Die offene Abfrage des Betreibers liegt auf derselben Domain, passt also.

    const istOffiziell = (url) => {
      try {
        const host = new URL(url).hostname.replace(/^www\./, '');
        return offizielleQuellen.some((d) => host === d || host.endsWith('.' + d));
      } catch {
        return false;
      }
    };

    // Offizielle Namen sind verbindlich. Portalnamen gelten als vorlaeufig.
    // Metasuchen, Sammelseiten und PDFs bleiben draussen.
    const brauchbar = rooms
      .filter((r) => r.source_url && !/\.pdf($|\?)/i.test(r.source_url) && r.confidence !== 'low')
      .filter((r) => istOffiziell(r.source_url) || istPortal(r.source_url))
      .map((r) => ({ ...r, source: istOffiziell(r.source_url) ? r.source : 'portal_provisional' }));

    // Gibt es offizielle Namen, verdraengen sie die vorlaeufigen komplett.
    const offizielle = brauchbar.filter((r) => r.source !== 'portal_provisional');
    const gewaehlt = offizielle.length >= 3 ? offizielle : brauchbar;

    // Merkt sich, ob dieser Lauf nur vorlaeufige Namen hervorgebracht hat.
    const vorlaeufig = offizielle.length < 3;

    // Eine oder zwei Kategorien taugen nicht: daraus laesst sich keine Leiter bilden.
    // Lieber keine Kategorie als eine erfundene.
    if (gewaehlt.length < 3) {
      await env.DB.prepare(
        "UPDATE hotels SET enrich_status = 'incomplete', enrich_error = ?, enriched_at = ? WHERE id = ?"
      ).bind(
        'Auf den offiziellen Seiten liessen sich keine Zimmerkategorien belegen',
        stamp, hotelId
      ).run();
      return;
    }

    // Was der Nutzer bestaetigt hat, bleibt unangetastet.
    // Das Vorschaubild der Hotelseite holen wir einmal und behalten es.
    const eigenesBild = await siteImage(result.website || hotel.website);

    const inserts = gewaehlt.slice(0, 30).map((r, i) =>
      env.DB.prepare(
        `INSERT INTO room_types
           (hotel_id, name, rank, confirmed, source, source_url, type, size_sqm,
            bed_type, max_occupancy, description, researched_at, created_at, provisional)
         VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(hotel_id, name) DO UPDATE SET
           provisional   = CASE WHEN room_types.confirmed = 1 THEN 0 ELSE excluded.provisional END,
           rank          = CASE WHEN room_types.confirmed = 1 THEN room_types.rank ELSE excluded.rank END,
           type          = COALESCE(excluded.type, room_types.type),
           size_sqm      = COALESCE(excluded.size_sqm, room_types.size_sqm),
           bed_type      = COALESCE(excluded.bed_type, room_types.bed_type),
           max_occupancy = COALESCE(excluded.max_occupancy, room_types.max_occupancy),
           description   = COALESCE(excluded.description, room_types.description),
           source_url    = COALESCE(excluded.source_url, room_types.source_url),
           researched_at = excluded.researched_at`
      ).bind(
        hotelId, String(r.name).trim(), Number(r.rank) || i + 1,
        r.source || 'llm', r.source_url || null,
        r.type === 'suite' ? 'suite' : r.type === 'room' ? 'room' : null,
        optionalNumber(r.size_sqm),
        r.bed_type || null,
        optionalNumber(r.max_occupancy),
        r.description || null, stamp, stamp, vorlaeufig ? 1 : 0
      )
    );

    // Offizielle Namen ersetzen vorlaeufige, nie umgekehrt.
    if (!vorlaeufig) {
      inserts.push(env.DB.prepare(
        'DELETE FROM room_types WHERE hotel_id = ? AND provisional = 1 AND confirmed = 0'
      ).bind(hotelId));
    }

    inserts.push(
      env.DB.prepare(
        `UPDATE hotels SET enrich_status = 'ready', enriched_at = ?,
           chain = COALESCE(?, chain), brand = COALESCE(?, brand),
           program = COALESCE(?, program), lounge = ?, breakfast_note = ?,
           address = COALESCE(?, address), website = COALESCE(?, website),
           description = COALESCE(?, description), rank_reliable = ?,
           name = COALESCE(?, name), image_url = COALESCE(?, image_url)
         WHERE id = ?`
      ).bind(
        stamp,
        result.chain || null,
        result.brand || null,
        result.program || null,
        result.lounge === true ? 1 : result.lounge === false ? 0 : null,
        result.breakfast_note || null,
        result.address || null,
        result.website || null,
        result.description || null,
        (karten?.zimmer?.length || result.rank_reliable !== false) ? 1 : 0,
        // Umbenennung nur uebernehmen, wenn sie plausibel dasselbe Haus meint.
        (result.official_name && result.official_name !== hotel.name
          && nameFitsHotel(hotel.name, result.official_name))
          ? result.official_name
          : null,
        eigenesBild?.thumb || null,
        hotelId
      )
    );

    await env.DB.batch(inserts);
  } catch (err) {
    await env.DB.prepare("UPDATE hotels SET enrich_status = 'failed', enrich_error = ? WHERE id = ?")
      .bind(String(err.message || err).slice(0, 500), hotelId).run();
  }
}

/* ---------------------------------------------- Verbrauch mitzaehlen */
// Google kennt kein hartes Tageslimit mehr, also fuehren wir selbst Buch.

const monthKey = () => new Date().toISOString().slice(0, 7);

async function usageCount(env, dienst) {
  try {
    const row = await env.DB.prepare('SELECT anzahl FROM usage_counter WHERE dienst = ? AND monat = ?')
      .bind(dienst, monthKey()).first();
    return row?.anzahl || 0;
  } catch {
    return 0;
  }
}

async function usageAdd(env, dienst, wieviel) {
  try {
    await env.DB.prepare(
      `INSERT INTO usage_counter (dienst, monat, anzahl, updated_at) VALUES (?,?,?,?)
       ON CONFLICT(dienst, monat) DO UPDATE SET anzahl = anzahl + excluded.anzahl, updated_at = excluded.updated_at`
    ).bind(dienst, monthKey(), wieviel, now()).run();
  } catch { /* Zaehler darf nie die App aufhalten */ }
}

/* ------------------------------------------------ Google Places (optional) */
// Nur die Place-ID wird gespeichert. Bewertung und Bilder holen wir bei jedem
// Aufruf frisch – Googles Bedingungen erlauben kein Zwischenspeichern.

async function googlePlace(env, hotel) {
  const key = env.GOOGLE_API_KEY;
  if (!key) return null;

  // Selbst gesetzte Obergrenze, damit keine Rechnung ueberrascht.
  const limit = Number(env.GOOGLE_MONTHLY_LIMIT || 800);
  const verbraucht = await usageCount(env, 'google');
  if (verbraucht >= limit) return { limit_erreicht: true, verbraucht, limit, photos: [] };

  let calls = 0;
  let place = null;

  // Kennen wir die Place-ID schon, sparen wir uns die Suche.
  if (hotel.google_place_id) {
    const fields = 'id,displayName,formattedAddress,rating,userRatingCount,googleMapsUri,websiteUri,photos';
    const res = await fetch(
      'https://places.googleapis.com/v1/places/' + encodeURIComponent(hotel.google_place_id)
      + '?languageCode=de',
      { headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': fields } }
    );
    calls += 1;
    if (res.ok) place = await res.json();
  }

  if (!place) {
    const fields = [
      'places.id', 'places.displayName', 'places.formattedAddress', 'places.rating',
      'places.userRatingCount', 'places.googleMapsUri', 'places.websiteUri', 'places.photos',
    ].join(',');

    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': fields,
      },
      body: JSON.stringify({
        textQuery: [hotel.name, hotel.city, hotel.country].filter(Boolean).join(', '),
        maxResultCount: 1,
        languageCode: 'de',
      }),
    });
    calls += 1;
    if (!res.ok) {
      await usageAdd(env, 'google', calls);
      throw new Error('Google Places: ' + res.status);
    }
    place = (await res.json()).places?.[0];
  }

  if (!place) {
    await usageAdd(env, 'google', calls);
    return null;
  }

  const photos = [];
  for (const photo of (place.photos || []).slice(0, 1)) {
    try {
      const media = await fetch(
        'https://places.googleapis.com/v1/' + photo.name +
        '/media?maxWidthPx=900&skipHttpRedirect=true&key=' + key
      );
      calls += 1;
      if (!media.ok) continue;
      const body = await media.json();
      if (body.photoUri) {
        photos.push({
          thumb: body.photoUri,
          page: place.googleMapsUri || null,
          author: (photo.authorAttributions || [])[0]?.displayName || null,
          license: 'Google',
        });
      }
    } catch { /* einzelnes Bild ueberspringen */ }
  }

  await usageAdd(env, 'google', calls);

  return {
    place_id: place.id || null,
    rating: place.rating ?? null,
    rating_count: place.userRatingCount ?? null,
    maps_uri: place.googleMapsUri || null,
    website: place.websiteUri || null,
    address: place.formattedAddress || null,
    photos,
  };
}

/* ------------------------------------- Bilder aus Wikimedia Commons */
// Frei lizenziert, kein Schluessel noetig. Urheber und Lizenz kommen mit.

// Das Vorschaubild der Hotelseite – dasselbe, das beim Teilen eines Links erscheint.
async function siteImage(website) {
  if (!website) return null;
  try {
    const res = await fetch(website, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; stayLOG/1.0)', 'accept': 'text/html' },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 250000);

    const patterns = [
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    ];
    for (const re of patterns) {
      const hit = html.match(re);
      if (hit?.[1]) {
        const absolute = new URL(hit[1], website).toString();
        return { thumb: absolute, page: website, author: null, license: 'Hotelseite' };
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function commonsImages(query) {
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  url.searchParams.set('action', 'query');
  url.searchParams.set('generator', 'search');
  url.searchParams.set('gsrsearch', query);
  url.searchParams.set('gsrnamespace', '6');
  url.searchParams.set('gsrlimit', '8');
  url.searchParams.set('prop', 'imageinfo');
  url.searchParams.set('iiprop', 'url|extmetadata');
  url.searchParams.set('iiurlwidth', '480');
  url.searchParams.set('format', 'json');

  const res = await fetch(url.toString(), { headers: { 'user-agent': UA } });
  if (!res.ok) return [];
  const data = await res.json();
  const pages = Object.values(data.query?.pages || {});

  return pages
    .map((page) => {
      const info = page.imageinfo?.[0];
      if (!info || !/\.(jpe?g|png)$/i.test(info.url || '')) return null;
      const meta = info.extmetadata || {};
      const strip = (html) => (html || '').replace(/<[^>]*>/g, '').trim() || null;
      return {
        thumb: info.thumburl || info.url,
        page: info.descriptionurl || null,
        author: strip(meta.Artist?.value),
        license: strip(meta.LicenseShortName?.value),
      };
    })
    .filter(Boolean)
    .slice(0, 6);
}

/* ---------------------------------------------------- Aufenthalte anreichern */

async function withDetails(env, stays) {
  if (!stays.length) return stays;
  const ids = stays.map((s) => s.id);
  const photos = await env.DB.prepare(
    `SELECT * FROM photos WHERE stay_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`
  ).bind(...ids).all();

  const byStay = new Map();
  for (const p of photos.results) {
    if (!byStay.has(p.stay_id)) byStay.set(p.stay_id, []);
    byStay.get(p.stay_id).push(p);
  }
  for (const s of stays) {
    s.photos = byStay.get(s.id) || [];
    s.benefits = normalizeBenefits(s.benefits);
  }
  return stays;
}

// Welche Kategorien sind Suiten? Fuer die Suite-Upgradequote.
async function suiteLookup(env, hotelIds) {
  const map = new Map();
  if (!hotelIds.length) return map;
  try {
    const rows = await env.DB.prepare(
      `SELECT hotel_id, name, type FROM room_types
        WHERE hotel_id IN (${hotelIds.map(() => '?').join(',')})`
    ).bind(...hotelIds).all();
    for (const r of rows.results) map.set(r.hotel_id + '|' + r.name, r.type);
  } catch {
    // Spalte fehlt noch, weil die Migration aussteht – dann eben ohne Suite-Quote.
  }
  return map;
}

const isSuiteUpgrade = (stay, lookup) =>
  lookup.get(stay.hotel_id + '|' + stay.received_room) === 'suite'
  && lookup.get(stay.hotel_id + '|' + stay.booked_room) !== 'suite';

const share = (part, whole) => (whole ? Math.round((part / whole) * 100) : null);

// Fuer den Hotelabgleich: Gross-/Kleinschreibung, Akzente und Zeichensetzung weg.
function slug(text) {
  return (text || '')
    .toLowerCase().replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

// Tragende Woerter eines Hotelnamens, ohne Fuellwerk.
const NAME_FUELL = new Set([
  'hotel', 'hotels', 'the', 'by', 'a', 'member', 'of', 'and', 'und', 'resort', 'spa',
  'am', 'im', 'zum', 'zur', 'de', 'la', 'le', 'les', 'du', 'des', 'city', 'centre',
  'center', 'collection', 'individuals', 'suites', 'inn',
]);

function nameWords(text) {
  return slug(text).split(' ').filter((w) => w.length > 2 && !NAME_FUELL.has(w));
}

// Meinen zwei Namen dasselbe Haus? Alle tragenden Woerter des kuerzeren Namens
// muessen im laengeren vorkommen UND das erste Wort muss gleich sein. Sonst
// gaelte "Hampton by Hilton Stuttgart" als dasselbe wie "Hilton Stuttgart".
function sameHotelName(a, b) {
  const x = nameWords(a);
  const y = nameWords(b);
  if (!x.length || !y.length) return false;
  if (x[0] !== y[0]) return false;

  const [klein, gross] = x.length <= y.length ? [x, new Set(y)] : [y, new Set(x)];
  return klein.every((wort) => gross.has(wort));
}

// Grobe Entfernung in Metern, reicht fuer "dasselbe Gebaeude".
function metersApart(a, b) {
  if (!a?.lat || !a?.lon || !b?.lat || !b?.lon) return Infinity;
  const dLat = (a.lat - b.lat) * 111000;
  const dLon = (a.lon - b.lon) * 111000 * Math.cos((a.lat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

/* ------------------------------------------------------------- Endpunkte */

export async function onRequest(context) {
  const { request, env, params, waitUntil } = context;
  const path = '/' + (Array.isArray(params.path) ? params.path.join('/') : params.path || '');
  const url = new URL(request.url);
  const method = request.method;

  // Bilder sind oeffentlich lesbar, damit sie sich in die Gruppe teilen lassen.
  if (method === 'GET' && path.startsWith('/photos/')) {
    const key = decodeURIComponent(path.slice('/photos/'.length));
    const obj = await env.PHOTOS.get(key);
    if (!obj) return fail('Bild nicht gefunden', 404);
    return new Response(obj.body, {
      headers: {
        'content-type': obj.httpMetadata?.contentType || 'image/jpeg',
        'cache-control': 'public, max-age=31536000, immutable',
      },
    });
  }

  // Pruefseite. Verraet keine Werte, nur ob sie vorhanden sind.
  if (path === '/health' && method === 'GET') {
    const sent = (request.headers.get('x-stay-pass') || '').trim();
    const expected = (env.STAY_PASSWORD || '').trim();
    return json({
      passwort_hinterlegt: expected.length > 0,
      laenge_hinterlegt: expected.length,
      laenge_gesendet: sent.length,
      passt: expected.length > 0 && sent === expected,
      offener_betrieb: openMode(env) || 'aus',
      adminpasswort_hinterlegt: Boolean(env.ADMIN_PASSWORD),
      google_schluessel_hinterlegt: Boolean(env.GOOGLE_API_KEY),
      browser_konto_hinterlegt: Boolean(env.CF_ACCOUNT_ID),
      browser_token_hinterlegt: Boolean(env.CF_BROWSER_TOKEN),
      anthropic_schluessel_hinterlegt: Boolean(env.ANTHROPIC_API_KEY),
      datenbank_verbunden: Boolean(env.DB),
      bilderspeicher_verbunden: Boolean(env.PHOTOS),
    });
  }

  // Pruefadresse: testet die Ortssuche ohne Anmeldung.
  if (path === '/geo/ping' && method === 'GET') {
    const q = url.searchParams.get('q') || 'frankfu';
    const report = {};
    try {
      report.open_meteo = (await citiesFromOpenMeteo(null, q)).length;
    } catch (err) {
      report.open_meteo_fehler = String(err.message || err);
    }
    try {
      report.nominatim = (await citiesFromNominatim(null, q)).length;
    } catch (err) {
      report.nominatim_fehler = String(err.message || err);
    }
    return json(report);
  }

  const user = await whoami(request, env);

  if (path === '/login' && method === 'POST') {
    if (await tooManyFailures(env, request)) {
      await logEvent(env, request, 'login_blocked', null, null);
      return fail('Zu viele Fehlversuche. Versuch es in einer Viertelstunde erneut.', 429);
    }

    if (!passwordOk(request, env)) {
      const mode = openMode(env);
      const anonymous = !(request.headers.get('x-stay-pass') || '').trim();
      if (anonymous && (mode === 'read' || mode === 'full')) {
        return json({ name: 'Gast', email: null, statuses: {}, guest: true, mode });
      }
      await logEvent(env, request, 'login_fail', null, 'falsches Passwort');
      return fail('Das Passwort stimmt nicht', 401);
    }

    const email = loginEmail(request);
    if (!email || !EMAIL_RE.test(email)) return fail('Trag deine E-Mail-Adresse ein', 400);

    if (user) {
      waitUntil(logEvent(env, request, 'login_ok', user.name, email));
      if (Math.random() < 0.1) waitUntil(prune(env));
      let statuses = {};
      try { statuses = JSON.parse(user.statuses || '{}'); } catch { /* leer lassen */ }
      return json({
        name: user.name,
        email: user.email,
        statuses,
        mode: openMode(env),
        is_admin: isAdmin(env, user),
      });
    }

    // Erster Besuch: Name anlegen.
    let body = {};
    try { body = await request.json(); } catch { /* kein Rumpf */ }
    const name = String(body.name || '').trim().slice(0, 40);

    if (!name) return json({ needsName: true }, 200);
    if (name.length < 2) return fail('Der Name ist zu kurz', 400);

    const taken = await env.DB.prepare('SELECT email FROM members WHERE name = ?').bind(name).first();
    if (taken) return fail('Diesen Namen nutzt schon jemand. Nimm einen anderen.', 409);

    const stamp = now();
    await env.DB.prepare(
      'INSERT INTO members (email, name, statuses, created_at, updated_at) VALUES (?,?,?,?,?)'
    ).bind(email, name, '{}', stamp, stamp).run();

    waitUntil(logEvent(env, request, 'member_create', name, email));
    return json({ name, email, statuses: {}, created: true });
  }

  if (!user) return fail('Bitte anmelden', 401);

  // Gaeste duerfen nur schauen, solange OPEN_MODE nicht auf "full" steht.
  if (user.guest && user.mode !== 'full' && method !== 'GET') {
    return fail('In der Gastansicht kannst du nur schauen. Melde dich an, um etwas einzutragen.', 403);
  }

  try {
    /* ---- Orte und Hotels suchen ---- */

    if (path === '/geo/cities' && method === 'GET') {
      const q = url.searchParams.get('q');
      if (!q || q.length < 2) return json([]);
      return json(await searchCities(url.searchParams.get('country'), q));
    }

    if (path === '/geo/hotel-search' && method === 'GET') {
      const q = url.searchParams.get('q');
      if (!q || q.length < 2) return json([]);
      return json(await searchHotelsByName(
        env,
        q,
        Number(url.searchParams.get('lat')) || null,
        Number(url.searchParams.get('lon')) || null,
        url.searchParams.get('city') || null
      ));
    }

    if (path === '/geo/hotels' && method === 'GET') {
      const lat = Number(url.searchParams.get('lat'));
      const lon = Number(url.searchParams.get('lon'));
      if (!lat || !lon) return fail('Koordinaten fehlen');
      const radius = Number(url.searchParams.get('radius')) || 12000;

      // Was stayLOG schon kennt, steht mit dem gepflegten Namen ganz oben.
      const grad = radius / 111000 + 0.05;
      const eigene = await env.DB.prepare(
        `SELECT id, source, source_id, name, brand, program, lat, lon, city
           FROM hotels
          WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?`
      ).bind(lat - grad, lat + grad, lon - grad, lon + grad).all();

      const bekannt = eigene.results.map((h) => ({
        source: h.source,
        source_id: h.source_id,
        name: h.name,
        brand: h.brand,
        program: h.program,
        lat: h.lat,
        lon: h.lon,
        place: h.city,
        known: true,
      }));

      let gefunden = [];
      try {
        gefunden = await searchHotels(lat, lon, radius);
      } catch (err) {
        if (!bekannt.length) throw err;   // ohne eigene Treffer bleibt es ein Fehler
      }

      // Doppelte aussortieren: gleiche Kennung, gleicher Name oder dieselbe Adresse.
      const kennungen = new Set(bekannt.map((h) => h.source_id).filter(Boolean));
      const namen = new Set(bekannt.map((h) => slug(h.name)));
      const frisch = gefunden.filter((h) =>
        !kennungen.has(h.source_id)
        && !namen.has(slug(h.name))
        && !bekannt.some((b) => metersApart(b, h) < 120));

      return json([...bekannt, ...frisch]);
    }

    /* ---- Hotels ---- */

    // Diagnose: Zustand der Recherchen.
    // Alle steckengebliebenen Recherchen auf einen Schlag freigeben.
    if (path === '/hotels/unstick' && method === 'POST') {
      const rows = await env.DB.prepare(
        "SELECT id, enrich_status, enriched_at FROM hotels WHERE enrich_status = 'running'"
      ).all();
      const stuck = rows.results.filter(isStuck);
      for (const h of stuck) await unstick(env, h.id);
      return json({ freigegeben: stuck.map((h) => h.id) });
    }

    if (path === '/hotels/status' && method === 'GET') {
      const rows = await env.DB.prepare(
        `SELECT id, name, city, enrich_status, enrich_error, enriched_at,
                (SELECT COUNT(*) FROM room_types r WHERE r.hotel_id = h.id) AS kategorien
           FROM hotels h ORDER BY id DESC LIMIT 20`
      ).all();
      return json(rows.results.map((r) => ({
        ...r,
        alter_sekunden: r.enriched_at ? Math.round((Date.now() - Date.parse(r.enriched_at)) / 1000) : null,
      })));
    }

    if (path === '/hotels' && method === 'GET') {
      const rows = await env.DB.prepare(
        `SELECT h.*, COUNT(s.id) AS stay_count
           FROM hotels h LEFT JOIN stays s ON s.hotel_id = h.id
          GROUP BY h.id ORDER BY h.name`
      ).all();
      return json(rows.results);
    }

    if (path === '/hotels' && method === 'POST') {
      const b = await request.json();
      if (!b.name) return fail('Der Name des Hotels fehlt');

      let existing = null;
      if (b.source_id) {
        existing = await env.DB.prepare('SELECT * FROM hotels WHERE source = ? AND source_id = ?')
          .bind(b.source || 'osm', b.source_id).first();
      }

      // Dieselbe Kennung gibt es nicht immer: Photon und Overpass vergeben
      // eigene. Deshalb zusaetzlich ueber Name und Lage abgleichen.
      if (!existing) {
        const candidates = await env.DB.prepare(
          'SELECT * FROM hotels WHERE IFNULL(city, "") = ?'
        ).bind(b.city || '').all();

        const wanted = slug(b.name);
        existing =
          // 1. genau derselbe Name
          candidates.results.find((h) => slug(h.name) === wanted)
          // 2. gleiche tragende Woerter, etwa "AC Hotel Valencia" und
          //    "AC Hotel Valencia by Marriott"
          || candidates.results.find((h) => sameHotelName(h.name, b.name))
          // 3. dasselbe Gebaeude, auch wenn die Namen abweichen
          || candidates.results.find((h) => metersApart(h, b) < 250)
          || null;
      }

      let hotelId;
      if (existing) {
        hotelId = existing.id;
        if (isStuck(existing)) {
          await unstick(env, hotelId);
        }
      } else {
        const res = await env.DB.prepare(
          `INSERT INTO hotels (source, source_id, name, brand, program, country, country_code, city, lat, lon, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          b.source || 'manual', b.source_id || null, b.name, b.brand || null,
          b.program || guessProgram(b.brand) || guessProgram(b.name),
          b.country || null, b.country_code || null, b.city || null,
          b.lat ?? null, b.lon ?? null, now()
        ).run();
        hotelId = res.meta.last_row_id;
        waitUntil(logEvent(env, request, 'hotel_create', user.name, b.name));
        // Die Recherche startet der Browser gleich danach selbst – Hintergrund-
        // aufgaben werden von Cloudflare zu frueh beendet.
      }

      const hotel = await env.DB.prepare('SELECT * FROM hotels WHERE id = ?').bind(hotelId).first();
      const rooms = await env.DB.prepare('SELECT * FROM room_types WHERE hotel_id = ? ORDER BY rank, name')
        .bind(hotelId).all();
      return json({ hotel, rooms: rooms.results });
    }

    const hotelMatch = path.match(/^\/hotels\/(\d+)(\/[a-z]+)?$/);
    if (hotelMatch) {
      const hotelId = Number(hotelMatch[1]);
      const sub = hotelMatch[2] || '';

      if (sub === '' && method === 'GET') {
        let hotel = await env.DB.prepare('SELECT * FROM hotels WHERE id = ?').bind(hotelId).first();
        if (!hotel) return fail('Hotel nicht gefunden', 404);

        if (isStuck(hotel)) {
          await unstick(env, hotelId);
          hotel = { ...hotel, enrich_status: 'pending', enrich_error: null };
        }
        const rooms = await env.DB.prepare('SELECT * FROM room_types WHERE hotel_id = ? ORDER BY rank, name')
          .bind(hotelId).all();
        return json({ hotel, rooms: rooms.results });
      }

      if (sub === '/community' && method === 'GET') {
        const hotel = await env.DB.prepare('SELECT * FROM hotels WHERE id = ?').bind(hotelId).first();
        if (!hotel) return fail('Hotel nicht gefunden', 404);

        const rows = await env.DB.prepare(
          'SELECT * FROM stays WHERE hotel_id = ? ORDER BY checkin DESC, id DESC'
        ).bind(hotelId).all();
        const stays = rows.results;
        const lookup = await suiteLookup(env, [hotelId]);

        const withRank = stays.filter((s) => s.upgrade_steps != null);
        const upgraded = withRank.filter((s) => s.upgrade_steps > 0);
        const suites = stays.filter((s) => isSuiteUpgrade(s, lookup));

        const byStatus = new Map();
        const benefitCount = new Map();
        const benefitValues = new Map();
        const pairs = new Map();

        for (const s of stays) {
          const key = [s.program, s.status_level].filter(Boolean).join(' · ') || 'ohne Status';
          const entry = byStatus.get(key)
            || { label: key, program: s.program, status: s.status_level, stays: 0, upgraded: 0, steps: [] };
          entry.stays += 1;
          if (s.upgrade_steps != null) {
            entry.steps.push(s.upgrade_steps);
            if (s.upgrade_steps > 0) entry.upgraded += 1;
          }
          byStatus.set(key, entry);

          for (const b of normalizeBenefits(s.benefits)) {
            benefitCount.set(b.name, (benefitCount.get(b.name) || 0) + 1);
            if (b.value) {
              if (!benefitValues.has(b.name)) benefitValues.set(b.name, []);
              benefitValues.get(b.name).push(b.value);
            }
          }
          if (s.booked_room && s.received_room) {
            const pairKey = s.booked_room + ' → ' + s.received_room;
            const pair = pairs.get(pairKey)
              || { booked: s.booked_room, received: s.received_room, count: 0, steps: s.upgrade_steps };
            pair.count += 1;
            pairs.set(pairKey, pair);
          }
        }

        return json({
          hotel,
          stays: stays.length,
          people: new Set(stays.map((s) => s.author)).size,
          upgrade_quote: share(upgraded.length, stays.length),
          suite_quote: share(suites.length, stays.length),
          avg_steps: withRank.length
            ? Math.round((withRank.reduce((sum, s) => sum + s.upgrade_steps, 0) / withRank.length) * 10) / 10
            : null,
          by_status: [...byStatus.values()].map((g) => ({
            label: g.label,
            program: g.program,
            status: g.status,
            stays: g.stays,
            upgraded: g.upgraded,
            upgrade_quote: share(g.upgraded, g.stays),
            avg_steps: g.steps.length
              ? Math.round((g.steps.reduce((a, b) => a + b, 0) / g.steps.length) * 10) / 10
              : null,
          })).sort((a, b) => b.stays - a.stays),
          benefits: [...benefitCount.entries()]
            .map(([name, count]) => ({
              name, count,
              quote: share(count, stays.length),
              values: [...new Set(benefitValues.get(name) || [])].slice(0, 5),
            }))
            .sort((a, b) => b.count - a.count),
          pairs: [...pairs.values()].sort((a, b) => b.count - a.count).slice(0, 10),
          alle: await withDetails(env, stays),
        });
      }

      if (sub === '/images' && method === 'GET') {
        const hotel = await env.DB.prepare(
          `SELECT id, name, city, country, website, google_place_id,
                  image_url, rating, rating_count, rating_at
             FROM hotels WHERE id = ?`
        ).bind(hotelId).first();
        if (!hotel) return fail('Hotel nicht gefunden', 404);

        const photos = [];
        if (hotel.image_url) {
          photos.push({ thumb: hotel.image_url, page: hotel.website, author: null, license: 'Hotelseite' });
        }

        // Bewertung nur einmal im Monat frisch holen, sonst aus der Datenbank.
        const frisch = hotel.rating_at
          && Date.now() - Date.parse(hotel.rating_at) < 30 * 86400000;

        let rating = hotel.rating;
        let ratingCount = hotel.rating_count;
        let mapsUri = null;
        let limitErreicht = false;

        if (!frisch && env.GOOGLE_API_KEY) {
          const google = await googlePlace(env, hotel).catch(() => null);
          if (google?.limit_erreicht) {
            limitErreicht = true;
          } else if (google) {
            rating = google.rating ?? rating;
            ratingCount = google.rating_count ?? ratingCount;
            mapsUri = google.maps_uri;

            waitUntil(env.DB.prepare(
              `UPDATE hotels SET google_place_id = COALESCE(?, google_place_id),
                 rating = ?, rating_count = ?, rating_at = ?,
                 image_url = COALESCE(image_url, ?)
               WHERE id = ?`
            ).bind(
              google.place_id, google.rating ?? null, google.rating_count ?? null, now(),
              google.photos?.[0]?.thumb || null, hotelId
            ).run());

            for (const bild of google.photos || []) {
              if (!photos.some((p) => p.thumb === bild.thumb)) photos.push(bild);
            }
          }
        }

        // Ohne eigenes Bild noch bei Wikimedia nachsehen – kostenlos.
        if (!photos.length) {
          const commons = await commonsImages(hotel.name).catch(() => []);
          photos.push(...commons.slice(0, 3));
        }

        return json({
          photos: photos.slice(0, 4),
          rating: rating ?? null,
          rating_count: ratingCount ?? null,
          maps_uri: mapsUri,
          google_aktiv: Boolean(env.GOOGLE_API_KEY),
          limit_erreicht: limitErreicht,
        });
      }

      // Prueft, welche oeffentliche Buchungsadresse die Zimmerkarten liefert.
      // Nur ein Werkzeug fuer die Entwicklung, nichts wird gespeichert.
      if (sub === '/probe' && method === 'POST') {
        const hotel = await env.DB.prepare('SELECT * FROM hotels WHERE id = ?').bind(hotelId).first();
        if (!hotel) return fail('Hotel nicht gefunden', 404);

        const basis = hotelBaseUrl(hotel.website);
        const code = (basis || '').match(/hotels\/([a-z0-9]{5})-/i)?.[1] || null;

        const tag = (plus) => {
          const d = new Date(Date.now() + plus * 86400000);
          return d.toISOString().slice(0, 10);
        };
        const an = tag(30);
        const ab = tag(31);

        const suchparameter = '?arrivalDate=' + an + '&departureDate=' + ab
          + '&numAdults=1&roomCount=1&clusterCode=none';

        const kandidaten = [
          { name: 'rooms mit Datum', url: basis + 'rooms/' + suchparameter },
          { name: 'overview mit Datum', url: basis + 'overview/' + suchparameter },
          code ? {
            name: 'Tarifliste (Altweg)',
            url: 'https://www.marriott.com/reservation/rateListMenu.mi?propertyCode=' + code
              + '&fromDate=' + an + '&toDate=' + ab + '&numberOfAdults=1',
          } : null,
          code ? {
            name: 'Verfuegbarkeitssuche',
            url: 'https://www.marriott.com/reservation/availabilitySearch.mi?propertyCode=' + code,
          } : null,
        ].filter(Boolean);

        const muster = /(guest room|zimmer mit|standardzimmer|deluxe|suite|king|queen|twin)/i;
        const berichte = [];

        for (const k of kandidaten) {
          if (berichte.length) await warte(22000);   // Ratenbegrenzung
          const seite = await browserMarkdown(env, k.url);

          const zeilen = seite?.text
            ? seite.text.split('\n').filter((z) => muster.test(z) && z.length < 160).slice(0, 25)
            : [];

          berichte.push({
            name: k.name,
            url: k.url,
            gelesen: Boolean(seite),
            laenge: seite?.text?.length || 0,
            fehler: seite ? null : letzterBrowserfehler,
            treffer: zeilen,
          });
        }

        return json({ hotel: hotel.name, property_code: code, basis, versuche: berichte });
      }

      // Diagnose: zeigt, welche Seite gelesen wurde und was das Modell antwortet.
      if (sub === '/enrich' && method === 'POST' && url.searchParams.get('debug') === '1') {
        const hotel = await env.DB.prepare('SELECT * FROM hotels WHERE id = ?').bind(hotelId).first();
        if (!hotel) return fail('Hotel nicht gefunden', 404);

        const ziel = roomsUrl(hotel.website);
        const kette = chainDomain(hotel);

        let karten = null;
        if ((kette || '').includes('marriott.com')) {
          karten = await marriottRoomCards(hotel).catch(() => null);
        }
        if (!karten) {
          const schema = await schemaRooms(env, hotel).catch(() => null);
          if (schema) karten = { marsha: null, url: schema.url, zimmer: schema.zimmer };
        }
        const seite = karten ? {
          url: karten.url,
          quellen: [karten.url],
          quelle: karten.marsha ? 'marriott-api' : 'schema-org',
          verbindlich: true,
          text: karten.zimmer.map((z) => z.name + ' | ' + (z.description || '')).join('\n'),
        } : await officialCorpus(env, hotel, kette);

        const bericht = {
          hotel: hotel.name,
          webseite: hotel.website,
          zimmerseite: ziel,
          kette,
          seite_gelesen: seite?.quellen || null,
          seite_quelle: seite?.quelle || (seite ? 'fetch' : null),
          seite_laenge: seite?.text?.length || 0,
          seite_anfang: seite?.text?.slice(0, 800) || null,
          browser_fehler: letzterBrowserfehler,
        };

        try {
          const result = await enrichHotel(env, hotel, seite, kette);
          return json({
            ...bericht,
            gefunden: result.found,
            anzahl: (result.rooms || []).length,
            namen: (result.rooms || []).map((r) => r.name + ' « ' + (r.source_url || 'ohne Quelle')),
            diagnose: result._diagnose,
          });
        } catch (err) {
          return json({ ...bericht, fehler: String(err.message || err), diagnose: err.diagnose || null });
        }
      }

      if (sub === '/enrich' && method === 'POST') {
        // Eine erneute Recherche ist nur einmal im Monat je Hotel erlaubt.
        const stand = await env.DB.prepare(
          'SELECT enrich_status, enriched_at FROM hotels WHERE id = ?'
        ).bind(hotelId).first();

        // Gesperrt wird nur, wenn das bisherige Ergebnis auch etwas taugt.
        const anzahl = await env.DB.prepare(
          'SELECT COUNT(*) AS n FROM room_types WHERE hotel_id = ?'
        ).bind(hotelId).first();

        if (stand?.enrich_status === 'ready' && stand.enriched_at && (anzahl?.n || 0) >= 3) {
          const alter = Date.now() - Date.parse(stand.enriched_at);
          const sperre = 30 * 86400000;
          if (alter < sperre) {
            const frei = new Date(Date.parse(stand.enriched_at) + sperre);
            return json({
              gesperrt: true,
              wieder_ab: frei.toISOString(),
              tage: Math.ceil((sperre - alter) / 86400000),
            }, 429);
          }
        }

        // ?wait=1: der Browser wartet die Recherche ab und bekommt das Ergebnis.
        if (url.searchParams.get('wait') === '1') {
          await runEnrichment(env, hotelId);
          const hotel = await env.DB.prepare('SELECT * FROM hotels WHERE id = ?').bind(hotelId).first();
          const rooms = await env.DB.prepare(
            'SELECT * FROM room_types WHERE hotel_id = ? ORDER BY rank, name'
          ).bind(hotelId).all();
          return json({ hotel, rooms: rooms.results });
        }
        waitUntil(runEnrichment(env, hotelId));
        return json({ status: 'running' });
      }

      if (sub === '/rooms' && method === 'POST') {
        const b = await request.json();
        const stamp = now();
        const ops = [];

        // Umbenennen: die Kategorie und alle Aufenthalte, die darauf zeigen.
        if (b.rename?.von && b.rename?.nach) {
          const von = String(b.rename.von).trim();
          const nach = String(b.rename.nach).trim();
          if (von && nach && von !== nach) {
            await env.DB.batch([
              env.DB.prepare(
                'UPDATE room_types SET name = ?, confirmed = 1, provisional = 0, source = ? WHERE hotel_id = ? AND name = ?'
              ).bind(nach, 'user', hotelId, von),
              env.DB.prepare(
                'UPDATE stays SET booked_room = ? WHERE hotel_id = ? AND booked_room = ?'
              ).bind(nach, hotelId, von),
              env.DB.prepare(
                'UPDATE stays SET received_room = ? WHERE hotel_id = ? AND received_room = ?'
              ).bind(nach, hotelId, von),
            ]);
          }
        }

        for (const r of b.rooms || []) {
          if (!r.name) continue;
          const confirmed = r.confirmed === false ? 0 : 1;
          ops.push(
            env.DB.prepare(
              `INSERT INTO room_types (hotel_id, name, rank, confirmed, source, type, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(hotel_id, name) DO UPDATE SET
                 confirmed = excluded.confirmed,
                 rank = excluded.rank,
                 type = COALESCE(excluded.type, room_types.type)`
            ).bind(
              hotelId, String(r.name).trim(), Number(r.rank) || 0, confirmed,
              r.source || 'user',
              r.type === 'suite' ? 'suite' : r.type === 'room' ? 'room' : null,
              stamp
            )
          );
        }
        // Korrigiert der Nutzer die Reihenfolge, gilt sie ab jetzt als gesichert.
        if (b.rank_confirmed) {
          ops.push(env.DB.prepare('UPDATE hotels SET rank_reliable = 1 WHERE id = ?').bind(hotelId));
        }
        for (const name of b.remove || []) {
          ops.push(env.DB.prepare('DELETE FROM room_types WHERE hotel_id = ? AND name = ?').bind(hotelId, name));
        }
        if (ops.length) await env.DB.batch(ops);

        const rooms = await env.DB.prepare('SELECT * FROM room_types WHERE hotel_id = ? ORDER BY rank, name')
          .bind(hotelId).all();
        return json({ rooms: rooms.results });
      }
    }

    /* ---- Aufenthalte ---- */

    if (path === '/stays' && method === 'GET') {
      const where = [];
      const bind = [];
      const add = (sql, value) => {
        if (value) { where.push(sql); bind.push(value); }
      };
      add('s.program = ?', url.searchParams.get('program'));
      add('s.author = ?', url.searchParams.get('author'));
      add('s.status_level = ?', url.searchParams.get('status'));
      add('h.country_code = ?', url.searchParams.get('country'));
      add('h.city = ?', url.searchParams.get('city'));
      if (url.searchParams.get('hotel')) {
        where.push('h.id = ?');
        bind.push(Number(url.searchParams.get('hotel')));
      }
      if (url.searchParams.get('land')) {
        where.push('h.country = ?');
        bind.push(url.searchParams.get('land'));
      }
      if (url.searchParams.get('upgraded') === '1') where.push('s.upgrade_steps > 0');

      const rows = await env.DB.prepare(
        `SELECT s.*, h.name AS hotel_name, h.brand, h.city, h.country, h.country_code
           FROM stays s JOIN hotels h ON h.id = s.hotel_id
          ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
          ORDER BY s.checkin DESC, s.id DESC LIMIT 300`
      ).bind(...bind).all();

      return json(await withDetails(env, rows.results));
    }

    if (path === '/stays' && method === 'POST') {
      const b = await request.json();
      if (!b.hotel_id) return fail('Es fehlt das Hotel');

      const ranks = await env.DB.prepare('SELECT name, rank FROM room_types WHERE hotel_id = ?')
        .bind(b.hotel_id).all();
      const rankOf = new Map(ranks.results.map((r) => [r.name, r.rank]));
      const bookedRank = b.booked_room ? rankOf.get(b.booked_room) ?? null : null;
      const receivedRank = b.received_room ? rankOf.get(b.received_room) ?? null : null;
      const steps = bookedRank != null && receivedRank != null ? receivedRank - bookedRank : null;

      const res = await env.DB.prepare(
        `INSERT INTO stays (hotel_id, author, program, status_level, checkin, checkout, nights,
                            booked_room, booked_rank, received_room, received_rank, upgrade_steps,
                            price, currency, benefits, notes, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        b.hotel_id, user.name, b.program || null, b.status_level || null,
        b.checkin || null, b.checkout || null, nightsBetween(b.checkin, b.checkout),
        b.booked_room || null, bookedRank, b.received_room || null, receivedRank, steps,
        b.price != null && b.price !== '' ? Number(b.price) : null, b.currency || 'EUR',
        JSON.stringify(normalizeBenefits(b.benefits)), b.notes || null, now()
      ).run();

      // Kennt das Hotel noch kein Programm, uebernehmen wir die Wahl des Nutzers.
      if (b.program) {
        waitUntil(env.DB.prepare(
          'UPDATE hotels SET program = ? WHERE id = ? AND (program IS NULL OR program = "")'
        ).bind(b.program, b.hotel_id).run());
      }

      waitUntil(logEvent(env, request, 'stay_create', user.name, 'Hotel ' + b.hotel_id));
      return json({ id: res.meta.last_row_id });
    }

    const stayMatch = path.match(/^\/stays\/(\d+)$/);

    if (stayMatch && method === 'PUT') {
      const id = Number(stayMatch[1]);
      const stay = await env.DB.prepare('SELECT * FROM stays WHERE id = ?').bind(id).first();
      if (!stay) return fail('Aufenthalt nicht gefunden', 404);
      if (stay.author !== user.name) return fail('Das ist nicht dein Eintrag', 403);

      const b = await request.json();
      const ranks = await env.DB.prepare('SELECT name, rank FROM room_types WHERE hotel_id = ?')
        .bind(stay.hotel_id).all();
      const rankOf = new Map(ranks.results.map((r) => [r.name, r.rank]));
      const bookedRank = b.booked_room ? rankOf.get(b.booked_room) ?? null : null;
      const receivedRank = b.received_room ? rankOf.get(b.received_room) ?? null : null;
      const steps = bookedRank != null && receivedRank != null ? receivedRank - bookedRank : null;

      await env.DB.prepare(
        `UPDATE stays SET program = ?, status_level = ?, checkin = ?, checkout = ?, nights = ?,
           booked_room = ?, booked_rank = ?, received_room = ?, received_rank = ?, upgrade_steps = ?,
           price = ?, currency = ?, benefits = ?, notes = ?
         WHERE id = ?`
      ).bind(
        b.program || null, b.status_level || null,
        b.checkin || null, b.checkout || null, nightsBetween(b.checkin, b.checkout),
        b.booked_room || null, bookedRank, b.received_room || null, receivedRank, steps,
        b.price != null && b.price !== '' ? Number(b.price) : null, b.currency || 'EUR',
        JSON.stringify(normalizeBenefits(b.benefits)), b.notes || null, id
      ).run();

      waitUntil(logEvent(env, request, 'stay_edit', user.name, 'Aufenthalt ' + id));
      return json({ id });
    }

    if (stayMatch && method === 'DELETE') {
      const id = Number(stayMatch[1]);
      const stay = await env.DB.prepare('SELECT * FROM stays WHERE id = ?').bind(id).first();
      if (!stay) return fail('Aufenthalt nicht gefunden', 404);
      if (stay.author !== user.name) return fail('Das ist nicht dein Eintrag', 403);

      const photos = await env.DB.prepare('SELECT key FROM photos WHERE stay_id = ?').bind(id).all();
      for (const p of photos.results) await env.PHOTOS.delete(p.key);
      await env.DB.batch([
        env.DB.prepare('DELETE FROM photos WHERE stay_id = ?').bind(id),
        env.DB.prepare('DELETE FROM stays WHERE id = ?').bind(id),
      ]);
      waitUntil(logEvent(env, request, 'stay_delete', user.name, 'Aufenthalt ' + id));
      return json({ deleted: id });
    }

    /* ---- Bilder ---- */

    if (path === '/photos' && method === 'POST') {
      const stayId = Number(url.searchParams.get('stay_id'));
      if (!stayId) return fail('Der Aufenthalt fehlt');
      const caption = url.searchParams.get('caption') || null;
      const type = request.headers.get('content-type') || 'image/jpeg';
      const key = `${stayId}/${crypto.randomUUID()}.jpg`;

      await env.PHOTOS.put(key, request.body, { httpMetadata: { contentType: type } });
      await env.DB.prepare('INSERT INTO photos (stay_id, key, caption, created_at) VALUES (?,?,?,?)')
        .bind(stayId, key, caption, now()).run();
      waitUntil(logEvent(env, request, 'photo_upload', user.name, 'Aufenthalt ' + stayId));
      return json({ key });
    }

    /* ---- Auswertung ---- */

    // Werte fuer die abhaengigen Filter, jeweils nur was wirklich vorkommt.
    if (path === '/filters' && method === 'GET') {
      const rows = await env.DB.prepare(
        `SELECT h.country, h.country_code, h.city, h.id AS hotel_id, h.name AS hotel_name,
                s.program, s.status_level, s.author
           FROM stays s JOIN hotels h ON h.id = s.hotel_id`
      ).all();

      const byHotel = new Map();
      const programs = new Set();
      const statuses = new Set();
      const people = new Set();

      for (const r of rows.results) {
        if (r.program) programs.add(r.program);
        if (r.status_level) statuses.add(r.status_level);
        if (r.author) people.add(r.author);

        const entry = byHotel.get(r.hotel_id) || {
          country: r.country || 'ohne Land',
          city: r.city || 'ohne Stadt',
          hotel_id: r.hotel_id,
          hotel_name: r.hotel_name,
          stays: 0,
          people: new Set(),
        };
        entry.stays += 1;
        if (r.author) entry.people.add(r.author);
        byHotel.set(r.hotel_id, entry);
      }

      const places = [...byHotel.values()].map((e) => ({
        country: e.country,
        city: e.city,
        hotel_id: e.hotel_id,
        hotel_name: e.hotel_name,
        stays: e.stays,
        people: e.people.size,
      }));
      const allPeople = await env.DB.prepare('SELECT name FROM members ORDER BY name').all();
      for (const m of allPeople.results) people.add(m.name);

      return json({
        places,
        programs: [...programs].sort(),
        statuses: [...statuses].sort(),
        people: [...people].sort(),
      });
    }

    if (path === '/tree' && method === 'GET') {
      const rows = await env.DB.prepare(
        `SELECT h.country, h.country_code, h.city, h.id AS hotel_id, h.name AS hotel_name,
                COUNT(s.id) AS stays
           FROM stays s JOIN hotels h ON h.id = s.hotel_id
          GROUP BY h.id
          ORDER BY h.country, h.city, h.name`
      ).all();

      const tree = [];
      for (const row of rows.results) {
        let country = tree.find((c) => c.country === row.country);
        if (!country) {
          country = { country: row.country || 'ohne Land', country_code: row.country_code, stays: 0, cities: [] };
          tree.push(country);
        }
        let city = country.cities.find((c) => c.city === row.city);
        if (!city) {
          city = { city: row.city || 'ohne Stadt', stays: 0, hotels: [] };
          country.cities.push(city);
        }
        city.hotels.push({ id: row.hotel_id, name: row.hotel_name, stays: row.stays });
        city.stays += row.stays;
        country.stays += row.stays;
      }
      return json(tree);
    }

    if (path === '/stats' && method === 'GET') {
      const author = url.searchParams.get('author');
      const rows = await env.DB.prepare(
        `SELECT s.*, h.name AS hotel_name, h.city, h.country
           FROM stays s JOIN hotels h ON h.id = s.hotel_id
          ${author ? 'WHERE s.author = ?' : ''}`
      ).bind(...(author ? [author] : [])).all();
      const stays = rows.results;
      const lookup = await suiteLookup(env, [...new Set(stays.map((s) => s.hotel_id))]);

      const group = new Map();
      for (const s of stays) {
        const key = (s.program || 'ohne Programm') + ' · ' + (s.status_level || 'ohne Status');
        if (!group.has(key)) {
          group.set(key, {
            program: s.program || 'ohne Programm',
            status: s.status_level || 'ohne Status',
            stays: 0, upgraded: 0, suites: 0, steps: [],
            benefits: new Map(), hotels: new Map(), paths: new Map(),
          });
        }
        const g = group.get(key);
        g.stays += 1;
        if (isSuiteUpgrade(s, lookup)) g.suites += 1;

        const hotel = g.hotels.get(s.hotel_name)
          || { id: s.hotel_id, name: s.hotel_name, city: s.city, stays: 0, steps: [] };
        hotel.stays += 1;
        if (s.upgrade_steps != null) {
          g.steps.push(s.upgrade_steps);
          hotel.steps.push(s.upgrade_steps);
          if (s.upgrade_steps > 0) g.upgraded += 1;
        }
        g.hotels.set(s.hotel_name, hotel);

        for (const b of normalizeBenefits(s.benefits)) {
          g.benefits.set(b.name, (g.benefits.get(b.name) || 0) + 1);
        }

        if (s.booked_room && s.received_room && s.upgrade_steps > 0) {
          const key = s.booked_room + ' → ' + s.received_room;
          const path = g.paths.get(key)
            || { booked: s.booked_room, received: s.received_room, steps: s.upgrade_steps, count: 0 };
          path.count += 1;
          g.paths.set(key, path);
        }
      }

      const average = (list) => (list.length
        ? Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 10) / 10
        : null);

      const groups = [...group.values()].map((g) => ({
        program: g.program,
        status: g.status,
        stays: g.stays,
        upgrade_quote: share(g.upgraded, g.stays),
        suite_quote: share(g.suites, g.stays),
        avg_steps: average(g.steps),
        benefits: [...g.benefits.entries()]
          .map(([name, count]) => ({ name, count, quote: share(count, g.stays) }))
          .sort((a, b) => b.quote - a.quote)
          .slice(0, 8),
        paths: [...g.paths.values()].sort((a, b) => b.count - a.count).slice(0, 3),
        top_hotels: [...g.hotels.values()]
          .map((h) => ({ id: h.id, name: h.name, city: h.city, stays: h.stays, avg_steps: average(h.steps) }))
          .filter((h) => h.avg_steps != null && h.avg_steps > 0)
          .sort((a, b) => b.avg_steps - a.avg_steps || b.stays - a.stays)
          .slice(0, 3),
      })).sort((a, b) => b.stays - a.stays);

      const withRank = stays.filter((s) => s.upgrade_steps != null);
      return json({
        totals: {
          stays: stays.length,
          hotels: new Set(stays.map((s) => s.hotel_id)).size,
          nights: stays.reduce((sum, s) => sum + (s.nights || 0), 0),
          upgrade_quote: share(withRank.filter((s) => s.upgrade_steps > 0).length, stays.length),
        },
        groups,
      });
    }

    // Alles loeschen. Verlangt Adminadresse, Adminpasswort und ein Bestaetigungswort.
    if (path === '/admin/reset' && method === 'POST') {
      if (!isAdmin(env, user)) return fail('Nur der Verwalter darf das', 403);

      const admin = (env.ADMIN_PASSWORD || '').trim();
      if (!admin) return fail('Es ist kein ADMIN_PASSWORD hinterlegt', 400);
      if ((request.headers.get('x-stay-admin') || '').trim() !== admin) {
        return fail('Das Adminpasswort stimmt nicht', 403);
      }

      const body = await request.json().catch(() => ({}));
      if (body.confirm !== 'LOESCHEN') return fail('Bestätigungswort fehlt', 400);

      const scope = body.scope === 'alles' ? 'alles' : 'aufenthalte';

      // Bilder liegen ausserhalb der Datenbank und muessen einzeln weg.
      const photos = await env.DB.prepare('SELECT key FROM photos').all();
      for (const p of photos.results) {
        try { await env.PHOTOS.delete(p.key); } catch { /* weiter */ }
      }

      const steps = [
        env.DB.prepare('DELETE FROM photos'),
        env.DB.prepare('DELETE FROM stays'),
      ];
      if (scope === 'alles') {
        steps.push(env.DB.prepare('DELETE FROM room_types'));
        steps.push(env.DB.prepare('DELETE FROM hotels'));
      }
      await env.DB.batch(steps);

      waitUntil(logEvent(env, request, 'admin_reset', user.name, scope));
      return json({ geloescht: scope, bilder: photos.results.length });
    }

    // Doppelte Hotels zusammenfuehren: Aufenthalte und Kategorien wandern zum
    // aeltesten Eintrag, die spaeteren verschwinden.
    if (path === '/admin/merge' && method === 'POST') {
      if (!isAdmin(env, user)) return fail('Nur der Verwalter darf das', 403);

      const rows = await env.DB.prepare('SELECT * FROM hotels ORDER BY id').all();
      const hotels = rows.results;
      const zusammen = [];

      for (let i = 0; i < hotels.length; i += 1) {
        const behalten = hotels[i];
        if (behalten.merged) continue;

        for (let j = i + 1; j < hotels.length; j += 1) {
          const weg = hotels[j];
          if (weg.merged) continue;
          if ((behalten.city || '') !== (weg.city || '')) continue;

          const gleich = slug(behalten.name) === slug(weg.name)
            || sameHotelName(behalten.name, weg.name)
            || metersApart(behalten, weg) < 250;
          if (!gleich) continue;

          weg.merged = true;
          zusammen.push({ behalten: behalten.id, entfernt: weg.id, name: weg.name });

          await env.DB.batch([
            env.DB.prepare('UPDATE stays SET hotel_id = ? WHERE hotel_id = ?').bind(behalten.id, weg.id),
            // Kategorien nur uebernehmen, wenn der Name dort noch fehlt.
            env.DB.prepare(
              `INSERT OR IGNORE INTO room_types
                 (hotel_id, name, rank, confirmed, source, source_url, type, size_sqm,
                  bed_type, max_occupancy, description, researched_at, created_at)
               SELECT ?, name, rank, confirmed, source, source_url, type, size_sqm,
                      bed_type, max_occupancy, description, researched_at, created_at
                 FROM room_types WHERE hotel_id = ?`
            ).bind(behalten.id, weg.id),
            env.DB.prepare('DELETE FROM room_types WHERE hotel_id = ?').bind(weg.id),
            env.DB.prepare('DELETE FROM hotels WHERE id = ?').bind(weg.id),
          ]);
        }
      }

      waitUntil(logEvent(env, request, 'admin_merge', user.name, zusammen.length + ' zusammengefuehrt'));
      return json({ zusammengefuehrt: zusammen });
    }

    // Zaehlt, was ein Zuruecksetzen betreffen wuerde.
    if (path === '/admin/summary' && method === 'GET') {
      if (!isAdmin(env, user)) return fail('Nur der Verwalter darf das', 403);
      const google = await usageCount(env, 'google');
      const browser = await usageCount(env, 'browser');
      const row = await env.DB.prepare(
        `SELECT (SELECT COUNT(*) FROM stays) AS aufenthalte,
                (SELECT COUNT(*) FROM hotels) AS hotels,
                (SELECT COUNT(*) FROM room_types) AS kategorien,
                (SELECT COUNT(*) FROM photos) AS bilder,
                (SELECT COUNT(*) FROM members) AS mitglieder`
      ).first();
      return json({
        ...row,
        google_monat: google,
        google_limit: Number(env.GOOGLE_MONTHLY_LIMIT || 800),
        browser_monat: browser,
        browser_limit: Number(env.BROWSER_MONTHLY_LIMIT || 600),
      });
    }

    if (path === '/me/status' && method === 'PUT') {
      if (user.guest) return fail('Dafür musst du angemeldet sein', 403);
      const body = await request.json();
      await env.DB.prepare('UPDATE members SET statuses = ?, updated_at = ? WHERE email = ?')
        .bind(JSON.stringify(body.statuses || {}), now(), user.email).run();
      return json({ gespeichert: true });
    }

    if (path === '/log' && method === 'GET') {
      const admin = (env.ADMIN_PASSWORD || '').trim();
      if (!admin) return fail('Fuer das Protokoll ist kein ADMIN_PASSWORD gesetzt', 403);
      if ((request.headers.get('x-stay-admin') || '').trim() !== admin) {
        await logEvent(env, request, 'login_fail', user.name, 'Protokoll: falsches Adminpasswort');
        return fail('Das Adminpasswort stimmt nicht', 403);
      }
      const rows = await env.DB.prepare('SELECT * FROM access_log ORDER BY id DESC LIMIT 300').all();
      return json({ days: LOG_DAYS, entries: rows.results });
    }

    if (path === '/people' && method === 'GET') {
      const rows = await env.DB.prepare('SELECT name FROM members ORDER BY name').all();
      return json(rows.results.map((r) => r.name));
    }

    return fail('Diesen Weg gibt es nicht: ' + path, 404);
  } catch (err) {
    return fail(String(err.message || err), 500);
  }
}
