/* stayLOG – Oberfläche */

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/* --------------------------------------------------------- Darstellung */

// Die Wahl kann "auto" sein; gesetzt wird immer das aufgelöste Ergebnis,
// damit Farben und Bedienelemente nie auseinanderlaufen.
function applyTheme(wahl) {
  const dunkel = wahl === 'dark'
    || (wahl !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  document.documentElement.dataset.theme = dunkel ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', dunkel ? '#10161F' : '#F2F0EA');
  document.body.classList.toggle('is-dark', dunkel);
}

applyTheme(localStorage.getItem('staylog.theme') || 'auto');

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if ((localStorage.getItem('staylog.theme') || 'auto') === 'auto') applyTheme('auto');
});

// Die drei Knöpfe in den Einstellungen
document.addEventListener('DOMContentLoaded', () => {
  for (const knopf of document.querySelectorAll('[data-theme-choice]')) {
    knopf.addEventListener('click', () => {
      const wahl = knopf.dataset.themeChoice;
      localStorage.setItem('staylog.theme', wahl);
      applyTheme(wahl);
      markThemeChoice();
    });
  }
  markThemeChoice();
});

function markThemeChoice() {
  const wahl = localStorage.getItem('staylog.theme') || 'auto';
  for (const knopf of document.querySelectorAll('[data-theme-choice]')) {
    knopf.classList.toggle('is-on', knopf.dataset.themeChoice === wahl);
  }
}

// Die eigene Fassung steht als Version im Skriptpfad.
const MY_VERSION = (document.currentScript?.src || '').split('v=')[1] || '';

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
  checkoutTouched: false,
  stays: [],
  places: [],
  selected: null,
  guest: false,
  mode: '',
  isAdmin: false,
  editing: null,
  view: localStorage.getItem('staylog.view') || 'cards',
  sort: { key: 'date', dir: 'desc' },
  columns: JSON.parse(localStorage.getItem('staylog.columns') || 'null'),
  hotelPage: null,
  contextCache: {},
  imageCache: {},
  groupBy: localStorage.getItem('staylog.group') || '',
  pollStarted: null,
  pollGaveUp: false,
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

// Alle Länder nach ISO 3166. Die Namen holt der Browser selbst auf Deutsch,
// so bleibt die Liste kurz und trotzdem vollständig.
const COUNTRY_CODES = [
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX', 'AZ', 'BA', 'BB',
  'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS', 'BT', 'BW', 'BY', 'BZ',
  'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN', 'CO', 'CR', 'CU', 'CV', 'CW', 'CX', 'CY',
  'CZ', 'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ', 'EC', 'EE', 'EG', 'EH', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK', 'FM',
  'FO', 'FR', 'GA', 'GB', 'GD', 'GE', 'GF', 'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT',
  'GU', 'GW', 'GY', 'HK', 'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT',
  'JE', 'JM', 'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KY', 'KZ', 'LA', 'LB', 'LC',
  'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK', 'ML', 'MM',
  'MN', 'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ', 'NA', 'NC', 'NE', 'NF', 'NG',
  'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ', 'OM', 'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PL', 'PM', 'PN', 'PR',
  'PS', 'PT', 'PW', 'PY', 'QA', 'RE', 'RO', 'RS', 'RU', 'RW', 'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI',
  'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS', 'ST', 'SV', 'SX', 'SY', 'SZ', 'TC', 'TD', 'TF', 'TG', 'TH',
  'TJ', 'TK', 'TL', 'TM', 'TN', 'TO', 'TR', 'TT', 'TV', 'TW', 'TZ', 'UA', 'UG', 'US', 'UY', 'UZ', 'VA', 'VC',
  'VE', 'VG', 'VI', 'VN', 'VU', 'WF', 'WS', 'XK', 'YE', 'YT', 'ZA', 'ZM', 'ZW',
];

// Wo der amtliche Name sperrig ist oder fehlt, nehmen wir den gebräuchlichen.
const COUNTRY_NAMES = {
  XK: 'Kosovo',
  HK: 'Hongkong',
  MO: 'Macau',
  PS: 'Palästina',
  TW: 'Taiwan',
  VA: 'Vatikan',
  SZ: 'Eswatini',
  TL: 'Osttimor',
  CD: 'Kongo (Kinshasa)',
  CG: 'Kongo (Brazzaville)',
  MM: 'Myanmar',
  CI: 'Elfenbeinküste',
  CV: 'Kap Verde',
  BQ: 'Bonaire, Saba, Sint Eustatius',
};

const COUNTRIES = (() => {
  let names = null;
  try {
    names = new Intl.DisplayNames(['de'], { type: 'region' });
  } catch { /* dann eben die Codes */ }

  const nameOf = (code) => {
    if (COUNTRY_NAMES[code]) return COUNTRY_NAMES[code];
    if (!names) return code;
    try {
      const found = names.of(code);
      return found && found !== code ? found : code;
    } catch {
      return code;
    }
  };

  return COUNTRY_CODES
    .map((code) => [code, nameOf(code)])
    .sort((a, b) => a[1].localeCompare(b[1], 'de'));
})();

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
    const tolerance = part.length <= 4 ? 0 : part.length <= 8 ? 1 : 2;
    return words.some((word) => {
      if (word.includes(part)) return true;
      // Ein sehr kurzes Wort darf nicht auf eine lange Eingabe passen:
      // sonst trifft "a" aus "[Á] Hotel" die Suche nach "radisso".
      if (part.includes(word) && word.length >= Math.max(4, part.length - 2)) return true;
      if (!tolerance) return false;
      if (distance(word, part) <= tolerance) return true;
      return distance(word.slice(0, part.length + tolerance), part) <= tolerance;
    });
  });
}

// Derselbe Namensvergleich wie auf dem Server: tragende Wörter ohne Füllwerk,
// und das erste Wort muss stimmen.
const NAME_FUELL = new Set([
  'hotel', 'hotels', 'the', 'by', 'a', 'member', 'of', 'and', 'und', 'resort', 'spa',
  'am', 'im', 'zum', 'zur', 'de', 'la', 'le', 'les', 'du', 'des', 'city', 'centre',
  'center', 'collection', 'individuals', 'suites', 'inn',
]);

function nameWords(text) {
  return normalize(text).split(' ').filter((w) => w.length > 2 && !NAME_FUELL.has(w));
}

function sameHotelName(a, b) {
  const x = nameWords(a);
  const y = nameWords(b);
  if (!x.length || !y.length) return false;
  if (x[0] !== y[0]) return false;
  const [klein, gross] = x.length <= y.length ? [x, new Set(y)] : [y, new Set(x)];
  return klein.every((wort) => gross.has(wort));
}

const debounce = (fn, ms = 300) => {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
};

/* --------------------------------------------------------------- Dialoge */

// Eigene Dialoge statt der Browserfenster: gleiche Optik auf jedem Gerät.
function dialog({ titel, text, ja = 'OK', nein = 'Abbrechen', eingabe = null, gefahr = false }) {
  const node = $('#dialog');
  const feld = $('#dialog-input');

  $('#dialog-title').textContent = titel;
  $('#dialog-text').textContent = text || '';
  $('#dialog-text').hidden = !text;
  $('#dialog-yes').textContent = ja;
  $('#dialog-no').textContent = nein;
  $('#dialog-no').hidden = !nein;   // ohne Beschriftung entfaellt der Knopf
  node.classList.toggle('is-danger', gefahr);

  if (eingabe) {
    feld.hidden = false;
    feld.type = eingabe.typ || 'text';
    feld.placeholder = eingabe.platzhalter || '';
    feld.value = eingabe.wert || '';
  } else {
    feld.hidden = true;
    feld.value = '';
  }

  node.showModal();
  if (eingabe) setTimeout(() => feld.focus(), 50);

  return new Promise((fertig) => {
    const schliessen = (wert) => {
      node.close();
      $('#dialog-yes').removeEventListener('click', jaKlick);
      $('#dialog-no').removeEventListener('click', neinKlick);
      feld.removeEventListener('keydown', taste);
      fertig(wert);
    };
    const jaKlick = () => schliessen(eingabe ? (feld.value.trim() || null) : true);
    const neinKlick = () => schliessen(eingabe ? null : false);
    const taste = (e) => { if (e.key === 'Enter') { e.preventDefault(); jaKlick(); } };

    $('#dialog-yes').addEventListener('click', jaKlick);
    $('#dialog-no').addEventListener('click', neinKlick);
    if (eingabe) feld.addEventListener('keydown', taste);
    node.addEventListener('cancel', (e) => { e.preventDefault(); neinKlick(); }, { once: true });
  });
}

