// @ts-check
import { getSettings, getDay, getDays, getAllDays, total, send } from '../lib/store.js';
import {
  dayKey, addDays, keysBetween, tsFor, pad, fmtTime, fmtDay, fmtDuration, fmtVol, toUnit, fromUnit, ML_PER_OZ,
} from '../lib/time.js';

const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));
const el = (/** @type {string} */ tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

const LONG_GAP = 3 * 3600_000; // gaps longer than this are highlighted

/** @type {import('../lib/store.js').Settings} */
let s;
let day = '';
let range = 7;
let editingId = '';
/** @type {import('../lib/store.js').Entry[]} */
let entries = [];

const today = () => dayKey(Date.now(), s.dayStartHour);
const hhmm = (/** @type {number} */ t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

async function load() {
  s = await getSettings();
  if (!day) {
    day = today();
    $('to').value = day;
    $('from').value = addDays(day, -29);
  }
  $('date').max = today();
  $('addPreset').replaceChildren(
    ...s.presets.map((p, i) => el('option', { value: String(i), textContent: `${p.name} (${fmtVol(p.ml, s.unit)})` })),
    el('option', { value: 'custom', textContent: 'Custom' }),
  );
  $('addPreset').value = String(s.defaultPreset);
  $('addAmount').value = toUnit(s.presets[s.defaultPreset]?.ml ?? 250, s.unit);
  $('addUnit').textContent = s.unit;
  await setDay(day);
}

async function setDay(/** @type {string} */ key) {
  if (key > today()) key = today();
  const changed = key !== day;
  day = key;
  if (changed) editingId = '';
  $('date').value = day;
  $('next').disabled = day >= today();
  $('dayTitle').textContent = fmtDay(day, true) + (day === today() ? ' (today)' : '');
  if (changed || !$('addTime').value) $('addTime').value = day === today() ? hhmm(Date.now()) : '12:00';
  entries = await getDay(day);
  renderDay();
  await renderChart();
}

// ---- day summary + timeline ----
function renderDay() {
  const ml = total(entries);
  const pct = s.goalMl ? Math.round((ml / s.goalMl) * 100) : 0;
  $('cTotal').textContent = fmtVol(ml, s.unit);
  $('cGoal').textContent = ml >= s.goalMl ? `Goal of ${fmtVol(s.goalMl, s.unit)} reached` : `${pct}% of ${fmtVol(s.goalMl, s.unit)} goal`;
  $('fill').style.width = `${Math.min(100, pct)}%`;
  $('progress').classList.toggle('done', ml >= s.goalMl);

  $('cCount').textContent = String(entries.length);
  $('cAvg').textContent = entries.length ? `avg ${fmtVol(ml / entries.length, s.unit)} each` : '';

  const first = entries[0];
  const last = entries[entries.length - 1];
  $('cSpan').textContent = first ? `${fmtTime(first.t)} – ${fmtTime(last.t)}` : '—';
  $('cSpanSub').textContent = entries.length > 1 ? `over ${fmtDuration(last.t - first.t)}` : '';

  let gap = 0;
  let gapAt = 0;
  for (let i = 1; i < entries.length; i++) {
    const g = entries[i].t - entries[i - 1].t;
    if (g > gap) { gap = g; gapAt = i; }
  }
  $('cGap').textContent = gap ? fmtDuration(gap) : '—';
  $('cGapSub').textContent = gap ? `${fmtTime(entries[gapAt - 1].t)} → ${fmtTime(entries[gapAt].t)}` : '';

  let running = 0;
  $('rows').replaceChildren(...entries.map((e, i) => {
    running += e.ml;
    const g = i ? e.t - entries[i - 1].t : 0;
    const gapCell = el('td', { textContent: i ? fmtDuration(g) : '—', className: g > LONG_GAP ? 'gap-long' : '' });
    if (e.id === editingId) return editRow(e, running, gapCell);

    const edit = el('button', { textContent: 'Edit' });
    edit.addEventListener('click', () => { editingId = e.id; renderDay(); });
    const del = el('button', { textContent: 'Delete', className: 'danger' });
    del.addEventListener('click', () => send({ type: 'remove', day, id: e.id }));
    return el('tr', {},
      el('td', { textContent: fmtTime(e.t) }),
      el('td', { textContent: fmtVol(e.ml, s.unit) }),
      el('td', { textContent: e.preset }),
      el('td', { textContent: fmtVol(running, s.unit) }),
      gapCell,
      el('td', { className: 'actions' }, edit, ' ', del),
    );
  }));
  $('empty').hidden = entries.length > 0;
  document.querySelector('.timeline')?.toggleAttribute('hidden', !entries.length);
}

function editRow(
  /** @type {import('../lib/store.js').Entry} */ e, /** @type {number} */ running, /** @type {HTMLElement} */ gapCell,
) {
  const time = el('input', { type: 'time', value: hhmm(e.t), ariaLabel: 'Time' });
  const amount = el('input', { type: 'number', min: '1', step: 'any', value: toUnit(e.ml, s.unit), ariaLabel: 'Amount' });
  const saveBtn = el('button', { textContent: 'Save', className: 'primary' });
  const cancel = el('button', { textContent: 'Cancel' });

  const commit = async () => {
    const v = parseFloat(amount.value);
    if (!(v > 0) || !time.value) return;
    const [hh, mm] = time.value.split(':').map(Number);
    const t = time.value === hhmm(e.t) ? e.t : tsFor(day, hh, mm, s.dayStartHour);
    editingId = '';
    await send({ type: 'update', day, id: e.id, patch: { t, ml: fromUnit(v, s.unit) } });
  };
  saveBtn.addEventListener('click', commit);
  cancel.addEventListener('click', () => { editingId = ''; renderDay(); });
  for (const input of [time, amount]) {
    input.addEventListener('keydown', (/** @type {KeyboardEvent} */ ev) => {
      if (ev.key === 'Enter') commit();
      if (ev.key === 'Escape') cancel.click();
    });
  }
  queueMicrotask(() => amount.focus());

  return el('tr', {},
    el('td', {}, time),
    el('td', {}, amount),
    el('td', { textContent: e.preset }),
    el('td', { textContent: fmtVol(running, s.unit) }),
    gapCell,
    el('td', { className: 'actions' }, saveBtn, ' ', cancel),
  );
}

$('addPreset').addEventListener('change', () => {
  const p = s.presets[+$('addPreset').value];
  if (p) $('addAmount').value = toUnit(p.ml, s.unit);
  else $('addAmount').focus();
});

$('addForm').addEventListener('submit', async (/** @type {Event} */ ev) => {
  ev.preventDefault();
  const v = parseFloat($('addAmount').value);
  if (!(v > 0)) return;
  const [hh, mm] = String($('addTime').value).split(':').map(Number);
  const ml = fromUnit(v, s.unit);
  const p = s.presets[+$('addPreset').value];
  await send({
    type: 'add',
    t: tsFor(day, hh, mm, s.dayStartHour),
    ml,
    preset: p && p.ml === ml ? p.name : 'Custom',
  });
});

// ---- trend chart (hand-drawn SVG) ----
async function renderChart() {
  const keys = keysBetween(addDays(day, -(range - 1)), day);
  const data = await getDays(keys);
  const days = keys.map((k) => ({ key: k, ml: total(data[k]), count: data[k].length }));

  const W = 860, H = 240, L = 52, R = 12, T = 14, B = 30;
  const plotW = W - L - R, plotH = H - T - B;
  const max = Math.max(s.goalMl, ...days.map((d) => d.ml)) * 1.1 || 1;
  const y = (/** @type {number} */ v) => T + plotH - (v / max) * plotH;
  const slot = plotW / days.length;
  const barW = Math.max(4, slot * 0.64);

  const steps = s.unit === 'oz' ? [4, 8, 16, 32, 64, 128].map((oz) => oz * ML_PER_OZ) : [100, 250, 500, 1000, 2000, 5000];
  const step = steps.find((st) => max / st <= 5) ?? steps[steps.length - 1] * 2;
  const ticks = [];
  for (let v = step; v < max; v += step) ticks.push(v);
  const grid = ticks.map((v) => {
    return `<line class="gridline" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="axis" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${fmtVol(v, s.unit)}</text>`;
  }).join('');

  const bars = days.map((d, i) => {
    const x = L + i * slot + (slot - barW) / 2;
    const h = Math.max(d.ml ? 2 : 0, T + plotH - y(d.ml));
    const date = new Date(d.key + 'T12:00');
    const label = range <= 7 ? date.toLocaleDateString([], { weekday: 'short' }) : String(date.getDate());
    const cls = ['bar', d.ml >= s.goalMl ? 'met' : '', d.key === day ? 'selected' : ''].join(' ');
    const tip = `${fmtDay(d.key)}: ${fmtVol(d.ml, s.unit)} (${d.count} glass${d.count === 1 ? '' : 'es'})`;
    return `<g>
      <rect class="${cls}" data-day="${d.key}" x="${x}" y="${T + plotH - h}" width="${barW}" height="${h}" rx="3"><title>${tip}</title></rect>
      ${range <= 7 && d.ml ? `<text class="val" x="${x + barW / 2}" y="${T + plotH - h - 4}" text-anchor="middle">${fmtVol(d.ml, s.unit)}</text>` : ''}
      <text class="axis" x="${x + barW / 2}" y="${H - 10}" text-anchor="middle">${label}</text>
    </g>`;
  }).join('');

  const goalY = y(s.goalMl);
  $('chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily totals">
    ${grid}
    <line class="gridline" x1="${L}" x2="${W - R}" y1="${T + plotH}" y2="${T + plotH}"/>
    ${bars}
    <line class="goal" x1="${L}" x2="${W - R}" y1="${goalY}" y2="${goalY}"/>
    <text class="goal-label" x="${W - R}" y="${goalY - 5}" text-anchor="end">goal ${fmtVol(s.goalMl, s.unit)}</text>
  </svg>`;

  const met = days.filter((d) => d.ml >= s.goalMl).length;
  const avg = days.reduce((a, d) => a + d.ml, 0) / days.length;
  const best = days.reduce((a, d) => (d.ml > a.ml ? d : a), days[0]);
  $('chartSummary').textContent = best.ml
    ? `Goal met on ${met} of ${days.length} days · average ${fmtVol(avg, s.unit)}/day · best ${fmtDay(best.key)} (${fmtVol(best.ml, s.unit)})`
    : 'No water logged in this period.';
}

$('chart').addEventListener('click', (/** @type {MouseEvent} */ e) => {
  const key = /** @type {HTMLElement} */ (e.target).closest?.('[data-day]')?.getAttribute('data-day');
  if (key) setDay(key);
});

document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('active', x === b));
  range = +(/** @type {HTMLElement} */ (b).dataset.range || 7);
  renderChart();
}));

// ---- CSV export ----
function download(/** @type {Record<string, import('../lib/store.js').Entry[]>} */ byDay, /** @type {string} */ name) {
  const q = (/** @type {string} */ v) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = ['date,time,ml,preset'];
  for (const [key, list] of Object.entries(byDay)) {
    for (const e of list) {
      const d = new Date(e.t);
      lines.push([key, `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`, e.ml, q(e.preset)].join(','));
    }
  }
  // BOM so Excel reads UTF-8 names correctly.
  const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' }));
  el('a', { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

$('exportForm').addEventListener('submit', async (/** @type {Event} */ ev) => {
  ev.preventDefault();
  const keys = keysBetween($('from').value, $('to').value);
  download(await getDays(keys), `sip-water-${keys[0]}-to-${keys[keys.length - 1]}.csv`);
});
$('exportAll').addEventListener('click', async () => download(await getAllDays(), `sip-water-all-${today()}.csv`));

// ---- navigation ----
$('prev').addEventListener('click', () => setDay(addDays(day, -1)));
$('next').addEventListener('click', () => setDay(addDays(day, 1)));
$('today').addEventListener('click', () => setDay(today()));
$('date').addEventListener('change', () => { if ($('date').value) setDay($('date').value); });

document.addEventListener('keydown', (e) => {
  const tag = /** @type {HTMLElement} */ (e.target).tagName;
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(tag) || e.ctrlKey || e.altKey || e.metaKey) return;
  if (e.key === 'ArrowLeft') setDay(addDays(day, -1));
  else if (e.key === 'ArrowRight') setDay(addDays(day, 1));
  else if (e.key === 't' || e.key === 'T') setDay(today());
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) load();
  else if (area === 'local' && Object.keys(changes).some((k) => k.startsWith('log:'))) setDay(day);
});

load();
