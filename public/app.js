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
  myStatus: JSON.parse(localStorage.getItem('staylog.status') || '{}'),
  draftStatus: {},
  addingStatus: false,
  hotel: null,
  city: null,
  country: null,
  rooms: [],
  hotelCandidates: [],
  nameHits: [],
  pendingPhotos: [],
  benefitValues: {},
  pollTimer: null,
  skipEnrichment: false,
  programTouched: false,
  stays: [],
  places: [],
  selected: null,
  guest: false,
  mode: '',
  editing: null,
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

// Dezente Eigenfarbe je Statusstufe.
const STATUS_COLORS = [
  [/ambassador|titanium|globalist|limitless|reserve|diamond select/i, '#2B3442'],
  [/diamond|vip/i, '#4E6E93'],
  [/platinum/i, '#6E7B8A'],
  [/gold/i, '#B0842F'],
  [/silver|premium|explorist/i, '#8A8F96'],
  [/blue|club|classic|member|discoverist|level/i, '#8A9099'],
];
const statusColor = (level) => {
  if (!level) return '#8A9099';
  for (const [re, color] of STATUS_COLORS) if (re.test(level)) return color;
  return '#8A9099';
};

const FALLBACK_ROOMS = {
  'Marriott Bonvoy': ['Guest Room', 'Deluxe Room', 'Executive / Club Room', 'Junior Suite', 'Suite'],
  'Hilton Honors':   ['Standard Room', 'Deluxe Room', 'Executive Room', 'Junior Suite', 'Suite'],
  'default':         ['Standardzimmer', 'Komfortzimmer', 'Deluxe', 'Junior Suite', 'Suite'],
};

// hint = Platzhalter für den Zusatzwert. null heißt: kein Wert sinnvoll.
const BENEFITS = [
  ['Frühstück', 'für 2 Personen'],
  ['Lounge Access', null],
  ['Late Checkout', '16:00'],
  ['Early Check-in', '11:00'],
  ['Welcome Gift', 'Wein und Pralinen'],
  ['Getränke', null],
  ['F&B Credit', '50 €'],
  ['Parkplatz', 'kostenfrei'],
  ['Bonuspunkte', '1.000'],
  ['Höhere Etage', null],
  ['Bessere Aussicht', null],
  ['Sonstiges', 'was genau'],
];
const benefitHint = (name) => (BENEFITS.find(([b]) => b === name) || [])[1] || null;

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

/* ------------------------------------------------- Tolerante Namenssuche */

function normalize(text) {
  return (text || '')
    .toLowerCase().replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

function distance(a, b) {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

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
      return distance(word.slice(0, part.length + tolerance), part) <= tolerance;
    });
  });
}

const debounce = (fn, ms = 300) => {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
};

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

/* -------------------------------------------------------------- Anmeldung */

async function signIn(pass, login, name) {
  state.pass = pass;
  state.email = login;

  const res = await api('/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(name ? { name } : {}),
  });

  if (res.needsName) {
    $('#gate-newcomer').hidden = false;
    $('#gate-name').focus();
    const err = new Error('Bitte trag noch deinen Namen ein');
    err.needsName = true;
    throw err;
  }

  state.me = res.name;
  state.email = res.email || login;
  state.guest = Boolean(res.guest);
  state.mode = res.mode || '';
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

  document.body.classList.toggle('is-guest', state.guest && state.mode !== 'full');
  const bar = $('#guest-bar');
  bar.hidden = !state.guest;
  if (state.guest) {
    $('#guest-text').textContent = state.mode === 'full'
      ? 'Offener Betrieb – jeder kann eintragen. Deine Einträge stehen unter „Gast“.'
      : 'Gastansicht – du kannst alles ansehen, aber nichts eintragen.';
  }

  buildForm();
  loadFilters();
  loadStays();
}

$('#gate-go').addEventListener('click', async () => {
  const err = $('#gate-error');
  err.hidden = true;
  try {
    await signIn($('#gate-key').value.trim(), $('#gate-email').value.trim(), $('#gate-name').value.trim());
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  }
});
for (const id of ['#gate-key', '#gate-email', '#gate-name']) {
  $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#gate-go').click(); });
}

function signOut() {
  localStorage.removeItem('staylog.pass');
  localStorage.removeItem('staylog.email');
  localStorage.removeItem('staylog.name');
  localStorage.removeItem('staylog.status');
  sessionStorage.setItem('staylog.gate', '1');
  location.reload();
}

$('#guest-login').addEventListener('click', signOut);

// Klick auf den eigenen Namen öffnet die Einstellungen, dort steht das Abmelden.
$('#who').addEventListener('click', () => openSettings());

/* ------------------------------------------------------------ Navigation */

function showView(name) {
  for (const view of ['stays', 'new', 'stats']) $('#view-' + view).hidden = view !== name;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-on', t.dataset.view === name));
  document.querySelectorAll('.topnav-btn').forEach((t) => t.classList.toggle('is-on', t.dataset.view === name));
  $('#f-text').closest('.search-wrap').hidden = name !== 'stays';
  if (name === 'stats') loadStats();
  if (name === 'stays') { loadStays(); loadFilters(); }
  window.scrollTo({ top: 0 });
}

document.querySelectorAll('.tab, .topnav-btn').forEach((button) => {
  button.addEventListener('click', () => showView(button.dataset.view));
});
$('#new-stay').addEventListener('click', () => {
  if (!state.editing && !state.hotel) resetPicker();
  showView('new');
});
$('#brand').addEventListener('click', () => showView('stays'));

/* ---------------------------------------------------------- Einstellungen */

function openSettings() {
  $('#account-who').textContent = state.guest
    ? 'Du bist als Gast unterwegs.'
    : 'Angemeldet als ' + state.me + (state.email ? ' · ' + state.email : '');
  $('#logout').textContent = state.guest ? 'Anmelden' : 'Abmelden';
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

$('#logout').addEventListener('click', () => {
  if (state.guest) { signOut(); return; }
  if (confirm('Abmelden? Das Passwort wird auf diesem Gerät vergessen.')) signOut();
});

$('#settings-toggle').addEventListener('click', () => {
  if ($('#settings').classList.contains('is-open')) closeSettings();
  else openSettings();
});
$('#settings-cancel').addEventListener('click', closeSettings);
$('#settings-close').addEventListener('click', closeSettings);
$('#settings-veil').addEventListener('click', closeSettings);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if ($('#settings').classList.contains('is-open')) closeSettings();
  if ($('#filter-pane').classList.contains('is-open')) closeFilters();
  if ($('#detail-pane').classList.contains('is-open')) closeDetail();
});

/* ------------------------------------------------------ Filter und Chips */

const FILTER_IDS = ['#f-country', '#f-city', '#f-hotel', '#f-program', '#f-status', '#f-author', '#f-from', '#f-to'];

function fillSelect(sel, values, placeholder) {
  const previous = sel.value;
  sel.innerHTML = '';
  sel.appendChild(new Option(placeholder, ''));
  for (const v of values) {
    sel.appendChild(typeof v === 'string' ? new Option(v, v) : new Option(v.label, v.value));
  }
  sel.value = [...sel.options].some((o) => o.value === previous) ? previous : '';
}

