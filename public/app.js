/* stayLOG – Oberfläche */

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const state = {
  pass: localStorage.getItem('staylog.pass') || '',
  me: localStorage.getItem('staylog.name') || '',
  email: localStorage.getItem('staylog.email') || '',
  country: null,
  city: null,
  hotel: null,
  rooms: [],
  hotelCandidates: [],
  pendingPhotos: [],
  pollTimer: null,
  skipEnrichment: false,
  myStatus: JSON.parse(localStorage.getItem('staylog.status') || '{}'),
  programTouched: false,
  addingStatus: false,
  draftStatus: {},
};

/* ------------------------------------------------------------ Stammdaten */

const PROGRAMS = {
  'Marriott Bonvoy':      { color: '#2C3D6B', status: ['Member', 'Silver Elite', 'Gold Elite', 'Platinum Elite', 'Titanium Elite', 'Ambassador Elite'] },
  'Hilton Honors':        { color: '#1B5FA8', status: ['Member', 'Silver', 'Gold', 'Diamond', 'Diamond Reserve'] },
  'IHG One Rewards':      { color: '#B4472F', status: ['Club', 'Silver Elite', 'Gold Elite', 'Platinum Elite', 'Diamond Elite'] },
  'World of Hyatt':       { color: '#3C6E5B', status: ['Member', 'Discoverist', 'Explorist', 'Globalist'] },
  'Accor ALL':            { color: '#3B4D8F', status: ['Classic', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Limitless'] },
  'Radisson Rewards':     { color: '#A32A2A', status: ['Club', 'Premium', 'VIP'] },
  'Wyndham Rewards':      { color: '#1E6B7B', status: ['Blue', 'Gold', 'Platinum', 'Diamond'] },
  'Choice Privileges':    { color: '#6B4E9B', status: ['Member', 'Gold', 'Platinum', 'Diamond'] },
  'Best Western Rewards': { color: '#2F5FA8', status: ['Blue', 'Gold', 'Platinum', 'Diamond', 'Diamond Select'] },
  'GHA Discovery':        { color: '#7A6A3C', status: ['Silver', 'Gold', 'Platinum', 'Titanium'] },
  'Meliá Rewards':        { color: '#8C2F4A', status: ['Blue', 'Silver', 'Gold', 'Platinum'] },
  'Scandic Friends':      { color: '#3D6B4A', status: ['Level 1', 'Level 2', 'Level 3', 'Level 4'] },
  'Ohne Programm':        { color: '#7A7A72', status: [] },
};

// Rueckfall, solange die Recherche noch laeuft oder nichts gefunden hat.
const FALLBACK_ROOMS = {
  'Marriott Bonvoy': ['Guest Room', 'Deluxe Room', 'Executive / Club Room', 'Junior Suite', 'Suite'],
  'Hilton Honors':   ['Standard Room', 'Deluxe Room', 'Executive Room', 'Junior Suite', 'Suite'],
  'default':         ['Standardzimmer', 'Komfortzimmer', 'Deluxe', 'Junior Suite', 'Suite'],
};

const BENEFITS = [
  'Frühstück', 'Lounge-Zugang', 'Late Check-out', 'Early Check-in',
  'Welcome Amenity', 'Willkommensgetränk', 'Punkte statt Frühstück',
  'Suite-Upgrade', 'Höhere Etage', 'Bessere Aussicht', 'Wäscheservice', 'Parken frei',
];

const COUNTRIES = [
  ['DE', 'Deutschland'], ['AT', 'Österreich'], ['CH', 'Schweiz'], ['IT', 'Italien'],
  ['FR', 'Frankreich'], ['ES', 'Spanien'], ['PT', 'Portugal'], ['NL', 'Niederlande'],
  ['BE', 'Belgien'], ['LU', 'Luxemburg'], ['DK', 'Dänemark'], ['SE', 'Schweden'],
  ['NO', 'Norwegen'], ['FI', 'Finnland'], ['PL', 'Polen'], ['CZ', 'Tschechien'],
  ['HU', 'Ungarn'], ['GR', 'Griechenland'], ['HR', 'Kroatien'], ['TR', 'Türkei'],
  ['GB', 'Vereinigtes Königreich'], ['IE', 'Irland'], ['US', 'Vereinigte Staaten'],
  ['CA', 'Kanada'], ['MX', 'Mexiko'], ['BR', 'Brasilien'], ['AR', 'Argentinien'],
  ['AE', 'Vereinigte Arabische Emirate'], ['QA', 'Katar'], ['SA', 'Saudi-Arabien'],
  ['EG', 'Ägypten'], ['MA', 'Marokko'], ['ZA', 'Südafrika'], ['KE', 'Kenia'],
  ['TH', 'Thailand'], ['VN', 'Vietnam'], ['SG', 'Singapur'], ['MY', 'Malaysia'],
  ['ID', 'Indonesien'], ['PH', 'Philippinen'], ['JP', 'Japan'], ['KR', 'Südkorea'],
  ['CN', 'China'], ['HK', 'Hongkong'], ['IN', 'Indien'], ['AU', 'Australien'],
  ['NZ', 'Neuseeland'], ['MV', 'Malediven'], ['LK', 'Sri Lanka'],
];

/* ------------------------------------------------------------------ Netz */

async function api(path, options = {}) {
  const res = await fetch('/api' + path, {
    ...options,
    headers: {
      'x-stay-pass': state.pass,
      'x-stay-user': encodeURIComponent(state.email || state.me || ''),
      ...(options.headers || {}),
    },
  });
  const type = res.headers.get('content-type') || '';
  const body = type.includes('json') ? await res.json() : null;
  if (!res.ok) throw new Error(body?.error || 'Das hat nicht geklappt (' + res.status + ')');
  return body;
}

/* ------------------------------------------------- Tolerante Namenssuche */

// Akzente weg, Sonderzeichen weg, alles klein.
function normalize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function distance(a, b) {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[b.length];
}

// Jedes getippte Wort muss irgendein Wort im Namen treffen –
// als Anfang, als Teil, oder mit ein bis zwei Abweichungen.
function fuzzyMatch(name, query) {
  const words = normalize(name).split(' ').filter(Boolean);
  const parts = normalize(query).split(' ').filter(Boolean);
  if (!parts.length) return true;

  return parts.every((part) => {
    const tolerance = part.length <= 4 ? 0 : part.length <= 7 ? 1 : 2;
    return words.some((word) => {
      if (word.includes(part) || part.includes(word)) return true;
      if (!tolerance) return false;
      if (distance(word, part) <= tolerance) return true;
      // auch der Wortanfang zaehlt, damit "meriden" auf "meridien" passt
      return distance(word.slice(0, part.length + tolerance), part) <= tolerance;
    });
  });
}

const debounce = (fn, ms = 350) => {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
};

/* -------------------------------------------------------------- Anmeldung */

async function signIn(pass, login, name) {
  state.pass = pass;
  state.email = login;

  const res = await api('/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(name ? { name } : {}),
  });

  // Erster Besuch: die Anmeldemaske fragt nach dem Namen und ruft nochmal auf.
  if (res.needsName) {
    $('#gate-newcomer').hidden = false;
    $('#gate-name').focus();
    const err = new Error('Bitte trag noch deinen Namen ein');
    err.needsName = true;
    throw err;
  }

  state.me = res.name;
  state.email = res.email || login;
  if (res.statuses && Object.keys(res.statuses).length) {
    state.myStatus = res.statuses;
    localStorage.setItem('staylog.status', JSON.stringify(state.myStatus));
  }
  localStorage.setItem('staylog.pass', pass);
  localStorage.setItem('staylog.name', state.me);
  localStorage.setItem('staylog.email', state.email || '');
  $('#gate').hidden = true;
  $('#app').hidden = false;
  $('#who').textContent = state.me;
  buildForm();
  loadStays();
}

$('#gate-go').addEventListener('click', async () => {
  const err = $('#gate-error');
  err.hidden = true;
  try {
    await signIn(
      $('#gate-key').value.trim(),
      $('#gate-email').value.trim(),
      $('#gate-name').value.trim()
    );
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  }
});
for (const id of ['#gate-key', '#gate-email', '#gate-name']) {
  $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#gate-go').click(); });
}

$('#who').addEventListener('click', () => {
  if (!confirm('Abmelden und Passwort auf diesem Gerät vergessen?')) return;
  localStorage.removeItem('staylog.pass');
  localStorage.removeItem('staylog.email');
  localStorage.removeItem('staylog.name');
  location.reload();
});

/* ---------------------------------------------------------- Einstellungen */

// Die Schublade arbeitet auf einem Entwurf. Erst Speichern uebernimmt ihn.
function openSettings() {
  state.draftStatus = { ...state.myStatus };
  state.addingStatus = false;
  buildSettings();
  $('#settings').classList.add('is-open');
  $('#settings-veil').classList.add('is-open');
  $('#settings-toggle').classList.add('is-on');
  $('#settings-close').focus();
}

function closeSettings() {
  $('#settings').classList.remove('is-open');
  $('#settings-veil').classList.remove('is-open');
  $('#settings-toggle').classList.remove('is-on');
  $('#settings-toggle').focus();
}

function buildSettings() {
  const box = $('#status-settings');
  box.innerHTML = '';

  const entries = Object.entries(state.draftStatus);
  if (!entries.length && !state.addingStatus) {
    box.appendChild(el('p', 'status-empty', 'Noch kein Programm gepflegt.'));
  }
  for (const [program] of entries) box.appendChild(statusRow(program));
  if (state.addingStatus) box.appendChild(statusRow(null));

  $('#status-add').hidden = state.addingStatus || entries.length >= Object.keys(PROGRAMS).length;
}

function statusRow(existing) {
  const row = el('div', 'status-row');
  const used = new Set(Object.keys(state.draftStatus).filter((p) => p !== existing));

  const progSel = document.createElement('select');
  progSel.appendChild(new Option('– Programm wählen –', ''));
  for (const [name, info] of Object.entries(PROGRAMS)) {
    if (!info.status.length || used.has(name)) continue;
    progSel.appendChild(new Option(name, name));
  }
  progSel.value = existing || '';

  const levelSel = document.createElement('select');
  const fillLevels = (program, chosen) => {
    levelSel.innerHTML = '';
    levelSel.appendChild(new Option('– Status wählen –', ''));
    for (const level of PROGRAMS[program]?.status || []) levelSel.appendChild(new Option(level, level));
    levelSel.value = chosen || '';
    levelSel.disabled = !program;
  };
  fillLevels(existing, existing ? state.draftStatus[existing] : '');

  progSel.addEventListener('change', () => {
    if (existing && existing !== progSel.value) delete state.draftStatus[existing];
    fillLevels(progSel.value, '');
    if (progSel.value) levelSel.focus();
  });

  levelSel.addEventListener('change', () => {
    const program = progSel.value;
    if (!program) return;
    if (levelSel.value) state.draftStatus[program] = levelSel.value;
    else delete state.draftStatus[program];
    state.addingStatus = false;
    buildSettings();
  });

  const remove = el('button', 'remove', '×');
  remove.type = 'button';
  remove.title = 'Zeile entfernen';
  remove.addEventListener('click', () => {
    if (progSel.value) delete state.draftStatus[progSel.value];
    state.addingStatus = false;
    buildSettings();
  });

  row.append(progSel, levelSel, remove);
  return row;
}

$('#status-add').addEventListener('click', () => {
  state.addingStatus = true;
  buildSettings();
  $('#status-settings').querySelector('.status-row:last-child select')?.focus();
});

$('#settings-save').addEventListener('click', async () => {
  const button = $('#settings-save');
  button.disabled = true;
  state.myStatus = { ...state.draftStatus };
  localStorage.setItem('staylog.status', JSON.stringify(state.myStatus));
  syncStatusOptions();
  try {
    await api('/me/status', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ statuses: state.myStatus }),
    });
  } catch { /* im Gerät steht es trotzdem */ }
  button.disabled = false;
  closeSettings();
});

