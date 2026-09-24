// @ts-check
import { getSettings, saveSettings, DEFAULTS, send } from '../lib/store.js';
import { toUnit, fromUnit } from '../lib/time.js';

const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));
const el = (/** @type {string} */ tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

/** @type {import('../lib/store.js').Settings} */
let s;

let savedTimer = 0;
async function save() {
  await saveSettings(s);
  const badge = $('saved');
  badge.textContent = 'Saved';
  badge.classList.add('show');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => badge.classList.remove('show'), 1200);
}

// ---- glass sizes ----
function renderPresets() {
  $('presets').replaceChildren(...s.presets.map((p, i) => {
    const radio = el('input', { type: 'radio', name: 'default', checked: i === s.defaultPreset, title: 'Default size' });
    radio.addEventListener('change', () => { s.defaultPreset = i; save(); });

    const name = el('input', { value: p.name, placeholder: 'Name', maxLength: 30, ariaLabel: 'Name' });
    name.addEventListener('change', () => { p.name = name.value.trim() || 'Glass'; name.value = p.name; save(); });

    const amount = el('input', { type: 'number', min: '1', step: s.unit === 'oz' ? '0.1' : '10', value: toUnit(p.ml, s.unit), ariaLabel: 'Amount' });
    amount.addEventListener('change', () => {
      const v = parseFloat(amount.value);
      if (v > 0) { p.ml = fromUnit(v, s.unit); save(); } else amount.value = String(toUnit(p.ml, s.unit));
    });

    const remove = el('button', { className: 'icon', textContent: '×', title: 'Remove', disabled: s.presets.length === 1 });
    remove.addEventListener('click', () => {
      s.presets.splice(i, 1);
      if (s.defaultPreset >= s.presets.length || s.defaultPreset === i) s.defaultPreset = 0;
      else if (s.defaultPreset > i) s.defaultPreset--;
      renderPresets();
      save();
    });

    return el('div', { className: 'preset-row' },
      el('label', { className: 'default-pick' }, radio, 'Default'),
      name,
      el('span', { className: 'amount' }, amount, el('span', { className: 'muted', textContent: s.unit })),
      i < 9 ? el('kbd', { textContent: String(i + 1) }) : el('span'),
      remove,
    );
  }));
  $('addPreset').disabled = s.presets.length >= 9;
}

$('addPreset').addEventListener('click', () => {
  s.presets.push({ name: 'Glass', ml: 250 });
  renderPresets();
  save();
});

// ---- goal / unit / day start ----
function renderGeneral() {
  $('goal').value = toUnit(s.goalMl, s.unit);
  $('goal').step = s.unit === 'oz' ? '1' : '50';
  document.querySelectorAll('.unit-label').forEach((n) => { n.textContent = s.unit; });
  $('unit').value = s.unit;
  $('dayStart').value = String(s.dayStartHour);
}