async function loadFilters() {
  try {
    const data = await api('/filters');
    state.places = data.places;
    fillSelect($('#f-program'), data.programs, 'Alle Programme');
    fillSelect($('#f-status'), data.statuses, 'Alle Statuslevel');
    fillSelect($('#f-author'), data.people, 'Alle Personen');
    refreshPlaceSelects();
  } catch { /* Filter bleiben leer */ }
}

// Stadt hängt am Land, Hotel an der Stadt.
function refreshPlaceSelects() {
  const country = $('#f-country').value;
  const city = $('#f-city').value;

  const countries = [...new Set(state.places.map((p) => p.country))].sort();
  fillSelect($('#f-country'), countries, 'Alle Länder');

  const cities = [...new Set(state.places
    .filter((p) => !country || p.country === country)
    .map((p) => p.city))].sort();
  fillSelect($('#f-city'), cities, 'Alle Städte');
  $('#f-city').disabled = cities.length === 0;

  const hotels = [];
  const seen = new Set();
  for (const p of state.places) {
    if (country && p.country !== country) continue;
    if (city && p.city !== city) continue;
    if (seen.has(p.hotel_id)) continue;
    seen.add(p.hotel_id);
    hotels.push({ value: String(p.hotel_id), label: p.hotel_name });
  }
  hotels.sort((a, b) => a.label.localeCompare(b.label));
  fillSelect($('#f-hotel'), hotels, 'Alle Hotels');
  $('#f-hotel').disabled = hotels.length === 0;
}

function activeFilters() {
  const out = [];
  const push = (id, label, value, text) => { if (value) out.push({ id, label, value, text: text || value }); };
  push('#f-country', 'Land', $('#f-country').value);
  push('#f-city', 'Stadt', $('#f-city').value);
  const hotelSel = $('#f-hotel');
  push('#f-hotel', 'Hotel', hotelSel.value, hotelSel.selectedOptions[0]?.text);
  push('#f-program', 'Programm', $('#f-program').value);
  push('#f-status', 'Status', $('#f-status').value);
  push('#f-author', 'Person', $('#f-author').value);
  push('#f-from', 'ab', $('#f-from').value, 'ab ' + formatDate($('#f-from').value));
  push('#f-to', 'bis', $('#f-to').value, 'bis ' + formatDate($('#f-to').value));
  if ($('#f-upgraded').checked) out.push({ id: '#f-upgraded', label: '', value: '1', text: 'nur mit Upgrade' });
  return out;
}

function renderChips() {
  const box = $('#chips');
  box.innerHTML = '';
  for (const f of activeFilters()) {
    const chip = el('span', 'chip-active');
    chip.appendChild(el('span', null, f.text));
    const x = el('button', null, '×');
    x.type = 'button';
    x.setAttribute('aria-label', 'Filter entfernen');
    x.addEventListener('click', () => {
      const node = $(f.id);
      if (node.type === 'checkbox') node.checked = false;
      else node.value = '';
      refreshPlaceSelects();
      loadStays();
    });
    chip.appendChild(x);
    box.appendChild(chip);
  }
}

for (const id of FILTER_IDS) {
  $(id).addEventListener('change', () => {
    if (id === '#f-country' || id === '#f-city') refreshPlaceSelects();
    loadStays();
  });
}
$('#f-upgraded').addEventListener('change', loadStays);
$('#f-text').addEventListener('input', debounce(() => renderStayList(), 200));

function openFilters() {
  $('#filter-pane').classList.add('is-open');
  $('#filter-veil').classList.add('is-open');
}
function closeFilters() {
  $('#filter-pane').classList.remove('is-open');
  $('#filter-veil').classList.remove('is-open');
}
$('#filter-open').addEventListener('click', openFilters);
$('#filter-close').addEventListener('click', closeFilters);
$('#filter-veil').addEventListener('click', closeFilters);

/* ------------------------------------------------------ Aufenthalte laden */

async function loadStays() {
  const params = new URLSearchParams();
  const set = (key, value) => { if (value) params.set(key, value); };
  set('program', $('#f-program').value);
  set('author', $('#f-author').value);
  set('status', $('#f-status').value);
  set('hotel', $('#f-hotel').value);
  set('land', $('#f-country').value);
  set('city', $('#f-city').value);
  if ($('#f-upgraded').checked) params.set('upgraded', '1');

  try {
    state.stays = await api('/stays?' + params);
    renderChips();
    renderStayList();
  } catch (e) {
    $('#stay-list').innerHTML = '';
    $('#stay-list').appendChild(el('p', 'empty', e.message));
  }
}

function inRange(stay) {
  const from = $('#f-from').value;
  const to = $('#f-to').value;
  if (from && (!stay.checkin || stay.checkin < from)) return false;
  if (to && (!stay.checkin || stay.checkin > to)) return false;
  return true;
}

function renderStayList() {
  const box = $('#stay-list');
  const q = $('#f-text').value.trim();
  renderHotelHits(q);

  const list = state.stays.filter((s) => {
    if (!inRange(s)) return false;
    if (!q) return true;
    const haystack = [s.hotel_name, s.city, s.country, s.booked_room, s.received_room,
      s.notes, s.author, (s.benefits || []).map((b) => b.name + ' ' + (b.value || '')).join(' ')]
      .filter(Boolean).join(' ');
    return fuzzyMatch(haystack, q);
  });

  $('#stay-count').textContent = list.length + (list.length === 1 ? ' Aufenthalt' : ' Aufenthalte');

  box.innerHTML = '';
  if (!list.length) {
    box.appendChild(el('p', 'empty', state.stays.length
      ? 'Kein Aufenthalt passt zu diesen Filtern.'
      : 'Noch nichts eingetragen. Fang mit deinem letzten Aufenthalt an.'));
    return;
  }
  for (const s of list) box.appendChild(renderStayCard(s));
}

// Passende Hotels als eigener Vorschlag über der Liste.
function renderHotelHits(q) {
  const box = $('#hotel-hits');
  box.innerHTML = '';
  box.hidden = true;
  if (!q || q.length < 2) return;

  const seen = new Set();
  const hits = [];
  for (const p of state.places) {
    if (seen.has(p.hotel_id)) continue;
    if (!fuzzyMatch(p.hotel_name + ' ' + p.city, q)) continue;
    seen.add(p.hotel_id);
    hits.push(p);
  }
  if (!hits.length) return;

  box.hidden = false;
  box.appendChild(el('h4', null, 'HOTELS'));
  for (const p of hits.slice(0, 5)) {
    const row = el('div', 'hotel-hit');
    row.appendChild(hotelLink(p.hotel_name, p.hotel_id));
    row.appendChild(el('span', 'n', [p.city, p.country].filter(Boolean).join(', ')));
    box.appendChild(row);
  }
}

/* ---------------------------------------------------------------- Karten */

