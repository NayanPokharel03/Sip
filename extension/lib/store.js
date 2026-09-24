// @ts-check
// Settings live in storage.sync (small, follows you across devices).
// The log lives in storage.local, one key per day: "log:YYYY-MM-DD" → [{id, t, ml, preset}].
// Write functions are only called from the service worker, which serializes them.
import { dayKey } from './time.js';

/**
 * @typedef {{ id: string, t: number, ml: number, preset: string }} Entry
 * @typedef {{ name: string, ml: number }} Preset
 */

export const DEFAULTS = {
  presets: /** @type {Preset[]} */ ([
    { name: 'Glass', ml: 250 },
    { name: 'Small glass', ml: 150 },
    { name: 'Bottle', ml: 500 },
  ]),
  defaultPreset: 0,
  goalMl: 2500,
  unit: 'ml',
  dayStartHour: 4,
  inPage: { enabled: true, open: ['Shift+/'], log: /** @type {string[]} */ ([]), undo: /** @type {string[]} */ ([]) },
  excludedSites: /** @type {string[]} */ ([]),
  popupKeys: { log: ['Enter', 'Space'], undo: ['Backspace'], report: ['R'], options: ['O'] },
};

/** @typedef {typeof DEFAULTS} Settings */

/** @returns {Promise<Settings>} */
export async function getSettings() {
  const { settings = {} } = await chrome.storage.sync.get('settings');
  return {
    ...structuredClone(DEFAULTS),
    ...settings,
    inPage: { ...DEFAULTS.inPage, ...settings.inPage },
    popupKeys: { ...DEFAULTS.popupKeys, ...settings.popupKeys },
  };
}

/** @param {Settings} settings */
export const saveSettings = (settings) => chrome.storage.sync.set({ settings });

export const logKey = (/** @type {string} */ day) => 'log:' + day;

/** @returns {Promise<Entry[]>} */
export async function getDay(/** @type {string} */ day) {
  const r = await chrome.storage.local.get(logKey(day));
  return r[logKey(day)] || [];
}

/** @returns {Promise<Record<string, Entry[]>>} */
export async function getDays(/** @type {string[]} */ days) {
  const r = await chrome.storage.local.get(days.map(logKey));
  return Object.fromEntries(days.map((d) => [d, r[logKey(d)] || []]));
}

/** Every day that has entries, sorted. */
export async function getAllDays() {
  const all = await chrome.storage.local.get(null);
  return Object.fromEntries(
    Object.keys(all).filter((k) => k.startsWith('log:')).sort().map((k) => [k.slice(4), all[k]]),
  );
}

export const total = (/** @type {Entry[]} */ entries) => entries.reduce((sum, e) => sum + e.ml, 0);

/** Send a write request to the service worker. */
export async function send(/** @type {object} */ msg) {
  const res = await chrome.runtime.sendMessage(msg);
  if (res && !res.ok) throw new Error(res.error);
  return res?.result;
}

// ---- writes (service worker only) ----

async function putDay(/** @type {string} */ day, /** @type {Entry[]} */ entries) {
  if (!entries.length) return chrome.storage.local.remove(logKey(day));
  entries.sort((a, b) => a.t - b.t);
  return chrome.storage.local.set({ [logKey(day)]: entries });
}

/** @param {{t?: number, ml: number, preset: string}} e @param {number} dayStartHour */
export async function addEntry({ t = Date.now(), ml, preset }, dayStartHour) {
  const day = dayKey(t, dayStartHour);
  const entries = await getDay(day);
  const entry = { id: crypto.randomUUID(), t, ml, preset };
  entries.push(entry);
  await putDay(day, entries);
  return entry;
}

export async function removeEntry(/** @type {string} */ day, /** @type {string} */ id) {
  const entries = await getDay(day);
  const i = entries.findIndex((e) => e.id === id);
  if (i < 0) return null;
  const [removed] = entries.splice(i, 1);
  await putDay(day, entries);
  return removed;
}

/** Edit an entry; if its new time falls on another day it moves there. */
export async function updateEntry(
  /** @type {string} */ day, /** @type {string} */ id,
  /** @type {Partial<Entry>} */ patch, /** @type {number} */ dayStartHour,
) {
  const old = await removeEntry(day, id);
  if (!old) return null;
  const next = { ...old, ...patch, id };
  const newDay = dayKey(next.t, dayStartHour);
  const entries = await getDay(newDay);
  entries.push(next);
  await putDay(newDay, entries);
  return next;
}

/** Remove the latest entry of the current day. */
export async function undoLast(/** @type {number} */ dayStartHour) {
  const day = dayKey(Date.now(), dayStartHour);
  const entries = await getDay(day);
  if (!entries.length) return null;
  return removeEntry(day, entries.reduce((a, b) => (b.t > a.t ? b : a)).id);
}

export async function clearAll() {
  const all = await chrome.storage.local.get(null);
  await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith('log:')));
}