const frage = (titel, text, ja = 'Ja', gefahr = false) =>
  dialog({ titel, text, ja, nein: 'Abbrechen', gefahr });

const eingabeDialog = (titel, text, platzhalter, typ = 'text') =>
  dialog({ titel, text, ja: 'Weiter', eingabe: { platzhalter, typ } });

// Reiner Hinweis ohne Wahl: nur ein Knopf.
const hinweis = (titel, text) => dialog({ titel, text, ja: 'Verstanden', nein: '' });

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
  state.isAdmin = Boolean(res.is_admin);
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

  $('#group-by').value = state.groupBy;
  $('#view-cards').classList.toggle('is-on', state.view === 'cards');
  $('#view-rows').classList.toggle('is-on', state.view === 'rows');
  $('#columns-menu').hidden = state.view !== 'rows';

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
  for (const view of ['stays', 'new', 'stats', 'hotel']) $('#view-' + view).hidden = view !== name;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-on', t.dataset.view === name));
  document.querySelectorAll('.topnav-btn').forEach((t) => t.classList.toggle('is-on', t.dataset.view === name));
  // Nur unsichtbar schalten, nicht entfernen – sonst rutscht die Kopfzeile um.
  $('#f-text').closest('.search-wrap').classList.toggle('is-off', name !== 'stays');
  if (name !== 'hotel') state.hotelPage = null;
  if (name === 'stats') {
    loadStats();
    $('#log-open').closest('.log-section').hidden = !state.isAdmin;
  }
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
// Klick auf die Marke bringt den Ausgangszustand zurück.
$('#brand').addEventListener('click', () => {
  for (const id of FILTER_IDS) $(id).value = '';
  $('#f-upgraded').checked = false;
  $('#f-text').value = '';
  state.groupBy = '';
  $('#group-by').value = '';
  localStorage.setItem('staylog.group', '');

  closeDetail();
  refreshPlaceSelects();
  showView('stays');
  loadStays();
  window.scrollTo({ top: 0 });
});

/* ---------------------------------------------------------- Einstellungen */

function openSettings() {
  markThemeChoice();
  $('#version-note').textContent = MY_VERSION
    ? 'Fassung ' + MY_VERSION
    : 'Fassung unbekannt';

  $('#admin-block').hidden = !state.isAdmin;
  if (state.isAdmin) loadAdminSummary();

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

async function loadAdminSummary() {
  const box = $('#admin-summary');
  box.textContent = 'Wird geladen …';
  try {
    const d = await api('/admin/summary');
    box.innerHTML = '';
    box.appendChild(el('span', null, d.aufenthalte + ' Aufenthalte · ' + d.hotels + ' Hotels · '
      + d.kategorien + ' Zimmerkategorien · ' + d.bilder + ' Bilder · ' + d.mitglieder + ' Mitglieder'));
    box.appendChild(document.createElement('br'));
    box.appendChild(el('span', null,
      'Google-Aufrufe diesen Monat: ' + d.google_monat + ' von ' + d.google_limit));
    box.appendChild(document.createElement('br'));
    box.appendChild(el('span', null,
      'Browser-Abrufe diesen Monat: ' + (d.browser_monat ?? 0) + ' von ' + (d.browser_limit ?? 0)));
  } catch (e) {
    box.textContent = e.message;
  }
}

// Zwei Stufen: nur Aufenthalte, oder zusätzlich Hotels und Kategorien.
async function adminReset(scope) {
  const was = scope === 'alles'
    ? 'ALLE Aufenthalte, Bilder, Hotels und Zimmerkategorien'
    : 'alle Aufenthalte und Bilder';

  const sicher = await frage('Unwiderruflich löschen?',
    'Es werden ' + was + ' gelöscht.\nMitglieder und Statuslevel bleiben erhalten.',
    'Löschen', true);
  if (!sicher) return;

  const admin = await eingabeDialog('Adminpasswort', 'Zur Sicherheit noch einmal das Adminpasswort.', 'Passwort', 'password');
  if (!admin) return;

  const word = await eingabeDialog('Bestätigen', 'Tipp zur Bestätigung das Wort LOESCHEN.', 'LOESCHEN');
  if (word !== 'LOESCHEN') {
    $('#admin-result').hidden = false;
    $('#admin-result').textContent = 'Abgebrochen – das Bestätigungswort stimmte nicht.';
    return;
  }

  const result = $('#admin-result');
  result.hidden = false;
  result.textContent = 'Wird gelöscht …';

  try {
    const res = await api('/admin/reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-stay-admin': admin },
      body: JSON.stringify({ scope, confirm: 'LOESCHEN' }),
    });
    result.textContent = 'Gelöscht: ' + res.geloescht + ', dazu ' + res.bilder + ' Bilder.';
    state.contextCache = {};
    loadAdminSummary();
    loadFilters();
    loadStays();
  } catch (e) {
    result.textContent = e.message;
  }
}

$('#admin-merge').addEventListener('click', async () => {
  const sicher = await frage('Doppelte Hotels zusammenführen?',
    'Aufenthalte und Zimmerkategorien wandern jeweils zum ältesten Eintrag.', 'Zusammenführen');
  if (!sicher) return;

  const result = $('#admin-result');
  result.hidden = false;
  result.textContent = 'Wird geprüft …';
  try {
    const res = await api('/admin/merge', { method: 'POST' });
    const liste = res.zusammengefuehrt;
    result.textContent = liste.length
      ? liste.length + ' Doppelgänger zusammengeführt: '
        + liste.map((e) => e.name + ' (' + e.entfernt + ' → ' + e.behalten + ')').join(', ')
      : 'Keine Doppelgänger gefunden.';
    state.contextCache = {};
    state.imageCache = {};
    loadAdminSummary();
    loadFilters();
    loadStays();
  } catch (e) {
    result.textContent = e.message;
  }
});

$('#admin-reset-stays').addEventListener('click', () => adminReset('aufenthalte'));
$('#admin-reset-all').addEventListener('click', () => adminReset('alles'));