$('#settings-toggle').addEventListener('click', () => {
  if ($('#settings').classList.contains('is-open')) closeSettings();
  else openSettings();
});

$('#settings-cancel').addEventListener('click', closeSettings);
$('#settings-close').addEventListener('click', closeSettings);
$('#settings-veil').addEventListener('click', closeSettings);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('#settings').classList.contains('is-open')) closeSettings();
});

/* ------------------------------------------------------------- Navigation */

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-on', t === tab));
    for (const name of ['stays', 'new', 'stats']) {
      $('#view-' + name).hidden = name !== tab.dataset.view;
    }
    if (tab.dataset.view === 'stats') loadStats();
    if (tab.dataset.view === 'stays') loadStays();
  });
});

/* ------------------------------------------------ Auswahl: Land, Stadt, Hotel */

function renderCountryOptions() {
  const q = $('#p-country').value.trim().toLowerCase();
  const box = $('#country-results');
  box.innerHTML = '';
  if (!q) return;

  const hits = COUNTRIES
    .filter(([code, name]) => fuzzyMatch(name, q) || code.toLowerCase() === q)
    .slice(0, 8);

  if (!hits.length) {
    box.appendChild(el('p', 'options-empty', 'Kein Land gefunden.'));
    return;
  }
  for (const [code, name] of hits) {
    const b = el('button', 'option');
    b.type = 'button';
    b.appendChild(el('span', null, name));
    b.appendChild(el('small', null, code));
    b.addEventListener('click', () => chooseCountry(code, name));
    box.appendChild(b);
  }
}