function renderStayCard(s) {
  const card = el('article', 'stay' + (state.selected === s.id ? ' is-on' : ''));
  card.tabIndex = 0;
  card.setAttribute('role', 'button');

  const top = el('div', 'stay-top');
  const head = el('div');
  head.appendChild(hotelLink(s.hotel_name, s.hotel_id, 'stay-hotel'));
  head.appendChild(el('div', 'stay-place', [s.city, s.country].filter(Boolean).join(', ')));
  top.appendChild(head);
  if (s.price != null) top.appendChild(el('div', 'stay-price', formatMoney(s.price, s.currency)));
  card.appendChild(top);

  card.appendChild(el('div', 'stay-when', stayDates(s)));

  const badges = el('div', 'badge-row');
  if (s.program) badges.appendChild(el('span', 'badge', s.program));
  if (s.status_level) {
    const badge = el('span', 'badge badge-status', s.status_level);
    badge.style.background = statusColor(s.status_level);
    badges.appendChild(badge);
  }
  if (badges.children.length) card.appendChild(badges);

  if (s.booked_room || s.received_room) card.appendChild(renderFlow(s));

  if (s.benefits?.length) {
    const pills = el('div', 'stay-benefits');
    for (const b of s.benefits) {
      const pill = el('span', 'pill');
      pill.appendChild(document.createTextNode(b.name));
      if (b.value) {
        pill.appendChild(document.createTextNode(' '));
        pill.appendChild(el('span', 'v', b.value));
      }
      pills.appendChild(pill);
    }
    card.appendChild(pills);
  }

  const foot = el('div', 'stay-foot');
  const author = el('span', 'stay-author');
  author.appendChild(el('span', 'avatar', initials(s.author)));
  author.appendChild(document.createTextNode(s.author));
  foot.appendChild(author);
  if (s.photos?.length) foot.appendChild(el('span', null, s.photos.length + (s.photos.length === 1 ? ' Foto' : ' Fotos')));
  card.appendChild(foot);

  const open = () => { state.selected = s.id; renderStayList(); showDetail(s); };
  card.addEventListener('click', open);
  card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  return card;
}

// Gebucht → Erhalten, das Herzstück jeder Karte.
function renderFlow(s) {
  const flow = el('div', 'flow');

  const booked = el('div', 'flow-row');
  booked.appendChild(el('span', 'flow-label', 'GEBUCHT'));
  booked.appendChild(el('span', 'flow-value', s.booked_room || 'nicht erfasst'));
  flow.appendChild(booked);

  const mid = el('div', 'flow-mid');
  mid.appendChild(el('span', 'flow-arrow', '↓'));
  const verdict = el('span', null, upgradeText(s.upgrade_steps));
  verdict.className = s.upgrade_steps > 0 ? 'flow-up' : s.upgrade_steps < 0 ? 'flow-down' : 'flow-same';
  mid.appendChild(verdict);
  flow.appendChild(mid);

  const got = el('div', 'flow-row');
  got.appendChild(el('span', 'flow-label', 'ERHALTEN'));
  got.appendChild(el('span', 'flow-value got', s.received_room || 'nicht erfasst'));
  flow.appendChild(got);
  return flow;
}

function upgradeText(steps) {
  if (steps == null) return 'Kategorien nicht vergleichbar';
  if (steps === 0) return 'kein Upgrade';
  if (steps < 0) return Math.abs(steps) + (Math.abs(steps) === 1 ? ' Kategorie schlechter' : ' Kategorien schlechter');
  return '+' + steps + (steps === 1 ? ' Kategorie' : ' Kategorien');
}

// Hotelnamen sind überall Einstieg in die Hotelseite.
function hotelLink(name, hotelId, cls) {
  const button = el('button', (cls ? cls + ' ' : '') + 'hotel-link', name);
  button.type = 'button';
  button.title = 'Hotelseite öffnen';
  button.addEventListener('click', (e) => { e.stopPropagation(); showHotel(hotelId); });
  return button;
}

const initials = (name) => (name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

function formatMoney(value, currency) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: currency || 'EUR', maximumFractionDigits: 0 }).format(value);
}
function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
function stayDates(s) {
  if (!s.checkin) return '';
  const range = s.checkout ? formatDate(s.checkin) + ' – ' + formatDate(s.checkout) : formatDate(s.checkin);
  const nights = s.nights ? ' · ' + s.nights + (s.nights === 1 ? ' Nacht' : ' Nächte') : '';
  return range + nights;
}

/* ---------------------------------------------------------- Detailansicht */

function closeDetail() {
  $('#detail-pane').classList.remove('is-open');
  state.selected = null;
  renderStayList();
  $('#detail-body').innerHTML = '';
  $('#detail-body').appendChild(el('p', 'detail-placeholder', 'Wähle einen Aufenthalt, um alles dazu zu sehen.'));
}
$('#detail-close').addEventListener('click', closeDetail);

function showDetail(s) {
  const box = $('#detail-body');
  box.innerHTML = '';
  $('#detail-pane').classList.add('is-open');

  box.appendChild(hotelLink(s.hotel_name, s.hotel_id, 'detail-title'));
  box.appendChild(el('p', 'detail-sub', [s.city, s.country].filter(Boolean).join(', ')));

  const badges = el('div', 'badge-row');
  if (s.program) badges.appendChild(el('span', 'badge', s.program));
  if (s.status_level) {
    const badge = el('span', 'badge badge-status', s.status_level);
    badge.style.background = statusColor(s.status_level);
    badges.appendChild(badge);
  }
  box.appendChild(badges);

  if (s.booked_room || s.received_room) box.appendChild(renderFlow(s));

  const facts = el('div', 'detail-section');
  facts.appendChild(el('h4', null, 'AUFENTHALT'));
  const grid = el('div', 'detail-facts');
  const fact = (label, value) => {
    if (!value) return;
    const cell = el('div');
    cell.appendChild(el('div', 'fact-label', label));
    cell.appendChild(el('div', 'fact-value', value));
    grid.appendChild(cell);
  };
  fact('Zeitraum', stayDates(s));
  fact('Preis', s.price != null ? formatMoney(s.price, s.currency) : null);
  fact('Eingetragen von', s.author);
  fact('Nächte', s.nights ? String(s.nights) : null);
  facts.appendChild(grid);
  box.appendChild(facts);

  if (s.benefits?.length) {
    const section = el('div', 'detail-section');
    section.appendChild(el('h4', null, 'BENEFITS'));
    const pills = el('div', 'stay-benefits');
    for (const b of s.benefits) {
      const pill = el('span', 'pill');
      pill.appendChild(document.createTextNode(b.name));
      if (b.value) {
        pill.appendChild(document.createTextNode(' '));
        pill.appendChild(el('span', 'v', b.value));
      }
      pills.appendChild(pill);
    }
    section.appendChild(pills);
    box.appendChild(section);
  }

  if (s.notes) {
    const section = el('div', 'detail-section');
    section.appendChild(el('h4', null, 'ERFAHRUNG'));
    section.appendChild(el('p', 'detail-notes', s.notes));
    box.appendChild(section);
  }

  if (s.photos?.length) {
    const section = el('div', 'detail-section');
    section.appendChild(el('h4', null, 'FOTOS'));
    const gallery = el('div', 'detail-gallery');
    for (const p of s.photos) {
      const fig = document.createElement('figure');
      const img = document.createElement('img');
      img.src = '/api/photos/' + encodeURIComponent(p.key);
      img.alt = p.caption || '';
      img.loading = 'lazy';
      fig.appendChild(img);
      if (p.caption) fig.appendChild(el('figcaption', null, p.caption));
      gallery.appendChild(fig);
    }
    section.appendChild(gallery);
    box.appendChild(section);
  }

  const actions = el('div', 'detail-actions');
  const hotelBtn = el('button', 'btn btn-quiet', 'Hotel ansehen');
  hotelBtn.addEventListener('click', () => showHotel(s.hotel_id));
  actions.appendChild(hotelBtn);

  const share = el('button', 'btn btn-quiet', 'Teilen');
  share.addEventListener('click', () => shareStay(s));
  actions.appendChild(share);

  if (s.author === state.me) {
    const edit = el('button', 'btn btn-quiet', 'Bearbeiten');
    edit.addEventListener('click', () => editStay(s));
    actions.appendChild(edit);
  }

  if (s.author === state.me) {
    const del = el('button', 'btn btn-quiet', 'Löschen');
    del.addEventListener('click', async () => {
      if (!confirm('Diesen Aufenthalt löschen?')) return;
      await api('/stays/' + s.id, { method: 'DELETE' });
      closeDetail();
      loadStays();
      loadFilters();
    });
    actions.appendChild(del);
  }
  box.appendChild(actions);
}