$('#logout').addEventListener('click', async () => {
  if (state.guest) { signOut(); return; }
  if (await frage('Abmelden?', 'Das Passwort wird auf diesem Gerät vergessen.', 'Abmelden')) signOut();
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
    hotels.push({
      value: String(p.hotel_id),
      label: p.hotel_name + (p.stays > 1 ? '  (' + p.stays + ')' : ''),
    });
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

function setView(mode) {
  state.view = mode;
  localStorage.setItem('staylog.view', mode);
  $('#view-cards').classList.toggle('is-on', mode === 'cards');
  $('#view-rows').classList.toggle('is-on', mode === 'rows');
  $('#columns-menu').hidden = mode !== 'rows';
  $('#columns-list').hidden = true;
  renderStayList();
}

$('#columns-open').addEventListener('click', (e) => {
  e.stopPropagation();
  const box = $('#columns-list');
  if (box.hidden) buildColumnsMenu();
  box.hidden = !box.hidden;
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#columns-menu')) $('#columns-list').hidden = true;
});
$('#view-cards').addEventListener('click', () => setView('cards'));
$('#view-rows').addEventListener('click', () => setView('rows'));

$('#group-by').addEventListener('change', () => {
  state.groupBy = $('#group-by').value;
  localStorage.setItem('staylog.group', state.groupBy);
  renderStayList();
});

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

  if (state.view === 'rows') sortStays(list);

  box.innerHTML = '';
  // Der äußere Behälter ordnet nichts an – das machen die Blöcke darin.
  box.className = state.view === 'rows' ? 'rows' : 'grouped';

  if (!list.length) {
    box.appendChild(el('p', 'empty', state.stays.length
      ? 'Kein Aufenthalt passt zu diesen Filtern.'
      : 'Noch nichts eingetragen. Fang mit deinem letzten Aufenthalt an.'));
    return;
  }

  if (!state.groupBy) {
    box.appendChild(renderBatch(list));
    return;
  }

  for (const [label, entries] of groupStays(list)) {
    const head = el('div', 'group-head');
    head.appendChild(el('h3', null, label));
    head.appendChild(el('span', 'n', entries.length + (entries.length === 1 ? ' Aufenthalt' : ' Aufenthalte')));
    box.appendChild(head);
    box.appendChild(renderBatch(entries));
  }
}

// Gruppen in sinnvoller Reihenfolge: Jahre absteigend, sonst nach Menge.
function groupStays(list) {
  const keyOf = {
    country: (s) => s.country || 'ohne Land',
    city: (s) => s.city || 'ohne Stadt',
    hotel: (s) => s.hotel_name,
    program: (s) => s.program || 'ohne Programm',
    status: (s) => s.status_level || 'ohne Status',
    author: (s) => s.author,
    year: (s) => (s.checkin ? s.checkin.slice(0, 4) : 'ohne Datum'),
  }[state.groupBy];

  const map = new Map();
  for (const s of list) {
    const key = keyOf(s);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(s);
  }
  const entries = [...map.entries()];
  if (state.groupBy === 'year') entries.sort((a, b) => b[0].localeCompare(a[0]));
  else entries.sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  return entries;
}

// Ein Block Aufenthalte, je nach Ansicht als Kacheln oder als Zeilen.
function renderBatch(entries) {
  const wrap = document.createDocumentFragment();
  if (state.view === 'rows') {
    wrap.appendChild(rowsHeader());
    let vorher = null;
    for (const s of entries) {
      wrap.appendChild(renderStayRow(s, vorher));
      vorher = s.hotel_id;
    }
  } else {
    const grid = el('div', 'stay-list');
    for (const s of entries) grid.appendChild(renderStayCard(s));
    wrap.appendChild(grid);
  }
  return wrap;
}

// Spalten der Listenansicht. "breite" geht in das Raster, "sort" in die Sortierung.
const COLUMNS = [
  { key: 'hotel',   label: 'Hotel',                 breite: 'minmax(0, 2.2fr)', sort: (s) => (s.hotel_name || '').toLowerCase() },
  { key: 'city',    label: 'Ort',                   breite: 'minmax(0, 1.1fr)', sort: (s) => (s.city || '').toLowerCase() },
  { key: 'date',    label: 'Zeitraum',              breite: '118px',            sort: (s) => s.checkin || '' },
  { key: 'program', label: 'Programm',              breite: 'minmax(0, 1.5fr)', sort: (s) => [s.program, s.status_level].filter(Boolean).join(' ').toLowerCase() },
  { key: 'rooms',   label: 'Gebucht → Erhalten',    breite: 'minmax(0, 2fr)',   sort: (s) => (s.received_room || '').toLowerCase() },
  { key: 'step',    label: 'Upgrade',   rechts: true, breite: '88px',           sort: (s) => (s.upgrade_steps == null ? -99 : s.upgrade_steps) },
  { key: 'price',   label: 'Preis',     rechts: true, breite: '86px',           sort: (s) => (s.price == null ? -1 : s.price) },
  { key: 'author',  label: 'Person',    aus: true,  breite: 'minmax(0, 1fr)',   sort: (s) => (s.author || '').toLowerCase() },
  { key: 'nights',  label: 'Nächte',    aus: true, rechts: true, breite: '74px', sort: (s) => (s.nights || 0) },
];

// Was gerade sichtbar ist. Standard: alles außer den abgewählten.
function visibleColumns() {
  const gespeichert = state.columns;
  const nachGruppe = { city: 'city', hotel: 'hotel', author: 'author' }[state.groupBy];

  return COLUMNS.filter((c) => {
    if (gespeichert) return gespeichert.includes(c.key);
    return !c.aus;
  }).filter((c) => c.key !== nachGruppe);   // die Gruppenspalte wäre nur Wiederholung
}

function applyColumnWidths(node) {
  node.style.setProperty('--cols', visibleColumns().map((c) => c.breite).join(' '));
}

function sortStays(list) {
  const spalte = COLUMNS.find((c) => c.key === state.sort.key) || COLUMNS[2];
  const factor = state.sort.dir === 'asc' ? 1 : -1;
  list.sort((a, b) => {
    const x = spalte.sort(a);
    const y = spalte.sort(b);
    if (x === y) return 0;
    return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y))) * factor;
  });
}

function rowsHeader() {
  const head = el('div', 'rows-head');
  applyColumnWidths(head);

  for (const spalte of visibleColumns()) {
    const cell = el('span', (spalte.rechts ? 'right ' : '') + 'col-' + spalte.key);
    const button = el('button', state.sort.key === spalte.key ? 'sorted' : null);
    button.type = 'button';
    button.appendChild(document.createTextNode(spalte.label));
    if (state.sort.key === spalte.key) {
      button.appendChild(el('span', null, state.sort.dir === 'asc' ? '▲' : '▼'));
    }
    button.addEventListener('click', () => {
      if (state.sort.key === spalte.key) state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
      else state.sort = { key: spalte.key, dir: ['date', 'step', 'price', 'nights'].includes(spalte.key) ? 'desc' : 'asc' };
      renderStayList();
    });
    cell.appendChild(button);
    head.appendChild(cell);
  }
  return head;
}

// Menü zur Spaltenwahl
function buildColumnsMenu() {
  const box = $('#columns-list');
  box.innerHTML = '';
  const aktiv = new Set(visibleColumns().map((c) => c.key));

  for (const spalte of COLUMNS) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = aktiv.has(spalte.key) || (state.columns || []).includes(spalte.key);
    input.addEventListener('change', () => {
      const gewaehlt = state.columns
        ? [...state.columns]
        : COLUMNS.filter((c) => !c.aus).map((c) => c.key);
      const ohne = gewaehlt.filter((k) => k !== spalte.key);
      state.columns = input.checked ? [...ohne, spalte.key] : ohne;
      // Reihenfolge wie in COLUMNS beibehalten
      state.columns = COLUMNS.filter((c) => state.columns.includes(c.key)).map((c) => c.key);
      localStorage.setItem('staylog.columns', JSON.stringify(state.columns));
      renderStayList();
    });
    label.appendChild(input);
    label.appendChild(document.createTextNode(spalte.label));
    box.appendChild(label);
  }
}