function chooseCountry(code, name) {
  state.country = { code, name };
  $('#p-country').value = name;
  $('#country-results').innerHTML = '';
  document.querySelector('[data-step="city"]').hidden = false;
  $('#p-city').focus();
}

$('#p-country').addEventListener('input', () => {
  const typed = $('#p-country').value.trim().toLowerCase();
  const exact = COUNTRIES.find(([, name]) => name.toLowerCase() === typed);
  if (exact) { chooseCountry(exact[0], exact[1]); return; }
  renderCountryOptions();
});

// Enter nimmt den obersten Vorschlag.
$('#p-country').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  $('#country-results').querySelector('.option')?.click();
});

$('#p-city').addEventListener('input', debounce(async () => {
  const q = $('#p-city').value.trim();
  const box = $('#city-results');
  if (q.length < 2) { box.innerHTML = ''; return; }
  box.innerHTML = '<p class="options-empty">Suche läuft …</p>';
  try {
    const cities = await api('/geo/cities?country=' + encodeURIComponent(state.country?.code || '') + '&q=' + encodeURIComponent(q));
    box.innerHTML = '';
    if (!cities.length) { box.innerHTML = '<p class="options-empty">Kein Ort gefunden. Schreibweise prüfen.</p>'; return; }
    for (const c of cities) {
      const b = el('button', 'option');
      b.type = 'button';
      b.appendChild(el('span', null, c.name));
      b.appendChild(el('small', null, [c.region, c.country].filter(Boolean).join(', ')));
      b.addEventListener('click', () => chooseCity(c));
      box.appendChild(b);
    }
  } catch (e) {
    box.innerHTML = '';
    box.appendChild(el('p', 'options-empty', e.message));
  }
}, 220));

async function chooseCity(city) {
  state.city = city;
  $('#p-city').value = city.name;
  $('#city-results').innerHTML = '';
  document.querySelector('[data-step="hotel"]').hidden = false;

  const box = $('#hotel-results');
  const count = $('#hotel-count');
  count.textContent = '';
  box.innerHTML = '<p class="options-empty">Hotels werden geladen …</p>';
  try {
    state.hotelCandidates = await api('/geo/hotels?lat=' + city.lat + '&lon=' + city.lon);
    count.textContent = state.hotelCandidates.length + ' im Umkreis';
    renderHotelOptions();
  } catch (e) {
    count.textContent = 'Umkreissuche gescheitert';
    box.innerHTML = '';
    box.appendChild(el('p', 'options-empty', e.message));
  }
}

