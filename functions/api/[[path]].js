// stayLOG – API. Laeuft als Cloudflare Pages Function unter /api/*
// Bindings: DB (D1), PHOTOS (R2)
// Secrets:  STAY_PASSWORD (gemeinsames Passwort), ANTHROPIC_API_KEY

const UA = 'stayLOG/1.0 (persoenliches Hotel-Aufenthaltsbuch)';

/* ---------------------------------------------------------------- Helfer */

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const fail = (message, status = 400) => json({ error: message }, status);

const now = () => new Date().toISOString();

// Ein gemeinsames Passwort oeffnet die Seite. Der Name sagt nur, wer den
// Eintrag geschrieben hat – er ist keine zweite Huerde.
function whoami(request, env) {
  const pass = (request.headers.get('x-stay-pass') || '').trim();
  const expected = (env.STAY_PASSWORD || '').trim();
  if (!expected || pass !== expected) return null;

  let name = '';
  try {
    name = decodeURIComponent(request.headers.get('x-stay-name') || '');
  } catch {
    return null;
  }
  name = name.trim().slice(0, 40);
  return name || null;
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
  [/holiday inn|intercontinental|crowne plaza|staybridge|candlewood|kimpton|hotel indigo|even hotels|voco|regent|six senses|avid/i, 'IHG One Rewards'],
  [/hyatt|andaz|thompson hotels|alila|park hyatt|grand hyatt|caption by|urcove/i, 'World of Hyatt'],
  [/accor|novotel|ibis|mercure|sofitel|pullman|swiss[oô]tel|m[oö]venpick|raffles|fairmont|banyan tree|mama shelter|25hours|adagio|mgallery|tribe hotel/i, 'Accor ALL'],
  [/radisson|park inn|park plaza|country inn|prizeotel|art\'?otel/i, 'Radisson Rewards'],
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
    const name = tags.name;
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const brand = tags.brand || tags.operator || null;
    out.push({
      source: 'osm',
      source_id: element.type + '/' + element.id,
      name,
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

// Zweite Quelle: gezielt nach dem getippten Namen suchen.
async function searchHotelsByName(q, lat, lon) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '15');
  url.searchParams.set('extratags', '1');
  if (lat && lon) {
    const d = 0.35;
    url.searchParams.set('viewbox', [lon - d, lat + d, lon + d, lat - d].join(','));
    url.searchParams.set('bounded', '1');
  }

  const res = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'de,en' } });
  if (!res.ok) return [];
  const rows = await res.json();

  return rows
    .filter((r) => r.category === 'tourism' || r.type === 'hotel' || r.extratags?.tourism)
    .map((r) => {
      const brand = r.extratags?.brand || r.extratags?.operator || null;
      const name = r.name || r.display_name.split(',')[0];
      return {
        source: 'osm',
        source_id: (r.osm_type || 'node') + '/' + r.osm_id,
        name,
        brand,
        program: guessProgram(brand) || guessProgram(name),
        lat: Number(r.lat),
        lon: Number(r.lon),
        street: null,
      };
    });
}

/* ------------------------------------------- Zimmerkategorien per Claude */

