// Pruefwerkzeug: oeffnet die Marriott-Buchungsansicht in einem echten Browser,
// hoert die Netzwerkantworten mit und liest die Zimmerkarten aus.
// Speichert nichts. Nur fuer die Entwicklung gedacht.

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

// Adresse des Hauses ohne Unterseite.
function hotelBaseUrl(website) {
  if (!website) return null;
  try {
    const url = new URL(website);
    const teile = url.pathname.split('/').filter(Boolean);
    const unterseiten = ['rooms', 'zimmer', 'suites', 'photos', 'overview', 'gallery'];
    while (teile.length && unterseiten.includes(teile[teile.length - 1])) teile.pop();
    url.pathname = teile.length ? '/' + teile.join('/') + '/' : '/';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

const tag = (plus) => new Date(Date.now() + plus * 86400000).toISOString().slice(0, 10);

// Sucht in einer beliebigen JSON-Struktur nach Zimmerbezeichnungen.
function findeZimmer(daten, treffer = [], tiefe = 0) {
  if (!daten || tiefe > 8 || treffer.length > 60) return treffer;

  if (Array.isArray(daten)) {
    for (const eintrag of daten) findeZimmer(eintrag, treffer, tiefe + 1);
    return treffer;
  }
  if (typeof daten !== 'object') return treffer;

  const schluessel = Object.keys(daten);
  const namensfeld = schluessel.find((k) =>
    /^(roomName|name|roomTypeName|title|displayName|description)$/i.test(k));
  const kennzeichen = schluessel.some((k) =>
    /(roomType|roomCode|productCode|bedType|inventory|accommodation|rateplan)/i.test(k));

  if (namensfeld && kennzeichen && typeof daten[namensfeld] === 'string') {
    treffer.push({
      name: daten[namensfeld],
      felder: schluessel.filter((k) => /(code|bed|type|desc)/i.test(k))
        .slice(0, 5)
        .map((k) => k + '=' + String(daten[k]).slice(0, 60)),
    });
  }

  for (const wert of Object.values(daten)) findeZimmer(wert, treffer, tiefe + 1);
  return treffer;
}

export async function onRequestPost({ request, env, params }) {
  // Zugang wie im uebrigen Backend: gemeinsames Passwort.
  const pass = (request.headers.get('x-stay-pass') || '').trim();
  if (!pass || pass !== (env.STAY_PASSWORD || '').trim()) {
    return json({ error: 'Bitte anmelden' }, 401);
  }

  const hotelId = Number(params.id);
  const hotel = await env.DB.prepare('SELECT * FROM hotels WHERE id = ?').bind(hotelId).first();
  if (!hotel) return json({ error: 'Hotel nicht gefunden' }, 404);

  const url = new URL(request.url);
  const sprache = url.searchParams.get('lang') === 'de' ? 'de' : 'en-us';
  const abstand = Number(url.searchParams.get('tage')) || 30;

  const basis = (hotelBaseUrl(hotel.website) || '')
    .replace(/\/(de|es|fr|it|nl|en-us)\/hotels\//, '/' + sprache + '/hotels/');

  const ziel = basis + 'rooms/'
    + '?arrivalDate=' + tag(abstand)
    + '&departureDate=' + tag(abstand + 1)
    + '&numAdults=1&roomCount=1';

  const konto = (env.CF_ACCOUNT_ID || '').trim();
  const token = (env.CF_BROWSER_TOKEN || '').trim();
  if (!konto || !token) return json({ fehler: 'CF_ACCOUNT_ID oder CF_BROWSER_TOKEN fehlt' }, 500);

  const ruf = async (endpunkt, koerper) => {
    const res = await fetch(
      'https://api.cloudflare.com/client/v4/accounts/' + konto + '/browser-rendering/' + endpunkt,
      {
        method: 'POST',
        signal: AbortSignal.timeout(70000),
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
        body: JSON.stringify(koerper),
      }
    );
    const text = await res.text();
    try {
      return { status: res.status, daten: JSON.parse(text) };
    } catch {
      return { status: res.status, daten: text.slice(0, 400) };
    }
  };

  // Warten, bis die Zimmerkarten wirklich stehen. Ohne das liest der Renderer
  // die Seite ab, bevor Marriott die Tarife nachgeladen hat.
  const wartemarke = url.searchParams.get('selector')
    || '[data-testid*="room" i], [class*="room-card" i], [class*="roomType" i]';

  const berichte = {};

  // Weg null: Tarnabruf ueber einen Dienst mit Wohnanschluss-Adressen.
  // Nur das kommt an Akamai vorbei. Kostet Guthaben, laeuft daher zuerst und
  // die anderen Wege werden uebersprungen, sobald er liefert.
  const bienenSchluessel = (env.SCRAPINGBEE_API_KEY || '').trim();
  if (bienenSchluessel) {
    const anfrage = new URL('https://app.scrapingbee.com/api/v1/');
    anfrage.searchParams.set('api_key', bienenSchluessel);
    anfrage.searchParams.set('url', ziel);
    anfrage.searchParams.set('render_js', 'true');
    anfrage.searchParams.set('stealth_proxy', 'true');
    anfrage.searchParams.set('country_code', sprache === 'de' ? 'de' : 'us');
    anfrage.searchParams.set('wait_for', wartemarke);
    anfrage.searchParams.set('timeout', '60000');
    anfrage.searchParams.set('block_resources', 'false');

    try {
      const res = await fetch(anfrage.toString(), { signal: AbortSignal.timeout(80000) });
      const html = await res.text();

      // Ueberschriften der Zimmerkarten samt der Zeile darunter herausziehen.
      const karten = [];
      const muster = /<h[2-4][^>]*>([^<]{3,90})<\/h[2-4]>\s*(?:<[^>]+>\s*)*([^<]{0,140})/gi;
      let m;
      while ((m = muster.exec(html)) && karten.length < 40) {
        const name = m[1].replace(/\s+/g, ' ').trim();
        if (!/(room|zimmer|suite|studio|apartment)/i.test(name)) continue;
        karten.push({ name, beschreibung: m[2].replace(/\s+/g, ' ').trim() });
      }

      berichte.tarnabruf = {
        status: res.status,
        guthaben_verbraucht: res.headers.get('spb-cost'),
        laenge: html.length,
        anzahl: karten.length,
        karten,
        anfang: karten.length ? null : html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 600),
      };

      if (karten.length >= 2) {
        return json({ hotel: hotel.name, geoeffnet: ziel, sprache, wartemarke, ergebnisse: berichte });
      }
    } catch (err) {
      berichte.tarnabruf = { fehler: String(err.message || err) };
    }
  } else {
    berichte.tarnabruf = 'SCRAPINGBEE_API_KEY nicht gesetzt';
  }

  // Weg eins: strukturiert auslesen lassen.
  const jsonLauf = await ruf('json', {
    url: ziel,
    waitForSelector: { selector: wartemarke, timeout: 25000 },
    prompt: 'Liste alle buchbaren Zimmerkategorien dieses Hotels auf. Gib je Eintrag den '
      + 'Namen exakt so an, wie er auf der Seite steht, dazu die Kurzbeschreibung '
      + 'darunter (Bettentyp, Zimmerart). Keine Bildunterschriften, keine Tarife.',
  });
  berichte.json = jsonLauf;

  // Weg zwei: die Karten roh abgreifen.
  const scrapeLauf = await ruf('scrape', {
    url: ziel,
    waitForSelector: { selector: wartemarke, timeout: 25000 },
    elements: [{ selector: wartemarke }, { selector: 'h2, h3' }],
  });
  berichte.scrape = {
    status: scrapeLauf.status,
    treffer: Array.isArray(scrapeLauf.daten?.result)
      ? scrapeLauf.daten.result.flatMap((gruppe) =>
          (gruppe.results || []).map((r) => (r.text || '').replace(/\s+/g, ' ').trim().slice(0, 160))
        ).filter((z) => /(room|zimmer|suite)/i.test(z)).slice(0, 30)
      : scrapeLauf.daten,
  };

  return json({
    hotel: hotel.name,
    geoeffnet: ziel,
    sprache,
    wartemarke,
    ergebnisse: berichte,
  });
}