function renderHotelOptions(extra = []) {
  const box = $('#hotel-results');
  const q = $('#p-hotel').value.trim();

  const merged = [];
  const seen = new Set();
  for (const h of [...extra, ...state.hotelCandidates]) {
    const marker = normalize(h.name);
    if (seen.has(marker)) continue;
    if (q && !fuzzyMatch(h.name, q)) continue;
    seen.add(marker);
    merged.push(h);
  }

  box.innerHTML = '';
  if (!merged.length) {
    box.appendChild(el('p', 'options-empty',
      q ? 'Nichts gefunden. Weiter tippen oder von Hand eintragen.' : 'Keine Hotels im Umkreis gefunden.'));
    if (q) box.appendChild(el('p', 'options-empty', 'Es wird zusätzlich direkt nach dem Namen gesucht, das dauert einen Moment.'));
    return;
  }
  for (const h of merged.slice(0, 40)) {
    const b = el('button', 'option');
    b.type = 'button';
    b.appendChild(el('span', null, h.name));
    b.appendChild(el('small', null, h.program || h.brand || ''));
    b.addEventListener('click', () => chooseHotel(h));
    box.appendChild(b);
  }
}

const searchHotelByName = debounce(async () => {
  const q = $('#p-hotel').value.trim();
  if (q.length < 3 || !state.city) return;
  try {
    const found = await api('/geo/hotel-search?q=' + encodeURIComponent(q)
      + '&lat=' + state.city.lat + '&lon=' + state.city.lon);
    if ($('#p-hotel').value.trim() === q) renderHotelOptions(found);
  } catch { /* die Umkreisliste bleibt ja stehen */ }
}, 400);

$('#p-hotel').addEventListener('input', () => {
  renderHotelOptions();
  searchHotelByName();
});

$('#hotel-manual').addEventListener('click', () => {
  const name = prompt('Wie heißt das Hotel?');
  if (!name) return;
  chooseHotel({ source: 'manual', name: name.trim(), brand: null, program: null, lat: state.city?.lat, lon: state.city?.lon });
});