function renderStayRow(s, vorherigesHotel) {
  const row = el('button', 'row' + (state.selected === s.id ? ' is-on' : ''));
  row.type = 'button';
  applyColumnWidths(row);

  const zellen = {
    hotel: () => {
      // Dasselbe Haus in Folge nur einmal ausschreiben.
      const wiederholt = vorherigesHotel === s.hotel_id;
      return el('span', 'r-hotel' + (wiederholt ? ' is-repeat' : ''),
        wiederholt ? '↳' : s.hotel_name);
    },
    city: () => el('span', 'r-muted', s.city || ''),
    date: () => el('span', 'r-when', stayDates(s)),
    program: () => el('span', 'r-badges r-muted', [s.program, s.status_level].filter(Boolean).join(' · ')),
    rooms: () => {
      const flow = el('span', 'r-flow');
      flow.appendChild(el('span', 'r-muted', s.booked_room || '–'));
      flow.appendChild(el('span', 'r-arrow', flowArrow(s.upgrade_steps)));
      flow.appendChild(el('span', null, s.received_room || '–'));
      return flow;
    },
    step: () => {
      const step = el('span', 'r-step' + (s.upgrade_steps > 0 ? ' up' : s.upgrade_steps < 0 ? ' down' : ''));
      step.textContent = s.upgrade_steps == null ? '–'
        : s.upgrade_steps === 0 ? 'keins' : (s.upgrade_steps > 0 ? '+' : '') + s.upgrade_steps;
      return step;
    },
    price: () => el('span', 'r-price', s.price != null ? formatMoney(s.price, s.currency) : ''),
    author: () => el('span', 'r-muted', s.author || ''),
    nights: () => el('span', 'r-price', s.nights ? String(s.nights) : ''),
  };

  for (const spalte of visibleColumns()) {
    const zelle = zellen[spalte.key]();
    // Leere Nebenzellen würden auf dem Handy eine leere Zeile erzeugen.
    if (!zelle.textContent.trim() && !['hotel', 'step'].includes(spalte.key)) continue;
    row.appendChild(zelle);
  }

  row.addEventListener('click', () => {
    state.selected = s.id;
    renderStayList();
    showDetail(s);
  });
  return row;
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
  box.appendChild(el('h4', null, 'Hotels'));
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

  const info = hotelCount(s.hotel_id);
  if (info && info.stays > 1) {
    const more = el('button', 'stay-more');
    more.type = 'button';
    more.textContent = info.stays + ' Aufenthalte hier'
      + (info.people > 1 ? ' · ' + info.people + ' Personen' : '');
    more.addEventListener('click', (e) => { e.stopPropagation(); showHotel(s.hotel_id); });
    card.appendChild(more);
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
  const arrow = el('span', 'flow-arrow', flowArrow(s.upgrade_steps));
  if (s.upgrade_steps > 0) arrow.className = 'flow-arrow flow-up';
  if (s.upgrade_steps < 0) arrow.className = 'flow-arrow flow-down';
  mid.appendChild(arrow);
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

// Hoch bei Upgrade, runter bei Downgrade, waagerecht wenn sich nichts tut.
function flowArrow(steps) {
  if (steps == null) return '→';
  if (steps > 0) return '↑';
  if (steps < 0) return '↓';
  return '→';
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

// Wie oft wurde dieses Haus insgesamt gemeldet?
function hotelCount(hotelId) {
  return state.places.find((p) => p.hotel_id === hotelId) || null;
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
  $('#detail-veil').classList.remove('is-open');
  state.selected = null;
  renderStayList();
  $('#detail-body').innerHTML = '';
  $('#detail-body').appendChild(el('p', 'detail-placeholder', 'Wähle einen Aufenthalt, um alles dazu zu sehen.'));
}
$('#detail-close').addEventListener('click', closeDetail);
$('#detail-veil').addEventListener('click', closeDetail);

function detailHead() {
  const head = el('div', 'detail-head');
  const close = el('button', 'icon-btn');
  close.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" '
    + 'stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M6 6 18 18M18 6 6 18"/></svg>';
  close.type = 'button';
  close.title = 'Schließen';
  close.setAttribute('aria-label', 'Schließen');
  close.addEventListener('click', closeDetail);
  head.appendChild(close);
  return head;
}

function showDetail(s) {
  const box = $('#detail-body');
  box.innerHTML = '';
  box.appendChild(detailHead());
  $('#detail-pane').classList.add('is-open');
  $('#detail-veil').classList.add('is-open');

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
  facts.appendChild(el('h4', null, 'Aufenthalt'));
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
    section.appendChild(el('h4', null, 'Benefits'));
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
    section.appendChild(el('h4', null, 'Erfahrungsbericht'));
    section.appendChild(el('p', 'detail-notes', s.notes));
    box.appendChild(section);
  }

  if (s.photos?.length) {
    const section = el('div', 'detail-section');
    section.appendChild(el('h4', null, 'Fotos'));
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
    const del = el('button', 'link-btn danger', 'Löschen');
    del.addEventListener('click', async () => {
      if (!await frage('Aufenthalt löschen?',
        'Der Eintrag und seine Fotos werden entfernt.', 'Löschen', true)) return;
      await api('/stays/' + s.id, { method: 'DELETE' });
      state.contextCache = {};
      closeDetail();
      loadStays();
      loadFilters();
    });
    actions.appendChild(del);
  }
  box.appendChild(actions);

  const context = el('div', 'detail-section', '');
  context.id = 'detail-context';
  box.appendChild(context);
  loadHotelContext(s);
}

// Was andere in diesem Haus erlebt haben – direkt neben dem eigenen Aufenthalt.
async function loadHotelContext(stay) {
  const box = $('#detail-context');
  if (!box) return;

  let data = state.contextCache[stay.hotel_id];
  if (!data) {
    try {
      data = await api('/hotels/' + stay.hotel_id + '/community');
      state.contextCache[stay.hotel_id] = data;
    } catch {
      return;
    }
  }
  if (!document.body.contains(box)) return;

  box.innerHTML = '';
  box.appendChild(el('h4', null, 'In diesem Haus'));

  const bilder = el('div', 'hotel-gallery-slot');
  box.appendChild(bilder);
  loadHotelGallery(stay.hotel_id, bilder, stay.hotel_name);

  const grid = el('div', 'mini-kpis');
  const mini = (num, label) => {
    const cell = el('div', 'mini-kpi');
    cell.appendChild(el('div', 'num', num));
    cell.appendChild(el('div', 'lbl', label));
    grid.appendChild(cell);
  };
  mini(String(data.stays), data.stays === 1 ? 'Aufenthalt' : 'Aufenthalte');
  mini(String(data.people), data.people === 1 ? 'Person' : 'Personen');
  if (data.stays >= 3 && data.upgrade_quote != null) mini(data.upgrade_quote + ' %', 'Upgradequote');
  if (data.avg_steps != null) mini((data.avg_steps > 0 ? '+' : '') + comma(data.avg_steps), 'Ø Kategorien');
  box.appendChild(grid);

  const others = data.alle.filter((s) => s.id !== stay.id);
  if (others.length) {
    box.appendChild(el('h4', null, 'Weitere Aufenthalte hier'));
    const list = el('div', 'mini-list');
    for (const s of others.slice(0, 8)) list.appendChild(miniStayRow(s));
    box.appendChild(list);
    if (others.length > 8) {
      box.appendChild(el('p', 'sample-note', 'und ' + (others.length - 8) + ' weitere'));
    }
  }

  if (data.benefits.length) {
    box.appendChild(el('h4', null, 'Was es hier häufig gab'));
    for (const b of data.benefits.slice(0, 4)) box.appendChild(benefitBar(b, data.stays));
  }

  const more = el('button', 'btn btn-quiet wide', 'Alles zu diesem Hotel');
  more.type = 'button';
  more.style.marginTop = '18px';
  more.addEventListener('click', () => { closeDetail(); showHotel(stay.hotel_id); });
  box.appendChild(more);
}

// Kompakte Zeile: wer, wann, welches Upgrade.
function miniStayRow(s) {
  const row = el('button', 'mini-row');
  row.type = 'button';

  const left = el('div');
  const who = el('div', 'who');
  who.appendChild(el('span', 'avatar', initials(s.author)));
  who.appendChild(document.createTextNode(s.author));
  if (s.status_level) {
    const badge = el('span', 'badge badge-status', s.status_level);
    badge.style.background = statusColor(s.status_level);
    who.appendChild(badge);
  }
  left.appendChild(who);
  left.appendChild(el('div', 'mini-when', stayDates(s)));
  left.appendChild(el('div', 'mini-rooms',
    (s.booked_room || '–') + '  ' + flowArrow(s.upgrade_steps) + '  ' + (s.received_room || '–')));
  row.appendChild(left);

  const step = el('span', 'r-step' + (s.upgrade_steps > 0 ? ' up' : s.upgrade_steps < 0 ? ' down' : ''));
  step.textContent = s.upgrade_steps == null ? '–'
    : s.upgrade_steps === 0 ? 'keins' : (s.upgrade_steps > 0 ? '+' : '') + s.upgrade_steps;
  row.appendChild(step);

  row.addEventListener('click', () => {
    state.selected = s.id;
    renderStayList();
    showDetail(s);
  });
  return row;
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
  else navigator.clipboard.writeText(text)
    .then(() => dialog({ titel: 'Kopiert', text: 'Der Text liegt in der Zwischenablage.', ja: 'Gut', nein: '' }));
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
  $('#s-checkout').min = stay.checkin || '';
  state.checkoutTouched = Boolean(stay.checkout);
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

// Bearbeiten abbrechen und Eingabe verwerfen führen beide zurück zur Übersicht.
async function verwerfen() {
  const etwasDrin = state.hotel || state.pendingPhotos.length || $('#s-notes').value.trim();
  if (etwasDrin && !await frage('Eingaben verwerfen?',
    'Was du bisher eingetragen hast, geht verloren.', 'Verwerfen', true)) return;
  resetPicker();
  showView('stays');
}

$('#edit-cancel').addEventListener('click', verwerfen);
$('#form-cancel').addEventListener('click', verwerfen);

/* ------------------------------------------------------- Hotel-Detailseite */

// Beantwortet: Was bringt mein Status in genau diesem Haus?
async function showHotel(hotelId) {
  const box = $('#hotel-page');
  state.hotelPage = hotelId;
  showView('hotel');
  box.innerHTML = '';
  box.appendChild(el('p', 'empty', 'Wird geladen …'));

  try {
    const data = await api('/hotels/' + hotelId + '/community');
    if (state.hotelPage !== hotelId) return;
    box.innerHTML = '';

    box.appendChild(el('h1', 'hotel-title', data.hotel.name));
    box.appendChild(el('p', 'hotel-sub', [data.hotel.city, data.hotel.country].filter(Boolean).join(', ')));

    const badges = el('div', 'badge-row');
    if (data.hotel.program) badges.appendChild(el('span', 'badge', data.hotel.program));
    if (data.hotel.lounge === 1) badges.appendChild(el('span', 'badge', 'Lounge vorhanden'));
    if (badges.children.length) box.appendChild(badges);

    // Bilder direkt unter den Namen, danach Beschreibung und Links.
    const bilder = el('div', 'hotel-gallery-slot');
    box.appendChild(bilder);
    loadHotelGallery(hotelId, bilder, data.hotel.name);

    if (data.hotel.description) {
      const desc = el('p', 'hotel-desc', data.hotel.description);
      desc.style.marginTop = '16px';
      box.appendChild(desc);
    }

    const links = el('div', 'hotel-links');
    if (data.hotel.address) links.appendChild(el('span', null, data.hotel.address));
    if (data.hotel.website) {
      const a = el('a', null, 'Hotelseite');
      a.href = data.hotel.website; a.target = '_blank'; a.rel = 'noopener';
      links.appendChild(a);
    }
    if (links.children.length) box.appendChild(links);

    // Kennzahlen
    const kpis = section('Überblick');
    const grid = el('div', 'hotel-kpis');
    const kpi = (num, label) => {
      const cell = el('div', 'kpi');
      cell.appendChild(el('div', 'num', num));
      cell.appendChild(el('div', 'lbl', label));
      grid.appendChild(cell);
    };
    kpi(String(data.stays), data.stays === 1 ? 'Aufenthalt' : 'Aufenthalte');
    kpi(String(data.people), data.people === 1 ? 'Person' : 'Personen');
    if (data.stays >= 3) {
      kpi(data.upgrade_quote != null ? data.upgrade_quote + ' %' : '–', 'Upgradequote');
      kpi(data.suite_quote != null ? data.suite_quote + ' %' : '–', 'Suite-Upgrades');
    }
    if (data.avg_steps != null) kpi((data.avg_steps > 0 ? '+' : '') + comma(data.avg_steps), 'Ø Kategorien');
    kpis.appendChild(grid);
    if (data.stays < 3) {
      kpis.appendChild(el('p', 'sample-note', data.stays === 1
        ? 'Ein gemeldeter Aufenthalt. Für Quoten ist die Basis zu klein.'
        : data.stays + ' gemeldete Aufenthalte. Für Quoten ist die Basis zu klein.'));
    }
    box.appendChild(kpis);

    // Alle Aufenthalte: wer, wann, was bekommen
    const table = section('Aufenthalte im Detail');
    const scroll = el('div', 'table-scroll');
    const t = document.createElement('table');
    t.className = 'stay-table';

    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    for (const h of ['Datum', 'Person', 'Status', 'Zimmer gebucht → erhalten', 'Upgrade', 'Benefits', 'Preis']) {
      hr.appendChild(el('th', null, h));
    }
    thead.appendChild(hr);
    t.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const s of data.alle) tbody.appendChild(hotelStayRow(s));
    t.appendChild(tbody);
    scroll.appendChild(t);
    scroll.classList.add('only-wide');
    table.appendChild(scroll);

    // Auf schmalen Bildschirmen dieselben Daten gestapelt statt als Tabelle.
    const narrow = el('div', 'mini-list only-narrow');
    for (const s of data.alle) narrow.appendChild(miniStayRow(s));
    table.appendChild(narrow);

    box.appendChild(table);

    // Zwei Spalten: Statuslevel und Benefits
    const cols = el('div', 'hotel-cols');
    cols.style.marginTop = '34px';

    if (data.by_status.length) {
      const left = el('div');
      left.appendChild(el('h3', null, 'Nach Statuslevel'));
      for (const g of data.by_status) {
        const row = el('div', 'status-line');
        const info = el('div');
        if (g.status) {
          const badge = el('span', 'badge badge-status', g.status);
          badge.style.background = statusColor(g.status);
          info.appendChild(badge);
        } else {
          info.appendChild(el('span', null, g.label));
        }
        info.appendChild(el('div', 'sample-note',
          'basierend auf ' + g.stays + (g.stays === 1 ? ' Aufenthalt' : ' Aufenthalten')
          + (g.avg_steps != null ? ' · Ø ' + (g.avg_steps > 0 ? '+' : '') + comma(g.avg_steps) + ' Kategorien' : '')));
        row.appendChild(info);

        const quote = el('div', 'quote-block');
        if (g.stays >= 3 && g.upgrade_quote != null) {
          quote.appendChild(el('div', 'quote', g.upgrade_quote + ' %'));
          quote.appendChild(el('div', 'sample-note', 'mit Upgrade'));
        } else {
          quote.appendChild(el('div', 'quote', g.upgraded + ' von ' + g.stays));
          quote.appendChild(el('div', 'sample-note', 'mit Upgrade'));
        }
        row.appendChild(quote);
        left.appendChild(row);
      }
      cols.appendChild(left);
    }

    const right = el('div');
    if (data.pairs.length) {
      right.appendChild(el('h3', null, 'Häufige Upgrades'));
      for (const pair of data.pairs) {
        const row = el('div', 'pair');
        const rooms = el('div', 'pair-rooms');
        rooms.appendChild(el('div', null, pair.booked));
        rooms.appendChild(el('div', 'to', flowArrow(pair.steps) + ' ' + pair.received));
        row.appendChild(rooms);
        row.appendChild(el('span', 'pair-count', pair.count + '× gemeldet'));
        right.appendChild(row);
      }
    }
    if (right.children.length) cols.appendChild(right);
    if (cols.children.length) box.appendChild(cols);

    if (data.benefits.length) {
      const benefits = section('Benefits');
      for (const b of data.benefits) benefits.appendChild(benefitBar(b, data.stays));
      box.appendChild(benefits);
    }
  } catch (e) {
    box.innerHTML = '';
    box.appendChild(el('p', 'empty', e.message));
  }
}

// Füllt einen Platzhalter mit Bewertung und Bildern, sobald sie da sind.
async function loadHotelGallery(hotelId, slot, name) {
  try {
    const data = await hotelImages(hotelId);
    if (!document.body.contains(slot)) return;

    const line = ratingLine(data);
    if (line) slot.appendChild(line);

    const strip = galleryStrip(data, name);
    if (strip) slot.appendChild(strip);
  } catch { /* ohne Bilder geht es auch */ }
}

function section(title) {
  const node = el('section', 'hotel-section');
  node.appendChild(el('h3', null, title));
  return node;
}

// Eine Zeile der Hoteltabelle: wer, wann, welches Upgrade, welche Benefits.
function hotelStayRow(s) {
  const tr = document.createElement('tr');

  tr.appendChild(el('td', 'c-when', stayDates(s)));

  const who = document.createElement('td');
  const person = el('div', 'who');
  person.appendChild(el('span', 'avatar', initials(s.author)));
  person.appendChild(document.createTextNode(s.author));
  who.appendChild(person);
  tr.appendChild(who);

  const status = document.createElement('td');
  if (s.status_level) {
    const badge = el('span', 'badge badge-status', s.status_level);
    badge.style.background = statusColor(s.status_level);
    status.appendChild(badge);
  } else {
    status.appendChild(el('span', 'r-muted', '–'));
  }
  tr.appendChild(status);

  const flow = el('td', 'c-flow');
  flow.appendChild(el('div', 'r-muted', s.booked_room || '–'));
  flow.appendChild(el('div', null,
    (s.received_room ? flowArrow(s.upgrade_steps) + ' ' : '') + (s.received_room || '')));
  tr.appendChild(flow);

  const step = el('td', 'c-step' + (s.upgrade_steps > 0 ? ' up' : s.upgrade_steps < 0 ? ' down' : ''));
  step.textContent = s.upgrade_steps == null ? '–'
    : s.upgrade_steps === 0 ? 'keins' : (s.upgrade_steps > 0 ? '+' : '') + s.upgrade_steps;
  tr.appendChild(step);

  const benefits = document.createElement('td');
  const pills = el('div', 'benefits');
  for (const b of s.benefits || []) {
    const pill = el('span', 'pill');
    pill.appendChild(document.createTextNode(b.name + (b.value ? ' ' + b.value : '')));
    pills.appendChild(pill);
  }
  benefits.appendChild(pills);
  tr.appendChild(benefits);

  tr.appendChild(el('td', 'c-step', s.price != null ? formatMoney(s.price, s.currency) : ''));

  tr.addEventListener('click', () => {
    showView('stays');
    state.selected = s.id;
    const known = state.stays.find((x) => x.id === s.id);
    renderStayList();
    showDetail(known || s);
  });
  return tr;
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
  if (total >= 3) row.appendChild(el('div', 'sample-note', 'Basis: ' + total + ' Aufenthalte'));
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
    count.textContent = state.hotelCandidates.length
      ? state.hotelCandidates.length + ' im Umkreis'
      : 'keine im Umkreis – tipp den Namen';
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

  // Reihenfolge: was stayLOG kennt, dann Googles aktuelle Namen, dann der Umkreis.
  const bekannt = state.hotelCandidates.filter((h) => h.known);
  const umkreis = state.hotelCandidates.filter((h) => !h.known);

  const merged = [];
  const passt = (h) => !q || fuzzyMatch(h.name, q);

  const aufnehmen = (liste, mitFilter) => {
    for (const h of liste) {
      if (mitFilter && !passt(h)) continue;
      // Derselbe Name oder dasselbe Haus unter anderem Namen: nur einmal zeigen.
      if (merged.some((v) => normalize(v.name) === normalize(h.name)
        || sameHotelName(v.name, h.name))) continue;
      merged.push(h);
    }
  };

  aufnehmen(bekannt, true);
  aufnehmen(extra, false);
  aufnehmen(umkreis, true);

  box.innerHTML = '';
  if (!merged.length) {
    box.appendChild(el('p', 'options-empty', q
      ? 'Nichts gefunden. Probier eine andere Schreibweise oder such nach der Marke.'
      : 'Keine Hotels im Umkreis gefunden.'));
    return;
  }

  for (const h of merged.slice(0, 40)) {
    const b = el('button', 'option');
    b.type = 'button';

    const label = el('span');
    label.appendChild(document.createTextNode(h.name));
    if (h.known) label.appendChild(el('span', 'known-mark', 'in stayLOG'));
    else if (h.aktuell) label.appendChild(el('span', 'known-mark aktuell', 'aktuell'));
    if (h.local_name) {
      label.appendChild(document.createElement('br'));
      label.appendChild(el('span', 'local-name', h.local_name));
    }
    b.appendChild(label);
    b.appendChild(el('small', null, [h.place, h.program || h.brand].filter(Boolean).join(' · ')
      || h.street || ''));
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
}, 500);

$('#p-hotel').addEventListener('input', () => { renderHotelOptions([]); searchHotelByName(); });

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

  if (state.hotel.enrich_status === 'pending') runEnrichment();
  else { watchEnrichment(); loadGallery(); }
}

// Der Browser stösst die Recherche an und wartet auf das Ergebnis.
async function runEnrichment() {
  const hotelId = state.hotel.id;
  state.pollStarted = Date.now();
  state.pollGaveUp = false;
  state.hotel.enrich_status = 'running';
  renderRooms();
  renderChosenHotel();

  // Zaehlt die Sekunden im Wartetext hoch.
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(() => {
    if (state.hotel?.id === hotelId && state.hotel.enrich_status === 'running') renderRooms();
    else clearInterval(state.pollTimer);
  }, 4000);

  try {
    const res = await api('/hotels/' + hotelId + '/enrich?wait=1', { method: 'POST' });
    if (state.hotel?.id !== hotelId) return;
    state.hotel = res.hotel;
    state.rooms = res.rooms;
  } catch {
    if (state.hotel?.id !== hotelId) return;
    state.hotel.enrich_status = 'failed';
    state.pollGaveUp = true;
  } finally {
    clearInterval(state.pollTimer);
    if (state.hotel?.id === hotelId) {
      renderChosenHotel();
      applyHotelProgram();
      renderRooms();
      loadGallery();
    }
  }
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
  state.checkoutTouched = false;
  const heute = new Date();
  $('#s-checkin').valueAsDate = heute;
  $('#s-checkout').value = tagDanach($('#s-checkin').value);
  $('#s-checkout').min = $('#s-checkin').value;
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

  // Auf dem Handy zugeklappt, damit das Formular oben bleibt.
  $('#hotel-more').open = window.innerWidth > 700;

  $('#chosen-name').textContent = hotel.name;
  $('#chosen-place').textContent = [hotel.city, hotel.country].filter(Boolean).join(', ');

  const desc = $('#chosen-desc');
  desc.textContent = hotel.description || '';
  desc.hidden = !hotel.description;

  const links = $('#chosen-links');
  links.innerHTML = '';

  // Solange recherchiert wird, sagen wir das – statt eine leere Karte zu zeigen.
  const busy = !state.skipEnrichment && ['pending', 'running'].includes(hotel.enrich_status);
  if (busy && !hotel.address && !hotel.website) {
    const wait = el('span', null, 'Adresse, Beschreibung und Bilder werden recherchiert …');
    links.appendChild(wait);
  }

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

// Holt Bilder und Bewertung eines Hotels. Beides liegt in der Datenbank,
// der Zwischenspeicher spart nur den Netzweg innerhalb einer Sitzung.
async function hotelImages(hotelId) {
  if (state.imageCache[hotelId]) return state.imageCache[hotelId];
  const data = await api('/hotels/' + hotelId + '/images');
  state.imageCache[hotelId] = data;
  return data;
}

// Baut eine Bilderreihe. Gibt null zurück, wenn es nichts zu zeigen gibt.
function galleryStrip(data, alt) {
  if (!data.photos?.length) return null;
  const strip = el('div', 'gallery');
  for (const img of data.photos) {
    const fig = document.createElement('figure');
    const image = document.createElement('img');
    image.src = img.thumb;
    image.alt = alt;
    image.loading = 'lazy';
    image.addEventListener('error', () => fig.remove());
    fig.appendChild(image);

    const credit = el('figcaption');
    const parts = [img.author, img.license].filter(Boolean).join(' · ');
    if (img.page) {
      const a = el('a', null, parts || 'Quelle');
      a.href = img.page;
      a.target = '_blank';
      a.rel = 'noopener';
      credit.appendChild(a);
    } else {
      credit.textContent = parts;
    }
    fig.appendChild(credit);
    strip.appendChild(fig);
  }
  return strip;
}

// Bewertung als Sterne mit Anzahl.
function ratingLine(data) {
  if (data.rating == null) return null;
  const line = el('p', 'rating');
  const full = Math.round(data.rating);
  line.appendChild(el('span', 'stars', '★'.repeat(full) + '☆'.repeat(5 - full)));
  line.appendChild(el('span', null, ' ' + data.rating.toFixed(1)));
  if (data.rating_count) line.appendChild(el('span', 'n', ' · ' + data.rating_count + ' Bewertungen bei Google'));
  if (data.maps_uri) {
    const a = el('a', null, ' ansehen');
    a.href = data.maps_uri;
    a.target = '_blank';
    a.rel = 'noopener';
    line.appendChild(a);
  }
  return line;
}

async function loadGallery() {
  const box = $('#chosen-gallery');
  const rating = $('#chosen-rating');
  box.innerHTML = '';
  rating.hidden = true;
  document.querySelectorAll('.gallery-note').forEach((n) => n.remove());
  if (!state.hotel) return;

  if (['pending', 'running'].includes(state.hotel.enrich_status)) return;

  try {
    const data = await hotelImages(state.hotel.id);

    const line = ratingLine(data);
    if (line) {
      rating.replaceWith(line);
      line.id = 'chosen-rating';
      line.hidden = false;
    }

    const strip = galleryStrip(data, state.hotel.name);
    if (strip) box.replaceWith(strip), strip.id = 'chosen-gallery';

    if (data.limit_erreicht) {
      $('#chosen-gallery').insertAdjacentElement('afterend', el('p', 'gallery-note',
        'Das monatliche Limit für Bilddienste ist erreicht. Ab dem Ersten geht es weiter.'));
    } else if (!strip && data.google_aktiv) {
      $('#chosen-gallery').insertAdjacentElement('afterend', el('p', 'gallery-note',
        'Zu diesem Haus wurden keine Bilder gefunden.'));
    }
  } catch { /* ohne Bilder geht es auch */ }
}

/* --------------------------------------------------------- Zimmerkategorien */

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

  const waitSlot = $('#rooms-wait-slot');
  waitSlot.innerHTML = '';

  if (busy) {
    const seconds = state.pollStarted ? Math.round((Date.now() - state.pollStarted) / 1000) : 0;
    status.textContent = state.pollGaveUp ? 'abgebrochen' : 'läuft …';

    // Die Animation steht sichtbar im Zimmerblock, nicht im zugeklappten Bereich.
    const wait = el('div', 'rooms-wait');
    if (!state.pollGaveUp) wait.appendChild(keycardAnimation());

    const texts = el('div');
    if (state.pollGaveUp) {
      texts.appendChild(el('div', 'rooms-step', 'Die Recherche antwortet nicht mehr.'));
      texts.appendChild(el('div', 'rooms-wait-note',
        'Trag die Kategorien unten selbst ein oder versuch es später noch einmal.'));
    } else {
      texts.appendChild(el('div', 'rooms-step', waitingLine(seconds)));
      texts.appendChild(el('div', 'rooms-wait-note',
        seconds > 45
          ? 'Dauert bei diesem Haus länger als üblich (' + seconds + ' Sekunden). Du kannst jederzeit selbst eintragen.'
          : 'Das kann einen Moment dauern. Du kannst den Rest schon ausfüllen.'));
    }
    wait.appendChild(texts);
    waitSlot.appendChild(wait);

    // Bewusst kein Knopf zum Überspringen: wer wartet, bekommt die echten
    // Kategorien des Hauses. Nach einem Abbruch geht es unten von Hand weiter.
    if (state.pollGaveUp) {
      const selbst = el('button', 'btn btn-quiet', 'Kategorien selbst eintragen');
      selbst.type = 'button';
      selbst.addEventListener('click', () => {
        state.skipEnrichment = true;
        state.pollGaveUp = false;
        clearInterval(state.pollTimer);
        renderRooms();
        $('#rooms-box').open = true;
        $('#room-new').focus();
      });
      waitSlot.appendChild(selbst);
    }

    fillRoomSelects([], state.pollGaveUp ? 'Recherche abgebrochen' : 'wird recherchiert …');
    updateRefreshNote();
    return;
  }

  const found = state.rooms.length;
  const rooms = state.rooms;

  const vorlaeufig = rooms.some((r) => r.provisional === 1);

  if (found) {
    status.innerHTML = '';
    status.appendChild(el('span', vorlaeufig ? 'rooms-provisional' : 'rooms-found',
      (vorlaeufig ? '◌ ' : '✓ ') + found + (found === 1 ? ' Kategorie' : ' Kategorien')
      + (vorlaeufig ? ' vorläufig' : ' gefunden')));

    if (vorlaeufig) {
      list.appendChild(el('p', 'rooms-hint',
        'Die offizielle Seite gibt keine Zimmerliste her. Diese Namen stammen von einem '
        + 'Buchungsportal und können vom Hotel abweichen. Wer die richtigen Bezeichnungen '
        + 'kennt, klickt einen Namen an und berichtigt ihn – das gilt dann für alle.'));
    }
  } else {
    // Bewusst keine Ersatzliste: falsche Namen sind schlechter als keine.
    status.textContent = 'nicht ermittelt';
    list.appendChild(el('p', 'rooms-failed',
      'Die offiziellen Zimmerkategorien konnten nicht zuverlässig ermittelt werden. '
      + 'Trag sie unten selbst ein – deine Angaben gelten dann für alle.'));
    if (state.hotel?.enrich_error) {
      list.appendChild(el('p', 'rooms-error', state.hotel.enrich_error));
    }
    const add = el('button', 'btn btn-quiet', 'Zimmerkategorie hinzufügen');
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

    const titel = el('button', 'room-name');
    titel.type = 'button';
    titel.textContent = room.name;
    titel.title = 'Namen ändern';
    titel.addEventListener('click', () => renameRoom(room));
    name.appendChild(titel);
    if ((room.provisional === 1 || room.source === 'portal_provisional') && !room.confirmed) {
      const mark = el('span', 'provisional', 'vorläufig');
      mark.title = 'Name stammt von einem Buchungsportal – anklicken zum Berichtigen';
      name.appendChild(mark);
    }
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

  fillRoomSelects(rooms, rooms.length ? null : 'noch keine Kategorien – bitte ergänzen');
  renderRankWarning();
  updateRefreshNote();
}

// Kategorie umbenennen. Bestehende Aufenthalte werden mitgezogen.
async function renameRoom(room) {
  if (!state.hotel) return;
  const neu = await dialog({
    titel: 'Kategorie umbenennen',
    text: 'Schreib den Namen so, wie ihn das Hotel verwendet. '
      + 'Bestehende Aufenthalte werden mit umgestellt.',
    ja: 'Übernehmen',
    eingabe: { wert: room.name, platzhalter: 'Zimmerkategorie' },
  });
  if (!neu || neu === room.name) return;

  const res = await api('/hotels/' + state.hotel.id + '/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rename: { von: room.name, nach: neu } }),
  });
  state.rooms = res.rooms;
  state.contextCache = {};
  renderRooms();
  loadStays();
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
  if (!await frage('Neu recherchieren?',
    'Von dir bestätigte Kategorien bleiben erhalten.\nDas ist einmal im Monat je Hotel möglich.',
    'Recherchieren')) return;

  const hotelId = state.hotel.id;
  const note = $('#rooms-refresh-note');
  note.textContent = '';

  // Dieselbe Warteanzeige wie beim ersten Anlegen: Schlüsselkarte und Fortschritt.
  state.pollStarted = Date.now();
  state.pollGaveUp = false;
  state.skipEnrichment = false;
  state.hotel.enrich_status = 'running';
  state.rooms = [];
  renderRooms();

  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(() => {
    if (state.hotel?.id === hotelId && state.hotel.enrich_status === 'running') renderRooms();
    else clearInterval(state.pollTimer);
  }, 4000);

  try {
    const res = await fetch('/api/hotels/' + hotelId + '/enrich?wait=1', {
      method: 'POST',
      headers: {
        'x-stay-pass': state.pass,
        'x-stay-user': encodeURIComponent(state.email || state.me || ''),
      },
    });
    const data = await res.json();
    if (state.hotel?.id !== hotelId) return;

    if (res.status === 429 && data.gesperrt) {
      state.hotel.enrich_status = 'ready';
      note.textContent = 'Zuletzt vor Kurzem recherchiert. Wieder möglich in '
        + data.tage + (data.tage === 1 ? ' Tag.' : ' Tagen.');
      return;
    }
    if (!res.ok) throw new Error(data.error || 'Das hat nicht geklappt');

    state.hotel = data.hotel;
    state.rooms = data.rooms;
    delete state.imageCache[hotelId];
    delete state.contextCache[hotelId];
    loadGallery();
  } catch (e) {
    if (state.hotel?.id !== hotelId) return;
    state.hotel.enrich_status = 'failed';
    state.pollGaveUp = true;
    note.textContent = e.message;
  } finally {
    clearInterval(state.pollTimer);
    if (state.hotel?.id === hotelId) {
      renderChosenHotel();
      applyHotelProgram();
      renderRooms();
    }
  }
});

