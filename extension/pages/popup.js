// @ts-check
import { getSettings, getDay, total, send, logKey } from '../lib/store.js';
import { dayKey, fmtTime, fmtVol } from '../lib/time.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** @type {import('../lib/store.js').Settings} */
let s;
let day = '';
/** @type {import('../lib/store.js').Entry[]} */
let entries = [];
let lastAddedId = '';

if (new URLSearchParams(location.search).has('window')) document.body.classList.add('window');

async function load() {
  s = await getSettings();
  day = dayKey(Date.now(), s.dayStartHour);
  entries = await getDay(day);
  renderPresets();
  renderKeys();
  render();
}

function renderPresets() {
  const box = $('presets');
  box.replaceChildren(...s.presets.map((p, i) => {
    const b = document.createElement('button');
    b.className = 'preset' + (i === s.defaultPreset ? ' default' : '');
    b.dataset.index = String(i);
    const name = Object.assign(document.createElement('span'), { className: 'name', textContent: p.name });
    const vol = Object.assign(document.createElement('span'), { className: 'vol', textContent: fmtVol(p.ml, s.unit) });
    b.append(name, vol);
    if (i < 9) b.append(Object.assign(document.createElement('kbd'), { textContent: String(i + 1) }));
    b.addEventListener('click', () => log(i));
    return b;
  }));
  $('maxDigit').textContent = String(Math.min(9, s.presets.length));
}

function renderKeys() {
  document.querySelectorAll('kbd[data-keys]').forEach((k) => {
    const action = /** @type {keyof typeof s.popupKeys} */ (/** @type {HTMLElement} */ (k).dataset.keys);
    k.textContent = s.popupKeys[action]?.[0] ?? '';
  });
}

function render() {
  const ml = total(entries);
  $('total').textContent = fmtVol(ml, s.unit);
  $('goal').textContent = fmtVol(s.goalMl, s.unit);
  $('count').textContent = `${entries.length} glass${entries.length === 1 ? '' : 'es'}`;
  $('fill').style.width = `${Math.min(100, (ml / s.goalMl) * 100 || 0)}%`;
  $('progress').classList.toggle('done', ml >= s.goalMl);

  const list = $('list');
  list.replaceChildren(...[...entries].reverse().map((e) => {
    const li = document.createElement('li');
    if (e.id === lastAddedId) li.className = 'new';
    const del = Object.assign(document.createElement('button'), { className: 'icon', textContent: '×', title: 'Delete' });
    del.addEventListener('click', () => send({ type: 'remove', day, id: e.id }));
    li.append(
      Object.assign(document.createElement('span'), { className: 'num', textContent: fmtTime(e.t) }),
      Object.assign(document.createElement('span'), { className: 'preset-name', textContent: e.preset }),
      Object.assign(document.createElement('span'), { className: 'num', textContent: fmtVol(e.ml, s.unit) }),
      del,
    );
    return li;
  }));
  $('empty').hidden = entries.length > 0;
}

async function log(/** @type {number} */ index) {
  const btn = document.querySelector(`.preset[data-index="${index}"]`);
  btn?.classList.remove('pulse');
  void (/** @type {HTMLElement} */ (btn))?.offsetWidth; // restart animation
  btn?.classList.add('pulse');
  const res = await send({ type: 'add', presetIndex: index });
  lastAddedId = res?.entry?.id ?? '';
  render();
}

const openReport = () => chrome.tabs.create({ url: chrome.runtime.getURL('pages/report.html') }).then(() => window.close());
const openOptions = () => chrome.runtime.openOptionsPage().then(() => window.close());

$('undo').addEventListener('click', () => send({ type: 'undo' }));
$('report').addEventListener('click', openReport);
$('options').addEventListener('click', openOptions);

document.addEventListener('keydown', (e) => {
  if (!s || e.repeat) return;
  const target = /** @type {HTMLElement} */ (e.target);
  // Let focused buttons handle their own Enter/Space.
  if (/^(BUTTON|A)$/.test(target.tagName) && (e.key === 'Enter' || e.key === ' ')) return;

  const plain = !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey;
  const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
  if (plain && digit && +digit[1] <= s.presets.length) {
    e.preventDefault();
    log(+digit[1] - 1);
    return;
  }

  const combo = globalThis.SipKeys.fromEvent(e);
  if (!combo) return;
  const k = s.popupKeys;
  const action = k.log.includes(combo) ? () => log(s.defaultPreset)
    : k.undo.includes(combo) ? () => send({ type: 'undo' })
    : k.report.includes(combo) ? openReport
    : k.options.includes(combo) ? openOptions
    : null;
  if (!action) return;
  e.preventDefault();
  action();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) load();
  else if (area === 'local' && changes[logKey(day)]) {
    entries = changes[logKey(day)].newValue || [];
    render();
  }
});

load();