async function chooseHotel(candidate) {
  const payload = {
    ...candidate,
    city: state.city?.name || null,
    country: state.country?.name || state.city?.country || null,
    country_code: state.country?.code || state.city?.country_code || null,
  };
  const res = await api('/hotels', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  state.hotel = res.hotel;
  state.rooms = res.rooms;
  state.skipEnrichment = false;
  state.programTouched = false;

  $('#picker').hidden = true;
  $('#stay-form').hidden = false;
  renderChosenHotel();
  applyHotelProgram();
  renderRooms();
  watchEnrichment();
  loadGallery();
}

// Programm aus dem Hotel uebernehmen, solange nichts von Hand gewaehlt wurde.
function applyHotelProgram() {
  const sel = $('#s-program');
  const program = state.hotel?.program;
  if (program && !state.programTouched && [...sel.options].some((o) => o.value === program)) {
    sel.value = program;
  }
  syncStatusOptions();
}

function renderChosenHotel() {
  const hotel = state.hotel;
  if (!hotel) return;

  $('#chosen-name').textContent = hotel.name;
  $('#chosen-place').textContent = [hotel.city, hotel.country].filter(Boolean).join(', ');

  const desc = $('#chosen-desc');
  desc.textContent = hotel.description || '';
  desc.hidden = !hotel.description;

  const links = $('#chosen-links');
  links.innerHTML = '';

  if (hotel.address) links.appendChild(el('span', null, hotel.address));

  if (hotel.website) {
    const a = el('a', null, 'Hotelseite');
    a.href = hotel.website;
    a.target = '_blank';
    a.rel = 'noopener';
    links.appendChild(a);
  }
  if (hotel.lat && hotel.lon) {
    const map = el('a', null, 'auf der Karte');
    map.href = 'https://www.openstreetmap.org/?mlat=' + hotel.lat + '&mlon=' + hotel.lon + '#map=17/' + hotel.lat + '/' + hotel.lon;
    map.target = '_blank';
    map.rel = 'noopener';
    links.appendChild(map);
  }
  if (hotel.lounge === 1) links.appendChild(el('span', null, 'Lounge vorhanden'));
  if (hotel.breakfast_note) links.appendChild(el('span', null, hotel.breakfast_note));
}

async function loadGallery() {
  const box = $('#chosen-gallery');
  box.innerHTML = '';
  if (!state.hotel) return;

  try {
    const images = await api('/hotels/' + state.hotel.id + '/images');
    if (!images.length) return;

    for (const img of images) {
      const fig = document.createElement('figure');
      const image = document.createElement('img');
      image.src = img.thumb;
      image.alt = state.hotel.name;
      image.loading = 'lazy';
      fig.appendChild(image);

      const credit = el('figcaption');
      const parts = [img.author, img.license].filter(Boolean).join(' · ');
      if (img.page) {
        const a = el('a', null, parts || 'Wikimedia Commons');
        a.href = img.page;
        a.target = '_blank';
        a.rel = 'noopener';
        credit.appendChild(a);
      } else {
        credit.textContent = parts;
      }
      fig.appendChild(credit);
      box.appendChild(fig);
    }
    box.insertAdjacentElement('afterend', el('p', 'gallery-note',
      'Bilder aus Wikimedia Commons. Nicht jedes Haus ist dort zu finden.'));
  } catch { /* ohne Bilder geht es auch */ }
}

$('#chosen-reset').addEventListener('click', resetPicker);

function resetPicker() {
  clearInterval(state.pollTimer);
  state.hotel = null;
  state.rooms = [];
  state.pendingPhotos = [];
  $('#photo-previews').innerHTML = '';
  $('#stay-form').reset();
  $('#stay-form').hidden = true;
  $('#picker').hidden = false;
  $('#p-hotel').value = '';
  renderHotelOptions();
}

/* --------------------------------------------------------- Zimmerkategorien */

function fallbackRooms() {
  const program = $('#s-program').value;
  const names = FALLBACK_ROOMS[program] || FALLBACK_ROOMS.default;
  return names.map((name, i) => ({ name, rank: i + 1, confirmed: 0, source: 'fallback' }));
}

function renderRooms() {
  const list = $('#rooms-list');
  const status = $('#rooms-status');
  const adder = document.querySelector('.rooms-add');
  const st = state.hotel?.enrich_status;
  const busy = !state.skipEnrichment && (st === 'pending' || st === 'running');
  if (busy) state.wasBusy = true;

  list.innerHTML = '';
  adder.hidden = busy;

  // Solange recherchiert wird, zeigen wir bewusst keine Kategorien –
  // eine allgemeine Markenliste sieht sonst aus wie ein Ergebnis.
  if (busy) {
    status.textContent = 'wird recherchiert …';
    const wait = el('div', 'rooms-wait');
    wait.appendChild(el('span', 'spinner'));
    const texts = el('div');
    texts.appendChild(el('div', null, 'Zimmerkategorien werden recherchiert'));
    texts.appendChild(el('div', 'rooms-wait-note', 'Dauert meist zehn bis zwanzig Sekunden. Du kannst den Rest schon ausfüllen.'));
    wait.appendChild(texts);
    list.appendChild(wait);

    const skip = el('button', 'btn btn-quiet', 'nicht warten, selbst eintragen');
    skip.type = 'button';
    skip.addEventListener('click', () => {
      state.skipEnrichment = true;
      clearInterval(state.pollTimer);
      renderRooms();
    });
    list.appendChild(skip);

    fillRoomSelects([], 'wird recherchiert …');
    return;
  }

  const rooms = state.rooms.length ? state.rooms : fallbackRooms();
  const isFallback = state.rooms.length === 0;

  // Wenn die Recherche gerade fertig wurde, einmal kurz zeigen was da ist.
  if (state.wasBusy && !isFallback) $('#rooms-box').open = true;
  state.wasBusy = false;

  if (isFallback) {
    status.textContent = 'allgemeine Liste der Marke – bitte anpassen';
  } else {
    const open = state.rooms.filter((r) => !r.confirmed).length;
    status.textContent = open ? open + ' Vorschläge – bestätige, was stimmt' : 'bestätigt';
  }

  if (state.hotel?.enrich_error && isFallback) {
    list.appendChild(el('p', 'rooms-wait-note', 'Die Recherche hat nichts Gesichertes gefunden.'));
  }

  for (const room of rooms) {
    const row = el('div', 'room-row' + (room.confirmed ? '' : ' is-suggested'));

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = !!room.confirmed;
    check.setAttribute('aria-label', 'Kategorie ' + room.name + ' bestätigen');
    check.addEventListener('change', () => confirmRoom(room, check.checked));

    row.appendChild(check);
    row.appendChild(el('span', 'rank', room.rank ?? ''));
    row.appendChild(el('span', 'name', room.name));

    if (room.source_url) {
      const a = el('a', null, 'Quelle');
      a.href = room.source_url;
      a.target = '_blank';
      a.rel = 'noopener';
      row.appendChild(a);
    }
    list.appendChild(row);
  }
  fillRoomSelects(rooms);
}

function fillRoomSelects(rooms, placeholder) {
  for (const id of ['#s-booked', '#s-received']) {
    const sel = $(id);
    const previous = sel.value;
    sel.innerHTML = '';
    sel.appendChild(new Option(placeholder || '– keine Angabe –', ''));
    for (const r of rooms) sel.appendChild(new Option(r.name, r.name));
    sel.disabled = Boolean(placeholder);
    if (previous) sel.value = previous;
  }
}

async function confirmRoom(room, confirmed) {
  if (!state.hotel) return;
  const body = confirmed
    ? { rooms: [{ name: room.name, rank: room.rank || 0, source: room.source || 'user' }] }
    : { remove: [room.name] };
  const res = await api('/hotels/' + state.hotel.id + '/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  state.rooms = res.rooms;
  renderRooms();
}

$('#room-add').addEventListener('click', async () => {
  const input = $('#room-new');
  const name = input.value.trim();
  if (!name || !state.hotel) return;
  const rank = (state.rooms.reduce((m, r) => Math.max(m, r.rank || 0), 0) || 0) + 1;
  input.value = '';
  await confirmRoom({ name, rank, source: 'user' }, true);
});

function watchEnrichment() {
  clearInterval(state.pollTimer);
  if (!state.hotel) return;
  if (['ready', 'failed'].includes(state.hotel.enrich_status)) return;

  let tries = 0;
  state.pollTimer = setInterval(async () => {
    tries += 1;
    if (tries > 20 || !state.hotel) { clearInterval(state.pollTimer); return; }
    try {
      const res = await api('/hotels/' + state.hotel.id);
      state.hotel = res.hotel;
      state.rooms = res.rooms;
      renderChosenHotel();
      applyHotelProgram();
      renderRooms();
      if (['ready', 'failed'].includes(res.hotel.enrich_status)) clearInterval(state.pollTimer);
    } catch { /* still weiter versuchen */ }
  }, 4000);
}

/* ------------------------------------------------------------- Formular */

function buildForm() {

  const prog = $('#s-program');
  prog.innerHTML = '';
  prog.appendChild(new Option('– Programm wählen –', ''));
  for (const name of Object.keys(PROGRAMS)) prog.appendChild(new Option(name, name));
  prog.addEventListener('change', () => {
    state.programTouched = true;
    syncStatusOptions();
    renderRooms();
  });

  const chips = $('#benefit-list');
  chips.innerHTML = '';
  for (const b of BENEFITS) {
    const label = el('label', 'chip');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = b;
    label.appendChild(input);
    label.appendChild(document.createTextNode(b));
    chips.appendChild(label);
  }

  const fp = $('#f-program');
  for (const name of Object.keys(PROGRAMS)) fp.appendChild(new Option(name, name));
  const fc = $('#f-country');
  for (const [code, name] of COUNTRIES) fc.appendChild(new Option(name, code));
  for (const id of ['#f-program', '#f-author', '#f-country']) $(id).addEventListener('change', loadStays);
  $('#f-upgraded').addEventListener('change', loadStays);

  $('#s-checkin').valueAsDate = new Date();
}

function syncStatusOptions() {
  const sel = $('#s-status');
  const program = $('#s-program').value;
  const levels = PROGRAMS[program]?.status || [];
  const previous = sel.value;
  sel.innerHTML = '';
  sel.appendChild(new Option('– kein Status –', ''));
  for (const s of levels) sel.appendChild(new Option(s, s));

  // Gepflegter Status gewinnt, solange nichts anderes gewaehlt wurde.
  const mine = state.myStatus[program];
  if (previous && levels.includes(previous)) sel.value = previous;
  else if (mine && levels.includes(mine)) sel.value = mine;
}

/* Bilder verkleinern, bevor sie hochgehen. */
async function shrink(file, max = 1600) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
}

$('#s-photos').addEventListener('change', async (e) => {
  for (const file of e.target.files) {
    const blob = await shrink(file);
    const entry = { blob, caption: '' };
    state.pendingPhotos.push(entry);

    const wrap = el('div', 'photo-preview');
    const img = document.createElement('img');
    img.src = URL.createObjectURL(blob);
    img.alt = '';
    const caption = document.createElement('input');
    caption.placeholder = 'Bildunterschrift';
    caption.addEventListener('input', () => { entry.caption = caption.value; });
    wrap.append(img, caption);
    $('#photo-previews').appendChild(wrap);
  }
  e.target.value = '';
});

$('#stay-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#form-error');
  err.hidden = true;

  try {
    const benefits = [...document.querySelectorAll('#benefit-list input:checked')].map((i) => i.value);
    const { id } = await api('/stays', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        hotel_id: state.hotel.id,
        program: $('#s-program').value,
        status_level: $('#s-status').value,
        checkin: $('#s-checkin').value,
        checkout: $('#s-checkout').value,
        booked_room: $('#s-booked').value,
        received_room: $('#s-received').value,
        price: $('#s-price').value,
        currency: $('#s-currency').value,
        benefits,
        notes: $('#s-notes').value,
      }),
    });

    for (const photo of state.pendingPhotos) {
      await api('/photos?stay_id=' + id + '&caption=' + encodeURIComponent(photo.caption || ''), {
        method: 'POST',
        headers: { 'content-type': 'image/jpeg' },
        body: photo.blob,
      });
    }

    resetPicker();
    document.querySelector('.tab[data-view="stays"]').click();
  } catch (e2) {
    err.textContent = e2.message;
    err.hidden = false;
  }
});