// Zeigt an, ob eine neue Recherche gerade möglich ist.
function updateRefreshNote() {
  const note = $('#rooms-refresh-note');
  const knopf = $('#rooms-refresh');
  const hotel = state.hotel;
  if (!hotel) return;

  const laeuft = ['pending', 'running'].includes(hotel.enrich_status);
  knopf.disabled = laeuft;

  if (laeuft) { note.textContent = ''; return; }

  // Nur bei brauchbarem Ergebnis sperren – sonst darf sofort neu gesucht werden.
  if (hotel.enrich_status === 'ready' && hotel.enriched_at && state.rooms.length >= 3) {
    const tage = Math.ceil((30 * 86400000 - (Date.now() - Date.parse(hotel.enriched_at))) / 86400000);
    if (tage > 0) {
      knopf.disabled = true;
      note.textContent = 'Zuletzt am ' + formatDate(hotel.enriched_at)
        + ' recherchiert. Wieder möglich in ' + tage + (tage === 1 ? ' Tag.' : ' Tagen.');
      return;
    }
  }
  note.textContent = '';
}

// Schlüsselkarte, die immer wieder in den Türleser gleitet.
function keycardAnimation() {
  const box = el('span', 'keycard');
  box.innerHTML = '<svg viewBox="0 0 64 44" aria-hidden="true">'
    + '<rect class="reader" x="30" y="4" width="30" height="36" rx="5"/>'
    + '<rect class="slot" x="34" y="12" width="22" height="3" rx="1.5"/>'
    + '<circle class="led" cx="45" cy="32" r="3"/>'
    + '<rect class="card" x="2" y="14" width="26" height="17" rx="2.5"/>'
    + '<rect class="stripe" x="5" y="18" width="12" height="2.4" rx="1.2"/>'
    + '</svg>';
  return box;
}