const ENRICH_PROMPT = (hotel) => `Recherchiere die Zimmerkategorien dieses Hotels:

Hotel: ${hotel.name}
Stadt: ${hotel.city || 'unbekannt'}
Land: ${hotel.country || 'unbekannt'}
${hotel.brand ? 'Marke laut Kartendaten: ' + hotel.brand : ''}

Nutze die Websuche. Bevorzuge die offizielle Seite der Hotelkette, sonst grosse Buchungsportale.

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt, ohne Markdown, ohne Vor- oder Nachtext:

{
  "found": true,
  "chain": "Marriott International",
  "brand": "Sheraton",
  "program": "Marriott Bonvoy",
  "lounge": true,
  "breakfast_note": "kurzer Satz zur Fruehstuecksregelung fuer Statusgaeste, sonst null",
  "address": "Strasse Hausnummer, PLZ Ort, Land",
  "website": "https://... offizielle Seite genau dieses Hauses",
  "description": "zwei bis drei Saetze: Lage, Groesse, was das Haus ausmacht",
  "rooms": [
    {"name": "Classic Room", "rank": 1, "source_url": "https://..."},
    {"name": "Deluxe Room", "rank": 2, "source_url": "https://..."}
  ]
}

Regeln:
- "rank" ist die Rangfolge der Kategorie, 1 ist die einfachste. Gleicher Rang ist erlaubt, wenn zwei Kategorien gleichwertig sind.
- "name" ist der Kategoriename genau so, wie ihn das Hotel schreibt.
- "program" ist das Vielfliegerprogramm bzw. Treueprogramm der Kette, z.B. "Marriott Bonvoy", "Hilton Honors", "IHG One Rewards", "World of Hyatt", "Accor ALL", "Radisson Rewards". Ist das Hotel unabhaengig, setze null.
- Jede Kategorie braucht die Quell-URL, aus der sie stammt.
- "website" ist die Seite genau dieses Hauses, nicht die Startseite der Kette. Findest du sie nicht, setze null.
- Findest du das Hotel nicht sicher, antworte {"found": false, "rooms": []}. Erfinde nichts.`;

async function enrichHotel(env, hotel) {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY ist nicht gesetzt');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: ENRICH_PROMPT(hotel) }],
      tools: [{ type: env.WEB_SEARCH_TOOL || 'web_search_20250305', name: 'web_search', max_uses: 4 }],
    }),
  });

  if (!res.ok) throw new Error('Claude API: ' + res.status + ' ' + (await res.text()).slice(0, 300));

  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Keine verwertbare Antwort erhalten');
  return JSON.parse(text.slice(start, end + 1));
}