/* ------------------------------------------------------ Aufenthalte zeigen */

async function loadStays() {
  const params = new URLSearchParams();
  if ($('#f-program').value) params.set('program', $('#f-program').value);
  if ($('#f-author').value) params.set('author', $('#f-author').value);
  if ($('#f-country').value) params.set('country', $('#f-country').value);
  if ($('#f-upgraded').checked) params.set('upgraded', '1');

  const box = $('#stay-list');
  try {
    const [stays, people] = await Promise.all([api('/stays?' + params), api('/people')]);

    const fa = $('#f-author');
    const chosen = fa.value;
    fa.innerHTML = '<option value="">Alle Personen</option>';
    for (const p of people) fa.appendChild(new Option(p, p));
    fa.value = chosen;

    box.innerHTML = '';
    if (!stays.length) {
      box.appendChild(el('p', 'empty', 'Noch nichts eingetragen. Fang mit deinem letzten Aufenthalt an.'));
      return;
    }
    for (const s of stays) box.appendChild(renderStay(s));
  } catch (e) {
    box.innerHTML = '';
    box.appendChild(el('p', 'empty', e.message));
  }
}

function renderStay(s) {
  const card = el('article', 'stay');
  card.style.setProperty('--program', PROGRAMS[s.program]?.color || 'var(--line)');

  const top = el('div', 'stay-top');
  const head = el('div');
  head.appendChild(el('div', 'stay-hotel', s.hotel_name));
  head.appendChild(el('div', 'stay-place', [s.city, s.country].filter(Boolean).join(', ')));
  top.appendChild(head);
  if (s.price != null) top.appendChild(el('div', null, formatMoney(s.price, s.currency)));
  card.appendChild(top);

  const meta = el('div', 'stay-meta');
  if (s.checkin) meta.appendChild(el('span', null, formatStayDates(s)));
  if (s.program) meta.appendChild(el('span', null, s.program + (s.status_level ? ' · ' + s.status_level : '')));
  card.appendChild(meta);

  if (s.booked_room || s.received_room) card.appendChild(renderLadder(s));

  if (s.benefits?.length) {
    const tags = el('div', 'stay-benefits');
    for (const b of s.benefits) tags.appendChild(el('span', 'tag', b));
    card.appendChild(tags);
  }

  if (s.notes) card.appendChild(el('p', 'stay-notes', s.notes));

  if (s.photos?.length) {
    const strip = el('div', 'stay-photos');
    for (const p of s.photos) {
      const fig = document.createElement('figure');
      const img = document.createElement('img');
      img.src = '/api/photos/' + encodeURIComponent(p.key);
      img.alt = p.caption || '';
      img.loading = 'lazy';
      fig.appendChild(img);
      if (p.caption) fig.appendChild(el('figcaption', null, p.caption));
      strip.appendChild(fig);
    }
    card.appendChild(strip);
  }

  const foot = el('div', 'stay-foot');
  foot.appendChild(el('span', 'stay-author', s.author));
  const actions = el('div', 'stay-actions');

  const share = el('button', 'btn btn-quiet', 'teilen');
  share.addEventListener('click', () => shareStay(s));
  actions.appendChild(share);

  if (s.author === state.me) {
    const del = el('button', 'btn btn-quiet', 'löschen');
    del.addEventListener('click', async () => {
      if (!confirm('Diesen Aufenthalt löschen?')) return;
      await api('/stays/' + s.id, { method: 'DELETE' });
      loadStays();
    });
    actions.appendChild(del);
  }
  foot.appendChild(actions);
  card.appendChild(foot);
  return card;
}

