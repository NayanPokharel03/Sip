// @ts-check
// Day keys are local dates "YYYY-MM-DD". A day starts at `dayStartHour`, so with 4 a
// glass at 1 AM still belongs to the previous day.

export const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');

/** @param {Date} d */
export const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** @param {string} key */
export function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** @param {number} ts @param {number} dayStartHour */
export function dayKey(ts, dayStartHour = 0) {
  const d = new Date(ts);
  d.setHours(d.getHours() - dayStartHour);
  return keyOf(d);
}

/** @param {string} key @param {number} n */
export function addDays(key, n) {
  const d = parseKey(key);
  d.setDate(d.getDate() + n);
  return keyOf(d);
}

/** Inclusive list of day keys from `from` to `to`. */
export function keysBetween(/** @type {string} */ from, /** @type {string} */ to) {
  if (from > to) [from, to] = [to, from];
  const keys = [];
  for (let k = from; k <= to; k = addDays(k, 1)) keys.push(k);
  return keys;
}

/** Timestamp at which the next logical day begins. */
export function nextDayStart(/** @type {number} */ ts, /** @type {number} */ dayStartHour) {
  const now = new Date(ts);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), dayStartHour);
  if (start <= now) start.setDate(start.getDate() + 1);
  return start.getTime();
}

/** Timestamp for clock time hh:mm within logical day `key`. */
export function tsFor(/** @type {string} */ key, /** @type {number} */ hh, /** @type {number} */ mm, /** @type {number} */ dayStartHour) {
  const d = parseKey(key);
  if (hh < dayStartHour) d.setDate(d.getDate() + 1);
  d.setHours(hh, mm, 0, 0);
  return d.getTime();
}

export const fmtTime = (/** @type {number} */ ts) =>
  new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export const fmtDay = (/** @type {string} */ key, long = false) =>
  parseKey(key).toLocaleDateString([], long
    ? { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }
    : { weekday: 'short', month: 'short', day: 'numeric' });

export function fmtDuration(/** @type {number} */ ms) {
  const m = Math.round(ms / 60000);
  const h = Math.floor(m / 60);
  return h ? `${h}h ${pad(m % 60)}m` : `${m}m`;
}

export const ML_PER_OZ = 29.5735;

/** Format a volume stored in ml for the chosen unit. */
export function fmtVol(/** @type {number} */ ml, /** @type {string} */ unit) {
  if (unit === 'oz') return `${+(ml / ML_PER_OZ).toFixed(1)} oz`;
  return ml >= 1000 ? `${+(ml / 1000).toFixed(2)} L` : `${Math.round(ml)} ml`;
}

/** ml → number in the display unit (for inputs), and back. */
export const toUnit = (/** @type {number} */ ml, /** @type {string} */ unit) =>
  unit === 'oz' ? +(ml / ML_PER_OZ).toFixed(1) : Math.round(ml);
export const fromUnit = (/** @type {number} */ v, /** @type {string} */ unit) =>
  Math.round(unit === 'oz' ? v * ML_PER_OZ : v);