function shareStay(s) {
  const lines = [
    s.hotel_name + (s.city ? ', ' + s.city : ''),
    [s.program, s.status_level].filter(Boolean).join(' · '),
    s.booked_room && s.received_room ? 'Gebucht: ' + s.booked_room + ' → Bekommen: ' + s.received_room : null,
    upgradeText(s.upgrade_steps),
    s.benefits?.length ? 'Dazu: ' + s.benefits.map((b) => b.name + (b.value ? ' (' + b.value + ')' : '')).join(', ') : null,
    s.price != null ? 'Preis: ' + formatMoney(s.price, s.currency) : null,
    s.notes || null,
  ].filter(Boolean);
  const text = lines.join('\n');
  if (navigator.share) navigator.share({ text }).catch(() => {});
  else navigator.clipboard.writeText(text).then(() => alert('In die Zwischenablage kopiert.'));
}

// Bestehenden Aufenthalt zum Bearbeiten ins Formular laden.
async function editStay(stay) {
  const res = await api('/hotels/' + stay.hotel_id);
  state.hotel = res.hotel;
  state.rooms = res.rooms;
  state.editing = stay.id;
  state.skipEnrichment = true;
  state.programTouched = true;
  state.pendingPhotos = [];
  state.benefitValues = {};

  showView('new');
  $('#picker').hidden = true;
  $('#stay-form').hidden = false;
  $('#edit-banner').hidden = false;
  $('#photo-previews').innerHTML = '';

  renderChosenHotel();
  renderRooms();
  loadGallery();

  $('#s-program').value = stay.program || '';
  syncStatusOptions();
  $('#s-status').value = stay.status_level || '';
  $('#s-checkin').value = stay.checkin || '';
  $('#s-checkout').value = stay.checkout || '';
  $('#s-booked').value = stay.booked_room || '';
  $('#s-received').value = stay.received_room || '';
  $('#s-price').value = stay.price ?? '';
  $('#s-currency').value = stay.currency || 'EUR';
  $('#s-notes').value = stay.notes || '';

  const chosen = new Map((stay.benefits || []).map((b) => [b.name, b.value]));
  for (const input of document.querySelectorAll('#benefit-list input')) {
    input.checked = chosen.has(input.value);
    if (chosen.get(input.value)) state.benefitValues[input.value] = chosen.get(input.value);
  }
  renderBenefitValues();
  updateUpgradeHint();

  document.querySelector('#stay-form button[type=submit]').textContent = 'Änderungen speichern';
}

$('#edit-cancel').addEventListener('click', () => {
  resetPicker();
  showView('stays');
});

/* ------------------------------------------------------- Hotel-Detailseite */

// Beantwortet: Was bringt mein Status in genau diesem Haus?
async function showHotel(hotelId) {
  const box = $('#detail-body');
  box.innerHTML = '';
  $('#detail-pane').classList.add('is-open');
  box.appendChild(el('p', 'detail-placeholder', 'Wird geladen …'));

  try {
    const data = await api('/hotels/' + hotelId + '/community');
    box.innerHTML = '';

    if (state.selected) {
      const back = el('button', 'link-btn', '← zurück zum Aufenthalt');
      back.addEventListener('click', () => {
        const stay = state.stays.find((s) => s.id === state.selected);
        if (stay) showDetail(stay); else closeDetail();
      });
      box.appendChild(back);
    }

    box.appendChild(el('h3', 'detail-title', data.hotel.name));
    box.appendChild(el('p', 'detail-sub', [data.hotel.city, data.hotel.country].filter(Boolean).join(', ')));

    if (data.hotel.program) {
      const badges = el('div', 'badge-row');
      badges.appendChild(el('span', 'badge', data.hotel.program));
      box.appendChild(badges);
    }

    // Community
    const community = el('div', 'detail-section');
    community.appendChild(el('h4', null, 'COMMUNITY'));
    const grid = el('div', 'hotel-stat-grid');
    const stat = (num, label) => {
      const cell = el('div', 'hotel-stat');
      cell.appendChild(el('div', 'num', num));
      cell.appendChild(el('div', 'lbl', label));
      grid.appendChild(cell);
    };
    stat(String(data.stays), data.stays === 1 ? 'Aufenthalt' : 'Aufenthalte');
    stat(String(data.people), data.people === 1 ? 'Person' : 'Personen');

    // Bei ganz wenigen Meldungen keine Scheingenauigkeit vorgaukeln.
    if (data.stays >= 3) {
      stat(data.upgrade_quote != null ? data.upgrade_quote + ' %' : '–', 'Upgradequote');
      stat(data.suite_quote != null ? data.suite_quote + ' %' : '–', 'Suite-Upgrades');
    }
    if (data.avg_steps != null) stat((data.avg_steps > 0 ? '+' : '') + comma(data.avg_steps), 'Ø Kategorien');
    community.appendChild(grid);

    if (data.stays < 3) {
      community.appendChild(el('p', 'sample-note',
        data.stays === 1
          ? 'Erst ein gemeldeter Aufenthalt – für Quoten zu wenig.'
          : data.stays + ' gemeldete Aufenthalte – für belastbare Quoten noch zu wenig.'));
    }
    box.appendChild(community);

    // Status-Erfahrungen
    if (data.by_status.length) {
      const section = el('div', 'detail-section');
      section.appendChild(el('h4', null, 'STATUS-ERFAHRUNGEN'));
      for (const g of data.by_status) {
        const row = el('div', 'status-line');
        const left = el('div');
        if (g.status) {
          const badge = el('span', 'badge badge-status', g.status);
          badge.style.background = statusColor(g.status);
          left.appendChild(badge);
        } else {
          left.appendChild(el('span', null, g.label));
        }
        left.appendChild(el('div', 'sample-note',
          g.stays + (g.stays === 1 ? ' Aufenthalt' : ' Aufenthalte')
          + (g.avg_steps != null ? ' · Ø ' + (g.avg_steps > 0 ? '+' : '') + comma(g.avg_steps) : '')));
        row.appendChild(left);
        row.appendChild(el('span', 'quote', g.stays >= 3 && g.upgrade_quote != null
          ? g.upgrade_quote + ' %'
          : (g.upgrade_quote === 100 ? 'Upgrade' : g.upgrade_quote === 0 ? 'kein Upgrade' : '–')));
        section.appendChild(row);
      }
      box.appendChild(section);
    }

    // Häufige Upgrades
    if (data.pairs.length) {
      const section = el('div', 'detail-section');
      section.appendChild(el('h4', null, 'HÄUFIGE UPGRADES'));
      for (const pair of data.pairs) {
        const row = el('div', 'pair');
        const rooms = el('div', 'pair-rooms');
        rooms.appendChild(el('div', null, pair.booked));
        rooms.appendChild(el('div', 'to', '↓ ' + pair.received));
        row.appendChild(rooms);
        row.appendChild(el('span', 'pair-count', pair.count + '× gemeldet'));
        section.appendChild(row);
      }
      box.appendChild(section);
    }

    // Benefits
    if (data.benefits.length) {
      const section = el('div', 'detail-section');
      section.appendChild(el('h4', null, 'BENEFITS'));
      for (const b of data.benefits) section.appendChild(benefitBar(b, data.stays));
      box.appendChild(section);
    }

    // Letzte Erfahrungen
    if (data.recent.length) {
      const section = el('div', 'detail-section');
      section.appendChild(el('h4', null, 'LETZTE ERFAHRUNGEN'));
      const list = el('div', 'recent-list');
      for (const s of data.recent) list.appendChild(renderStayCard(s));
      section.appendChild(list);
      box.appendChild(section);
    }

    const actions = el('div', 'detail-actions');
    const filterBtn = el('button', 'btn btn-quiet', 'Alle Aufenthalte hier zeigen');
    filterBtn.addEventListener('click', () => {
      $('#f-country').value = data.hotel.country || '';
      refreshPlaceSelects();
      $('#f-city').value = data.hotel.city || '';
      refreshPlaceSelects();
      $('#f-hotel').value = String(hotelId);
      closeDetail();
      loadStays();
    });
    actions.appendChild(filterBtn);
    if (data.hotel.website) {
      const site = el('a', 'btn btn-quiet', 'Hotelseite');
      site.href = data.hotel.website;
      site.target = '_blank';
      site.rel = 'noopener';
      actions.appendChild(site);
    }
    box.appendChild(actions);
  } catch (e) {
    box.innerHTML = '';
    box.appendChild(el('p', 'detail-placeholder', e.message));
  }
}