$('dayStart').append(...Array.from({ length: 24 }, (_, h) =>
  el('option', { value: String(h), textContent: h === 0 ? 'Midnight' : new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' }) })));

$('goal').addEventListener('change', () => {
  const v = parseFloat($('goal').value);
  if (v > 0) { s.goalMl = fromUnit(v, s.unit); save(); } else renderGeneral();
});
$('unit').addEventListener('change', () => { s.unit = $('unit').value; renderGeneral(); renderPresets(); save(); });
$('dayStart').addEventListener('change', () => { s.dayStartHour = +$('dayStart').value; save(); });

// ---- browser shortcuts (chrome.commands) ----
const COMMAND_LABELS = { _execute_action: 'Open Sip', 'log-glass': 'Log default glass', 'undo-last': 'Undo last glass' };

async function renderCommands() {
  const commands = await chrome.commands.getAll();
  $('commands').replaceChildren(...commands.map((c) => el('tr', {},
    el('td', { textContent: COMMAND_LABELS[/** @type {keyof COMMAND_LABELS} */ (c.name)] || c.description }),
    el('td', {}, c.shortcut ? el('kbd', { textContent: c.shortcut }) : el('span', { className: 'unset', textContent: 'Not set — click "Change browser shortcuts" below' })),
  )));
}

function shortcutsUrl() {
  const brands = /** @type {any} */ (navigator).userAgentData?.brands?.map((/** @type {any} */ b) => b.brand).join(' ') || navigator.userAgent;
  if (/Edge|Edg\//.test(brands)) return 'edge://extensions/shortcuts';
  if (/** @type {any} */ (navigator).brave) return 'brave://extensions/shortcuts';
  return 'chrome://extensions/shortcuts';
}
$('openShortcuts').addEventListener('click', () => chrome.tabs.create({ url: shortcutsUrl() }));
// Refresh when you come back from the browser's shortcuts page.
document.addEventListener('visibilitychange', () => { if (!document.hidden) renderCommands(); });

// ---- key recorders ----
/** @type {(() => void) | null} */
let stopRecording = null;

function renderKeymaps() {
  document.querySelectorAll('.keymap').forEach((map) => {
    const group = /** @type {'inPage'|'popupKeys'} */ (/** @type {HTMLElement} */ (map).dataset.group);
    map.querySelectorAll('.keys').forEach((box) => renderKeys(/** @type {HTMLElement} */ (box), group));
  });
  $('inPageEnabled').checked = s.inPage.enabled;
  $('excluded').value = s.excludedSites.join('\n');
}

function renderKeys(/** @type {HTMLElement} */ box, /** @type {'inPage'|'popupKeys'} */ group, warning = '') {
  const action = /** @type {string} */ (box.dataset.action);
  const map = /** @type {Record<string, string[]>} */ (/** @type {unknown} */ (s[group]));
  const list = map[action];

  const chips = list.map((combo) => {
    const x = el('button', { textContent: '×', title: `Remove ${combo}` });
    x.addEventListener('click', () => {
      map[action] = list.filter((c) => c !== combo);
      renderKeys(box, group);
      save();
    });
    return el('span', { className: 'chip' }, el('kbd', { textContent: combo }), x);
  });

  const add = el('button', { className: 'add', textContent: '+ Add key' });
  add.addEventListener('click', () => {
    stopRecording?.();
    add.classList.add('recording');
    add.textContent = 'Press keys… (Esc cancels)';

    const onKey = (/** @type {KeyboardEvent} */ e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) return finish();
      const combo = globalThis.SipKeys.fromEvent(e);
      if (!combo) return; // lone modifier: keep waiting
      const clash = Object.values(map).some((keys) => Array.isArray(keys) && keys.includes(combo));
      if (clash) return finish(`${combo} is already used here`);
      if (group === 'popupKeys' && /^(Num)?[1-9]$/.test(combo)) return finish('1–9 are reserved for glass sizes');
      map[action] = [...list, combo];
      save();
      finish();
    };
    const finish = (/** @type {string} */ warn = '') => {
      window.removeEventListener('keydown', onKey, true);
      stopRecording = null;
      renderKeys(box, group, warn);
    };
    window.addEventListener('keydown', onKey, true);
    stopRecording = () => finish();
  });

  box.replaceChildren(...chips, add, ...(warning ? [el('span', { className: 'warn', textContent: warning })] : []));
}

$('inPageEnabled').addEventListener('change', () => { s.inPage.enabled = $('inPageEnabled').checked; save(); });
$('excluded').addEventListener('change', () => {
  s.excludedSites = [...new Set(String($('excluded').value).split(/[\s,]+/)
    .map((line) => line.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/[/:].*$/, '').replace(/^www\./, ''))
    .filter(Boolean))];
  $('excluded').value = s.excludedSites.join('\n');
  save();
});

// ---- data ----
$('resetKeys').addEventListener('click', () => {
  s.inPage = structuredClone(DEFAULTS.inPage);
  s.popupKeys = structuredClone(DEFAULTS.popupKeys);
  renderKeymaps();
  save();
});
$('clearAll').addEventListener('click', async () => {
  if (!confirm('Delete every logged glass of water? This cannot be undone.')) return;
  await send({ type: 'clearAll' });
  alert('All water logs deleted.');
});

(async () => {
  s = await getSettings();
  renderPresets();
  renderGeneral();
  renderKeymaps();
  renderCommands();
})();