// Was gerade wirklich passiert – die Schritte laufen der Reihe nach.
function waitingLine(seconds) {
  if (seconds < 10) return 'Die Zimmerkategorien werden beim Betreiber abgefragt …';
  if (seconds < 30) return 'Die offiziellen Seiten des Hauses werden gelesen …';
  if (seconds < 60) return 'Kategorien werden erfasst und sortiert …';
  if (seconds < 100) return 'Die Reihenfolge wird geprüft …';
  return 'Fast fertig – das Haus macht es uns schwer …';
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
  updateUpgradeHint();
}

// Zeigt sofort, was der Status gebracht hat.
function updateUpgradeHint() {
  const badge = $('#upgrade-hint');
  const text = $('#upgrade-text');
  const rooms = state.rooms;
  const rank = (name) => rooms.find((r) => r.name === name)?.rank;
  const booked = rank($('#s-booked').value);
  const got = rank($('#s-received').value);

  badge.className = 'upgrade-badge';
  const arrowNode = badge.querySelector('.upgrade-arrow');
  if (booked == null || got == null) {
    arrowNode.textContent = '→';
    text.textContent = $('#s-booked').disabled ? 'Kategorien werden geladen' : 'Kategorien wählen';
    return;
  }
  const steps = got - booked;
  arrowNode.textContent = flowArrow(steps);
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

const tagDanach = (datum) => {
  const d = new Date(datum);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
};

// Hat der Nutzer die Abreise selbst gesetzt, bleibt sie unangetastet.
$('#s-checkout').addEventListener('input', () => { state.checkoutTouched = true; });

// Die Abreise folgt der Anreise, solange sie automatisch gesetzt wurde.
$('#s-checkin').addEventListener('change', () => {
  const anreise = $('#s-checkin').value;
  const abreise = $('#s-checkout');
  if (!anreise) { abreise.min = ''; return; }

  abreise.min = anreise;

  if (!state.checkoutTouched || !abreise.value || abreise.value < anreise) {
    abreise.value = tagDanach(anreise);
  }
});

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
  state.pollGaveUp = false;
  if (!state.hotel || ['ready', 'failed'].includes(state.hotel.enrich_status)) return;

  state.pollStarted = Date.now();
  let tries = 0;

  state.pollTimer = setInterval(async () => {
    tries += 1;
    if (!state.hotel) { clearInterval(state.pollTimer); return; }

    // Nach drei Minuten hoeren wir auf und sagen es auch.
    if (tries > 45) {
      clearInterval(state.pollTimer);
      state.pollGaveUp = true;
      renderRooms();
      return;
    }
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

  const heute = new Date();
  $('#s-checkin').valueAsDate = heute;
  $('#s-checkout').value = tagDanach($('#s-checkin').value);
  $('#s-checkout').min = $('#s-checkin').value;
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

  const zeige = (text, feld) => {
    err.textContent = text;
    err.hidden = false;
    feld?.focus();
  };

  if (!$('#s-checkin').value) return zeige('Bitte trag die Anreise ein.', $('#s-checkin'));
  if (!$('#s-checkout').value) return zeige('Bitte trag die Abreise ein.', $('#s-checkout'));
  if ($('#s-checkout').value < $('#s-checkin').value) {
    return zeige('Die Abreise liegt vor der Anreise.', $('#s-checkout'));
  }

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

    state.contextCache = {};
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
      [t.upgrade_quote != null ? t.upgrade_quote + ' %' : '–', 'Upgradequote'],
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

    // Auf schmalen Schirmen zugeklappt, damit man die Programme überblickt.
    const eng = window.innerWidth <= 700;

    data.groups.forEach((g) => {
      const card = document.createElement('details');
      card.className = 'group-card';
      card.open = !eng;   // auf dem Handy alles zu, auf breiten Schirmen offen

      const head = document.createElement('summary');
      head.className = 'group-head';
      const title = el('div');
      title.appendChild(el('div', 'group-title', g.program));
      const badge = el('span', 'badge badge-status', g.status);
      badge.style.background = statusColor(g.status);
      title.appendChild(badge);
      head.appendChild(title);

      const meta = el('div', 'group-sub');
      meta.textContent = g.stays + (g.stays === 1 ? ' Aufenthalt' : ' Aufenthalte')
        + (g.upgrade_quote != null ? ' · ' + g.upgrade_quote + ' % Upgrade' : '');
      head.appendChild(meta);
      card.appendChild(head);

      const grid = el('div', 'group-grid');

      const upgrades = el('div');
      upgrades.appendChild(el('h4', null, 'Upgrades'));
      upgrades.appendChild(el('div', 'total-num', g.upgrade_quote != null ? g.upgrade_quote + ' %' : '–'));
      upgrades.appendChild(el('div', 'total-label', 'Upgradequote'));
      if (g.avg_steps != null) {
        upgrades.appendChild(el('div', 'group-sub', 'Ø ' + (g.avg_steps > 0 ? '+' : '') + comma(g.avg_steps) + ' Kategorien'));
      }
      if (g.suite_quote) {
        upgrades.appendChild(el('div', 'group-sub', g.suite_quote + ' % davon in eine Suite'));
      }
      if (g.stays < 3) {
        upgrades.appendChild(el('div', 'sample-note', 'Basis: ' + g.stays
          + (g.stays === 1 ? ' Aufenthalt' : ' Aufenthalte')));
      }
      grid.appendChild(upgrades);

      if (g.benefits.length) {
        const benefits = el('div');
        benefits.appendChild(el('h4', null, 'Benefits erhalten'));
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

      if (g.paths.length) {
        const paths = el('div');
        paths.appendChild(el('h4', null, 'Häufigste Upgrades'));
        for (const path of g.paths) {
          const row = el('div', 'path-row');
          row.appendChild(el('div', 'r-muted', path.booked));
          row.appendChild(el('div', 'path-to', flowArrow(path.steps) + ' ' + path.received));
          row.appendChild(el('div', 'n', path.count + '× gemeldet'));
          paths.appendChild(row);
        }
        grid.appendChild(paths);
      }

      if (g.top_hotels.length) {
        const hotels = el('div');
        hotels.appendChild(el('h4', null, 'Beste Häuser'));
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
    });
  } catch (e) {
    box.innerHTML = '';
    box.appendChild(el('p', 'empty', e.message));
  }
}
$('#stats-scope').addEventListener('change', loadStats);
$('#hotel-back').addEventListener('click', () => showView('stays'));

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
  if (!state.isAdmin) {
    $('#log-body').textContent = 'Das Protokoll ist dem Verwalter vorbehalten.';
    return;
  }
  const box = $('#log-body');
  const admin = await eingabeDialog('Adminpasswort', 'Das Protokoll ist geschützt.', 'Passwort', 'password');
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

/* ------------------------------------------------- Neue Fassung erkennen */

$('#update-now').addEventListener('click', async () => {
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((r) => r.unregister()));
  }
  if (window.caches) {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  }
  location.reload(true);
});

async function checkVersion() {
  try {
    const res = await fetch('/version.json', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    if (MY_VERSION && data.version && data.version !== MY_VERSION) {
      $('#update-bar').hidden = false;
    }
  } catch { /* offline, dann eben nicht */ }
}

checkVersion();
setInterval(checkVersion, 120000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) checkVersion();
});