// Balken mit Quote und Stichprobe.
function benefitBar(b, total) {
  const row = el('div', 'bar-row');
  const top = el('div', 'bar-top');
  top.appendChild(el('span', null, b.name + (b.values?.length ? ' · ' + b.values.slice(0, 3).join(', ') : '')));
  top.appendChild(el('span', 'muted', total >= 3
    ? b.quote + ' %'
    : b.count + '×'));
  row.appendChild(top);
  const track = el('div', 'bar-track');
  const fill = el('div', 'bar-fill');
  fill.style.width = (total >= 3 ? b.quote : Math.round((b.count / Math.max(total, 1)) * 100)) + '%';
  track.appendChild(fill);
  row.appendChild(track);
  if (total >= 3) row.appendChild(el('div', 'sample-note', 'basierend auf ' + total + ' Aufenthalten'));
  return row;
}

const comma = (n) => String(n).replace('.', ',');

/* ---------------------------------------------- Eintragen: Land, Stadt, Hotel */

function renderCountryOptions() {
  const q = $('#p-country').value.trim().toLowerCase();
  const box = $('#country-results');
  box.innerHTML = '';
  if (!q) return;
  const hits = COUNTRIES.filter(([code, name]) => fuzzyMatch(name, q) || code.toLowerCase() === q).slice(0, 8);
  if (!hits.length) { box.appendChild(el('p', 'options-empty', 'Kein Land gefunden.')); return; }
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
    if (!cities.length) { box.innerHTML = '<p class="options-empty">Kein Ort gefunden.</p>'; return; }
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
  $('#p-hotel').focus();

  const box = $('#hotel-results');
  const count = $('#hotel-count');
  count.textContent = '';
  box.innerHTML = '<p class="options-empty">Hotels werden geladen …</p>';
  try {
    state.hotelCandidates = await api('/geo/hotels?lat=' + city.lat + '&lon=' + city.lon);
    count.textContent = state.hotelCandidates.length + ' im Umkreis';
    renderHotelOptions([]);
  } catch (e) {
    count.textContent = 'Umkreissuche gescheitert';
    box.innerHTML = '';
    box.appendChild(el('p', 'options-empty', e.message));
  }
}

function renderHotelOptions(extra) {
  if (!extra) extra = state.nameHits || [];
  const box = $('#hotel-results');
  const q = $('#p-hotel').value.trim();

  const merged = [];
  const seen = new Set();
  for (const h of extra) {
    const marker = normalize(h.name);
    if (seen.has(marker)) continue;
    seen.add(marker);
    merged.push(h);
  }
  for (const h of state.hotelCandidates) {
    const marker = normalize(h.name);
    if (seen.has(marker)) continue;
    if (q && !fuzzyMatch(h.name, q)) continue;
    seen.add(marker);
    merged.push(h);
  }

  box.innerHTML = '';
  if (!merged.length) {
    box.appendChild(el('p', 'options-empty', q
      ? 'Nichts gefunden. Weiter tippen oder von Hand eintragen.'
      : 'Keine Hotels im Umkreis gefunden.'));
    return;
  }
  for (const h of merged.slice(0, 40)) {
    const b = el('button', 'option');
    b.type = 'button';
    b.appendChild(el('span', null, h.name));
    b.appendChild(el('small', null, h.program || h.brand || h.street || h.place || ''));
    b.addEventListener('click', () => chooseHotel(h));
    box.appendChild(b);
  }
}

const searchHotelByName = debounce(async () => {
  const q = $('#p-hotel').value.trim();
  if (q.length < 2 || !state.city) { state.nameHits = []; return; }
  try {
    const found = await api('/geo/hotel-search?q=' + encodeURIComponent(q)
      + '&lat=' + state.city.lat + '&lon=' + state.city.lon
      + '&city=' + encodeURIComponent(state.city.name || ''));
    if ($('#p-hotel').value.trim() !== q) return;
    state.nameHits = found;
    renderHotelOptions(found);
  } catch { /* Umkreisliste bleibt */ }
}, 300);

$('#p-hotel').addEventListener('input', () => { renderHotelOptions([]); searchHotelByName(); });

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

