// @ts-check
import {
  getSettings, getDay, total, addEntry, removeEntry, updateEntry, undoLast, clearAll,
} from './lib/store.js';
import { dayKey, nextDayStart, fmtVol } from './lib/time.js';

const BADGE = '#0284c7';
const BADGE_FLASH = '#16a34a';

// All writes go through this queue so rapid keypresses can't overwrite each other.
let queue = Promise.resolve();
function serial(/** @type {() => Promise<any>} */ fn) {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
}

async function refreshBadge(flash = false) {
  const s = await getSettings();
  const entries = await getDay(dayKey(Date.now(), s.dayStartHour));
  const n = entries.length;
  const ml = total(entries);
  await chrome.action.setBadgeText({ text: n ? String(n) : '' });
  await chrome.action.setBadgeTextColor?.({ color: '#ffffff' });
  await chrome.action.setBadgeBackgroundColor({ color: flash ? BADGE_FLASH : BADGE });
  if (flash) setTimeout(() => chrome.action.setBadgeBackgroundColor({ color: BADGE }), 900);
  await chrome.action.setTitle({
    title: `Sip — ${n} glass${n === 1 ? '' : 'es'}, ${fmtVol(ml, s.unit)} of ${fmtVol(s.goalMl, s.unit)} today`,
  });
  return { count: n, ml, goalMl: s.goalMl, unit: s.unit };
}

// Reset the badge when the logical day rolls over.
async function scheduleRollover() {
  const s = await getSettings();
  chrome.alarms.create('rollover', { when: nextDayStart(Date.now(), s.dayStartHour) + 1000 });
}

/** @param {import('./lib/store.js').Settings} s @param {number} [index] @param {number} [t] */
function logPreset(s, index, t) {
  const p = s.presets[index ?? s.defaultPreset] ?? s.presets[0];
  if (!p) throw new Error('No glass sizes configured');
  return addEntry({ t, ml: p.ml, preset: p.name }, s.dayStartHour);
}

/** @type {Record<string, (m: any, s: import('./lib/store.js').Settings) => Promise<any>>} */
const handlers = {
  add: (m, s) => (m.ml
    ? addEntry({ t: m.t ?? Date.now(), ml: m.ml, preset: m.preset || 'Custom' }, s.dayStartHour)
    : logPreset(s, m.presetIndex, m.t)),
  remove: (m) => removeEntry(m.day, m.id),
  update: (m, s) => updateEntry(m.day, m.id, m.patch, s.dayStartHour),
  undo: (_m, s) => undoLast(s.dayStartHour),
  clearAll: () => clearAll(),
};

function run(/** @type {string} */ type, /** @type {any} */ msg = {}) {
  return serial(async () => {
    const s = await getSettings();
    const result = await handlers[type](msg, s);
    const today = await refreshBadge(type === 'add');
    return { entry: result, today };
  });
}

async function openPopup(/** @type {number|undefined} */ windowId) {
  try {
    await chrome.action.openPopup(windowId ? { windowId } : undefined);
  } catch {
    // Older Chromium or no focused window: fall back to a small standalone window.
    chrome.windows.create({ url: chrome.runtime.getURL('pages/popup.html?window=1'), type: 'popup', width: 360, height: 620 });
  }
}

chrome.commands.onCommand.addListener((command) => {
  if (command === 'log-glass') run('add');
  else if (command === 'undo-last') run('undo');
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type === 'open-popup') {
    openPopup(sender.tab?.windowId);
    return;
  }
  if (!handlers[msg?.type]) return;
  run(msg.type, msg).then(
    (result) => reply({ ok: true, result }),
    (err) => reply({ ok: false, error: String(err?.message || err) }),
  );
  return true; // async reply
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'rollover') refreshBadge().then(scheduleRollover);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) refreshBadge().then(scheduleRollover);
});

chrome.runtime.onStartup.addListener(() => refreshBadge().then(scheduleRollover));
chrome.runtime.onInstalled.addListener(({ reason }) => {
  refreshBadge().then(scheduleRollover);
  if (reason === 'install') chrome.runtime.openOptionsPage();
});