async function runEnrichment(env, hotelId) {
  const hotel = await env.DB.prepare('SELECT * FROM hotels WHERE id = ?').bind(hotelId).first();
  if (!hotel) return;

  await env.DB.prepare("UPDATE hotels SET enrich_status = 'running', enrich_error = NULL WHERE id = ?")
    .bind(hotelId).run();

  try {
    const result = await enrichHotel(env, hotel);
    const stamp = now();

    if (!result.found || !Array.isArray(result.rooms) || result.rooms.length === 0) {
      await env.DB.prepare(
        "UPDATE hotels SET enrich_status = 'failed', enrich_error = ?, enriched_at = ? WHERE id = ?"
      ).bind('Keine gesicherten Zimmerkategorien gefunden', stamp, hotelId).run();
      return;
    }

    const inserts = result.rooms.slice(0, 25).map((r, i) =>
      env.DB.prepare(
        `INSERT INTO room_types (hotel_id, name, rank, confirmed, source, source_url, created_at)
         VALUES (?, ?, ?, 0, 'llm', ?, ?)
         ON CONFLICT(hotel_id, name) DO UPDATE SET rank = excluded.rank`
      ).bind(hotelId, String(r.name).trim(), Number(r.rank) || i + 1, r.source_url || null, stamp)
    );

    inserts.push(
      env.DB.prepare(
        `UPDATE hotels SET enrich_status = 'ready', enriched_at = ?,
           chain = COALESCE(?, chain), brand = COALESCE(?, brand),
           program = COALESCE(?, program), lounge = ?, breakfast_note = ?,
           address = COALESCE(?, address), website = COALESCE(?, website),
           description = COALESCE(?, description)
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
        hotelId
      )
    );

    await env.DB.batch(inserts);
  } catch (err) {
    await env.DB.prepare("UPDATE hotels SET enrich_status = 'failed', enrich_error = ? WHERE id = ?")
      .bind(String(err.message || err).slice(0, 500), hotelId).run();
  }
}

/* ------------------------------------- Bilder aus Wikimedia Commons */
// Frei lizenziert, kein Schluessel noetig. Urheber und Lizenz kommen mit.

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
      adminpasswort_hinterlegt: Boolean(env.ADMIN_PASSWORD),
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

  const user = whoami(request, env);

  if (path === '/login' && method === 'POST') {
    if (await tooManyFailures(env, request)) {
      await logEvent(env, request, 'login_blocked', null, null);
      return fail('Zu viele Fehlversuche. Versuch es in einer Viertelstunde erneut.', 429);
    }
    if (user) {
      waitUntil(logEvent(env, request, 'login_ok', user, null));
      if (Math.random() < 0.1) waitUntil(prune(env));
      return json({ name: user });
    }
    const hasName = (request.headers.get('x-stay-name') || '').trim().length > 0;
    await logEvent(env, request, 'login_fail', null, hasName ? 'falsches Passwort' : 'Name fehlt');
    return fail(hasName ? 'Das Passwort stimmt nicht' : 'Trag deinen Namen ein', 401);
  }

  if (!user) return fail('Bitte anmelden', 401);

  try {
    /* ---- Orte und Hotels suchen ---- */

    if (path === '/geo/cities' && method === 'GET') {
      const q = url.searchParams.get('q');
      if (!q || q.length < 2) return json([]);
      return json(await searchCities(url.searchParams.get('country'), q));
    }

    if (path === '/geo/hotel-search' && method === 'GET') {
      const q = url.searchParams.get('q');
      if (!q || q.length < 3) return json([]);
      return json(await searchHotelsByName(
        q,
        Number(url.searchParams.get('lat')) || null,
        Number(url.searchParams.get('lon')) || null
      ));
    }

    if (path === '/geo/hotels' && method === 'GET') {
      const lat = Number(url.searchParams.get('lat'));
      const lon = Number(url.searchParams.get('lon'));
      if (!lat || !lon) return fail('Koordinaten fehlen');
      const radius = Number(url.searchParams.get('radius')) || 12000;
      return json(await searchHotels(lat, lon, radius));
    }

    /* ---- Hotels ---- */

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
      if (!existing) {
        existing = await env.DB.prepare('SELECT * FROM hotels WHERE name = ? AND IFNULL(city, "") = ?')
          .bind(b.name, b.city || '').first();
      }

      let hotelId;
      if (existing) {
        hotelId = existing.id;
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
        waitUntil(logEvent(env, request, 'hotel_create', user, b.name));
        waitUntil(runEnrichment(env, hotelId));
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
        const hotel = await env.DB.prepare('SELECT * FROM hotels WHERE id = ?').bind(hotelId).first();
        if (!hotel) return fail('Hotel nicht gefunden', 404);
        const rooms = await env.DB.prepare('SELECT * FROM room_types WHERE hotel_id = ? ORDER BY rank, name')
          .bind(hotelId).all();
        return json({ hotel, rooms: rooms.results });
      }

      if (sub === '/images' && method === 'GET') {
        const hotel = await env.DB.prepare('SELECT name, city FROM hotels WHERE id = ?').bind(hotelId).first();
        if (!hotel) return fail('Hotel nicht gefunden', 404);
        try {
          return json(await commonsImages([hotel.name, hotel.city].filter(Boolean).join(' ')));
        } catch {
          return json([]);
        }
      }

      if (sub === '/enrich' && method === 'POST') {
        waitUntil(runEnrichment(env, hotelId));
        return json({ status: 'running' });
      }

      if (sub === '/rooms' && method === 'POST') {
        const b = await request.json();
        const stamp = now();
        const ops = [];

        for (const r of b.rooms || []) {
          if (!r.name) continue;
          ops.push(
            env.DB.prepare(
              `INSERT INTO room_types (hotel_id, name, rank, confirmed, source, created_at)
               VALUES (?, ?, ?, 1, ?, ?)
               ON CONFLICT(hotel_id, name) DO UPDATE SET confirmed = 1, rank = excluded.rank`
            ).bind(hotelId, String(r.name).trim(), Number(r.rank) || 0, r.source || 'user', stamp)
          );
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
      if (url.searchParams.get('upgraded') === '1') where.push('s.upgrade_steps > 0');

      const rows = await env.DB.prepare(
        `SELECT s.*, h.name AS hotel_name, h.brand, h.city, h.country, h.country_code
           FROM stays s JOIN hotels h ON h.id = s.hotel_id
          ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
          ORDER BY s.checkin DESC, s.id DESC LIMIT 300`
      ).bind(...bind).all();

      const stays = rows.results;
      if (stays.length) {
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
          s.benefits = s.benefits ? JSON.parse(s.benefits) : [];
        }
      }
      return json(stays);
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
        b.hotel_id, user, b.program || null, b.status_level || null,
        b.checkin || null, b.checkout || null, nightsBetween(b.checkin, b.checkout),
        b.booked_room || null, bookedRank, b.received_room || null, receivedRank, steps,
        b.price != null && b.price !== '' ? Number(b.price) : null, b.currency || 'EUR',
        JSON.stringify(b.benefits || []), b.notes || null, now()
      ).run();

      waitUntil(logEvent(env, request, 'stay_create', user, 'Hotel ' + b.hotel_id));
      return json({ id: res.meta.last_row_id });
    }

    const stayMatch = path.match(/^\/stays\/(\d+)$/);
    if (stayMatch && method === 'DELETE') {
      const id = Number(stayMatch[1]);
      const stay = await env.DB.prepare('SELECT * FROM stays WHERE id = ?').bind(id).first();
      if (!stay) return fail('Aufenthalt nicht gefunden', 404);
      if (stay.author !== user) return fail('Das ist nicht dein Eintrag', 403);

      const photos = await env.DB.prepare('SELECT key FROM photos WHERE stay_id = ?').bind(id).all();
      for (const p of photos.results) await env.PHOTOS.delete(p.key);
      await env.DB.batch([
        env.DB.prepare('DELETE FROM photos WHERE stay_id = ?').bind(id),
        env.DB.prepare('DELETE FROM stays WHERE id = ?').bind(id),
      ]);
      waitUntil(logEvent(env, request, 'stay_delete', user, 'Aufenthalt ' + id));
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
      waitUntil(logEvent(env, request, 'photo_upload', user, 'Aufenthalt ' + stayId));
      return json({ key });
    }

    /* ---- Auswertung ---- */

    if (path === '/stats' && method === 'GET') {
      const byStatus = await env.DB.prepare(
        `SELECT program, status_level,
                COUNT(*) AS stays,
                SUM(CASE WHEN upgrade_steps > 0 THEN 1 ELSE 0 END) AS upgraded,
                ROUND(AVG(CASE WHEN upgrade_steps IS NOT NULL THEN upgrade_steps END), 2) AS avg_steps
           FROM stays WHERE program IS NOT NULL
          GROUP BY program, status_level ORDER BY program, status_level`
      ).all();

      const byCity = await env.DB.prepare(
        `SELECT h.city, h.country_code, s.program,
                COUNT(*) AS stays,
                ROUND(AVG(CASE WHEN s.upgrade_steps IS NOT NULL THEN s.upgrade_steps END), 2) AS avg_steps
           FROM stays s JOIN hotels h ON h.id = s.hotel_id
          GROUP BY h.city, s.program HAVING stays > 0 ORDER BY stays DESC LIMIT 40`
      ).all();

      const totals = await env.DB.prepare(
        `SELECT COUNT(*) AS stays,
                COUNT(DISTINCT hotel_id) AS hotels,
                SUM(CASE WHEN upgrade_steps > 0 THEN 1 ELSE 0 END) AS upgraded,
                SUM(nights) AS nights
           FROM stays`
      ).first();

      return json({ totals, byStatus: byStatus.results, byCity: byCity.results });
    }

    if (path === '/log' && method === 'GET') {
      const admin = env.ADMIN_PASSWORD || '';
      if (!admin) return fail('Fuer das Protokoll ist kein ADMIN_PASSWORD gesetzt', 403);
      if ((request.headers.get('x-stay-admin') || '') !== admin) {
        await logEvent(env, request, 'login_fail', user, 'Protokoll: falsches Adminpasswort');
        return fail('Das Adminpasswort stimmt nicht', 403);
      }
      const rows = await env.DB.prepare(
        'SELECT * FROM access_log ORDER BY id DESC LIMIT 300'
      ).all();
      return json({ days: LOG_DAYS, entries: rows.results });
    }

    if (path === '/people' && method === 'GET') {
      const rows = await env.DB.prepare('SELECT DISTINCT author FROM stays ORDER BY author').all();
      return json(rows.results.map((r) => r.author));
    }

    return fail('Diesen Weg gibt es nicht: ' + path, 404);
  } catch (err) {
    return fail(String(err.message || err), 500);
  }
}