function resetPicker() {
  clearInterval(state.pollTimer);
  state.editing = null;
  $('#edit-banner').hidden = true;
  document.querySelector('#stay-form button[type=submit]').textContent = 'Aufenthalt eintragen';

  state.hotel = null;
  state.rooms = [];
  state.pendingPhotos = [];
  state.benefitValues = {};
  state.nameHits = [];
  state.hotelCandidates = [];
  state.skipEnrichment = false;
  state.programTouched = false;

  $('#stay-form').reset();
  $('#stay-form').hidden = true;
  $('#photo-previews').innerHTML = '';
  $('#benefit-values').innerHTML = '';
  $('#chosen-gallery').innerHTML = '';
  document.querySelectorAll('.gallery-note').forEach((n) => n.remove());
  $('#s-checkin').valueAsDate = new Date();
  $('#rank-warning').hidden = true;

  // Die Auswahl beginnt wieder beim Land.
  $('#picker').hidden = false;
  state.country = null;
  state.city = null;
  $('#p-country').value = '';
  $('#p-city').value = '';
  $('#p-hotel').value = '';
  $('#country-results').innerHTML = '';
  $('#city-results').innerHTML = '';
  $('#hotel-results').innerHTML = '';
  $('#hotel-count').textContent = '';
  document.querySelector('[data-step="city"]').hidden = true;
  document.querySelector('[data-step="hotel"]').hidden = true;
}

$('#chosen-reset').addEventListener('click', resetPicker);

/* ------------------------------------------------------------- Hotelkarte */

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
    a.href = hotel.website; a.target = '_blank'; a.rel = 'noopener';
    links.appendChild(a);
  }
  if (hotel.lat && hotel.lon) {
    const map = el('a', null, 'auf der Karte');
    map.href = 'https://www.openstreetmap.org/?mlat=' + hotel.lat + '&mlon=' + hotel.lon + '#map=17/' + hotel.lat + '/' + hotel.lon;
    map.target = '_blank'; map.rel = 'noopener';
    links.appendChild(map);
  }
  if (hotel.lounge === 1) links.appendChild(el('span', null, 'Lounge vorhanden'));
  if (hotel.breakfast_note) links.appendChild(el('span', null, hotel.breakfast_note));
}

async function loadGallery() {
  const box = $('#chosen-gallery');
  const rating = $('#chosen-rating');
  box.innerHTML = '';
  rating.hidden = true;
  document.querySelectorAll('.gallery-note').forEach((n) => n.remove());
  if (!state.hotel) return;

  try {
    const data = await api('/hotels/' + state.hotel.id + '/images');

    if (data.rating != null) {
      rating.innerHTML = '';
      const full = Math.round(data.rating);
      rating.appendChild(el('span', 'stars', '★'.repeat(full) + '☆'.repeat(5 - full)));
      rating.appendChild(el('span', null, ' ' + data.rating.toFixed(1)));
      if (data.rating_count) rating.appendChild(el('span', 'n', ' · ' + data.rating_count + ' Bewertungen bei Google'));
      if (data.maps_uri) {
        const a = el('a', null, ' ansehen');
        a.href = data.maps_uri; a.target = '_blank'; a.rel = 'noopener';
        rating.appendChild(a);
      }
      rating.hidden = false;
    }

    for (const img of data.photos || []) {
      const fig = document.createElement('figure');
      const image = document.createElement('img');
      image.src = img.thumb;
      image.alt = state.hotel.name;
      image.loading = 'lazy';
      image.addEventListener('error', () => fig.remove());
      fig.appendChild(image);
      const credit = el('figcaption');
      const parts = [img.author, img.license].filter(Boolean).join(' · ');
      if (img.page) {
        const a = el('a', null, parts || 'Quelle');
        a.href = img.page; a.target = '_blank'; a.rel = 'noopener';
        credit.appendChild(a);
      } else {
        credit.textContent = parts;
      }
      fig.appendChild(credit);
      box.appendChild(fig);
    }

    if (!(data.photos || []).length) {
      box.insertAdjacentElement('afterend', el('p', 'gallery-note', data.google_aktiv
        ? 'Zu diesem Haus wurden keine Bilder gefunden.'
        : 'Ohne Google-Schlüssel gibt es meist keine Hotelbilder.'));
    }
  } catch { /* ohne Bilder geht es auch */ }
}

/* --------------------------------------------------------- Zimmerkategorien */

function fallbackRooms() {
  const names = FALLBACK_ROOMS[$('#s-program').value] || FALLBACK_ROOMS.default;
  return names.map((name, i) => ({ name, rank: i + 1, confirmed: 0, source: 'fallback' }));
}

function renderRooms() {
  const list = $('#rooms-list');
  const status = $('#rooms-status');
  const adder = document.querySelector('.rooms-add');
  const refresh = $('#rooms-refresh');
  const st = state.hotel?.enrich_status;
  const busy = !state.skipEnrichment && (st === 'pending' || st === 'running');

  list.innerHTML = '';
  adder.hidden = busy;
  refresh.hidden = busy;

  if (busy) {
    status.textContent = 'läuft …';
    const wait = el('div', 'rooms-wait');
    wait.appendChild(el('span', 'spinner'));
    const texts = el('div');
    texts.appendChild(el('div', null, 'Zimmerkategorien werden auf der Hotelwebseite recherchiert …'));
    texts.appendChild(el('div', 'rooms-wait-note', 'Das kann einen Moment dauern. Du kannst den Rest schon ausfüllen.'));
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

  const found = state.rooms.length;
  const rooms = found ? state.rooms : fallbackRooms();

  if (found) {
    status.innerHTML = '';
    status.appendChild(el('span', 'rooms-found', '✓ ' + found + (found === 1 ? ' Kategorie' : ' Kategorien') + ' gefunden'));
  } else {
    status.textContent = 'nichts gefunden';
    list.appendChild(el('p', 'rooms-failed',
      'Keine Zimmerkategorien gefunden. Die Liste unten ist die allgemeine Leiter der Marke – ergänze oder ersetze sie.'));
    const add = el('button', 'btn btn-quiet', 'Zimmerkategorie selbst hinzufügen');
    add.type = 'button';
    add.addEventListener('click', () => {
      $('#rooms-box').open = true;
      $('#room-new').focus();
    });
    list.appendChild(add);
  }

  rooms.forEach((room, index) => {
    const row = el('div', 'room-row' + (room.confirmed ? '' : ' is-suggested'));

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = !!room.confirmed;
    check.setAttribute('aria-label', 'Kategorie ' + room.name + ' bestätigen');
    check.addEventListener('change', () => confirmRoom(room, check.checked));
    row.appendChild(check);

    // Reihenfolge korrigieren
    const move = el('div', 'room-move');
    const up = el('button', null, '▲');
    up.type = 'button';
    up.title = 'nach oben';
    up.disabled = index === 0 || !found;
    up.addEventListener('click', () => moveRoom(index, -1));
    const down = el('button', null, '▼');
    down.type = 'button';
    down.title = 'nach unten';
    down.disabled = index === rooms.length - 1 || !found;
    down.addEventListener('click', () => moveRoom(index, 1));
    move.append(up, down);
    row.appendChild(move);

    row.appendChild(el('span', 'rank', room.rank ?? ''));

    const name = el('span', 'name');
    name.appendChild(document.createTextNode(room.name));
    const bits = [
      room.size_sqm ? room.size_sqm + ' m²' : null,
      room.bed_type || null,
      room.max_occupancy ? 'bis ' + room.max_occupancy + ' Pers.' : null,
    ].filter(Boolean);
    if (bits.length) {
      name.appendChild(document.createElement('br'));
      name.appendChild(el('span', 'meta', bits.join(' · ')));
    }
    row.appendChild(name);

    if (room.type) row.appendChild(el('span', 'type', room.type === 'suite' ? 'SUITE' : 'ROOM'));

    if (room.source_url) {
      const a = el('a', null, 'Quelle');
      a.href = room.source_url;
      a.target = '_blank';
      a.rel = 'noopener';
      row.appendChild(a);
    }
    list.appendChild(row);
  });

  fillRoomSelects(rooms);
  renderRankWarning();
}

// Reihenfolge tauschen und gleich als geprüft speichern.
async function moveRoom(index, direction) {
  const rooms = [...state.rooms];
  const target = index + direction;
  if (target < 0 || target >= rooms.length) return;

  [rooms[index], rooms[target]] = [rooms[target], rooms[index]];
  const payload = rooms.map((room, i) => ({
    name: room.name,
    rank: i + 1,
    type: room.type || null,
    confirmed: room.confirmed === 1,
  }));

  const res = await api('/hotels/' + state.hotel.id + '/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rooms: payload, rank_confirmed: true }),
  });
  state.rooms = res.rooms;
  if (state.hotel) state.hotel.rank_reliable = 1;
  renderRooms();
}