/* Die Leiter zeigt, wie weit der Status im Zimmerangebot nach oben getragen hat. */
function renderLadder(s) {
  const wrap = el('div', 'ladder');
  const rungs = el('div', 'ladder-rungs');

  const booked = s.booked_rank;
  const got = s.received_rank;
  const top = Math.max(booked || 0, got || 0, 5);

  for (let i = 1; i <= top; i++) {
    const rung = el('div', 'rung');
    rung.style.height = 30 * (0.45 + (0.55 * i) / top) + 'px';
    if (booked != null && i === booked) rung.classList.add('is-booked');
    if (got != null && i === got) rung.classList.add(s.upgrade_steps < 0 ? 'is-down' : 'is-got');
    if (booked != null && got != null && i > Math.min(booked, got) && i < Math.max(booked, got)) {
      rung.classList.add('is-range');
    }
    rungs.appendChild(rung);
  }
  wrap.appendChild(rungs);

  const legend = el('div', 'ladder-legend');
  legend.appendChild(el('span', null, s.booked_room || 'gebucht unbekannt'));
  const arrow = el('span', 'got', s.received_room || 'erhalten unbekannt');
  legend.appendChild(arrow);
  wrap.appendChild(legend);

  const verdict = el('div', 'ladder-verdict', upgradeText(s.upgrade_steps));
  if (s.upgrade_steps == null || s.upgrade_steps === 0) verdict.classList.add('none');
  if (s.upgrade_steps < 0) verdict.classList.add('down');
  wrap.appendChild(verdict);
  return wrap;
}

function upgradeText(steps) {
  if (steps == null) return 'Kategorien nicht vergleichbar';
  if (steps === 0) return 'kein Upgrade';
  if (steps < 0) return Math.abs(steps) + (Math.abs(steps) === 1 ? ' Kategorie schlechter' : ' Kategorien schlechter');
  return steps + (steps === 1 ? ' Kategorie höher' : ' Kategorien höher');
}

function formatMoney(value, currency) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: currency || 'EUR', maximumFractionDigits: 0 }).format(value);
}

function formatStayDates(s) {
  const f = (d) => new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
  if (!s.checkout) return f(s.checkin);
  return f(s.checkin) + ' – ' + f(s.checkout) + (s.nights ? ' · ' + s.nights + (s.nights === 1 ? ' Nacht' : ' Nächte') : '');
}

/* Fertiger Textblock für die Gruppe. */
function shareStay(s) {
  const lines = [
    s.hotel_name + (s.city ? ', ' + s.city : ''),
    [s.program, s.status_level].filter(Boolean).join(' · '),
    s.booked_room && s.received_room ? 'Gebucht: ' + s.booked_room + ' → Bekommen: ' + s.received_room : null,
    upgradeText(s.upgrade_steps),
    s.benefits?.length ? 'Dazu: ' + s.benefits.join(', ') : null,
    s.price != null ? 'Preis: ' + formatMoney(s.price, s.currency) : null,
    s.notes || null,
  ].filter(Boolean);
  const text = lines.join('\n');

  if (navigator.share) navigator.share({ text }).catch(() => {});
  else navigator.clipboard.writeText(text).then(() => alert('In die Zwischenablage kopiert.'));
}