function renderRankWarning() {
  const box = $('#rank-warning');
  const unsure = state.hotel && state.hotel.rank_reliable === 0 && state.rooms.length;
  box.hidden = !unsure;
  if (unsure) {
    box.textContent = 'Die Reihenfolge der Kategorien ließ sich auf der Hotelseite nicht sicher belegen. '
      + 'Die Upgrade-Stufe ist deshalb nur ein Anhaltspunkt – korrigier die Reihenfolge unten mit den Pfeilen.';
  }
}

$('#rooms-refresh').addEventListener('click', async () => {
  if (!state.hotel) return;
  if (!confirm('Zimmerkategorien neu recherchieren? Von dir bestätigte Kategorien bleiben erhalten.')) return;
  await api('/hotels/' + state.hotel.id + '/enrich', { method: 'POST' });
  state.hotel.enrich_status = 'running';
  state.skipEnrichment = false;
  renderRooms();
  watchEnrichment();
});

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
  updateUpgradeHint();
}

// Zeigt sofort, was der Status gebracht hat.
function updateUpgradeHint() {
  const badge = $('#upgrade-hint');
  const text = $('#upgrade-text');
  const rooms = state.rooms.length ? state.rooms : fallbackRooms();
  const rank = (name) => rooms.find((r) => r.name === name)?.rank;
  const booked = rank($('#s-booked').value);
  const got = rank($('#s-received').value);

  badge.className = 'upgrade-badge';
  if (booked == null || got == null) {
    text.textContent = $('#s-booked').disabled ? 'Kategorien werden geladen' : 'Kategorien wählen';
    return;
  }
  const steps = got - booked;
  text.textContent = upgradeText(steps);
  if (steps > 0) badge.classList.add('up');
  if (steps < 0) badge.classList.add('down');

  if (state.hotel && state.hotel.rank_reliable === 0) {
    const note = el('span', 'sample', ' Reihenfolge unsicher');
    text.appendChild(note);
  }
}

$('#s-booked').addEventListener('change', updateUpgradeHint);
$('#s-received').addEventListener('change', updateUpgradeHint);

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
  if (!state.hotel || ['ready', 'failed'].includes(state.hotel.enrich_status)) return;
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
      if (['ready', 'failed'].includes(res.hotel.enrich_status)) {
        clearInterval(state.pollTimer);
        loadGallery();
      }
    } catch { /* weiter versuchen */ }
  }, 4000);
}

/* ---------------------------------------------------------------- Formular */

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
  for (const [name] of BENEFITS) {
    const label = el('label', 'chip');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = name;
    input.addEventListener('change', renderBenefitValues);
    label.appendChild(input);
    label.appendChild(document.createTextNode(name));
    chips.appendChild(label);
  }

  $('#s-checkin').valueAsDate = new Date();
}

// Für ausgewählte Benefits, die einen Wert vertragen, ein Feld anbieten.
function renderBenefitValues() {
  const box = $('#benefit-values');
  box.innerHTML = '';
  const chosen = [...document.querySelectorAll('#benefit-list input:checked')].map((i) => i.value);

  for (const name of chosen) {
    const hint = benefitHint(name);
    if (!hint) continue;
    const row = el('div', 'benefit-value');
    row.appendChild(el('span', null, name));
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = hint;
    input.value = state.benefitValues[name] || '';
    input.addEventListener('input', () => { state.benefitValues[name] = input.value; });
    row.appendChild(input);
    box.appendChild(row);
  }
}

function syncStatusOptions() {
  const sel = $('#s-status');
  const program = $('#s-program').value;
  const levels = PROGRAMS[program]?.status || [];
  const previous = sel.value;
  sel.innerHTML = '';
  sel.appendChild(new Option('– kein Status –', ''));
  for (const s of levels) sel.appendChild(new Option(s, s));
  const mine = state.myStatus[program];
  if (previous && levels.includes(previous)) sel.value = previous;
  else if (mine && levels.includes(mine)) sel.value = mine;
}

async function shrink(file, max = 1600) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
}

async function addPhotos(files) {
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    const blob = await shrink(file);
    state.pendingPhotos.push({ blob, caption: '', url: URL.createObjectURL(blob) });
  }
  renderPhotoPreviews();
}

function renderPhotoPreviews() {
  const box = $('#photo-previews');
  box.innerHTML = '';
  state.pendingPhotos.forEach((entry, index) => {
    const wrap = el('div', 'photo-preview');
    const img = document.createElement('img');
    img.src = entry.url;
    img.alt = '';
    wrap.appendChild(img);

    const tools = el('div', 'photo-tools');
    if (index > 0) {
      const left = el('button', null, '‹');
      left.type = 'button';
      left.title = 'nach vorn';
      left.addEventListener('click', () => {
        [state.pendingPhotos[index - 1], state.pendingPhotos[index]] =
          [state.pendingPhotos[index], state.pendingPhotos[index - 1]];
        renderPhotoPreviews();
      });
      tools.appendChild(left);
    }
    if (index < state.pendingPhotos.length - 1) {
      const right = el('button', null, '›');
      right.type = 'button';
      right.title = 'nach hinten';
      right.addEventListener('click', () => {
        [state.pendingPhotos[index + 1], state.pendingPhotos[index]] =
          [state.pendingPhotos[index], state.pendingPhotos[index + 1]];
        renderPhotoPreviews();
      });
      tools.appendChild(right);
    }
    const remove = el('button', null, '×');
    remove.type = 'button';
    remove.title = 'entfernen';
    remove.addEventListener('click', () => {
      URL.revokeObjectURL(entry.url);
      state.pendingPhotos.splice(index, 1);
      renderPhotoPreviews();
    });
    tools.appendChild(remove);
    wrap.appendChild(tools);

    const caption = document.createElement('input');
    caption.placeholder = 'Beschreibung';
    caption.value = entry.caption;
    caption.addEventListener('input', () => { entry.caption = caption.value; });
    wrap.appendChild(caption);
    box.appendChild(wrap);
  });
}

$('#dropzone').addEventListener('click', () => $('#s-photos').click());
$('#s-photos').addEventListener('change', async (e) => {
  await addPhotos(e.target.files);
  e.target.value = '';
});

for (const type of ['dragenter', 'dragover']) {
  $('#dropzone').addEventListener(type, (e) => {
    e.preventDefault();
    $('#dropzone').classList.add('is-over');
  });
}
for (const type of ['dragleave', 'drop']) {
  $('#dropzone').addEventListener(type, (e) => {
    e.preventDefault();
    $('#dropzone').classList.remove('is-over');
  });
}
$('#dropzone').addEventListener('drop', (e) => addPhotos(e.dataTransfer.files));

$('#stay-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#form-error');
  err.hidden = true;
  try {
    const benefits = [...document.querySelectorAll('#benefit-list input:checked')].map((i) => ({
      name: i.value,
      value: (state.benefitValues[i.value] || '').trim() || null,
    }));

    const payload = JSON.stringify({
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
    });

    const { id } = state.editing
      ? await api('/stays/' + state.editing, {
          method: 'PUT', headers: { 'content-type': 'application/json' }, body: payload,
        })
      : await api('/stays', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: payload,
        });

    for (const photo of state.pendingPhotos) {
      await api('/photos?stay_id=' + id + '&caption=' + encodeURIComponent(photo.caption || ''), {
        method: 'POST',
        headers: { 'content-type': 'image/jpeg' },
        body: photo.blob,
      });
    }

    resetPicker();
    showView('stays');
    loadFilters();
  } catch (e2) {
    err.textContent = e2.message;
    err.hidden = false;
  }
});

/* ------------------------------------------------------------ Auswertung */

async function loadStats() {
  const box = $('#stats-body');
  box.innerHTML = '<p class="empty">Wird geladen …</p>';
  try {
    const scope = $('#stats-scope').value === 'me' ? '?author=' + encodeURIComponent(state.me) : '';
    const data = await api('/stats' + scope);
    box.innerHTML = '';

    const totals = el('div', 'totals');
    const t = data.totals;
    for (const [num, label] of [
      [String(t.stays), t.stays === 1 ? 'Aufenthalt' : 'Aufenthalte'],
      [String(t.hotels), 'Hotels'],
      [String(t.nights), 'Nächte'],
      [t.upgrade_quote != null ? t.upgrade_quote + ' %' : '–', 'davon mit Upgrade'],
    ]) {
      const card = el('div', 'total-card');
      card.appendChild(el('div', 'total-num', num));
      card.appendChild(el('div', 'total-label', label));
      totals.appendChild(card);
    }
    box.appendChild(totals);

    if (!data.groups.length) {
      box.appendChild(el('p', 'empty', 'Sobald Aufenthalte eingetragen sind, steht hier die Auswertung.'));
      return;
    }

    for (const g of data.groups) {
      const card = el('div', 'group-card');
      const head = el('div', 'group-head');
      const title = el('div');
      title.appendChild(el('div', 'group-title', g.program));
      const badge = el('span', 'badge badge-status', g.status);
      badge.style.background = statusColor(g.status);
      title.appendChild(badge);
      head.appendChild(title);
      head.appendChild(el('div', 'group-sub', g.stays + (g.stays === 1 ? ' Aufenthalt' : ' Aufenthalte')));
      card.appendChild(head);

      const grid = el('div', 'group-grid');

      const upgrades = el('div');
      upgrades.appendChild(el('h4', null, 'UPGRADES'));
      upgrades.appendChild(el('div', 'total-num', g.upgrade_quote != null ? g.upgrade_quote + ' %' : '–'));
      upgrades.appendChild(el('div', 'total-label', 'Upgradequote'));
      if (g.avg_steps != null) {
        upgrades.appendChild(el('div', 'group-sub', 'Ø ' + (g.avg_steps > 0 ? '+' : '') + comma(g.avg_steps) + ' Kategorien'));
      }
      if (g.suite_quote) {
        upgrades.appendChild(el('div', 'group-sub', g.suite_quote + ' % davon in eine Suite'));
      }
      if (g.stays < 3) {
        upgrades.appendChild(el('div', 'sample-note', 'nur ' + g.stays
          + (g.stays === 1 ? ' Aufenthalt – wenig aussagekräftig' : ' Aufenthalte – wenig aussagekräftig')));
      }
      grid.appendChild(upgrades);

      if (g.benefits.length) {
        const benefits = el('div');
        benefits.appendChild(el('h4', null, 'BENEFITS ERHALTEN'));
        for (const b of g.benefits) {
          const row = el('div', 'bar-row');
          const top = el('div', 'bar-top');
          top.appendChild(el('span', null, b.name));
          top.appendChild(el('span', 'muted', g.stays >= 3 ? b.quote + ' %' : b.count + '×'));
          row.appendChild(top);
          const track = el('div', 'bar-track');
          const fill = el('div', 'bar-fill');
          fill.style.width = b.quote + '%';
          track.appendChild(fill);
          row.appendChild(track);
          benefits.appendChild(row);
        }
        grid.appendChild(benefits);
      }

      if (g.top_hotels.length) {
        const hotels = el('div');
        hotels.appendChild(el('h4', null, 'BESTE HÄUSER FÜR UPGRADES'));
        for (const h of g.top_hotels) {
          const row = el('div', 'top-hotel');
          row.appendChild(hotelLink(h.name, h.id));
          row.appendChild(el('div', 'n', h.stays + (h.stays === 1 ? ' Aufenthalt' : ' Aufenthalte')
            + ' · Ø +' + comma(h.avg_steps) + ' Kategorien'));
          hotels.appendChild(row);
        }
        grid.appendChild(hotels);
      }

      card.appendChild(grid);
      box.appendChild(card);
    }
  } catch (e) {
    box.innerHTML = '';
    box.appendChild(el('p', 'empty', e.message));
  }
}
$('#stats-scope').addEventListener('change', loadStats);

/* ------------------------------------------------------------- Protokoll */

const EVENT_TEXT = {
  login_ok: 'angemeldet',
  login_fail: 'Anmeldung fehlgeschlagen',
  login_blocked: 'gesperrt nach Fehlversuchen',
  member_create: 'Konto angelegt',
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
        'x-stay-user': encodeURIComponent(state.email || state.me || ''),
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
      tr.appendChild(el('td', 'ev ' + (e.event.includes('fail') ? 'ev-fail' : e.event.includes('blocked') ? 'ev-blocked' : ''),
        EVENT_TEXT[e.event] || e.event));
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

// Zuerst mit gespeicherten Zugangsdaten, sonst als Gast, sonst Anmeldemaske.
async function start() {
  // Nach dem Abmelden bewusst die Anmeldemaske zeigen, nicht die Gastansicht.
  if (sessionStorage.getItem('staylog.gate')) {
    sessionStorage.removeItem('staylog.gate');
    return;
  }
  if (state.pass && state.email) {
    try {
      await signIn(state.pass, state.email);
      return;
    } catch {
      localStorage.removeItem('staylog.pass');
      $('#gate-email').value = state.email || '';
    }
  }
  try {
    await signIn('', '');
  } catch { /* dann bleibt die Anmeldemaske stehen */ }
}
start();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