/* ------------------------------------------------------------ Auswertung */

async function loadStats() {
  const box = $('#stats-body');
  try {
    const data = await api('/stats');
    box.innerHTML = '';

    const totals = el('div', 'totals');
    const t = data.totals || {};
    for (const [num, label] of [
      [t.stays || 0, 'Aufenthalte'],
      [t.hotels || 0, 'Hotels'],
      [t.nights || 0, 'Nächte'],
      [t.upgraded || 0, 'davon mit Upgrade'],
    ]) {
      const item = el('div');
      item.appendChild(el('div', 'total-num', String(num)));
      item.appendChild(el('div', 'total-label', label));
      totals.appendChild(item);
    }
    box.appendChild(totals);

    box.appendChild(statTable(
      'Was der Status im Schnitt bringt',
      ['Programm', 'Status', 'Aufenthalte', 'mit Upgrade', 'Ø Kategorien'],
      data.byStatus.map((r) => [r.program, r.status_level || '–', r.stays, r.upgraded, r.avg_steps ?? '–'])
    ));

    box.appendChild(statTable(
      'Nach Stadt',
      ['Stadt', 'Programm', 'Aufenthalte', 'Ø Kategorien'],
      data.byCity.map((r) => [r.city || '–', r.program || '–', r.stays, r.avg_steps ?? '–'])
    ));
  } catch (e) {
    box.innerHTML = '';
    box.appendChild(el('p', 'empty', e.message));
  }
}

function statTable(title, headers, rows) {
  const block = el('section', 'stat-block');
  block.appendChild(el('h2', null, title));
  if (!rows.length) {
    block.appendChild(el('p', 'empty', 'Dafür reichen die Einträge noch nicht.'));
    return block;
  }
  const table = document.createElement('table');
  const thead = document.createElement('tr');
  headers.forEach((h, i) => {
    const th = el('th', i > 1 ? 'num' : null, h);
    thead.appendChild(th);
  });
  table.appendChild(thead);
  for (const row of rows) {
    const tr = document.createElement('tr');
    row.forEach((cell, i) => tr.appendChild(el('td', i > 1 ? 'num' : null, String(cell))));
    table.appendChild(tr);
  }
  block.appendChild(table);
  return block;
}

/* ------------------------------------------------------------- Protokoll */

const EVENT_TEXT = {
  login_ok: 'angemeldet',
  login_fail: 'Anmeldung fehlgeschlagen',
  login_blocked: 'gesperrt nach Fehlversuchen',
  stay_create: 'Aufenthalt eingetragen',
  stay_delete: 'Aufenthalt gelöscht',
  hotel_create: 'Hotel angelegt',
  photo_upload: 'Bild hochgeladen',
};

$('#log-open').addEventListener('click', async () => {
  const box = $('#log-body');
  const admin = prompt('Adminpasswort');
  if (!admin) return;

  box.innerHTML = '<p class="log-note">Wird geladen …</p>';
  try {
    const res = await fetch('/api/log', {
      headers: {
        'x-stay-pass': state.pass,
        'x-stay-name': encodeURIComponent(state.me || ''),
        'x-stay-admin': admin,
      },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Das hat nicht geklappt');

    box.innerHTML = '';
    box.appendChild(el('p', 'log-note',
      'Die letzten ' + data.entries.length + ' Vorgänge. Einträge älter als ' + data.days + ' Tage werden automatisch gelöscht.'));

    const scroll = el('div', 'log-scroll');
    const table = document.createElement('table');
    table.className = 'log-table';
    const head = document.createElement('tr');
    for (const h of ['Zeitpunkt', 'Vorgang', 'Name', 'IP', 'Ort', 'Netz']) head.appendChild(el('th', null, h));
    table.appendChild(head);

    for (const e of data.entries) {
      const tr = document.createElement('tr');
      tr.appendChild(el('td', null, new Date(e.ts).toLocaleString('de-DE')));
      const ev = el('td', 'ev ' + (e.event.includes('fail') ? 'ev-fail' : e.event.includes('blocked') ? 'ev-blocked' : ''),
        EVENT_TEXT[e.event] || e.event);
      tr.appendChild(ev);
      tr.appendChild(el('td', null, e.name || '–'));
      tr.appendChild(el('td', null, e.ip || '–'));
      tr.appendChild(el('td', null, [e.city, e.country].filter(Boolean).join(', ') || '–'));
      tr.appendChild(el('td', 'wrap', e.network || '–'));
      table.appendChild(tr);
    }
    scroll.appendChild(table);
    box.appendChild(scroll);
  } catch (e) {
    box.innerHTML = '';
    box.appendChild(el('p', 'log-note', e.message));
  }
});

/* ------------------------------------------------------------------ Start */

if (state.pass && state.email) {
  signIn(state.pass, state.email).catch(() => {
    localStorage.removeItem('staylog.pass');
    $('#gate-email').value = state.email || '';
  });
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
