// Max Effort — UI. All coaching math lives in engine.js; this file only renders and stores.
import { db, getMeta, setMeta } from './db.js';
import { DAYS, EXERCISES, WEEK_NAMES, expandWeek, MUSCLES, exportPlan, loadPlan, resetPlan, splitShared, copyForDay, dayUsing, renumberDays, dayIndexOf, dayLabel } from './plan.js';
import * as E from './engine.js';
import { parseHevy, parseGarmin, parseSleep, parseRestingHr } from './importers.js';
import { COACH_PROMPT } from './coach_prompt.js';
import * as X from './export.js';

const APP_VERSION = '9.7.4';
let installPrompt = null;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const S = {
  skips: [], skipSheet: null,
  exportOpen: false, report: null, exp: null,
  tab: 'home',
  data: { workouts: [], cardio: [], checkins: [], injuries: [], sleep: [], rhr: [] },
  settings: { week: 1, dayIdx: 1, weekStart: 0, bodyweight: 67.5, maxHr: 185, maxHrManual: false, easyPct: 0.75 },
  draft: null, post: null, detail: null, sheet: null, picker: null, pickQ: '',
  cardioForm: false, planWeek: null, planMode: 'week', editDay: null, editEx: null,
  progSeg: 'lifts', meSeg: 'health', trendKey: null, timerEnd: 0, timerTotal: 0, lastBackup: null, maxHrObserved: null,
};

// ---------- helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayStr = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const nowHHMM = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const fmtDate = (s) => new Date(E.toDay(s) * 86400000).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const relDate = (s) => { const d = E.daysBetween(s, todayStr()); return d === 0 ? 'Today' : d === 1 ? 'Yesterday' : d < 7 ? `${d} days ago` : fmtDate(s); };
const n1 = (x) => (x == null || Number.isNaN(x) ? '–' : Math.round(x * 10) / 10);
const r05 = (x) => Math.round(x * 2) / 2;
const num = (v) => { if (v == null) return null; const t = String(v).replace(',', '.').trim(); if (t === '') return null; const n = parseFloat(t); return Number.isFinite(n) ? n : null; };
const fmtDur = (m) => { if (m == null) return '–'; const h = Math.floor(m / 60); const mm = Math.round(m - h * 60); return h ? `${h}h ${mm}m` : `${mm}m`; };
const fmtClock = (sec) => { const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60); const s = sec % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`; };
const shortDay = (d) => (d.name.split('·')[1] || d.name).trim();
const dayNo = (d) => (d.name.split('·')[0] || '').trim();
const metaOf = (k) => EXERCISES[k] || null;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const fmtGroups = (sets, delta = 0) => { const g = []; sets.forEach((s) => { const w = r05((s.weight || 0) + delta); const l = g[g.length - 1]; if (l && l.reps === s.reps && l.w === w) l.n++; else g.push({ n: 1, reps: s.reps, w }); }); return g; };
const groupsTxt = (sets, delta = 0) => fmtGroups(sets, delta).map((x) => `${x.n}×${x.reps} @ ${x.w}`).join(' · ');
const garminDur = (date) => { const g = S.data.cardio.find((c) => c.type === 'strength-garmin' && c.date === date); return g ? g.durationMin : null; };
const easyCeil = () => Math.round(S.settings.maxHr * S.settings.easyPct);
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.remove('act'); t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2800); }
const lastIdx = () => DAYS.length - 1;
const advance = (p) => (p.dayIdx >= lastIdx() ? { week: (p.week + 1) % 5, dayIdx: 0 } : { week: p.week, dayIdx: p.dayIdx + 1 });
const pos = () => ({ week: S.settings.week, dayIdx: Math.min(S.settings.dayIdx, lastIdx()) });
const retreat = (p) => (p.dayIdx <= 0 ? { week: (p.week + 4) % 5, dayIdx: lastIdx() } : { week: p.week, dayIdx: p.dayIdx - 1 });
// The only place the plan position changes. Wrapping Week 5 -> Week 1 starts a new block (dated today).
function setPos(n, from = pos()) {
  const b = S.settings.blocks || (S.settings.blocks = []);
  const today = todayStr();
  if (from.week === 4 && n.week === 0) { if (b[b.length - 1] !== today) b.push(today); }
  else if (from.week === 0 && n.week === 4 && b.length > 1 && E.daysBetween(b[b.length - 1], today) <= 14) b.pop();
  S.settings.week = n.week; S.settings.dayIdx = n.dayIdx;
}
// Which plan days are done or skipped in the current week. The "next" day is the first day from the current
// pointer onwards that is neither, so doing days out of order never loses the one you missed.
const wkKey = () => `${currentBlockStart()}|${S.settings.week}`;
// Plan days finished today: marked done today, a workout logged today for this week, or cardio counted for it today.
function doneTodayIdx() {
  const t = todayStr(); const L = weekLog(); const out = new Set();
  DAYS.forEach((d, i) => { if (dayState(i) === 'done' && (L.doneOn || {})[d.id] === t) out.add(i); });
  for (const w of S.data.workouts) if (w.date === t && w.planRef && w.planRef.week === S.settings.week) { const i = dayIndexOf(w.planRef); if (i >= 0 && dayState(i) === 'done') out.add(i); }
  for (const c of S.data.cardio) if (c.date === t && c.planDayId) { const i = DAYS.findIndex((d) => d.id === c.planDayId); if (i >= 0 && dayState(i) === 'done') out.add(i); }
  return [...out].sort((a, b) => a - b);
}
function weekLog() {
  let L = S.settings.weekLog;
  // First time a week is tracked (or the week was set by hand): days before the current one count as done.
  if (!L || L.key !== wkKey()) L = S.settings.weekLog = { key: wkKey(), done: DAYS.slice(0, Math.min(S.settings.dayIdx, DAYS.length)).map((d) => d.id), skipped: [] };
  // older logs stored positions; convert to day ids
  for (const k of ['done', 'skipped']) L[k] = L[k].map((x) => (typeof x === 'number' ? (DAYS[x] || {}).id : x)).filter(Boolean);
  return L;
}
const dayState = (i) => { const L = weekLog(); const id = (DAYS[i] || {}).id; return L.done.includes(id) ? 'done' : L.skipped.includes(id) ? 'skipped' : null; };
async function markDay(i, status) {
  const L = weekLog();
  const id = DAYS[i].id;
  L.done = L.done.filter((x) => x !== id); L.skipped = L.skipped.filter((x) => x !== id);
  if (status) L[status].push(id);
  L.doneOn = L.doneOn || {};
  if (status === 'done') L.doneOn[id] = L.doneOn[id] || todayStr(); else delete L.doneOn[id];
  const from = pos();
  let next = -1;
  for (let k = from.dayIdx; k < DAYS.length; k++) if (!dayState(k)) { next = k; break; }
  if (next >= 0) S.settings.dayIdx = next;
  else setPos({ week: (from.week + 1) % 5, dayIdx: 0 }, { week: from.week, dayIdx: lastIdx() });
  S.planWeek = S.settings.week;
  await saveSettings();
}
const currentBlockStart = () => (S.settings.blocks || []).slice(-1)[0];
async function moveTo(n, from, msg) {
  setPos(n, pos()); S.planWeek = n.week;
  await saveSettings();
  render();
  if (from) { S.undoPos = from; toastUndo(msg || `Now on Week ${n.week + 1} · ${DAYS[n.dayIdx].name}`); } else if (msg) toast(msg);
}
function toastUndo(m) {
  const t = $('#toast');
  t.innerHTML = `${esc(m)} <button data-act="undoday" style="margin-left:10px;background:none;border:0;color:#2f8cff;font-weight:800;pointer-events:auto">Undo</button>`;
  t.classList.add('show', 'act'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show', 'act'), 5000);
}
const TYPE_LABEL = { run: 'Run', mtb: 'MTB', ride: 'Ride', walk: 'Walk', hike: 'Hike', other: 'Other', 'strength-garmin': 'Strength' };
const badgeCls = (t) => (t === 'run' ? 'run' : ['mtb', 'ride'].includes(t) ? 'mtb' : t === 'lift' || t === 'strength-garmin' ? 'lift' : 'other');
const badgeTxt = (t) => (t === 'skip' ? 'SKIP' : t === 'lift' || t === 'strength-garmin' ? 'LIFT' : t === 'run' ? 'RUN' : t === 'mtb' ? 'MTB' : t === 'ride' ? 'RIDE' : t === 'hike' ? 'HIKE' : t === 'walk' ? 'WALK' : '•');

async function saveSettings() { await setMeta('settings', S.settings); }
async function saveDraft() { await setMeta('draft', S.draft); }
let planSaveT;
function savePlan() { clearTimeout(planSaveT); planSaveT = setTimeout(() => setMeta('plan', exportPlan()), 250); }

async function loadAll() {
  for (const k of Object.keys(S.data)) S.data[k] = await db.all(k);
  S.settings = { ...S.settings, ...(await getMeta('settings', {})) };
  S.draft = await getMeta('draft', null);
  S.lastBackup = await getMeta('lastBackup', null);
  S.skips = await getMeta('skips', []);
  const plan = await getMeta('plan', null);
  if (plan) loadPlan(plan);
  if (splitShared(todayStr())) await setMeta('plan', exportPlan());
  renumberDays();
  // Dumbbells go up in 2.5 kg steps; fix plans saved before that was set.
  for (const m of Object.values(EXERCISES)) if (m.step === 2) m.step = 2.5;
  // Max HR: use the highest value Garmin has recorded unless the user set one by hand.
  const hrs = S.data.cardio.filter((c) => ['run', 'mtb', 'ride'].includes(c.type) && c.maxHr).map((c) => c.maxHr);
  S.maxHrObserved = hrs.length ? Math.max(...hrs) : null;
  if (!S.settings.maxHrManual && S.maxHrObserved) S.settings.maxHr = S.maxHrObserved;
  // First run: the current block started (current week - 1) weeks before this week's start.
  if (!Array.isArray(S.settings.blocks) || !S.settings.blocks.length) S.settings.blocks = [E.addDays(E.weekStartOf(todayStr(), S.settings.weekStart), -7 * S.settings.week)];
}

async function seedIfEmpty() {
  if (await getMeta('seeded', false)) return;
  try {
    const r = await fetch('data/seed.json');
    if (!r.ok) return;
    const seed = await r.json();
    await db.putMany('workouts', seed.workouts); await db.putMany('cardio', seed.cardio);
    await db.putMany('sleep', seed.sleep); await db.putMany('rhr', seed.rhr);
    await setMeta('seeded', true);
    setTimeout(() => toast(`Loaded ${seed.cardio.length} Garmin activities and ${seed.workouts.length} Hevy sessions.`), 400);
  } catch { /* offline first run: import on the Me tab */ }
}

// ---------- coaching context ----------
function context() {
  const t = todayStr();
  const checkin = S.data.checkins.find((c) => c.date === t) || null;
  const lm = E.loadMetrics(S.data.workouts, S.data.cardio, t);
  const creeps = E.rpeCreep(S.data.workouts, S.settings.bodyweight);
  const recentSleepDaily = S.data.checkins.filter((c) => c.sleepH != null && E.daysBetween(c.date, t) >= 0 && E.daysBetween(c.date, t) < 7).map((c) => c.sleepH);
  const recovery = E.recoveryStatus({ checkin, sleepWeeks: S.data.sleep, rhrWeeks: S.data.rhr, injuries: S.data.injuries, load: lm, creeps, recentSleepDaily });
  return { t, checkin, lm, creeps, recovery, fatigue: E.fatigueLabel(lm, recovery) };
}

const yesterdayCardio = (t) => S.data.cardio.filter((c) => c.date === E.addDays(t, -1) && c.type !== 'strength-garmin');

function suggestionsFor(dayIdx, week, ctx) {
  return expandWeek(dayIdx, week).map((ex) => {
    const history = E.historyFor(S.data.workouts, ex.id);
    const sug = E.suggestExercise({ key: ex.id, history, today: ctx.t, week, recovery: ctx.recovery, bodyweight: S.settings.bodyweight, yesterday: yesterdayCardio(ctx.t) });
    return { ex, sug };
  });
}

function nextExposure(key, from) {
  let p = from;
  for (let i = 0; i < 5 * DAYS.length; i++) {
    p = advance(p);
    const d = DAYS[p.dayIdx];
    if (d.type === 'strength' && d.exercises.some((e) => e.id === key)) return p;
  }
  return null;
}

// Garmin is the backbone of the activity feed. Hevy/app sets attach to the Garmin strength session.
function feedItems() {
  const strength = E.strengthSessions(S.data.workouts, S.data.cardio).map((s) => ({
    kind: 'strength', date: s.date, start: s.start, type: 'lift', workout: s.workout, garmin: s.garmin,
    id: s.workout ? `w:${s.workout.id}` : `c:${s.garmin.id}`,
    title: s.workout ? s.workout.title : (s.garmin.title || 'Strength'), durationMin: s.durationMin, avgHr: s.avgHr,
  }));
  const cardio = S.data.cardio.filter((c) => c.type !== 'strength-garmin').map((c) => ({ kind: 'cardio', date: c.date, start: c.start, type: c.type, cardio: c, id: `c:${c.id}`, title: c.title || TYPE_LABEL[c.type], durationMin: c.durationMin, avgHr: c.avgHr }));
  const skips = (S.skips || []).map((k) => ({ kind: 'skip', date: k.date, start: '00:00', type: 'skip', skip: k, id: `s:${k.id}`, title: `Skipped · ${k.dayName}` }));
  return strength.concat(cardio, skips).sort((a, b) => (a.date + a.start < b.date + b.start ? 1 : -1));
}

// ---------- render ----------
const TITLES = { home: 'Max Effort', workout: 'Workout', plan: 'Plan', progress: 'Progress', me: 'Me' };
function render() {
  const y = window.scrollY;
  document.querySelectorAll('#tabs button').forEach((b) => {
    b.classList.toggle('on', b.dataset.tab === S.tab);
    b.setAttribute('aria-current', b.dataset.tab === S.tab ? 'page' : 'false');
    const dot = b.querySelector('.dot');
    const want = b.dataset.tab === 'workout' && S.draft && S.tab !== 'workout';
    if (want && !dot) b.insertAdjacentHTML('beforeend', '<span class="dot" aria-label="Workout in progress"></span>');
    if (!want && dot) dot.remove();
  });
  const ctx = context();
  let back = null;
  let title = TITLES[S.tab];
  let body = '';
  if (S.tab === 'home') {
    if (S.detail) { back = 'detailback'; title = 'Activity'; body = detailView(); } else body = homeView(ctx);
  } else if (S.tab === 'workout') {
    if (S.post) { title = 'Workout complete'; body = postView(); }
    else if (S.draft) { title = S.draft.editingId ? 'Edit workout' : 'Logging'; body = workoutView(); }
    else if (S.cardioForm) { back = 'cardioback'; title = 'Log cardio'; body = cardioForm(ctx); }
    else body = startView(ctx);
  } else if (S.tab === 'plan') {
    if (S.splitOrder) { back = 'orddone'; title = 'Split order'; body = splitOrderView(); }
    else if (S.editEx) { back = 'exback'; title = 'Exercise'; body = exerciseEditor(); }
    else if (S.editDay != null) { back = 'dayback'; title = 'Edit day'; body = dayEditor(); }
    else body = planView();
  } else if (S.tab === 'progress') body = progressView(ctx);
  else if (S.exportOpen) { back = 'exportback'; title = 'Export'; body = exportView(ctx); }
  else body = meView(ctx);

  $('#top').innerHTML = `${back ? `<button class="back" data-act="${back}">‹ Back</button>` : ''}<h1 class="${back ? 'grow' : ''}" style="${back ? 'font-size:18px;text-align:center' : ''}">${esc(title)}</h1>
    <button class="status-btn ${ctx.recovery.status}" data-act="gohealth" aria-label="Recovery status ${ctx.recovery.status}">${ctx.recovery.status}</button>`;
  $('#app').innerHTML = body;
  renderOverlay();
  renderReport();
  window.scrollTo(0, y);
  tick();
}

function renderOverlay() {
  let h = '';
  if (S.daySheet) h = daySheetOverlay();
  else if (S.skipSheet) h = skipOverlay();
  else if (S.review) h = reviewOverlay();
  else if (S.sheet) {
    h = `<div class="backdrop" data-act="sheetclose"><div class="sheet" data-act="noop"><div class="grab"></div>${S.sheet.title ? `<h3>${esc(S.sheet.title)}</h3>` : ''}
      ${S.sheet.items.map((it) => `<button class="item ${it.danger ? 'danger' : ''}" data-act="${it.act}" ${Object.entries(it.data || {}).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}>${esc(it.label)}</button>`).join('')}
      <button class="item" data-act="sheetclose" style="text-align:center;color:var(--muted)">Cancel</button></div></div>`;
  } else if (S.picker) {
    h = `<div class="picker" role="dialog" aria-label="Choose exercise"><div class="ph"><button class="linkbtn" data-act="pkclose">Cancel</button><b>${S.picker.mode === 'replace' || S.picker.mode === 'planswap' ? 'Swap exercise' : 'Add exercise'}</b><span style="width:52px"></span></div>
      <div class="ps"><input class="f" id="pk-q" type="search" placeholder="Search exercise" value="${esc(S.pickQ)}" autocomplete="off"></div><div class="pl" id="pk-list">${pickList()}</div></div>`;
  }
  $('#overlay').innerHTML = h;
  if (h) $('#toast').classList.remove('show');
}

function recoveryCard(ctx, full = true) {
  const r = ctx.recovery;
  const head = r.status === 'GREEN' ? 'Good to train as planned' : r.status === 'YELLOW' ? 'Train, but modify' : 'Recover first';
  let h = `<div class="card"><div class="row between"><div><div class="eyebrow" style="color:inherit"><span class="status-btn ${r.status}" style="padding:3px 9px">${r.status}</span></div><div class="b" style="margin-top:6px;font-size:17px">${head}</div></div></div>`;
  if (r.reasons.length) h += `<ul class="dots">${r.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  if (full) {
    if (r.conflicts.length) h += `<div class="callout warn"><b>Data conflict.</b> ${r.conflicts.map(esc).join(' ')}</div>`;
    if (r.info.length) h += `<ul class="dots muted">${r.info.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
    if (r.missing.length) h += `<div class="tiny faint" style="margin-top:6px">Missing: ${esc(r.missing.join(', '))}. Status is less reliable without them.</div>`;
  } else if (r.info.length || r.conflicts.length) h += `<button class="linkbtn" data-act="gohealth">See details</button>`;
  return h + '</div>';
}

// ---------- HOME ----------
function homeView(ctx) {
  const p = pos();
  const day = DAYS[p.dayIdx];
  let h = '';
  const daysSince = S.lastBackup ? E.daysBetween(S.lastBackup.slice(0, 10), ctx.t) : null;
  if (daysSince == null || daysSince > 14) h += `<div class="callout warn" style="margin:0 0 12px">${daysSince == null ? 'No backup yet.' : `Last backup ${daysSince} days ago.`} Your log lives only on this phone. <button class="linkbtn" data-act="gobackup" style="padding:0;color:inherit;text-decoration:underline">Back up now</button></div>`;

  if (installPrompt && !isStandalone()) h += '<div class="callout info row between" style="margin:0 0 12px"><span>Install Max Effort as an app on this phone.</span><button class="btn primary sm" data-act="install">Install</button></div>';
  // Today
  S.shownDay = ctx.t;
  const todayTxt = new Date(`${ctx.t}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const doneT = doneTodayIdx().filter((i) => i !== p.dayIdx);
  h += `<div class="card"><div style="font-size:17px;font-weight:800;margin-bottom:6px">Today · ${esc(todayTxt)}</div>
    ${doneT.map((i) => `<button data-act="daysheet" data-d="${i}" style="display:block;width:100%;text-align:left;min-height:44px;margin:0 0 10px;padding:10px 12px;border:0;border-radius:12px;background:rgba(48,209,88,.14);color:var(--good);font:inherit;font-size:15px;font-weight:800;cursor:pointer">✓ Done today: ${esc(DAYS[i].name)} · ${esc(DAYS[i].title)}</button>`).join('')}
    <div class="eyebrow">${doneT.length ? 'Next up · ' : ''}Week ${p.week + 1} of 5 · ${esc(WEEK_NAMES[p.week])} · ${esc(dayNo(day))} of ${DAYS.length}</div><div class="big">${esc(shortDay(day))}</div><div class="muted">${esc(day.title)}</div>`;
  E.sequencingWarnings({ dayType: day.type, dayTitle: day.title, today: ctx.t, cardio: S.data.cardio, workouts: S.data.workouts }).forEach((w) => { h += `<div class="callout warn">${esc(w)}</div>`; });
  if (day.type === 'strength') {
    const sugg = suggestionsFor(p.dayIdx, p.week, ctx);
    h += '<ul class="clean" style="margin-top:10px">';
    for (const { ex, sug } of sugg) {
      const work = ex.sets.filter((s) => s.type === 'work');
      const tag = sug.action === 'Increase' ? ' <span class="tag up">▲</span>' : sug.action === 'Reduce' ? ' <span class="tag down">▼</span>' : '';
      h += `<li><div class="b" style="font-weight:650">${esc(ex.name)}</div><div class="muted small">${groupsTxt(work, sug.delta)} kg${tag}</div></li>`;
    }
    h += '</ul>';
    h += S.draft ? '<button class="btn primary block" data-act="resume" style="margin-top:12px">Resume workout</button>' : `<div class="daynav" style="grid-template-columns:2fr 1fr;margin-top:12px"><button class="btn primary" data-act="startday" data-d="${p.dayIdx}">Start ${esc(shortDay(day))}</button><button class="btn" data-act="skipopen" data-d="${p.dayIdx}">Skip</button></div>`;
  } else if (day.type === 'cardio') {
    h += `<p class="small" style="margin:10px 0 0">${esc(day.note || '')}</p><div class="callout info">Keep average HR under <b>${easyCeil()} bpm</b>${S.settings.maxHrManual ? '' : ` (75% of your highest Garmin HR, ${S.settings.maxHr})`}.</div>
      <div class="daynav" style="grid-template-columns:2fr 1fr;margin-top:12px"><button class="btn primary" data-act="cardio">Log cardio</button><button class="btn" data-act="skipopen" data-d="${p.dayIdx}">Skip</button></div>`;
  } else {
    h += `<p class="small" style="margin:10px 0 0">${esc(day.note || '')}</p><div class="daynav" style="grid-template-columns:2fr 1fr;margin-top:12px"><button class="btn primary" data-act="restdone">Rest day done</button><button class="btn" data-act="skipopen" data-d="${p.dayIdx}">Skip</button></div>`;
  }
  h += `<div class="strip" role="group" aria-label="Days this week">${DAYS.map((d, i) => `<button data-act="daysheet" data-d="${i}" class="${i === p.dayIdx ? 'now' : dayState(i) === 'done' ? 'past' : dayState(i) === 'skipped' ? 'skip' : ''}" aria-label="${esc(d.name)}: ${dayState(i) || 'to do'}. Tap to see or change" ${i === p.dayIdx ? 'aria-current="true"' : ''}><b>${i + 1}</b>${esc(shortDay(d).split(' ')[0].slice(0, 7))}</button>`).join('')}</div>
    <div class="daynav"><button class="btn sm" data-act="prevday">‹ Back a day</button><button class="btn sm" data-act="skipday">Next day ›</button></div>
    <div class="row between" style="margin-top:2px"><span class="tiny faint"><span style="color:var(--good)">■</span> done · <span style="color:var(--faint)">■</span> skipped · tap a day to see or change it</span><button class="linkbtn" data-act="goplan">Full plan</button></div></div>`;

  // Recovery + check-in
  h += recoveryCard(ctx, false);
  if (!ctx.checkin) h += checkinCard(null, true);

  // Week (Garmin)
  const ws = E.weekStartOf(ctx.t, S.settings.weekStart);
  const wr = E.weeklyReport({ workouts: S.data.workouts, cardio: S.data.cardio, weekStartDay: ws, bodyweight: S.settings.bodyweight });
  h += `<h2>This week</h2><div class="stats four"><div class="stat"><span>Lifts</span><b>${wr.strengthSessions}</b></div><div class="stat"><span>Run km</span><b>${wr.runKm}</b></div><div class="stat"><span>Ride km</span><b>${wr.mtbKm}</b></div><div class="stat"><span>Time</span><b>${fmtDur(wr.totalMin)}</b></div></div>`;

  // Feed
  h += '<h2>Recent activity</h2>';
  h += feedItems().slice(0, 12).map(feedCard).join('') || '<div class="card muted">No activity yet.</div>';
  h += '<div class="tiny faint" style="text-align:center">Activities, durations and heart rate from Garmin. Sets and reps from Max Effort and Hevy.</div>';
  return h;
}

function feedCard(it) {
  const meta = [];
  if (it.kind === 'skip') {
    return `<div class="card tap" data-act="detail" data-id="${esc(it.id)}" style="opacity:.8"><div class="feed"><div class="badge other" style="background:var(--surface2);color:var(--muted)">SKIP</div><div class="grow"><div class="row between"><span class="b">${esc(it.title)}</span><span class="tiny muted">${relDate(it.date)}</span></div><div class="meta">${esc(it.skip.reason)}${it.skip.note ? ` · ${esc(it.skip.note)}` : ''}</div></div></div></div>`;
  }
  if (it.kind === 'strength') {
    meta.push(`<b>${fmtDur(it.durationMin)}</b>`);
    if (it.avgHr) meta.push(`${it.avgHr} bpm`);
    if (it.workout) {
      const ws = it.workout.exercises.flatMap((e) => E.workSets(e));
      meta.push(`${ws.length} sets`, `${Math.round(it.workout.exercises.reduce((s, e) => s + E.volumeLoad(e), 0)).toLocaleString()} kg`);
    } else if (it.garmin && it.garmin.sets) meta.push(`${it.garmin.sets} sets (Garmin)`);
    else meta.push('<span class="faint">no sets logged</span>');
  } else {
    const c = it.cardio;
    if (c.distanceKm) meta.push(`<b>${n1(c.distanceKm)} km</b>`);
    meta.push(fmtDur(c.durationMin));
    if (c.avgHr) meta.push(`<span style="${c.avgHr > easyCeil() && c.durationMin >= 40 && ['run', 'mtb', 'ride'].includes(c.type) ? 'color:var(--warn)' : ''}">${c.avgHr} bpm</span>`);
    if (c.ascentM) meta.push(`↑${Math.round(c.ascentM)} m`);
  }
  const sub = it.kind === 'strength' && it.workout ? `<div class="tiny faint" style="margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(it.workout.exercises.map((e) => (metaOf(e.key) || {}).name || e.name).join(', '))}</div>` : '';
  return `<div class="card tap" data-act="detail" data-id="${esc(it.id)}"><div class="feed"><div class="badge ${badgeCls(it.type)}">${badgeTxt(it.type)}</div><div class="grow"><div class="row between"><span class="b">${esc(it.title)}</span><span class="tiny muted">${relDate(it.date)}</span></div><div class="meta">${meta.join('')}</div>${sub}</div></div></div>`;
}

function detailView() {
  const it = feedItems().find((x) => x.id === S.detail);
  if (!it) { S.detail = null; return ''; }
  if (it.kind === 'skip') {
    const k = it.skip;
    return `<div class="card"><div class="b" style="font-size:19px">${esc(it.title)}</div><div class="muted small">${fmtDate(k.date)} · Week ${k.week + 1}${k.block ? ` · Block ${k.block}` : ''}</div>
      <div class="small" style="margin-top:10px"><b>Reason:</b> ${esc(k.reason)}${k.note ? `<br><b>Note:</b> ${esc(k.note)}` : ''}</div></div>
      <button class="btn block" data-act="undoskip" data-id="${esc(k.id)}">Undo skip</button>`;
  }
  let h = `<div class="card"><div class="feed"><div class="badge ${badgeCls(it.type)}">${badgeTxt(it.type)}</div><div class="grow"><div class="b" style="font-size:19px">${esc(it.title)}</div><div class="muted small">${fmtDate(it.date)} · ${esc(it.start)}</div></div></div>`;
  if (it.kind === 'strength') {
    const g = it.garmin;
    h += `<div class="stats" style="margin-top:12px"><div class="stat"><span>Duration</span><b>${fmtDur(it.durationMin)}</b></div><div class="stat"><span>Avg HR</span><b>${g && g.avgHr ? g.avgHr : '–'}</b></div><div class="stat"><span>Max HR</span><b>${g && g.maxHr ? g.maxHr : '–'}</b></div></div>`;
    if (!g) h += '<div class="tiny faint" style="margin-top:8px">No matching Garmin activity, so duration is from the logger.</div>';
    h += '</div>';
    if (it.workout) {
      for (const e of it.workout.exercises) {
        const m = metaOf(e.key) || {};
        if (e.skipped) { h += `<div class="card" style="opacity:.75"><div class="row between"><h3 class="muted">${esc(m.name || e.name)}</h3><span class="tag">skipped</span></div><div class="small muted">${esc(e.skipReason || '')}</div></div>`; continue; }
        const best = E.sessionBest(e, S.settings.bodyweight, !!m.bodyweight);
        h += `<div class="card"><div class="row between"><h3 style="color:var(--accent)">${esc(m.name || e.name)}</h3>${best ? `<span class="tiny muted">e1RM ${best.e1rm}</span>` : ''}</div><table class="t" style="margin-top:6px"><tr><th>Set</th><th class="n">kg</th><th class="n">Reps</th><th class="n">RPE</th></tr>
          ${(() => { let wi = 0; return e.sets.map((s) => `<tr><td>${s.type === 'warmup' ? '<span style="color:var(--warn)">W</span>' : ++wi}</td><td class="n">${n1(s.weight)}</td><td class="n">${s.reps ?? '–'}</td><td class="n">${s.rpe ?? '–'}</td></tr>`).join(''); })()}</table>
          ${e.pain ? `<div class="callout bad">Pain ${e.pain.severity}/10 ${esc(e.pain.region || '')}</div>` : ''}${e.notes ? `<div class="small muted" style="margin-top:6px">${esc(e.notes)}</div>` : ''}</div>`;
      }
      h += `<button class="btn block" data-act="editworkout" data-id="${esc(it.workout.id)}">Edit sets</button><button class="btn block" data-act="exportday" data-d="${esc(it.date)}">Export this day</button>`;
      h += `<button class="btn danger block" data-act="delworkout" data-id="${esc(it.workout.id)}">Delete this workout</button>`;
    } else {
      h += `<div class="card"><div class="small">Garmin recorded this session${g.sets ? ` (${g.sets} sets, ${g.reps} reps counted by the watch)` : ''}, but no sets were logged, so it counts towards training load only.</div></div>`;
    }
  } else {
    const c = it.cardio;
    const pace = c.type === 'run' && c.distanceKm ? c.durationMin / c.distanceKm : null;
    const speed = c.distanceKm && c.durationMin ? c.distanceKm / (c.durationMin / 60) : null;
    const cells = [['Distance', c.distanceKm ? `${n1(c.distanceKm)} km` : '–'], ['Time', fmtDur(c.durationMin)], pace ? ['Pace', `${Math.floor(pace)}:${String(Math.round((pace % 1) * 60)).padStart(2, '0')}/km`] : ['Speed', speed ? `${n1(speed)} km/h` : '–'],
      ['Avg HR', c.avgHr ?? '–'], ['Max HR', c.maxHr ?? '–'], ['Climb', c.ascentM ? `${Math.round(c.ascentM)} m` : '–']];
    if (c.power) cells.push(['Power', `${c.power} W`]);
    if (c.gct) cells.push(['GCT', `${c.gct} ms`]);
    if (c.stride) cells.push(['Stride', `${c.stride} m`]);
    if (c.te) cells.push(['Aerobic TE', c.te]);
    if (c.rpe) cells.push(['RPE', c.rpe]);
    h += `<div class="stats" style="margin-top:12px">${cells.map(([k, v]) => `<div class="stat"><span>${k}</span><b>${esc(v)}</b></div>`).join('')}</div>`;
    if (c.avgHr && ['run', 'mtb', 'ride'].includes(c.type) && c.durationMin >= 40) {
      h += c.avgHr > easyCeil() ? `<div class="callout warn">Average HR ${c.avgHr} is above your easy ceiling (${easyCeil()}). Fine for a planned hard session; not for an easy day.</div>` : `<div class="callout good">Average HR ${c.avgHr} is within your easy ceiling (${easyCeil()}).</div>`;
    }
    if (c.notes) h += `<div class="small muted" style="margin-top:8px">${esc(c.notes)}</div>`;
    if (['run', 'mtb', 'ride', 'hike', 'walk', 'other'].includes(c.type) && E.daysBetween(c.date, todayStr()) <= 7) {
      const opts = DAYS.map((x, i) => ({ x, i, st: dayState(i) })).filter(({ x }) => x.type === 'cardio');
      const cur = c.planDayId ? DAYS.findIndex((d) => d.id === c.planDayId) : -1;
      h += `<label class="l">Counts as (this week's plan)</label><select class="f" data-act="cardioplan" data-id="${esc(c.id)}"><option value="" ${cur < 0 ? 'selected' : ''}>Not a plan day (extra session)</option>${opts.map(({ x, i, st }) => `<option value="${i}" ${cur === i ? 'selected' : ''}>${esc(x.name)} — ${esc(x.title)}${st && cur !== i ? ` (${st === 'skipped' ? 'was skipped' : 'already done'})` : ''}</option>`).join('')}</select>`;
    }
    h += `</div><button class="btn block" data-act="exportday" data-d="${esc(it.date)}">Export this day</button><button class="btn danger block" data-act="delcardio" data-id="${esc(c.id)}">Delete this activity</button>`;
  }
  return h;
}

function checkinCard(c, compact) {
  c = c || {};
  return `<div class="card"><h3>${compact ? 'How are you today?' : 'Daily check-in'}</h3><div class="tiny muted">30 seconds. This is what makes the recovery status trustworthy.</div>
    <div class="grid2"><div><label class="l" for="k-sleep">Sleep (hours)</label><input class="f" id="k-sleep" type="number" step="0.25" inputmode="decimal" value="${c.sleepH ?? ''}"></div>
    <div><label class="l" for="k-rhr">Resting HR</label><input class="f" id="k-rhr" type="number" inputmode="numeric" placeholder="from watch" value="${c.restingHr ?? ''}"></div>
    <div><label class="l" for="k-sore">Soreness 0–10</label><input class="f" id="k-sore" type="number" min="0" max="10" inputmode="numeric" value="${c.soreness ?? ''}"></div>
    <div><label class="l" for="k-mot">Motivation 0–10</label><input class="f" id="k-mot" type="number" min="0" max="10" inputmode="numeric" value="${c.motivation ?? ''}"></div></div>
    ${compact ? '' : `<label class="l" for="k-notes">Notes</label><input class="f" id="k-notes" value="${esc(c.notes || '')}">`}
    <button class="btn primary block" data-act="savecheckin" style="margin-top:12px">Save check-in</button></div>`;
}

function athleteInfo() {
  const st = S.settings;
  return { ageYears: st.birthYear ? new Date().getFullYear() - st.birthYear : 'not set', heightCm: st.heightCm ?? 'not set', bodyweightKg: st.bodyweight };
}

// ---------- DAY STATUS ----------
function statusPill(i) {
  const st = dayState(i); const isNext = i === pos().dayIdx;
  const [txt, style] = st === 'done' ? ['✓ Done', 'background:var(--good);color:#062b13'] : st === 'skipped' ? ['Skipped', 'background:var(--surface2);color:var(--muted);text-decoration:line-through'] : isNext ? ['Next', 'background:var(--accent);color:#fff'] : ['To do', 'background:transparent;color:var(--muted);border:1px solid var(--line)'];
  return `<button class="next-badge" data-act="daysheet" data-d="${i}" style="${style};border:0;cursor:pointer;font:inherit;font-size:11px;font-weight:900;letter-spacing:.5px;padding:3px 8px;${st || isNext ? '' : 'border:1px solid var(--line)'}" aria-label="Status ${txt}. Tap to change">${txt} ▾</button>`;
}
function dayLinks(i) {
  const t = todayStr(); const id = DAYS[i].id; const recent = (d) => E.daysBetween(d, t) <= 7 && d <= t;
  const items = [];
  for (const w of S.data.workouts) if (w.planRef && w.planRef.week === S.settings.week && dayIndexOf(w.planRef) === i && recent(w.date)) items.push({ kind: 'w', id: `w:${w.id}`, date: w.date, label: `${w.title} · ${fmtDur(w.durationMin)}` });
  for (const c of S.data.cardio) if (c.planDayId === id && recent(c.date)) items.push({ kind: 'c', id: `c:${c.id}`, date: c.date, label: `${TYPE_LABEL[c.type] || c.type}${c.distanceKm ? ` · ${n1(c.distanceKm)} km` : ''} · ${fmtDur(c.durationMin)}` });
  for (const k of S.skips || []) if (k.week === S.settings.week && dayIndexOf(k) === i && recent(k.date)) items.push({ kind: 's', id: `s:${k.id}`, date: k.date, label: `Skipped · ${k.reason}${k.note ? ` — ${k.note}` : ''}` });
  return items.sort((a, b) => (a.date < b.date ? 1 : -1));
}
function daySheetOverlay() {
  const i = S.daySheet.i; const d = DAYS[i];
  if (!d) { S.daySheet = null; return ''; }
  const st = dayState(i) || 'todo';
  const links = dayLinks(i);
  const seg = [['todo', 'To do'], ['done', 'Done'], ['skipped', 'Skipped']].map(([v, l]) => `<button data-act="dayset" data-v="${v}" class="${st === v ? 'on' : ''}">${l}</button>`).join('');
  const action = d.type === 'strength' ? `<button class="btn primary block" data-act="startday" data-d="${i}">Start ${esc(shortDay(d))}</button>` : d.type === 'cardio' ? '<button class="btn primary block" data-act="cardio">Log cardio</button>' : '';
  return `<div class="backdrop" data-act="dayclose"><div class="sheet" data-act="noop"><div class="grab"></div>
    <h3 style="margin-bottom:2px">${esc(d.name)}</h3><div class="small muted" style="text-align:center;margin-bottom:12px">${esc(d.title)} · Week ${S.settings.week + 1} (${esc(WEEK_NAMES[S.settings.week])})${i === pos().dayIdx ? ' · <b style="color:var(--accent)">next up</b>' : ''}</div>
    <label class="l" style="margin-top:0">Status this week</label><div class="seg" style="margin-bottom:12px">${seg}</div>
    <label class="l">Logged for this day</label>
    ${links.length ? links.map((x) => `<button class="item" data-act="daylink" data-id="${esc(x.id)}" style="min-height:46px;font-size:15px">${esc(relDate(x.date))} · ${esc(x.label)} ›</button>`).join('') : `<div class="small muted" style="margin-bottom:10px">Nothing linked yet.${d.type === 'cardio' ? ' A run or ride can be linked from its activity page (Counts as).' : ''}</div>`}
    ${action}
    ${i === pos().dayIdx ? '' : `<button class="btn block" data-act="daynext" data-d="${i}">Make this my next day</button>`}
    <button class="item" data-act="dayclose" style="text-align:center;color:var(--muted);margin-top:8px">Close</button></div></div>`;
}
async function setDayStatus(i, v) {
  const id = DAYS[i].id; const t = todayStr();
  const dropSkips = async () => { S.skips = (S.skips || []).filter((k) => !(k.week === S.settings.week && dayIndexOf(k) === i && E.daysBetween(k.date, t) <= 7)); await setMeta('skips', S.skips); };
  if (v === 'skipped') { S.daySheet = null; S.skipSheet = { dayIdx: i, reason: '', date: t, note: '' }; renderOverlay(); return; }
  if (v === 'done') { await dropSkips(); await markDay(i, 'done'); toast(`${DAYS[i].name} marked done.`); }
  if (v === 'todo') {
    await dropSkips();
    // unlink cardio that counted for this day this week
    for (const c of S.data.cardio) if (c.planDayId === id && E.daysBetween(c.date, t) <= 7) { delete c.planDayId; await db.put('cardio', c); }
    await markDay(i, null);
    if (i < S.settings.dayIdx) { S.settings.dayIdx = i; await saveSettings(); }
    toast(`${DAYS[i].name} is back on your to-do list.`);
  }
  S.daySheet = null; renderOverlay(); render();
}

// ---------- SKIP ----------
const SKIP_REASONS = ['Swapped days', 'Tired', 'Sick', 'Pain / injury', 'No time', 'Travel', 'Weather', 'Other'];
function skipOverlay() {
  const k = S.skipSheet;
  const d = DAYS[k.dayIdx];
  return `<div class="backdrop" data-act="skipclose"><div class="sheet" data-act="noop"><div class="grab"></div><h3>Skip ${esc(d.name)}</h3>
    <div class="small muted" style="text-align:center;margin-bottom:10px">Week ${S.settings.week + 1}. It's recorded as skipped, so your history and coach see it.</div>
    <label class="l">Why?</label><div class="chips" style="flex-wrap:wrap;margin:0">${SKIP_REASONS.map((r) => `<button class="chip ${k.reason === r ? 'on' : ''}" data-act="skipreason" data-v="${esc(r)}">${esc(r)}</button>`).join('')}</div>
    <div class="grid2"><div><label class="l">Day it was planned for</label><input class="f" type="date" id="skip-date" value="${k.date}" max="${todayStr()}"></div><div><label class="l">Note</label><input class="f" id="skip-note" value="${esc(k.note || '')}" placeholder="optional"></div></div>
    <button class="btn primary block" data-act="skipsave" style="margin-top:14px">Skip it</button><button class="item" data-act="skipclose" style="text-align:center;color:var(--muted);margin-top:8px">Cancel</button></div></div>`;
}
async function saveSkip() {
  const k = S.skipSheet;
  const date = ($('#skip-date') && $('#skip-date').value) || todayStr();
  const rec = { id: `skip-${Date.now()}`, date, week: S.settings.week, dayIdx: k.dayIdx, dayId: DAYS[k.dayIdx].id, dayName: DAYS[k.dayIdx].name, title: DAYS[k.dayIdx].title, reason: k.reason || 'Other', note: ($('#skip-note') && $('#skip-note').value) || '', block: (S.settings.blocks || []).length };
  S.skips.push(rec); await setMeta('skips', S.skips);
  S.skipSheet = null;
  await markDay(k.dayIdx, 'skipped');
  render(); window.scrollTo(0, 0);
  toast(`${rec.dayName} skipped. Next: ${DAYS[pos().dayIdx].name}.`);
}
async function undoSkip(id) {
  const rec = S.skips.find((x) => x.id === id);
  S.skips = S.skips.filter((x) => x.id !== id); await setMeta('skips', S.skips);
  if (rec && rec.week === S.settings.week) {
    const L = weekLog(); const di = dayIndexOf(rec); const id = rec.dayId || (DAYS[di] || {}).id;
    L.skipped = L.skipped.filter((x) => x !== id);
    if (di >= 0 && di < S.settings.dayIdx) S.settings.dayIdx = di;
    await saveSettings();
  }
  S.detail = null; render(); toast('Skip removed. That day is back in your week.');
}

// ---------- WORKOUT: start screen ----------
function startView(ctx) {
  const p = pos();
  let h = `<h2 style="margin-top:4px">Quick start</h2><div class="grid2"><button class="btn" data-act="startempty">+ Empty workout</button><button class="btn" data-act="cardio">Log run / ride</button></div>`;
  h += `<h2>Routines · Week ${p.week + 1} (${esc(WEEK_NAMES[p.week])})</h2>`;
  DAYS.forEach((d, i) => {
    const st = dayState(i);
    const next = statusPill(i);
    if (d.type === 'strength') {
      h += `<div class="card routine"><div class="grow"><div class="b">${esc(shortDay(d))} <span class="muted small">· ${esc(d.title)}</span>${next}</div><div class="small muted">${esc(d.exercises.map((e) => (metaOf(e.id) || { name: e.id }).name).join(', '))}</div></div>
        <button class="btn primary sm" data-act="startday" data-d="${i}">Start</button></div>`;
    } else if (d.type === 'cardio') {
      h += `<div class="card routine"><div class="grow"><div class="b">${esc(shortDay(d))}${next}</div><div class="small muted">${esc(d.title)}</div></div><button class="btn sm" data-act="cardio">Log</button></div>`;
    }
  });
  h += '<div class="tiny faint" style="text-align:center;margin-top:6px">Starting a routine uses this week\'s numbers, adjusted by your last RPE and today\'s recovery.</div>';
  return h;
}

function draftExercise(key, fallbackName, planSets, ctx, week) {
  const m = metaOf(key) || { name: fallbackName, step: 2.5, rpe: 8, compound: false };
  const hist = E.historyFor(S.data.workouts, key);
  const sug = E.suggestExercise({ key, history: hist, today: ctx.t, week, recovery: ctx.recovery, bodyweight: S.settings.bodyweight, yesterday: yesterdayCardio(ctx.t) });
  const prevSets = hist[0] ? E.workSets(hist[0].ex) : [];
  let sets;
  if (planSets) {
    sets = planSets.map((s) => ({ type: s.type, weight: s.type === 'work' ? r05(s.weight + sug.delta) : s.weight, reps: s.reps, rpe: null, done: false, planWeight: s.weight, planReps: s.reps }));
  } else {
    const src = prevSets.length ? prevSets : [{ weight: null, reps: null }, { weight: null, reps: null }, { weight: null, reps: null }];
    sets = src.map((s) => ({ type: 'work', weight: s.weight, reps: s.reps ?? null, rpe: null, done: false, planWeight: null, planReps: null }));
  }
  return {
    key, name: m.name || fallbackName, rpeTarget: sug.rpeTarget, compound: !!m.compound, step: m.step || 2.5,
    suggestion: { action: sug.action, delta: sug.delta, why: sug.why, flags: sug.flags },
    prev: prevSets.map((s) => ({ weight: s.weight, reps: s.reps, rpe: s.rpe })), prevDate: hist[0] ? hist[0].date : null,
    pain: null, notes: '', open: false, sets, planCount: planSets ? planSets.filter((x) => x.type === 'work').length : 0,
  };
}

function startDay(dayIdx) {
  if (S.draft && !confirm('A workout is already in progress. Replace it?')) return;
  const ctx = context();
  const week = S.settings.week;
  const day = DAYS[dayIdx];
  S.draft = {
    id: `app-${Date.now()}`, source: 'app', date: ctx.t, start: nowHHMM(), startedAt: Date.now(), title: day.title,
    planRef: { week, dayIdx, dayId: day.id }, sessionRpe: null, notes: '',
    exercises: expandWeek(dayIdx, week).map((ex) => draftExercise(ex.id, ex.name, ex.sets, ctx, week)),
  };
  saveDraft();
  S.tab = 'workout'; S.post = null;
  render(); window.scrollTo(0, 0);
}
function startEmpty() {
  if (S.draft && !confirm('A workout is already in progress. Replace it?')) return;
  S.draft = { id: `app-${Date.now()}`, source: 'app', date: todayStr(), start: nowHHMM(), startedAt: Date.now(), title: 'Workout', planRef: null, sessionRpe: null, notes: '', exercises: [] };
  saveDraft(); S.tab = 'workout'; render();
}
function editWorkout(id) {
  const w = S.data.workouts.find((x) => x.id === id);
  if (!w) return;
  if (S.draft && !confirm('A workout is already in progress. Replace it?')) return;
  const ctx = context();
  S.draft = {
    ...JSON.parse(JSON.stringify(w)), editingId: w.id, startedAt: Date.now() - (w.durationMin || 0) * 60000,
    exercises: w.exercises.map((e) => {
      const d = draftExercise(e.key, e.name, null, ctx, S.settings.week);
      return { ...d, sets: e.sets.map((s) => ({ ...s, done: true, planWeight: s.planWeight ?? null, planReps: s.planReps ?? null })), pain: e.pain, notes: e.notes || '', planned: e.planned, planCount: 0 };
    }),
  };
  saveDraft(); S.detail = null; S.tab = 'workout'; render(); window.scrollTo(0, 0);
}

// ---------- WORKOUT: logger ----------
function draftStats() {
  const d = S.draft;
  let vol = 0; let n = 0;
  for (const e of d.exercises) for (const s of e.sets) if (s.done && s.type === 'work') { n++; vol += (s.weight || 0) * (s.reps || 0); }
  return { vol: Math.round(vol), n };
}
function sugLine(sg) {
  const cls = sg.action === 'Increase' ? 'up' : sg.action === 'Reduce' ? 'down' : 'hold';
  const vs = sg.delta ? ` (${sg.delta > 0 ? '+' : ''}${sg.delta} kg vs plan)` : '';
  const lead = sg.action === 'Increase' ? `▲ Add load${vs}` : sg.action === 'Reduce' ? `▼ Lighter${vs}` : sg.action === 'Follow plan' ? '● Plan loads' : sg.action === 'Deload' ? '● Deload' : `● Hold${vs}`;
  return `<div class="sug ${cls}"><b>${lead}</b> ${esc(sg.why[0] || '')}</div>${sg.flags.map((f) => `<div class="callout warn">${esc(f)}</div>`).join('')}`;
}
function workoutView() {
  const d = S.draft;
  const st = draftStats();
  let h = `<div class="wk-head"><input class="wk-title" data-f="title" value="${esc(d.title)}" aria-label="Workout name"><div class="row" style="gap:8px;margin:2px 0 6px"><input class="f" type="date" data-f="date" value="${d.date}" max="${todayStr()}" style="width:auto;min-height:38px;padding:4px 8px" aria-label="Workout date">${d.date !== todayStr() && !d.editingId ? `<input class="f" type="text" inputmode="numeric" data-f="dur" value="${d.durManual ?? ''}" placeholder="${garminDur(d.date) ? Math.round(garminDur(d.date)) + ' (Garmin)' : 'minutes'}" style="width:120px;min-height:38px;padding:4px 8px" aria-label="Duration in minutes"><span class="tiny muted">min</span>` : ''}</div>
    <div class="wk-stats"><div><span>Duration</span><b id="elapsed">0:00</b></div><div><span>Volume</span><b id="vol">${st.vol.toLocaleString()} kg</b></div><div><span>Sets</span><b id="setcount">${st.n}</b></div></div></div>`;
  if (!d.exercises.length) h += '<div class="card muted" style="margin-top:12px;text-align:center">No exercises yet. Add one to get started.</div>';
  d.exercises.forEach((ex, i) => {
    if (ex.skipped) {
      h += `<section class="exb" style="opacity:.7"><div class="exb-head"><button class="exb-name" data-act="exmenu" data-i="${i}" style="color:var(--muted);text-decoration:line-through">${esc(ex.name)}</button><span class="tag">skipped · ${esc(ex.skipReason || '')}</span><button class="icon-btn" data-act="exunskip" data-i="${i}" aria-label="Un-skip">↺</button></div></section>`;
      return;
    }
    h += `<section class="exb"><div class="exb-head"><button class="exb-name" data-act="exmenu" data-i="${i}">${esc(ex.name)}</button><span class="tiny faint">RPE ${ex.rpeTarget}</span><button class="icon-btn" data-act="exmenu" data-i="${i}" aria-label="Options for ${esc(ex.name)}">⋯</button></div>
      ${d.editingId ? '' : sugLine(ex.suggestion)}`;
    if (ex.open || ex.notes || (ex.pain && ex.pain.severity)) {
      h += `<div class="grid2" style="margin-top:6px"><div><label class="l">Pain 0–10</label><select class="f" data-f="painSev" data-i="${i}">${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => `<option ${(ex.pain ? ex.pain.severity : 0) === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div><label class="l">Where</label><input class="f" data-f="painRegion" data-i="${i}" value="${esc(ex.pain ? ex.pain.region : '')}" placeholder="e.g. left knee"></div></div>
        <label class="l">Notes</label><input class="f" data-f="exnotes" data-i="${i}" value="${esc(ex.notes)}" placeholder="Seat 4, grip, technique…">`;
    }
    h += '<div class="st-head"><span>SET</span><span>PREVIOUS</span><span>KG</span><span>REPS</span><span>RPE</span><span>✓</span></div>';
    let wi = -1;
    ex.sets.forEach((s, j) => {
      if (s.type === 'work') wi++;
      const pv = s.type === 'work' ? ex.prev[wi] : null;
      h += `<div class="st-row ${s.type === 'warmup' ? 'warm' : ''} ${s.done ? 'done' : ''}" id="r-${i}-${j}">
        <button class="st-no" data-act="setmenu" data-i="${i}" data-j="${j}" aria-label="Set options">${s.type === 'warmup' ? 'W' : wi + 1}</button>
        <button class="st-prev" data-act="useprev" data-i="${i}" data-j="${j}" ${pv ? '' : 'disabled'}>${pv ? `${n1(pv.weight)} × ${pv.reps}` : '—'}</button>
        <input type="text" inputmode="decimal" value="${s.weight ?? ''}" placeholder="${s.planWeight ?? 'kg'}" data-f="weight" data-i="${i}" data-j="${j}" aria-label="Weight">
        <input type="text" inputmode="numeric" value="${s.reps ?? ''}" placeholder="${s.planReps ?? '0'}" data-f="reps" data-i="${i}" data-j="${j}" aria-label="Reps">
        <select data-f="rpe" data-i="${i}" data-j="${j}" aria-label="RPE"><option value="">–</option>${[5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10].map((v) => `<option ${s.rpe === v ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <button class="st-chk" data-act="done" data-i="${i}" data-j="${j}" aria-label="Mark set done">✓</button></div>`;
    });
    h += `<div id="adv-${i}">${ex.advice ? `<div class="callout info">${esc(ex.advice)}</div>` : ''}</div>
      <button class="add-set" data-act="addset" data-i="${i}">+ Add set</button></section>`;
  });
  h += `<button class="btn ghost block" data-act="addex" style="margin-top:16px">+ Add exercise</button>
    <div class="card" style="margin-top:16px"><div class="b">How hard was the whole session?</div><div class="tiny muted">Session RPE drives your training-load numbers.</div>
    <div class="rpe-chips">${[5, 6, 7, 8, 9, 10].map((v) => `<button data-act="srpe" data-v="${v}" class="${d.sessionRpe === v ? 'on' : ''}">${v}</button>`).join('')}</div></div>
    <button class="btn good block" data-act="finish">${d.editingId ? 'Save changes' : 'Finish workout'}</button>
    <button class="btn danger block" data-act="discard">${d.editingId ? 'Cancel editing' : 'Discard workout'}</button>
    <div class="restbar" id="restbar" hidden><span>Rest</span><b id="rest">0:00</b><button data-act="restadj" data-s="-15">−15</button><button data-act="restadj" data-s="15">+15</button><button data-act="restskip">Skip</button></div>`;
  return h;
}

function onWorkoutField(el) {
  const f = el.dataset.f;
  const d = S.draft;
  if (!f || !d) return false;
  const i = +el.dataset.i; const j = +el.dataset.j;
  const v = el.value;
  if (f === 'weight') d.exercises[i].sets[j].weight = num(v);
  else if (f === 'reps') { const n = num(v); d.exercises[i].sets[j].reps = n == null ? null : Math.round(n); }
  else if (f === 'rpe') d.exercises[i].sets[j].rpe = num(v);
  else if (f === 'painSev') d.exercises[i].pain = { severity: +v, region: d.exercises[i].pain ? d.exercises[i].pain.region : '' };
  else if (f === 'painRegion') d.exercises[i].pain = { severity: d.exercises[i].pain ? d.exercises[i].pain.severity : 0, region: v };
  else if (f === 'exnotes') d.exercises[i].notes = v;
  else if (f === 'title') d.title = v;
  else if (f === 'date') { if (v && v <= todayStr()) { d.date = v; saveDraft(); render(); } return true; }
  else if (f === 'dur') d.durManual = num(v);
  else return false;
  saveDraft();
  updateStats();
  return true;
}
function updateStats() {
  if (!S.draft) return;
  const st = draftStats();
  const v = $('#vol'); const n = $('#setcount');
  if (v) v.textContent = `${st.vol.toLocaleString()} kg`;
  if (n) n.textContent = st.n;
}

let ticker = null;
function tick() {
  clearInterval(ticker);
  const upd = () => {
    const el = $('#elapsed');
    if (el && S.draft) el.textContent = S.draft.date !== todayStr() && !S.draft.editingId ? 'past date' : fmtClock(Math.max(0, Math.floor((Date.now() - S.draft.startedAt) / 1000)));
    const bar = $('#restbar');
    if (bar) {
      const left = Math.max(0, Math.round((S.timerEnd - Date.now()) / 1000));
      bar.hidden = !S.timerEnd;
      $('#rest').textContent = fmtClock(left);
      if (S.timerEnd && left === 0) { S.timerEnd = 0; bar.hidden = true; if (navigator.vibrate) navigator.vibrate([250, 120, 250]); toast('Rest over. Next set.'); }
    }
  };
  upd();
  if ($('#elapsed') || $('#restbar')) ticker = setInterval(upd, 500);
}
function startRest(sec) { S.timerEnd = Date.now() + sec * 1000; tick(); }

function markDone(i, j) {
  const ex = S.draft.exercises[i];
  const s = ex.sets[j];
  if (!s.done && (s.reps == null || s.weight == null)) {
    if (s.weight == null && s.planWeight != null) s.weight = s.planWeight;
    if (s.reps == null && s.planReps != null) s.reps = s.planReps;
    if (s.reps == null) { toast('Enter reps first.'); return; }
    if (s.weight == null) s.weight = 0;
  }
  s.done = !s.done;
  if (s.done) {
    if (s.type === 'work') startRest(ex.compound ? 180 : 90);
    const wi = ex.sets.slice(0, j + 1).filter((x) => x.type === 'work').length - 1;
    const adv = E.inSessionAdvice({ workIndex: wi, set: s, rpeTarget: ex.rpeTarget, step: ex.step });
    if (adv) ex.advice = adv; else if (s.type === 'work') delete ex.advice;
    if (s.type === 'work' && s.rpe == null && !S.draft.tipShown) { S.draft.tipShown = true; toast('Tip: add RPE to each set so the next session can progress.'); }
  }
  saveDraft();
  render();
}

async function finishWorkout(reviewed = false) {
  const d = S.draft;
  const undone = d.exercises.filter((e) => !e.skipped).reduce((a, e) => a + e.sets.filter((s) => !s.done).length, 0);
  const sets = d.exercises.flatMap((e) => e.sets.filter((s) => s.done && s.type === 'work'));
  if (!sets.length) { toast('Tick at least one working set first.'); return; }
  if (!reviewed && undone && !confirm(`${undone} set${undone > 1 ? 's are' : ' is'} not ticked and will not be saved. Finish anyway?`)) return;
  if (!reviewed && !d.editingId && d.planRef) {
    const diffs = planDiffs({ ...d, exercises: d.exercises.filter((e) => !e.skipped) });
    if (diffs.length) { S.review = { diffs }; $('#toast').classList.remove('show'); renderOverlay(); return; }
  }
  const before = S.data.workouts.filter((w) => w.id !== d.editingId);
  const w = {
    id: d.editingId || d.id, source: d.source || 'app', date: d.date, start: d.start, title: d.title || 'Workout', planRef: d.planRef,
    durationMin: d.editingId ? d.durationMin : d.date !== todayStr() ? Math.round(d.durManual || garminDur(d.date) || 60) : Math.max(1, Math.round((Date.now() - d.startedAt) / 60000)), sessionRpe: d.sessionRpe, notes: d.notes,
    exercises: d.exercises.map((e) => ({
      key: e.key, name: e.name, notes: e.notes, pain: e.pain && e.pain.severity > 0 ? e.pain : null,
      sets: e.sets.filter((s) => s.done).map((s) => ({ type: s.type, weight: s.weight, reps: s.reps, rpe: s.rpe, done: true, ...(s.planWeight != null ? { planWeight: s.planWeight, planReps: s.planReps } : {}) })),
      planned: e.planned || e.sets.filter((s) => s.type === 'work' && s.planReps != null).map((s) => ({ weight: s.planWeight, reps: s.planReps })),
      ...(e.skipped ? { skipped: true, skipReason: e.skipReason || '' } : {}),
    })).map((e) => (e.skipped ? { ...e, sets: [] } : e)).filter((e) => e.sets.length || e.skipped),
  };
  if (S.review) { applyReview(S.review, d.planRef); S.review = null; renderOverlay(); }
  await db.put('workouts', w);
  S.data.workouts = before.concat(w);
  if (d.editingId) {
    S.draft = null; await setMeta('draft', null); S.tab = 'home'; S.detail = `w:${w.id}`; toast('Workout updated.'); render(); return;
  }
  S.post = buildPost(w, before);
  if (w.planRef && w.planRef.week === S.settings.week && dayIndexOf(w.planRef) >= 0) await markDay(dayIndexOf(w.planRef), 'done');
  else if (w.planRef && dayIndexOf(w.planRef) >= 0) { const r = { week: w.planRef.week, dayIdx: dayIndexOf(w.planRef) }; setPos(advance(r), r); await saveSettings(); }
  S.draft = null; S.timerEnd = 0; await setMeta('draft', null);
  render(); window.scrollTo(0, 0);
}

// ---- "keep this change in the plan?" ----
function planDiffs(d) {
  const day = DAYS[dayIndexOf(d.planRef)];
  if (!day || day.type !== 'strength') return [];
  const out = [];
  d.exercises.forEach((e) => {
    const done = e.sets.filter((s) => s.done && s.type === 'work');
    if (!done.length) return;
    const inPlan = day.exercises.some((x) => x.id === e.key);
    if (inPlan && e.planCount && done.length !== e.planCount) out.push({ kind: 'sets', key: e.key, name: e.name, planned: e.planCount, done: done.length, choice: 'once' });
    if (!inPlan) out.push({ kind: 'new', key: e.key, name: e.name, sets: done.map((s) => ({ reps: s.reps, weight: s.weight })), choice: 'once' });
  });
  return out;
}
function reviewOverlay() {
  const r = S.review;
  const w = S.draft && S.draft.planRef ? S.draft.planRef.week : 0;
  const scopes = (n, kind) => (kind === 'new'
    ? [['once', 'Just this time'], ['all', 'Add to this day']]
    : [['once', 'Just this time'], ['block', w >= 3 ? `Week ${w + 1} only` : `Weeks ${w + 1}–4`], ['all', 'All weeks']]
  ).map(([v, l]) => `<button class="chip ${r.diffs[n].choice === v ? 'on' : ''}" data-act="revchoice" data-n="${n}" data-v="${v}">${l}</button>`).join('');
  return `<div class="backdrop"><div class="sheet" data-act="noop" style="max-height:88vh;overflow-y:auto"><div class="grab"></div><h3>Update your plan?</h3>
    <div class="small muted" style="text-align:center;margin-bottom:12px">You changed the session. Keep the change for next time?</div>
    ${r.diffs.map((x, n) => `<div class="card"><div class="b">${esc(x.name)}</div><div class="small muted" style="margin:2px 0 8px">${x.kind === 'new'
      ? `Not in this day's plan. You did ${groupsTxt(x.sets)} kg.`
      : `You did <b style="color:var(--text)">${x.done} sets</b>, the plan has ${x.planned}.`}</div><div class="chips" style="flex-wrap:wrap;margin:0">${scopes(n, x.kind)}</div></div>`).join('')}
    <div class="tiny faint" style="margin-bottom:10px">“All weeks” leaves the Week 5 deload alone. You can always change it in the Plan tab.</div>
    <button class="btn good block" data-act="revsave">Save workout</button><button class="item" data-act="revcancel" style="text-align:center;color:var(--muted);margin-top:8px">Back to workout</button></div></div>`;
}
function changeSetCount(groups, diff) {
  if (diff > 0) { groups[groups.length - 1].sets += diff; return; }
  let r = -diff;
  while (r > 0 && groups.reduce((a, g) => a + g.sets, 0) > 1) {
    const g = groups[groups.length - 1];
    g.sets -= 1; if (g.sets <= 0) groups.pop();
    r -= 1;
  }
}
function applyReview(review, planRef) {
  const day = DAYS[dayIndexOf(planRef)];
  if (!day) return;
  let changed = 0;
  for (const x of review.diffs) {
    if (x.choice === 'once') continue;
    if (x.kind === 'sets') {
      const ex = day.exercises.find((e) => e.id === x.key);
      if (!ex) continue;
      const weeks = x.choice === 'block' ? (planRef.week >= 3 ? [planRef.week] : [...Array(4 - planRef.week).keys()].map((k) => k + planRef.week)) : [0, 1, 2, 3];
      if (planRef.week === 4 && x.choice !== 'once') weeks.splice(0, weeks.length, 4);
      for (const w of weeks) changeSetCount(ex.weeks[w], x.done - x.planned);
      changed++;
    } else if (x.kind === 'new') {
      const k = ownId(ensureCatalog(EXERCISES[x.key] ? x.key : '', x.name), dayIndexOf(planRef));
      const groups = fmtGroups(x.sets).map((g) => ({ sets: g.n, reps: g.reps, weight: g.w }));
      day.exercises.push({ id: k, weeks: [0, 1, 2, 3, 4].map((w) => JSON.parse(JSON.stringify(w === 4 ? [{ ...groups[0], sets: 1 }] : groups))) });
      changed++;
    }
  }
  if (changed) { splitShared(todayStr()); savePlan(); setTimeout(() => toast(`Plan updated (${changed} change${changed > 1 ? 's' : ''}).`), 600); }
}

function buildPost(w, before) {
  const ctx = context();
  const rows = []; const lines = [];
  let plannedSets = 0; let doneSets = 0; const rp = [];
  const from = w.planRef && dayIndexOf(w.planRef) >= 0 ? { week: w.planRef.week, dayIdx: dayIndexOf(w.planRef) } : pos();
  for (const e of w.exercises) {
    if (e.skipped) { rows.push({ name: (metaOf(e.key) || {}).name || e.name, skipped: true, reason: e.skipReason || '' }); continue; }
    const m = metaOf(e.key) || {};
    const planned = e.planned || [];
    const work = e.sets.filter((s) => s.type === 'work');
    plannedSets += planned.length; doneSets += work.length;
    work.forEach((s) => s.rpe != null && rp.push(s.rpe));
    const best = E.sessionBest(e, S.settings.bodyweight, !!m.bodyweight);
    const prior = E.historyFor(before, e.key).map((h) => E.sessionBest(h.ex, S.settings.bodyweight, !!m.bodyweight)).filter(Boolean);
    const priorBest = prior.length ? Math.max(...prior.map((b) => b.e1rm)) : null;
    const ne = nextExposure(e.key, from);
    const sug = E.suggestExercise({ key: e.key, history: E.historyFor(S.data.workouts, e.key), today: ctx.t, week: ne ? ne.week : from.week, recovery: ctx.recovery, bodyweight: S.settings.bodyweight });
    let next = 'Not in the plan. Repeat these loads next time and add reps if RPE stays ≤8.';
    if (ne) {
      const pl = expandWeek(ne.dayIdx, ne.week).find((x) => x.id === e.key);
      if (pl) next = `${DAYS[ne.dayIdx].name}, week ${ne.week + 1}: ${groupsTxt(pl.sets.filter((x) => x.type === 'work'), sug.delta)} kg · RPE ≤${sug.rpeTarget} · rest ${m.compound ? '3 min' : '90 s'}`;
    }
    if (e.pain && e.pain.severity >= 4) lines.push(`${e.name}: pain ${e.pain.severity}/10 (${e.pain.region || 'unspecified'}). Do not progress this lift until it settles. Log it under Me › Health if it persists.`);
    rows.push({ name: (m.name || e.name), work, planned, best, priorBest, pr: !!(best && priorBest && best.e1rm > priorBest + 0.4), sug, next });
  }
  const meanRpe = rp.length ? rp.reduce((a, b) => a + b, 0) / rp.length : null;
  let verdict = plannedSets ? (doneSets < plannedSets ? `${doneSets} of ${plannedSets} planned working sets done.` : `All ${plannedSets} planned working sets done.`) : `${doneSets} working sets logged.`;
  if (meanRpe != null) verdict += meanRpe >= 9 ? ` Average RPE ${n1(meanRpe)} is high: hold loads next time.` : meanRpe <= 7 ? ` Average RPE ${n1(meanRpe)} leaves room to progress.` : ` Average RPE ${n1(meanRpe)} is in the productive range.`;
  else verdict += ' No RPE recorded, so progression stays conservative.';
  return { title: w.title, verdict, rows, lines, duration: w.durationMin, vol: Math.round(w.exercises.reduce((s, e) => s + E.volumeLoad(e), 0)), sets: doneSets, prs: rows.filter((r) => r.pr).length };
}

function postView() {
  const p = S.post;
  let h = `<div class="card"><div class="big">${esc(p.title)}</div><div class="stats" style="margin-top:10px"><div class="stat"><span>Duration</span><b>${fmtDur(p.duration)}</b></div><div class="stat"><span>Volume</span><b>${p.vol.toLocaleString()} kg</b></div><div class="stat"><span>${p.prs ? 'PRs' : 'Sets'}</span><b>${p.prs || p.sets}</b></div></div>
    <div class="callout info"><b>Verdict.</b> ${esc(p.verdict)}</div></div>`;
  p.lines.forEach((l) => { h += `<div class="callout bad" style="margin-bottom:12px">${esc(l)}</div>`; });
  for (const r of p.rows) {
    if (r.skipped) { h += `<div class="card" style="opacity:.75"><div class="row between"><h3 class="muted">${esc(r.name)}</h3><span class="tag">skipped</span></div><div class="small muted">${esc(r.reason)}. Next time it starts from your last real session.</div></div>`; continue; }
    const cls = r.sug.action === 'Increase' ? 'up' : r.sug.action === 'Reduce' ? 'down' : 'hold';
    h += `<div class="card"><div class="row between"><h3 style="color:var(--accent)">${esc(r.name)}</h3>${r.pr ? '<span class="tag up">e1RM PR</span>' : ''}</div>
      <div class="small" style="margin-top:4px"><span class="muted">Did</span> ${r.work.map((s) => `${n1(s.weight)}×${s.reps}${s.rpe ? `@${s.rpe}` : ''}`).join(', ')}</div>
      ${r.planned.length ? `<div class="small"><span class="muted">Plan</span> ${groupsTxt(r.planned)}</div>` : ''}
      ${r.best ? `<div class="tiny faint">e1RM ≈ ${r.best.e1rm} kg${r.best.estimated ? ' (no RPE, underestimate)' : ''}${r.priorBest ? ` · best before ${r.priorBest}` : ''}</div>` : ''}
      <div class="callout"><span class="tag ${cls}">${esc(r.sug.action)}</span> <b>Next:</b> ${esc(r.next)}<div class="tiny muted" style="margin-top:4px">${esc(r.sug.why[0] || '')}</div></div></div>`;
  }
  return h + '<button class="btn primary block" data-act="closepost">Done</button>';
}

// ---------- cardio ----------
function cardioForm(ctx) {
  const day = DAYS[pos().dayIdx];
  const dflt = day.type === 'cardio' && /2 ?h|2 hours|long/i.test(day.title + day.note) ? 120 : 60;
  return `<div class="card"><label class="l">Type</label><div class="seg" id="c-type-seg">${[['run', 'Run'], ['mtb', 'MTB'], ['ride', 'Ride'], ['hike', 'Hike']].map(([v, l], k) => `<button data-act="ctype" data-v="${v}" class="${k === 0 ? 'on' : ''}">${l}</button>`).join('')}</div><input type="hidden" id="c-type" value="run">
    <div class="grid2"><div><label class="l">Date</label><input class="f" id="c-date" type="date" value="${ctx.t}"></div><div><label class="l">Minutes</label><input class="f" id="c-dur" type="number" inputmode="numeric" value="${dflt}"></div></div>
    <div class="grid3"><div><label class="l">km</label><input class="f" id="c-dist" type="text" inputmode="decimal"></div><div><label class="l">Climb m</label><input class="f" id="c-asc" type="number" inputmode="numeric"></div><div><label class="l">Avg HR</label><input class="f" id="c-hr" type="number" inputmode="numeric"></div></div>
    <label class="l">How hard? (RPE)</label><div class="rpe-chips" id="c-rpe">${[2, 3, 4, 5, 6, 7, 8, 9].slice(0, 6).map((v) => `<button data-act="crpe" data-v="${v}">${v}</button>`).join('')}</div><input type="hidden" id="c-rpe-v">
    <label class="l">Notes</label><input class="f" id="c-notes" placeholder="Terrain, legs, anything odd">
    <label class="l">Counts as</label><select class="f" id="c-plan">${(() => {
      // every cardio day of the week is listed; open ones first, then skipped (logging it un-skips), then done
      const all = DAYS.map((x, i) => ({ x, i, st: dayState(i) })).filter(({ x }) => x.type === 'cardio');
      const order = { null: 0, skipped: 1, done: 2 };
      all.sort((a, b) => order[a.st] - order[b.st] || a.i - b.i);
      const cur = pos().dayIdx;
      const avail = all.filter((q) => q.st !== 'done').sort((a, b) => a.i - b.i);
      const dflt = avail.find((q) => q.i === cur) || avail[0];
      const tag = (st) => (st === 'skipped' ? ' (was skipped)' : st === 'done' ? ' (already done)' : '');
      return all.map(({ x, i, st }) => `<option value="${i}" ${dflt && dflt.i === i ? 'selected' : ''}>${esc(x.name)} — ${esc(x.title)}${tag(st)}</option>`).join('') + `<option value="" ${dflt ? '' : 'selected'}>Extra session (not in the plan)</option>`;
    })()}</select>
    <div class="tiny muted" style="margin-top:8px">Easy ceiling ≈ ${easyCeil()} bpm. If you import the Garmin CSV later, this entry is kept alongside it.</div>
    <button class="btn primary block" data-act="savecardio" style="margin-top:12px">Save</button></div>`;
}
async function saveCardio() {
  const g = (id) => $(id).value;
  const c = { id: `app-${Date.now()}`, source: 'app', type: g('#c-type'), date: g('#c-date'), start: nowHHMM(), durationMin: num(g('#c-dur')), distanceKm: num(g('#c-dist')), ascentM: num(g('#c-asc')), avgHr: num(g('#c-hr')), maxHr: null, te: null, rpe: num(g('#c-rpe-v')), notes: g('#c-notes'), title: TYPE_LABEL[g('#c-type')] };
  if (!c.durationMin) { toast('Enter the duration.'); return; }
  await db.put('cardio', c); S.data.cardio.push(c);
  const planDay = $('#c-plan') ? $('#c-plan').value : '';
  if (planDay !== '' && dayState(+planDay) === 'skipped') {
    // you did it after all: remove this week's skip record for that day
    const id = DAYS[+planDay].id;
    S.skips = (S.skips || []).filter((k) => !(k.week === S.settings.week && (dayIndexOf(k) === +planDay) && E.daysBetween(k.date, todayStr()) <= 7));
    await setMeta('skips', S.skips);
    setTimeout(() => toast(`${DAYS[+planDay].name} was marked skipped. Now marked done.`), 700);
  }
  if (planDay !== '') { c.planDayId = DAYS[+planDay].id; await db.put('cardio', c); await markDay(+planDay, 'done'); }
  S.cardioForm = false; S.tab = 'home'; render(); window.scrollTo(0, 0);
  if (c.avgHr && c.avgHr > easyCeil() && c.durationMin >= 40 && ['run', 'mtb', 'ride'].includes(c.type)) toast(`Saved. Avg HR ${c.avgHr} is above your easy ceiling (${easyCeil()}).`);
  else toast('Saved.');
}

// ---------- exercise picker ----------
function pickList() {
  const q = S.pickQ.trim().toLowerCase();
  const seen = new Set();
  const items = [];
  for (const [k, m] of Object.entries(EXERCISES)) { items.push({ key: k, name: m.name, sub: (m.muscles || []).join(', ') || 'custom' }); seen.add(k); }
  for (const w of S.data.workouts) for (const e of w.exercises) if (!seen.has(e.key)) { seen.add(e.key); items.push({ key: e.key, name: e.name, sub: 'from your history' }); }
  const f = items.filter((x) => !q || x.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
  let h = '';
  if (q && !items.some((x) => x.name.toLowerCase() === q)) h += `<button class="pi" data-act="pick" data-key="" data-name="${esc(S.pickQ.trim())}"><span class="av">+</span><span><div class="nm">Create “${esc(S.pickQ.trim())}”</div><div class="mu">New exercise</div></span></button>`;
  h += f.map((x) => `<button class="pi" data-act="pick" data-key="${esc(x.key)}" data-name="${esc(x.name)}"><span class="av">${esc(x.name[0] || '?')}</span><span><div class="nm">${esc(x.name)}</div><div class="mu">${esc(x.sub)}</div></span></button>`).join('');
  return h || '<div class="muted" style="padding:20px 0">No match.</div>';
}
// Sensible defaults for a new exercise from its name (all editable in the exercise screen).
function guessMeta(name) {
  const n = name.toLowerCase();
  const m = new Set();
  if (/bench|chest|fly|dip|push.?up/.test(n)) { m.add('chest'); m.add('triceps'); }
  if (/row|pull.?down|pull.?up|chin|lat\b|lats/.test(n)) { m.add('back'); m.add('biceps'); }
  if (/overhead|ohp|shoulder press|military|lateral|raise|face pull|rear delt|upright/.test(n)) m.add('delts');
  if (/curl/.test(n) && !/leg curl/.test(n)) m.add('biceps');
  if (/tricep|pushdown|skull|extension/.test(n) && !/leg ext/.test(n)) m.add('triceps');
  if (/squat|leg press|lunge|split|leg ext|hack/.test(n)) { m.add('quads'); m.add('glutes'); }
  if (/deadlift|rdl|romanian|good morning|leg curl|hamstring/.test(n)) { m.add('hams'); m.add('glutes'); }
  if (/hip thrust|glute/.test(n)) m.add('glutes');
  if (/shrug|upright|face pull/.test(n)) m.add('traps');
  const compound = /bench|press|squat|deadlift|rdl|row|chin|pull.?up|dip|lunge|thrust/.test(n) && !/leg press/.test(n) ? true : /leg press/.test(n);
  return { muscles: [...m], compound, rpe: compound ? 8 : 8.5 };
}
// The id to use for an exercise on day `di`: if another day already has it, this day gets its own copy.
const ownId = (id, di) => (dayUsing(id, di) >= 0 ? copyForDay(id, DAYS[di], todayStr()) : id);
function usedIn(id) { return DAYS.map((d, i) => ({ d, i })).filter(({ d }) => (d.exercises || []).some((e) => e.id === id)); }
function ensureCatalog(key, name) {
  if (key && EXERCISES[key]) return key;
  const k = key || slug(name) || `ex_${Date.now()}`;
  if (!EXERCISES[k]) { EXERCISES[k] = { name, aliases: [name], step: 2.5, ...guessMeta(name) }; savePlan(); }
  return k;
}
function pickExercise(key, name) {
  const pk = S.picker;
  S.picker = null; S.pickQ = '';
  if (pk.mode === 'workout' || pk.mode === 'replace') {
    const ctx = context();
    const k = key || ensureCatalog('', name);
    const ex = draftExercise(k, name, null, ctx, S.settings.week);
    if (pk.mode === 'replace') S.draft.exercises[pk.i] = ex; else S.draft.exercises.push(ex);
    saveDraft();
  } else if (pk.mode === 'planswap') {
    const ex = DAYS[pk.day].exercises[pk.k];
    const k = ownId(ensureCatalog(key, name), pk.day);
    const oldName = (metaOf(ex.id) || { name: ex.id }).name;
    ex.id = k; splitShared(todayStr()); savePlan(); S.editEx = null;
    setTimeout(() => toast(`${DAYS[pk.day].name}: ${oldName} → ${EXERCISES[k].name}. Sets, reps and loads kept, so check the kg.`), 300);
  } else if (pk.mode === 'plan') {
    const k = ownId(ensureCatalog(key, name), S.editDay);
    DAYS[S.editDay].exercises.push({ id: k, weeks: [0, 1, 2, 3, 4].map(() => [{ sets: 3, reps: 10, weight: 0 }]) });
    splitShared(todayStr()); savePlan();
  }
  render();
}

// ---------- PLAN ----------
async function reorderDays(mutate) {
  const curId = (DAYS[pos().dayIdx] || {}).id;
  mutate();
  renumberDays();
  const ni = DAYS.findIndex((d) => d.id === curId);
  S.settings.dayIdx = ni >= 0 ? ni : Math.min(S.settings.dayIdx, lastIdx());
  await saveSettings(); savePlan();
}
function moveDay(from, to) { if (to < 0 || to >= DAYS.length) return false; const [x] = DAYS.splice(from, 1); DAYS.splice(to, 0, x); return true; }
function splitOrderView() {
  const p = pos();
  let h = `<div class="small muted" style="margin-bottom:12px">Move days with the arrows. Exercises, sets and history move with the day. What you've done or skipped this week stays attached to the right day.</div>`;
  h += DAYS.map((d, i) => {
    const st = dayState(i);
    const tag = d.type === 'strength' ? 'lift' : d.type === 'cardio' ? 'run' : 'other';
    return `<div class="card routine"><div class="badge ${tag}" style="width:40px;height:40px">${i + 1}</div><div class="grow"><div class="b">${esc(dayLabel(d))}${i === p.dayIdx ? '<span class="next-badge">NEXT</span>' : st ? `<span class="next-badge" style="background:var(--surface2);color:var(--muted)">${st.toUpperCase()}</span>` : ''}</div><div class="small muted">${esc(d.title)}</div></div>
      <button class="icon-btn" data-act="ordmove" data-i="${i}" data-v="-1" aria-label="Move ${esc(dayLabel(d))} up" ${i === 0 ? 'disabled style="opacity:.3"' : ''}>↑</button><button class="icon-btn" data-act="ordmove" data-i="${i}" data-v="1" aria-label="Move ${esc(dayLabel(d))} down" ${i === DAYS.length - 1 ? 'disabled style="opacity:.3"' : ''}>↓</button></div>`;
  }).join('');
  h += `<div class="row wrap" style="gap:8px;margin-top:4px"><button class="btn sm" data-act="addtyped" data-v="rest">+ Rest day</button><button class="btn sm" data-act="addtyped" data-v="cardio">+ Cardio day</button><button class="btn sm" data-act="addtyped" data-v="strength">+ Lifting day</button></div>
    <button class="btn primary block" data-act="orddone" style="margin-top:14px">Done</button>`;
  return h;
}
function planView() {
  const p = pos();
  if (S.planWeek == null) S.planWeek = p.week;
  let h = `<div class="card"><div class="eyebrow">You are here</div><div class="b" style="font-size:18px;margin:2px 0 8px">Week ${p.week + 1} · ${esc(WEEK_NAMES[p.week])} — ${esc(DAYS[p.dayIdx].name)}</div>
    <div class="grid2"><select class="f" data-set="week" aria-label="Current week">${[0, 1, 2, 3, 4].map((v) => `<option value="${v}" ${p.week === v ? 'selected' : ''}>Week ${v + 1} · ${WEEK_NAMES[v]}</option>`).join('')}</select>
    <select class="f" data-set="dayIdx" aria-label="Current day">${DAYS.map((x, i) => `<option value="${i}" ${p.dayIdx === i ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
    <div class="row between" style="margin-top:10px"><label class="l" for="blockstart" style="margin:0">Block ${(S.settings.blocks || []).length} started</label><input class="f" id="blockstart" type="date" data-act="blockstart" value="${esc(currentBlockStart() || '')}" style="width:auto;min-height:42px"></div></div>`;
  h += `<div class="seg"><button data-act="planmode" data-v="week" class="${S.planMode === 'week' ? 'on' : ''}">By week</button><button data-act="planmode" data-v="block" class="${S.planMode === 'block' ? 'on' : ''}">Whole block</button></div>`;
  h += '<div class="callout info" style="margin:0 0 12px">To change exercises, sets, reps or weights, tap <b>✎ Edit</b> on a day.</div>';
  if (S.planMode === 'week') {
    h += `<div class="chips weeks">${[0, 1, 2, 3, 4].map((v) => `<button class="chip ${S.planWeek === v ? 'on' : ''}" data-act="planweek" data-v="${v}">W${v + 1}<small>${WEEK_NAMES[v]}</small></button>`).join('')}</div>`;
    DAYS.forEach((d, i) => {
      h += `<div class="card"><div class="row between"><div class="grow"><div class="b" style="font-size:17px">${esc(d.name)}${S.planWeek === p.week ? statusPill(i) : ''}</div><div class="small muted">${esc(d.title)}</div></div><button class="btn sm primary" data-act="editday" data-d="${i}">✎ Edit</button></div>`;
      if (d.type === 'strength') {
        h += '<div style="margin-top:6px">';
        for (const ex of expandWeek(i, S.planWeek)) {
          const warm = ex.sets.filter((s) => s.type === 'warmup');
          h += `<div class="pex"><div class="nm">${esc(ex.name)}</div><div class="sets">${warm.length ? `<span style="color:var(--warn)">W</span> ${groupsTxt(warm)} · ` : ''}${groupsTxt(ex.sets.filter((s) => s.type === 'work'))} kg</div></div>`;
        }
        h += d.exercises.length ? '</div>' : '<div class="muted small">No exercises yet.</div></div>';
      } else h += `<div class="small" style="margin-top:6px">${esc(d.note || '')}</div>`;
      h += '</div>';
    });
  } else {
    h += '<div class="tiny muted" style="margin-bottom:10px">Every exercise across all five weeks. W1–W5 = sets×reps @ kg (warm-ups not shown).</div>';
    DAYS.forEach((d, i) => {
      if (d.type !== 'strength') { h += `<div class="card"><div class="row between"><div><div class="b">${esc(d.name)}</div><div class="small muted">${esc(d.title)}</div></div><button class="btn sm primary" data-act="editday" data-d="${i}">✎ Edit</button></div></div>`; return; }
      h += `<div class="card"><div class="row between"><div class="b" style="font-size:17px">${esc(d.name)}</div><button class="btn sm primary" data-act="editday" data-d="${i}">✎ Edit</button></div>`;
      d.exercises.forEach((ex) => {
        h += `<div class="pex"><div class="nm">${esc((metaOf(ex.id) || { name: ex.id }).name)}</div>${ex.weeks.map((grps, w) => `<div class="wkline ${w === p.week ? 'cur' : ''}"><span>W${w + 1}</span><span>${grps.map((g) => `${g.sets}×${g.reps} @ ${g.weight}`).join(' · ')}</span></div>`).join('')}</div>`;
      });
      h += '</div>';
    });
  }
  h += `<h2>Manage plan</h2><div class="card"><button class="btn primary block" data-act="ordopen">Change split order</button><button class="btn block" data-act="addday">+ Add a day</button>
    <div class="grid2" style="margin-top:10px"><button class="btn sm" data-act="exportplan">Export plan</button><label class="btn sm" style="cursor:pointer">Import plan<input type="file" data-act="importplan" hidden></label></div>
    <button class="btn danger block sm" data-act="resetplan">Reset to original plan</button></div>`;
  return h;
}

function dayEditor() {
  const d = DAYS[S.editDay];
  if (!d) { S.editDay = null; return planView(); }
  const w = S.planWeek ?? pos().week;
  let h = `<div class="card"><label class="l">Day name <span class="faint">(the number follows its position)</span></label><input class="f" data-pd="label" value="${esc(dayLabel(d))}">
    <label class="l">Subtitle</label><input class="f" data-pd="title" value="${esc(d.title)}">
    <label class="l">Type</label><select class="f" data-pd="type">${['strength', 'cardio', 'rest'].map((t) => `<option ${d.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
    ${d.type !== 'strength' ? `<label class="l">Instructions</label><textarea class="f" data-pd="note">${esc(d.note || '')}</textarea>` : ''}
    <div class="row" style="margin-top:12px"><button class="btn sm" data-act="daymove" data-v="-1">↑ Move up</button><button class="btn sm" data-act="daymove" data-v="1">↓ Move down</button></div></div>`;
  if (d.type === 'strength') {
    h += `<div class="chips weeks">${[0, 1, 2, 3, 4].map((v) => `<button class="chip ${w === v ? 'on' : ''}" data-act="planweek" data-v="${v}">W${v + 1}<small>${WEEK_NAMES[v]}</small></button>`).join('')}</div>`;
    d.exercises.forEach((ex, k) => {
      const m = metaOf(ex.id) || { name: ex.id };
      const shared = usedIn(ex.id).length > 1;
      h += `<div class="card"><div class="row"><button class="exb-name" data-act="editex" data-key="${esc(ex.id)}" data-k="${k}" style="font-size:16.5px">${esc(m.name)} ›${shared ? '<div class="tiny faint" style="font-weight:600">also on ' + esc(usedIn(ex.id).filter((x) => x.i !== S.editDay).map((x) => shortDay(x.d) + ' (' + dayNo(x.d) + ')').join(', ')) + '</div>' : ''}</button>
        <button class="icon-btn" data-act="planswap" data-k="${k}" aria-label="Swap exercise" title="Swap exercise">⇄</button>
        <button class="icon-btn" data-act="exup" data-k="${k}" aria-label="Move up">↑</button><button class="icon-btn" data-act="exdown" data-k="${k}" aria-label="Move down">↓</button><button class="icon-btn" data-act="exdel" data-k="${k}" aria-label="Remove" style="color:var(--bad)">✕</button></div>
        <div class="edhead"><span>SETS</span><span></span><span>REPS</span><span></span><span>KG</span><span></span></div>`;
      if (ex.warm) h += `<div class="edrow"><span class="b" style="text-align:center;color:var(--warn);font-size:14px">Warm</span><span></span><input inputmode="numeric" data-pf="wreps" data-k="${k}" value="${ex.warm.reps}"><span class="x">@</span><input inputmode="decimal" data-pf="wweight" data-k="${k}" value="${ex.warm.weight}"><button class="icon-btn" data-act="warmdel" data-k="${k}" aria-label="Remove warm-up">✕</button></div>`;
      ex.weeks[w].forEach((g, gi) => {
        h += `<div class="edrow"><input inputmode="numeric" data-pf="sets" data-k="${k}" data-g="${gi}" value="${g.sets}" aria-label="Sets"><span class="x">×</span><input inputmode="numeric" data-pf="reps" data-k="${k}" data-g="${gi}" value="${g.reps}" aria-label="Reps"><span class="x">@</span><input inputmode="decimal" data-pf="weight" data-k="${k}" data-g="${gi}" value="${g.weight}" aria-label="Kilograms"><button class="icon-btn" data-act="grpdel" data-k="${k}" data-g="${gi}" aria-label="Remove row">✕</button></div>`;
      });
      h += `<div class="row wrap" style="margin-top:10px"><button class="btn sm" data-act="grpadd" data-k="${k}">+ Row</button>${ex.warm ? '' : `<button class="btn sm" data-act="warmadd" data-k="${k}">+ Warm-up</button>`}<button class="btn sm" data-act="copyweeks" data-k="${k}">Copy to all weeks</button></div></div>`;
    });
    h += '<button class="btn ghost block" data-act="planaddex">+ Add exercise</button>';
    h += `<div class="tiny faint" style="margin:10px 0">Rows are edited for Week ${w + 1} only. Warm-ups apply to every week. Changes save automatically.</div>`;
  }
  h += '<button class="btn danger block" data-act="daydel" style="margin-top:12px">Delete this day</button>';
  return h;
}

function exerciseEditor() {
  const k = S.editEx;
  const m = EXERCISES[k];
  if (!m) { S.editEx = null; return dayEditor(); }
  const used = usedIn(k);
  const hf = m.historyFrom;
  const fromName = hf && EXERCISES[hf.id] ? EXERCISES[hf.id].name : null;
  let warn = `<div class="callout info" style="margin:0 0 12px">Only <b>${esc(used.map((x) => x.d.name).join(', ') || 'no day')}</b> uses this exercise. Changes here affect that day only.</div>`;
  if (hf) warn += `<div class="card"><div class="togg"><label><input type="checkbox" data-ef="inherit" ${hf.off ? '' : 'checked'}> Count sessions before ${fmtDate(hf.until)}${fromName ? ` (when it was shared with “${esc(fromName)}”)` : ''} as this exercise's history</label></div>
    <div class="tiny faint" style="margin-top:6px">Keep this on if it's the same lift. Turn it off if you changed it to a different exercise, so old loads don't drive its progression.</div></div>`;
  return `${warn}<div class="card"><label class="l">Name</label><input class="f" data-ef="name" value="${esc(m.name)}">
    <label class="l">Muscles worked</label><div class="togg">${MUSCLES.map((x) => `<label><input type="checkbox" data-ef="muscle" value="${x}" ${(m.muscles || []).includes(x) ? 'checked' : ''}> ${x}</label>`).join('')}</div>
    <div class="grid2"><div><label class="l">Load step (kg)</label><input class="f" data-ef="step" inputmode="decimal" value="${m.step}"></div><div><label class="l">Target RPE</label><input class="f" data-ef="rpe" inputmode="decimal" value="${m.rpe}"></div></div>
    <div class="togg" style="margin-top:12px"><label><input type="checkbox" data-ef="compound" ${m.compound ? 'checked' : ''}> Compound (3 min rest)</label><label><input type="checkbox" data-ef="bodyweight" ${m.bodyweight ? 'checked' : ''}> Add body weight to load</label></div>
    <label class="l">Also known as (Hevy names, comma-separated)</label><input class="f" data-ef="aliases" value="${esc((m.aliases || []).join(', '))}">
    <div class="tiny faint" style="margin-top:8px">Load step is how much the coach adds when you progress. Target RPE is where it aims your working sets.</div></div>`;
}

function onPlanField(el) {
  if (el.dataset.pd) {
    const d = DAYS[S.editDay];
    if (el.dataset.pd === 'label') { d.name = `Day ${S.editDay + 1} · ${el.value.trim() || 'Day'}`; savePlan(); return true; }
    d[el.dataset.pd] = el.value;
    if (el.dataset.pd === 'type') {
      if (el.value === 'strength' && !d.exercises) d.exercises = [];
      savePlan(); render(); return true;
    }
    savePlan(); return true;
  }
  if (el.dataset.pf) {
    const d = DAYS[S.editDay];
    const k = +el.dataset.k; const w = S.planWeek ?? pos().week;
    const v = num(el.value);
    if (v == null) return true;
    const f = el.dataset.pf;
    if (f === 'wreps') d.exercises[k].warm.reps = Math.round(v);
    else if (f === 'wweight') d.exercises[k].warm.weight = v;
    else d.exercises[k].weeks[w][+el.dataset.g][f] = f === 'weight' ? v : Math.max(0, Math.round(v));
    savePlan(); return true;
  }
  if (el.dataset.ef) {
    const m = EXERCISES[S.editEx];
    const f = el.dataset.ef;
    if (f === 'inherit') { if (m.historyFrom) m.historyFrom.off = !el.checked; }
    else if (f === 'muscle') { const set = new Set(m.muscles || []); if (el.checked) set.add(el.value); else set.delete(el.value); m.muscles = [...set]; }
    else if (f === 'compound' || f === 'bodyweight') m[f] = el.checked;
    else if (f === 'aliases') m.aliases = el.value.split(',').map((x) => x.trim()).filter(Boolean);
    else if (f === 'step' || f === 'rpe') { const v = num(el.value); if (v != null) m[f] = v; }
    else m[f] = el.value;
    savePlan(); return true;
  }
  return false;
}

// ---------- PROGRESS ----------
function liftGroups() {
  const g = {};
  const add = (name, key, n) => { const k = name.trim(); g[k] = g[k] || { name: k, keys: new Set(), n: 0, plan: false }; g[k].keys.add(key); g[k].n += n; };
  for (const w of S.data.workouts) for (const e of w.exercises) if (E.workSets(e).length) add((EXERCISES[e.key] || {}).name || e.name, e.key, 1);
  const planKeys = new Set(DAYS.flatMap((d) => (d.exercises || []).map((e) => e.id)));
  return Object.values(g).map((x) => ({ ...x, plan: [...x.keys].some((k) => planKeys.has(k)) })).sort((a, b) => (b.plan - a.plan) || (b.n - a.n));
}
function groupHistory(keys) {
  const seen = new Set();
  const out = [];
  for (const w of S.data.workouts) for (const e of w.exercises) if (keys.has(e.key) && E.workSets(e).length && !seen.has(w.id + e.key)) { seen.add(w.id + e.key); out.push({ date: w.date, ex: e }); }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}
function lineChart(pts, unit = 'kg') {
  if (pts.length < 2) return '<div class="muted small" style="padding:20px 0;text-align:center">Needs at least two sessions for a trend.</div>';
  const W = 340; const H = 160; const L = 34; const P = 14;
  const ys = pts.map((p) => p.y); let lo = Math.min(...ys); let hi = Math.max(...ys); const pad = Math.max(2, (hi - lo) * 0.15); lo -= pad; hi += pad;
  const t0 = E.toDay(pts[0].date); const t1 = E.toDay(pts[pts.length - 1].date);
  const x = (p) => L + ((E.toDay(p.date) - t0) / (t1 - t0 || 1)) * (W - L - P);
  const y = (v) => H - 22 - ((v - lo) / (hi - lo)) * (H - 22 - P);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ');
  const grid = [lo + (hi - lo) * 0.1, (lo + hi) / 2, hi - (hi - lo) * 0.1];
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Trend chart">
    ${grid.map((g) => `<line x1="${L}" x2="${W - P}" y1="${y(g).toFixed(1)}" y2="${y(g).toFixed(1)}" stroke="#2e333b" stroke-width="1"/><text x="${L - 6}" y="${(y(g) + 3).toFixed(1)}" text-anchor="end">${Math.round(g)}</text>`).join('')}
    <path d="${path}" fill="none" stroke="#2f8cff" stroke-width="2.5" stroke-linejoin="round"/>
    ${pts.map((p) => `<circle cx="${x(p).toFixed(1)}" cy="${y(p.y).toFixed(1)}" r="4" fill="${p.est ? '#0f1114' : '#2f8cff'}" stroke="#2f8cff" stroke-width="2"/>`).join('')}
    <text x="${L}" y="${H - 6}">${fmtDate(pts[0].date)}</text><text x="${W - P}" y="${H - 6}" text-anchor="end">${fmtDate(pts[pts.length - 1].date)}</text><text x="${L}" y="10">${unit}</text></svg>`;
}

// ---------- training chart (day columns; week / month / block) ----------
const TYPE_META = { strength: { label: 'Lift', color: 'var(--lift)' }, run: { label: 'Run', color: 'var(--run)' }, ride: { label: 'Ride', color: 'var(--mtb)' }, other: { label: 'Other', color: 'var(--other)' } };
function trState() { if (!S.tr) S.tr = { range: 'week', offset: 0, metric: 'time', types: ['strength', 'run', 'ride', 'other'], sel: null }; return S.tr; }
function trPeriod(t) {
  const today = todayStr();
  if (t.range === 'week') {
    const from = E.addDays(E.weekStartOf(today, S.settings.weekStart), 7 * t.offset);
    return { from, to: E.addDays(from, 6), label: t.offset === 0 ? 'This week' : t.offset === -1 ? 'Last week' : `${fmtShort(from)} – ${fmtShort(E.addDays(from, 6))}`, sub: `${fmtShort(from)} – ${fmtShort(E.addDays(from, 6))}` };
  }
  if (t.range === 'month') {
    const d = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1 + t.offset, 1));
    const from = d.toISOString().slice(0, 10);
    const to = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    return { from, to, label: d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }), sub: t.offset === 0 ? 'This month' : '' };
  }
  const bl = X.blockRanges(S.settings.blocks, today);
  const idx = Math.max(0, Math.min(bl.length - 1, bl.length - 1 + t.offset));
  const b = bl[idx] || { n: 1, from: E.addDays(today, -34), current: true };
  return { from: b.from, to: E.addDays(b.from, 34), label: `Block ${b.n}${b.current ? ' (current)' : ''}`, sub: `${fmtShort(b.from)} – ${fmtShort(E.addDays(b.from, 34))}`, block: true, first: idx === 0 };
}
const fmtShort = (d) => new Date(E.toDay(d) * 86400000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
function metricVal(t, metric) { return metric === 'time' ? t.min : metric === 'stress' ? t.load : t.km; }
function trainingChartCard() {
  const t = trState();
  const P = trPeriod(t);
  const today = todayStr();
  const series = E.dailySeries(S.data.workouts, S.data.cardio, P.from, P.to);
  const types = t.metric === 'distance' ? t.types.filter((k) => k === 'run' || k === 'ride') : t.types;
  // previous period of the same length, for comparison
  const len = E.daysBetween(P.from, P.to) + 1;
  const prevSeries = E.dailySeries(S.data.workouts, S.data.cardio, E.addDays(P.from, -len), E.addDays(P.from, -1));
  const elapsed = series.filter((d) => d.date <= today).length;
  const sum = E.summarize(series.slice(0, elapsed), types);
  const prev = E.summarize(prevSeries.slice(0, elapsed), types);
  const canNext = P.to < today || (t.range !== 'block' && P.from <= today && P.to >= today) ? E.addDays(P.to, 1) <= today : false;

  let h = `<div class="card"><div class="row between"><h3>Training</h3><span class="tiny muted">Garmin + logged</span></div>
    <div class="seg" style="margin:10px 0 8px">${[['week', 'Week'], ['month', 'Month'], ['block', 'Block']].map(([v, l]) => `<button data-act="trrange" data-v="${v}" class="${t.range === v ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="row between" style="margin-bottom:8px"><button class="icon-btn" data-act="trnav" data-v="-1" aria-label="Previous" ${P.first ? 'disabled style="opacity:.3"' : ''}>‹</button>
      <div style="text-align:center"><div class="b">${esc(P.label)}</div><div class="tiny muted">${esc(P.sub || '')}</div></div>
      <button class="icon-btn" data-act="trnav" data-v="1" aria-label="Next" ${canNext ? '' : 'disabled style="opacity:.3"'}>›</button></div>
    <div class="row wrap" style="gap:6px;margin-bottom:6px"><span class="tiny muted" style="width:38px">Show</span>${[['time', 'Time'], ['stress', 'Stress'], ['distance', 'Distance']].map(([v, l]) => `<button class="chip ${t.metric === v ? 'on' : ''}" style="min-height:34px;padding:5px 12px" data-act="trmetric" data-v="${v}">${l}</button>`).join('')}</div>
    <div class="row wrap" style="gap:6px;margin-bottom:4px"><span class="tiny muted" style="width:38px">Filter</span>${Object.entries(TYPE_META).map(([k, m]) => `<button class="chip" style="min-height:34px;padding:5px 12px;${t.types.includes(k) ? `background:${m.color};border-color:${m.color};color:#0b0d10` : ''}" data-act="trtype" data-v="${k}">${m.label}</button>`).join('')}</div>`;
  h += trChart(series, types, t, today, P);
  // selected day
  if (t.sel && series.some((d) => d.date === t.sel)) {
    const d = series.find((x) => x.date === t.sel);
    const items = d.items.filter((it) => types.includes(it.type));
    h += `<div class="callout" style="margin-top:6px"><b>${fmtDate(d.date)}</b>${items.length ? items.map((it) => `<div class="small" style="margin-top:4px"><span style="color:${TYPE_META[it.type].color}">●</span> ${esc(it.title)} · ${fmtDur(it.min)}${it.km ? ` · ${n1(it.km)} km` : ''}${it.ascent ? ` · ↑${Math.round(it.ascent)} m` : ''}${it.sets ? ` · ${it.sets} sets` : ''} · effort ${it.effort}${it.estimated ? '*' : ''}</div>`).join('') : '<div class="small muted">Rest day (nothing logged).</div>'}</div>`;
  }
  // summary
  const diff = (a, b) => (b ? Math.round(((a - b) / b) * 100) : null);
  const dTime = diff(sum.min, prev.min);
  const daysSoFar = series.filter((d) => d.date <= today).length;
  h += `<div class="b" style="margin-top:14px">Summary · ${esc(P.label)}</div>
    <div class="stats four tr-sum" style="margin-top:8px">
      <div class="stat"><span>Time</span><b>${fmtDur(sum.min)}</b></div>
      <div class="stat"><span>Sessions</span><b>${sum.sessions}</b></div>
      <div class="stat"><span>Days</span><b>${sum.activeDays}<small style="font-size:12px;color:var(--muted)">/${daysSoFar}</small></b></div>
      <div class="stat"><span>Effort</span><b>${sum.effort ?? '–'}${sum.effort ? '<small style="font-size:12px;color:var(--muted)">/10</small>' : ''}</b></div>
    </div>
    <div class="stats four tr-sum" style="margin-top:8px">
      <div class="stat"><span>Run</span><b>${n1(sum.runKm)}<small style="font-size:12px;color:var(--muted)"> km</small></b></div>
      <div class="stat"><span>Ride</span><b>${n1(sum.rideKm)}<small style="font-size:12px;color:var(--muted)"> km</small></b></div>
      <div class="stat"><span>Climb</span><b>${Math.round(sum.ascent)}<small style="font-size:12px;color:var(--muted)"> m</small></b></div>
      <div class="stat"><span>Lifting</span><b>${types.includes('strength') ? `${sum.sets}<small style="font-size:12px;color:var(--muted)"> sets</small>` : '–'}</b></div>
    </div>
    ${dTime != null ? `<div class="small" style="margin-top:10px">vs same ${elapsed === len ? '' : `first ${elapsed} days of `}previous ${t.range === 'block' ? 'block' : t.range}: <b style="color:${dTime > 25 ? 'var(--warn)' : dTime < -25 ? 'var(--muted)' : 'var(--good)'}">${dTime > 0 ? '+' : ''}${dTime}% time</b>${sum.volume ? ` · lifting volume ${Math.round(sum.volume).toLocaleString()} kg` : ''}</div>` : ''}
    <div style="margin-top:10px">${types.map((k) => { const b = sum.byType[k]; const pct = sum.min ? Math.round((b.min / sum.min) * 100) : 0; return `<div class="hbar" style="grid-template-columns:86px 1fr 92px"><span class="tiny">${TYPE_META[k].label}</span><span class="t"><i style="width:${pct}%;background:${TYPE_META[k].color}"></i></span><span class="tiny" style="text-align:right">${fmtDur(b.min)} · ${b.n}×</span></div>`; }).join('')}</div>
    <div class="tiny faint" style="margin-top:6px">Tap a day to see what you did. * = effort estimated.</div></div>`;
  return h;
}
function trChart(series, types, t, today, P) {
  const W = 340; const H = 170; const L = 30; const R = 6; const T = 10; const B = t.range === 'block' ? 34 : 30;
  const n = series.length;
  const vals = series.map((d) => types.reduce((a, k) => a + metricVal(d.types[k], t.metric), 0));
  let max = Math.max(...vals, 0);
  const unit = t.metric === 'time' ? 'h' : t.metric === 'distance' ? 'km' : '';
  const scale = t.metric === 'time' ? 60 : 1;
  const nice = (v) => { const steps = t.metric === 'time' ? [30, 60, 90, 120, 180, 240, 300, 360] : t.metric === 'distance' ? [5, 10, 20, 30, 40, 50, 75, 100] : [200, 400, 600, 800, 1000, 1500, 2000, 3000]; return steps.find((s) => s >= v) || Math.ceil(v / 100) * 100; };
  max = nice(max || 1);
  const cw = (W - L - R) / n; const bw = Math.max(2, Math.min(28, cw * 0.72));
  const y = (v) => T + (H - T - B) * (1 - v / max);
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily training chart">`;
  for (const g of [0, 0.5, 1]) {
    const v = max * g; const yy = y(v);
    svg += `<line x1="${L}" x2="${W - R}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}" stroke="#2e333b" stroke-width="1"/><text x="${L - 5}" y="${(yy + 3).toFixed(1)}" text-anchor="end">${t.metric === 'time' ? Math.round((v / scale) * 10) / 10 : Math.round(v)}${g === 1 ? unit : ''}</text>`;
  }
  series.forEach((d, i) => {
    const cx = L + cw * i + cw / 2;
    const fut = d.date > today;
    let acc = 0;
    if (t.sel === d.date) svg += `<rect x="${(L + cw * i + 1).toFixed(1)}" y="${T}" width="${(cw - 2).toFixed(1)}" height="${H - T - B}" fill="rgba(47,140,255,.14)" rx="4"/>`;
    for (const k of types) {
      const v = metricVal(d.types[k], t.metric);
      if (!v) continue;
      const y1 = y(acc + v); const y0 = y(acc);
      svg += `<rect x="${(cx - bw / 2).toFixed(1)}" y="${y1.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, y0 - y1).toFixed(1)}" fill="${TYPE_META[k].color}" rx="${Math.min(3, bw / 4)}"/>`;
      acc += v;
    }
    if (!acc && !fut) svg += `<circle cx="${cx.toFixed(1)}" cy="${(H - B - 3).toFixed(1)}" r="1.6" fill="#4b525c"/>`;
    // labels
    const dt = new Date(E.toDay(d.date) * 86400000); const dom = dt.getUTCDate();
    const isToday = d.date === today;
    const col = isToday ? '#2f8cff' : fut ? '#3a4049' : '#8a939e';
    if (t.range === 'week') svg += `<text x="${cx.toFixed(1)}" y="${H - B + 13}" text-anchor="middle" style="fill:${col};font-weight:${isToday ? 800 : 600};font-size:11px">${DOW[dt.getUTCDay()]}</text><text x="${cx.toFixed(1)}" y="${H - B + 25}" text-anchor="middle" style="fill:${col};font-size:10px">${dom}</text>`;
    else if (t.range === 'month') { if (dom === 1 || dom % 5 === 0 || isToday) svg += `<text x="${cx.toFixed(1)}" y="${H - B + 13}" text-anchor="middle" style="fill:${col};font-weight:${isToday ? 800 : 500};font-size:10px">${dom}</text>`; }
    else {
      if (i % 7 === 0) {
        const wk = i / 7;
        if (i) svg += `<line x1="${(L + cw * i).toFixed(1)}" x2="${(L + cw * i).toFixed(1)}" y1="${T}" y2="${H - B + 4}" stroke="#2e333b" stroke-dasharray="2 3"/>`;
        svg += `<text x="${(L + cw * (i + 3.5)).toFixed(1)}" y="${H - B + 14}" text-anchor="middle" style="fill:#c7ced6;font-weight:700;font-size:10.5px">W${wk + 1}</text><text x="${(L + cw * (i + 3.5)).toFixed(1)}" y="${H - B + 26}" text-anchor="middle" style="fill:#7d8792;font-size:9.5px">${WEEK_NAMES[wk] || ''}</text>`;
      }
      if (isToday) svg += `<path d="M${cx.toFixed(1)} ${H - B + 1} l-3 4 h6 z" fill="#2f8cff"/>`;
    }
    svg += `<rect x="${(L + cw * i).toFixed(1)}" y="${T}" width="${cw.toFixed(1)}" height="${H - T}" fill="transparent" data-act="trday" data-d="${d.date}" style="cursor:pointer"/>`;
  });
  return svg + '</svg>';
}

function loadCard(ctx) {
  const lm = ctx.lm; const f = ctx.fatigue;
  const eff = (x) => (x == null ? '–' : `${Math.round(x * 10) / 10}/10`);
  let h = `<div class="card"><div class="row between"><h3>Training load</h3><span class="tag ${f.tone}">${esc(f.label)}</span></div>`;
  if (f.level === 'unknown') {
    return h + `<div class="small" style="margin-top:6px">${esc(f.why)}</div><div class="callout">${esc(f.advice)}</div></div>`;
  }
  const max = Math.max(lm.acute, lm.chronicWeekly, 1);
  h += `<div class="small" style="margin-top:6px">${esc(f.why)}</div>
    <div class="stats" style="margin-top:12px">
      <div class="stat"><span>Last 7 days</span><b>${fmtDur(lm.acuteMin)}</b><em>effort ${eff(lm.acuteEffort)}</em></div>
      <div class="stat"><span>Usual week</span><b>${fmtDur(lm.chronicMinWeekly)}</b><em>effort ${eff(lm.chronicEffort)}</em></div>
      <div class="stat"><span>Difference</span><b style="color:${f.pct > 25 ? 'var(--bad)' : f.pct < -20 ? 'var(--warn)' : 'var(--good)'}">${f.pct > 0 ? '+' : ''}${f.pct}%</b><em>${f.pct >= 0 ? 'more stress' : 'less stress'}</em></div>
    </div>
    <div style="margin-top:12px">
      <div class="hbar" style="grid-template-columns:92px 1fr"><span class="tiny">Last 7 days</span><span class="t" style="height:14px"><i style="width:${(lm.acute / max) * 100}%;background:${f.pct > 25 ? 'var(--bad)' : 'var(--accent)'}"></i></span></div>
      <div class="hbar" style="grid-template-columns:92px 1fr"><span class="tiny">Usual week</span><span class="t" style="height:14px"><i style="width:${(lm.chronicWeekly / max) * 100}%;background:var(--faint)"></i></span></div>
    </div>
    <div class="callout ${f.level === 'very-high' ? 'warn' : f.level === 'normal' ? 'good' : 'info'}"><b>What to do:</b> ${esc(f.advice)}</div>
    ${lm.monotony != null ? `<div class="small muted" style="margin-top:8px">Day-to-day variety: <b style="color:var(--text)">${lm.monotony >= 2 ? 'low — every day is similar, add a proper easy or rest day' : 'good — hard and easy days are mixed'}</b></div>` : ''}
    ${lm.estimatedDays ? `<div class="tiny faint" style="margin-top:6px">Effort was estimated on ${lm.estimatedDays} of your ${lm.daysWithData} training days. Tap the session effort (5–10) when you finish a workout to make this accurate.</div>` : ''}
    <details style="margin-top:6px"><summary class="small">How is this worked out?</summary><div class="small muted">Training stress = minutes × effort (1–10), so an hour hard counts more than an hour easy. "Usual week" is your average over the last 4 weeks. Durations come from Garmin. Under 25% more than usual is normal; over 50% more is a spike worth backing off from.</div></details></div>`;
  return h;
}

function progressView(ctx) {
  let h = `<div class="seg">${[['lifts', 'Lifts'], ['training', 'Training'], ['coach', 'Coach']].map(([v, l]) => `<button data-act="progseg" data-v="${v}" class="${S.progSeg === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  if (S.progSeg === 'lifts') {
    const groups = liftGroups();
    if (!groups.length) return h + '<div class="card muted">No lifts logged yet.</div>';
    if (!S.trendKey || !groups.some((g) => g.name === S.trendKey)) S.trendKey = (groups.find((g) => g.keys.has('squat')) || groups[0]).name;
    const grp = groups.find((g) => g.name === S.trendKey);
    const key = [...grp.keys][0];
    const m = metaOf(key) || {};
    const hist = groupHistory(grp.keys);
    const pts = hist.map((x) => { const b = E.sessionBest(x.ex, S.settings.bodyweight, !!m.bodyweight); return b ? { date: x.date, y: b.e1rm, est: b.estimated, b } : null; }).filter(Boolean);
    const best = pts.reduce((a, p) => (!a || p.y > a.y ? p : a), null);
    const last = pts[pts.length - 1];
    h += `<select class="f" data-act="trendkey" aria-label="Exercise" style="margin-bottom:12px">${groups.map((g) => `<option value="${esc(g.name)}" ${g.name === grp.name ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select>
      <div class="stats" style="margin-bottom:12px"><div class="stat"><span>Best e1RM</span><b>${best ? best.y : '–'}</b></div><div class="stat"><span>Latest</span><b>${last ? last.y : '–'}</b></div><div class="stat"><span>Sessions</span><b>${pts.length}</b></div></div>
      <div class="card">${lineChart(pts.filter((q) => E.daysBetween(q.date, ctx.t) <= 365))}<div class="tiny faint">Estimated 1RM from your best set each session, last 12 months. Hollow points had no RPE and underestimate.</div></div>
      ${grp.keys.has('squat') || grp.keys.has('incline_press') ? `<div class="callout info" style="margin-bottom:12px">${grp.keys.has('squat') ? `Goal: 2× body weight ≈ ${Math.round(S.settings.bodyweight * 2)} kg. Latest estimate is ${last ? Math.round((last.y / (S.settings.bodyweight * 2)) * 100) : '–'}% of that.` : `Bench goal 1.7× body weight ≈ ${Math.round(S.settings.bodyweight * 1.7)} kg (flat bench; incline runs lower).`}</div>` : ''}
      <div class="card"><table class="t"><tr><th>Date</th><th>Best set</th><th class="n">RPE</th><th class="n">Vol</th></tr>
      ${hist.slice(-10).reverse().map((x) => { const b = E.sessionBest(x.ex, S.settings.bodyweight, !!m.bodyweight); const r = E.workSets(x.ex).map((s) => s.rpe).filter((v) => v != null); return `<tr><td>${fmtDate(x.date)}</td><td>${b ? `${n1(b.weight)} × ${b.reps}` : '–'}</td><td class="n">${r.length ? n1(r.reduce((a, c) => a + c, 0) / r.length) : '–'}</td><td class="n">${Math.round(E.volumeLoad(x.ex))}</td></tr>`; }).join('')}</table></div>`;
    return h;
  }
  if (S.progSeg === 'training') {
    const ws = E.weekStartOf(ctx.t, S.settings.weekStart);
    const weeks = [];
    for (let i = 9; i >= 0; i--) weeks.push(E.weeklyReport({ workouts: S.data.workouts, cardio: S.data.cardio, weekStartDay: E.addDays(ws, -7 * i), bodyweight: S.settings.bodyweight }));
    h += trainingChartCard(ctx);
    h += loadCard(ctx);
    const runs = S.data.cardio.filter((c) => c.type === 'run' && c.distanceKm).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 8);
    if (runs.length) {
      h += `<div class="card"><div class="row between"><h3>Recent runs</h3><span class="tiny muted">easy ≤ ${easyCeil()} bpm</span></div><table class="t" style="margin-top:6px"><tr><th>Date</th><th class="n">km</th><th class="n">Pace</th><th class="n">HR</th></tr>
        ${runs.map((r) => { const p = r.durationMin / r.distanceKm; return `<tr><td>${fmtDate(r.date)}</td><td class="n">${n1(r.distanceKm)}</td><td class="n">${Math.floor(p)}:${String(Math.round((p % 1) * 60)).padStart(2, '0')}</td><td class="n" style="${r.avgHr > easyCeil() ? 'color:var(--warn)' : ''}">${r.avgHr ?? '–'}</td></tr>`; }).join('')}</table></div>`;
    }
    const cur = weeks[9]; const prev = weeks[8];
    const mx = Math.max(10, ...MUSCLES.map((x) => Math.max(cur.setsByMuscle[x] || 0, prev.setsByMuscle[x] || 0)));
    h += `<div class="card"><h3>Working sets per muscle</h3><div class="tiny muted" style="margin-bottom:6px">This week (last week in brackets)</div>
      ${MUSCLES.map((x) => `<div class="hbar"><span>${x}</span><span class="t"><i style="width:${((cur.setsByMuscle[x] || 0) / mx) * 100}%"></i></span><span class="tiny" style="text-align:right">${cur.setsByMuscle[x] || 0} <span class="faint">(${prev.setsByMuscle[x] || 0})</span></span></div>`).join('')}</div>`;
    return h;
  }
  // coach
  const wsd = E.weekStartOf(ctx.t, S.settings.weekStart);
  const cur = E.weeklyReport({ workouts: S.data.workouts, cardio: S.data.cardio, weekStartDay: wsd, bodyweight: S.settings.bodyweight });
  const last = E.weeklyReport({ workouts: S.data.workouts, cardio: S.data.cardio, weekStartDay: E.addDays(wsd, -7), bodyweight: S.settings.bodyweight });
  const advice = E.nextWeekAdvice({ week: S.settings.week, recovery: ctx.recovery, lm: ctx.lm, creeps: ctx.creeps, report: cur });
  const rep = (t, r) => `<div class="card"><div class="row between"><h3>${t}</h3><span class="tiny muted">from ${fmtDate(r.weekStart)}</span></div>
    <div class="stats four" style="margin-top:10px"><div class="stat"><span>Lifts</span><b>${r.strengthSessions}</b></div><div class="stat"><span>Run</span><b>${r.runKm}km</b></div><div class="stat"><span>Ride</span><b>${r.mtbKm}km</b></div><div class="stat"><span>Time</span><b>${fmtDur(r.totalMin)}</b></div></div>
    ${r.prs.length ? `<div class="small" style="margin-top:8px"><b>PRs:</b> ${r.prs.map((p) => `${esc(p.name)} ${p.e1rm} kg (was ${p.prev})`).join('; ')}</div>` : ''}</div>`;
  h += `<div class="card"><h3>What to do next</h3><ul class="dots">${advice.map((a) => `<li>${esc(a)}</li>`).join('')}</ul><div class="tiny faint" style="margin-top:6px">Rule-based from your numbers.</div></div>
    ${rep('This week', cur)}${rep('Last week', last)}
    <div class="card"><h3>Full written review</h3><p class="small muted">Copies your coaching brief plus all computed numbers. Paste into Claude or Gemini for the weekly analysis in your format.</p>
    <button class="btn primary block" data-act="copypacket">Copy coach packet</button></div>`;
  return h;
}
function coachPacket(ctx) {
  const wsd = E.weekStartOf(ctx.t, S.settings.weekStart);
  const cur = E.weeklyReport({ workouts: S.data.workouts, cardio: S.data.cardio, weekStartDay: wsd, bodyweight: S.settings.bodyweight });
  const last = E.weeklyReport({ workouts: S.data.workouts, cardio: S.data.cardio, weekStartDay: E.addDays(wsd, -7), bodyweight: S.settings.bodyweight });
  const lifts = {};
  for (const k of Object.keys(EXERCISES)) {
    const h = E.exerciseHistory(S.data.workouts, k).slice(0, 4);
    const day = usedIn(k).map((x) => dayNo(x.d)).join('/');
    if (h.length) lifts[`${EXERCISES[k].name}${day ? ` (${day})` : ''}`] = h.map((x) => ({ date: x.date, sets: E.workSets(x.ex).map((s) => `${s.reps}x${s.weight}${s.rpe != null ? '@' + s.rpe : '@?'}`), pain: x.ex.pain || undefined }));
  }
  const packet = {
    note: 'Computed by the Max Effort app. Sessions, durations and HR come from Garmin; sets from the app/Hevy. "@?" = RPE not recorded. Nothing here is invented.',
    today: ctx.t, planPosition: { week: S.settings.week + 1, phase: WEEK_NAMES[S.settings.week], day: DAYS[pos().dayIdx].name }, athlete: athleteInfo(), bodyweightKg: S.settings.bodyweight,
    maxHr: { value: S.settings.maxHr, source: S.settings.maxHrManual ? 'manual' : 'highest Garmin-recorded HR' },
    recovery: ctx.recovery, fatigue: ctx.fatigue, load: ctx.lm, rpeCreep: ctx.creeps, thisWeek: cur, lastWeek: last, recentLifts: lifts,
    garminActivities28d: feedItems().filter((f) => E.daysBetween(f.date, ctx.t) <= 28).map((f) => ({ date: f.date, type: f.kind === 'strength' ? 'strength' : f.type, min: f.durationMin, avgHr: f.avgHr, km: f.cardio ? f.cardio.distanceKm : undefined, climbM: f.cardio ? f.cardio.ascentM : undefined, setsLogged: f.kind === 'strength' ? !!f.workout : undefined })),
    skippedLast28d: (S.skips || []).filter((k) => E.daysBetween(k.date, ctx.t) <= 28).map((k) => ({ date: k.date, day: k.dayName, reason: k.reason, note: k.note || undefined })),
    injuries: S.data.injuries, checkinsLast14: S.data.checkins.filter((c) => E.daysBetween(c.date, ctx.t) <= 14),
    sleepWeeksLast8: S.data.sleep.slice().sort((a, b) => (a.weekEnd < b.weekEnd ? 1 : -1)).slice(0, 8),
    restingHrWeeksLast8: S.data.rhr.slice().sort((a, b) => (a.weekEnd < b.weekEnd ? 1 : -1)).slice(0, 8),
  };
  return `${COACH_PROMPT}\n\n=== DATA FROM MY TRAINING APP ===\n${JSON.stringify(packet, null, 1)}\n\nUsing the format above, give me the weekly analysis and next-week recommendations.`;
}

// ---------- ME ----------
function meView(ctx) {
  let h = `<div class="seg">${[['health', 'Health'], ['settings', 'Settings'], ['data', 'Data']].map(([v, l]) => `<button data-act="meseg" data-v="${v}" class="${S.meSeg === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  if (S.meSeg === 'health') {
    h += recoveryCard(ctx, true) + checkinCard(ctx.checkin, false);
    const sl = S.data.sleep.slice().sort((a, b) => (a.weekEnd < b.weekEnd ? 1 : -1)).slice(0, 8).reverse();
    const rh = S.data.rhr.slice().sort((a, b) => (a.weekEnd < b.weekEnd ? 1 : -1)).slice(0, 8).reverse();
    if (sl.length) h += `<div class="card"><div class="row between"><h3>Sleep (Garmin, weekly)</h3><span class="tiny muted">need ≈ ${E.fmtMin(sl[sl.length - 1].needMin)}</span></div>${lineChart(sl.map((x) => ({ date: x.weekEnd, y: Math.round(x.durMin / 6) / 10 })), 'hours')}</div>`;
    if (rh.length) h += `<div class="card"><h3>Resting HR (Garmin, weekly)</h3>${lineChart(rh.map((x) => ({ date: x.weekEnd, y: x.resting })), 'bpm')}</div>`;
    h += '<h2>Injuries and niggles</h2>';
    const inj = S.data.injuries.slice().sort((a, b) => (a.status === 'resolved') - (b.status === 'resolved'));
    h += inj.map((i) => `<div class="card"><div class="row between"><h3>${esc(i.region)}</h3><span class="tag ${i.status === 'worsening' ? 'down' : i.status === 'resolved' ? 'up' : 'hold'}">${esc(i.status)}</span></div>
      <div class="small muted">${esc(i.type)} · since ${fmtDate(i.onset)}${i.aggravators ? ` · worse with ${esc(i.aggravators)}` : ''}</div>
      <div class="grid2"><div><label class="l">Pain now</label><select class="f" data-act="injsev" data-id="${esc(i.id)}">${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => `<option ${i.severity === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div><label class="l">Status</label><select class="f" data-act="injstatus" data-id="${esc(i.id)}">${['new', 'improving', 'stable', 'worsening', 'resolved'].map((v) => `<option ${i.status === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div></div></div>`).join('') || '<div class="card small muted">Nothing logged. Log niggles early; it is the cheapest injury prevention there is.</div>';
    h += `<div class="card"><h3>Log a niggle</h3><label class="l">Where</label><input class="f" id="i-region" placeholder="e.g. right Achilles">
      <div class="grid2"><div><label class="l">Type</label><select class="f" id="i-type"><option>joint</option><option>tendon</option><option>muscle</option><option>DOMS</option><option>other</option></select></div><div><label class="l">Pain 0–10</label><select class="f" id="i-sev">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => `<option>${v}</option>`).join('')}</select></div></div>
      <label class="l">Worse with</label><input class="f" id="i-agg" placeholder="e.g. bottom of squat, downhill running"><button class="btn block" data-act="addinjury" style="margin-top:12px">Add</button>
      <div class="tiny faint" style="margin-top:8px">Sharp or worsening pain, swelling, numbness or night pain: see a physio or doctor. This app is a training tool, not a clinician.</div></div>`;
    return h;
  }
  if (S.meSeg === 'settings') {
    return h + `<div class="card"><div class="grid2"><div><label class="l">Body weight (kg)</label><input class="f" data-set="bodyweight" inputmode="decimal" value="${S.settings.bodyweight}"></div>
      <div><label class="l">Max HR</label><input class="f" data-set="maxHr" inputmode="numeric" value="${S.settings.maxHr}"></div>
      <div><label class="l">Birth year</label><input class="f" data-set="birthYear" inputmode="numeric" placeholder="e.g. 1990" value="${S.settings.birthYear ?? ''}"></div>
      <div><label class="l">Height (cm)</label><input class="f" data-set="heightCm" inputmode="numeric" placeholder="e.g. 180" value="${S.settings.heightCm ?? ''}"></div>
      <div><label class="l">Easy ceiling (% max)</label><input class="f" data-set="easyPct" inputmode="decimal" value="${Math.round(S.settings.easyPct * 100)}"></div>
      <div><label class="l">Week starts</label><select class="f" data-set="weekStart"><option value="0" ${S.settings.weekStart === 0 ? 'selected' : ''}>Sunday</option><option value="1" ${S.settings.weekStart === 1 ? 'selected' : ''}>Monday</option></select></div></div>
      <div class="tiny muted" style="margin-top:10px">${S.settings.maxHrManual ? 'Max HR set by you.' : `Max HR is the highest your Garmin has recorded (${S.maxHrObserved ?? '–'} bpm). Wrist HR can spike; if that number looks wrong, type your own.`} Easy ceiling now: <b>${easyCeil()} bpm</b>.</div>
      ${S.settings.maxHrManual ? '<button class="btn sm" data-act="maxhrauto" style="margin-top:10px">Use Garmin max HR again</button>' : ''}</div>
      ${installCard()}
      <div class="tiny faint" style="text-align:center">Max Effort v${APP_VERSION}</div>`;
  }
  const d = S.data;
  return h + `<div class="card"><h3>Export</h3><div class="small muted" style="margin:4px 0 10px">A day, a week, a training block or any dates, as a spreadsheet, PDF report, coach text or raw data.</div><button class="btn primary block" data-act="openexport">Export data…</button></div>
    <div class="card"><h3>On this phone</h3><div class="small muted" style="margin-top:4px">${d.cardio.length} Garmin/cardio activities · ${d.workouts.length} logged lifting sessions · ${d.sleep.length} sleep weeks · ${d.rhr.length} resting-HR weeks · ${d.checkins.length} check-ins</div>
    <div class="tiny faint" style="margin-top:6px">${S.lastBackup ? `Last backup ${fmtDate(S.lastBackup.slice(0, 10))}.` : 'No backup yet.'} Clearing Chrome's site data erases everything, so back up weekly to Google Drive or email.</div>
    <button class="btn primary block" data-act="backup" style="margin-top:12px">Download backup</button>
    <label class="btn block" style="cursor:pointer">Restore from backup<input type="file" data-act="restore" hidden></label></div>
    <div class="card"><h3>Import from Garmin & Hevy</h3><div class="tiny muted">Re-importing the same file is safe; entries merge by date and time.</div>
    <label class="btn block sm" style="cursor:pointer;margin-top:10px">Garmin activities CSV<input type="file" data-act="impgarmin" hidden></label>
    <label class="btn block sm" style="cursor:pointer">Garmin sleep CSV<input type="file" data-act="impsleep" hidden></label>
    <label class="btn block sm" style="cursor:pointer">Hevy workouts CSV<input type="file" data-act="imphevy" hidden></label>
    <label class="l">Resting HR (paste the weekly table from Garmin Connect)</label><textarea class="f" id="rhr-paste" placeholder="29 Sep - 5 Oct    47 bpm    120 bpm"></textarea><button class="btn block sm" data-act="imprhr" style="margin-top:8px">Import resting HR</button></div>
    <div class="card"><button class="btn danger block" data-act="wipe">Erase everything on this phone</button></div>`;
}

function download(name, text, type = 'application/json') {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove();
}
const readFile = (el) => (el.files[0] ? el.files[0].text() : null);

// ---------- INSTALL ----------
function installCard() {
  const sw = S.swState || 'checking';
  const off = sw === 'active' ? '<span style="color:var(--good)">● Offline ready</span>' : sw === 'checking' ? '<span class="muted">● Checking offline mode…</span>' : '<span style="color:var(--bad)">● Offline mode not working</span>';
  let body;
  if (isStandalone()) body = '<div class="small">Installed. You are using the app version.</div>';
  else if (installPrompt) body = '<button class="btn primary block" data-act="install">Install Max Effort</button>';
  else body = `<div class="small muted">To install: Chrome menu <b>⋮ › Install app</b>.${sw === 'active' ? '' : ' Wait until it says Offline ready, then reload the page.'}</div>`;
  return `<div class="card"><div class="row between"><h3>App</h3><span class="tiny">${off}</span></div><div style="margin-top:8px">${body}</div></div>`;
}

// ---------- EXPORT ----------
function expState() {
  if (!S.exp) S.exp = { kind: 'block', day: todayStr(), block: (S.settings.blocks || []).length || 1, from: E.addDays(todayStr(), -6), to: todayStr(), inc: { strength: true, activities: true, weekly: true, health: true }, fmt: 'csv' };
  return S.exp;
}
function expRange() {
  const x = expState();
  return X.resolveRange(x, { today: todayStr(), weekStart: S.settings.weekStart, blocks: S.settings.blocks });
}
function expSlice() { return X.sliceData({ ...S.data, skips: S.skips }, expRange()); }
const PERIODS = [['today', 'Today'], ['day', 'A day…'], ['week', 'This week'], ['lastweek', 'Last week'], ['block', 'Block…'], ['last30', '30 days'], ['custom', 'Dates…'], ['all', 'Everything']];
const FORMATS = [
  ['csv', 'Spreadsheet', 'CSV tables for Sheets / Excel. Several tables come as one .zip.'],
  ['pdf', 'PDF report', 'A readable summary: totals, lifts, sessions, runs and rides, health. Save as PDF or print.'],
  ['coach', 'For your coach', 'Your coaching brief + this period\'s data, copied to paste into Claude or Gemini.'],
  ['json', 'Raw data', 'Everything in the period as JSON. Good for other tools or archiving.'],
];
function exportView() {
  const x = expState();
  const r = expRange();
  const sl = expSlice();
  const blocks = X.blockRanges(S.settings.blocks, todayStr());
  const short = (d) => fmtDate(d);
  let h = `<h2 style="margin-top:4px">Period</h2><div class="chips" style="flex-wrap:wrap">${PERIODS.map(([v, l]) => `<button class="chip ${x.kind === v ? 'on' : ''}" data-act="expkind" data-v="${v}">${l}</button>`).join('')}</div>`;
  if (x.kind === 'day') h += `<input class="f" type="date" data-exp="day" value="${x.day}" max="${todayStr()}">`;
  if (x.kind === 'block') h += `<select class="f" data-exp="block">${blocks.slice().reverse().map((b) => `<option value="${b.n}" ${x.block === b.n ? 'selected' : ''}>Block ${b.n} · ${short(b.from)} – ${b.current ? 'today' : short(b.to)}${b.current ? ' (current)' : ''}</option>`).join('')}</select>`;
  if (x.kind === 'custom') h += `<div class="grid2"><div><label class="l">From</label><input class="f" type="date" data-exp="from" value="${x.from}"></div><div><label class="l">To</label><input class="f" type="date" data-exp="to" value="${x.to}"></div></div>`;
  const c = X.counts(sl);
  h += `<div class="callout info" style="margin-top:12px"><b>${x.kind === 'all' ? 'All your data' : `${fmtDate(r.from)}${r.from !== r.to ? ` – ${fmtDate(r.to)}` : ''}`}</b><br>${c.lifts} strength session${c.lifts === 1 ? '' : 's'} · ${c.activities} run${c.activities === 1 ? '' : 's'}/ride${c.activities === 1 ? '' : 's'}/other · ${c.checkins} check-in${c.checkins === 1 ? '' : 's'}${c.skips ? ` · ${c.skips} skipped` : ''}</div>`;
  h += `<h2>Include</h2><div class="togg">${[['strength', 'Lifting sets'], ['activities', 'Activities (Garmin)'], ['weekly', 'Weekly totals'], ['health', 'Health']].map(([k, l]) => `<label><input type="checkbox" data-expinc="${k}" ${x.inc[k] ? 'checked' : ''}> ${l}</label>`).join('')}</div>
    <div class="tiny faint" style="margin-top:6px">Health = check-ins, injuries, and Garmin's weekly sleep and resting HR.</div>`;
  h += '<h2>Format</h2>';
  h += FORMATS.map(([v, l, d]) => `<button class="card tap" data-act="expfmt" data-v="${v}" style="display:block;width:100%;text-align:left;${x.fmt === v ? 'border-color:var(--accent);background:var(--accent-soft)' : ''}"><div class="row between"><span class="b">${l}</span><span style="color:var(--accent);font-weight:900">${x.fmt === v ? '●' : '○'}</span></div><div class="small muted">${d}</div></button>`).join('');
  const canShare = !!navigator.share;
  if (x.fmt === 'pdf') h += '<button class="btn primary block" data-act="expgo" data-how="view">Open report</button>';
  else if (x.fmt === 'coach') h += '<button class="btn primary block" data-act="expgo" data-how="copy">Copy for coach</button>' + (canShare ? '<button class="btn block" data-act="expgo" data-how="share">Share as text…</button>' : '');
  else h += (canShare ? '<button class="btn primary block" data-act="expgo" data-how="share">Share…</button>' : '') + `<button class="btn ${canShare ? '' : 'primary '}block" data-act="expgo" data-how="download">Download</button>`;
  h += '<div class="tiny faint" style="text-align:center;margin-top:8px">Share sends the file to Drive, email, WhatsApp, etc. Download saves it to your phone\'s Downloads folder.</div>';
  return h;
}
function expIncluded() { const i = expState().inc; return Object.values(i).some(Boolean); }
function expFiles() {
  const x = expState(); const sl = expSlice(); const r = sl.range;
  const base = x.kind === 'all' ? `max-effort_all_${todayStr()}` : `max-effort_${r.from}${r.from !== r.to ? `_to_${r.to}` : ''}`;
  if (x.fmt === 'json') {
    const { allWorkouts, allCardio, sessions, ...rest } = sl;
    return { name: `${base}.json`, type: 'application/json', data: JSON.stringify({ app: 'max-effort', version: APP_VERSION, exportedAt: new Date().toISOString(), ...rest, plan: exportPlan() }, null, 1) };
  }
  const tables = X.buildTables(sl, x.inc, { bodyweight: S.settings.bodyweight });
  const names = Object.keys(tables).filter((k) => tables[k].length > 1 || ['sets', 'activities'].includes(k));
  if (names.length === 1) return { name: `${base}_${names[0]}.csv`, type: 'text/csv', data: X.toCSV(tables[names[0]]) };
  const zip = X.makeZip(names.map((k) => ({ name: `${k}.csv`, text: X.toCSV(tables[k]) })));
  return { name: `${base}.zip`, type: 'application/zip', data: zip };
}
async function shareOrDownload(f, how) {
  const blob = new Blob([f.data], { type: f.type });
  if (how === 'share' && navigator.share) {
    const file = new File([blob], f.name, { type: f.type });
    if (!navigator.canShare || navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: f.name }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    toast('This file type can\'t be shared directly. Downloading instead.');
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(`Saved ${f.name} to Downloads.`);
}
async function runExport(how) {
  if (!expIncluded() && expState().fmt !== 'coach') { toast('Pick at least one thing to include.'); return; }
  const x = expState(); const sl = expSlice();
  if (!sl.workouts.length && !sl.sessions.length && !sl.cardio.length && !sl.checkins.length && !sl.sleep.length && !sl.skips.length) { toast('Nothing recorded in that period.'); return; }
  if (x.fmt === 'pdf') {
    S.report = X.reportHtml(sl, x.inc, { bodyweight: S.settings.bodyweight });
    renderReport(); return;
  }
  if (x.fmt === 'coach') {
    const txt = X.coachText(sl, COACH_PROMPT, { athlete: athleteInfo(), bodyweightKg: S.settings.bodyweight, maxHr: S.settings.maxHr, currentPlanPosition: `Week ${S.settings.week + 1} (${WEEK_NAMES[S.settings.week]}), ${DAYS[pos().dayIdx].name}` });
    if (how === 'share' && navigator.share) { try { await navigator.share({ title: 'Max Effort data', text: txt }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(txt); toast('Copied. Paste it into Claude or Gemini.'); } catch { await shareOrDownload({ name: `max-effort_${sl.range.from}_coach.txt`, type: 'text/plain', data: txt }, 'download'); }
    return;
  }
  await shareOrDownload(expFiles(), how);
}
function renderReport() {
  let root = document.getElementById('print-root');
  if (!S.report) { if (root) root.remove(); document.body.classList.remove('report-open'); return; }
  if (!root) { root = document.createElement('div'); root.id = 'print-root'; document.body.appendChild(root); }
  root.innerHTML = `<style>${X.REPORT_CSS}</style><div class="rp-bar no-print"><button data-act="reportclose">‹ Close</button><button class="rp-print" data-act="reportprint">Save as PDF / Print</button></div>${S.report}`;
  document.body.classList.add('report-open');
}

// ---------- events ----------
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-act],[data-tab]');
  if (!t) return;
  if (t.dataset.tab) {
    const same = S.tab === t.dataset.tab;
    S.tab = t.dataset.tab;
    if (same) { S.detail = null; S.editDay = null; S.editEx = null; S.cardioForm = false; S.exportOpen = false; S.splitOrder = false; }
    S.sheet = null; S.picker = null;
    render(); window.scrollTo(0, 0); return;
  }
  const a = t.dataset.act;
  if (t.tagName === 'SELECT' || (t.tagName === 'INPUT' && t.type !== 'button') || t.tagName === 'LABEL') return;
  if (a === 'noop') { if (e.target === t) return; return; }
  e.preventDefault();
  const i = +t.dataset.i; const j = +t.dataset.j; const k = +t.dataset.k;
  const d = S.draft;
  switch (a) {
    case 'gohealth': S.tab = 'me'; S.meSeg = 'health'; render(); window.scrollTo(0, 0); break;
    case 'gobackup': S.tab = 'me'; S.meSeg = 'data'; render(); window.scrollTo(0, 0); break;
    case 'goplan': S.tab = 'plan'; S.planMode = 'week'; S.planWeek = pos().week; render(); window.scrollTo(0, 0); break;
    case 'detail': S.detail = t.dataset.id; render(); window.scrollTo(0, 0); break;
    case 'detailback': S.detail = null; render(); break;
    case 'restdone': await markDay(pos().dayIdx, 'done'); render(); toast('Rest day done.'); break;
    case 'skipday': case 'prevday': case 'jumpday': {
      const from = pos();
      let n;
      if (a === 'prevday') n = retreat(from);
      else if (a === 'jumpday') n = { week: from.week, dayIdx: +t.dataset.d };
      else n = advance(from);
      if (n.week === from.week && n.dayIdx === from.dayIdx) break;
      await moveTo(n, from, null);
      break;
    }
    case 'undoday': await moveTo(S.undoPos, null, 'Back where you were.'); S.undoPos = null; break;
    case 'startday': S.daySheet = null; startDay(+t.dataset.d); break;
    case 'startempty': startEmpty(); break;
    case 'resume': S.tab = 'workout'; render(); window.scrollTo(0, 0); break;
    case 'cardio': S.daySheet = null; S.tab = 'workout'; S.cardioForm = true; render(); window.scrollTo(0, 0); break;
    case 'cardioback': S.cardioForm = false; render(); break;
    case 'ctype': document.querySelectorAll('#c-type-seg button').forEach((b) => b.classList.toggle('on', b === t)); $('#c-type').value = t.dataset.v; break;
    case 'crpe': document.querySelectorAll('#c-rpe button').forEach((b) => b.classList.toggle('on', b === t)); $('#c-rpe-v').value = t.dataset.v; break;
    case 'savecardio': saveCardio(); break;
    case 'done': markDone(i, j); break;
    case 'useprev': { const ex = d.exercises[i]; const wi = ex.sets.slice(0, j + 1).filter((x) => x.type === 'work').length - 1; const pv = ex.prev[wi]; if (pv) { ex.sets[j].weight = pv.weight; ex.sets[j].reps = pv.reps; saveDraft(); render(); } break; }
    case 'addset': { const ex = d.exercises[i]; const l = ex.sets.filter((s) => s.type === 'work').pop() || ex.sets[ex.sets.length - 1]; ex.sets.push({ type: 'work', weight: l ? l.weight : null, reps: l ? l.reps : null, rpe: null, done: false, planWeight: null, planReps: null }); saveDraft(); render(); break; }
    case 'setmenu': S.sheet = { title: `Set ${j + 1}`, items: [{ label: 'Make it a warm-up set', act: 'settype', data: { i, j, v: 'warmup' } }, { label: 'Make it a working set', act: 'settype', data: { i, j, v: 'work' } }, { label: 'Delete set', act: 'setdel', data: { i, j }, danger: true }] }; renderOverlay(); break;
    case 'settype': d.exercises[i].sets[j].type = t.dataset.v; S.sheet = null; saveDraft(); render(); break;
    case 'setdel': d.exercises[i].sets.splice(j, 1); S.sheet = null; saveDraft(); render(); break;
    case 'exmenu': S.sheet = { title: d.exercises[i].name, items: [{ label: 'Notes & pain', act: 'exopen', data: { i } }, { label: d.exercises[i].skipped ? 'Un-skip exercise' : 'Skip exercise', act: d.exercises[i].skipped ? 'exunskip' : 'exskip', data: { i } }, { label: 'Replace exercise', act: 'exreplace', data: { i } }, { label: 'Move up', act: 'exmove', data: { i, v: -1 } }, { label: 'Move down', act: 'exmove', data: { i, v: 1 } }, { label: 'Remove exercise', act: 'exremove', data: { i }, danger: true }] }; renderOverlay(); break;
    case 'exopen': d.exercises[i].open = !d.exercises[i].open; S.sheet = null; saveDraft(); render(); break;
    case 'exreplace': S.sheet = null; S.picker = { mode: 'replace', i }; S.pickQ = ''; renderOverlay(); break;
    case 'exmove': { const v = +t.dataset.v; const n = i + v; if (n >= 0 && n < d.exercises.length) { const [x] = d.exercises.splice(i, 1); d.exercises.splice(n, 0, x); } S.sheet = null; saveDraft(); render(); break; }
    case 'exremove': d.exercises.splice(i, 1); S.sheet = null; saveDraft(); render(); break;
    case 'addex': S.picker = { mode: 'workout' }; S.pickQ = ''; renderOverlay(); setTimeout(() => $('#pk-q') && $('#pk-q').focus(), 50); break;
    case 'pkclose': S.picker = null; renderOverlay(); break;
    case 'pick': pickExercise(t.dataset.key, t.dataset.name); break;
    case 'sheetclose': S.sheet = null; renderOverlay(); break;
    case 'srpe': d.sessionRpe = +t.dataset.v; saveDraft(); document.querySelectorAll('.rpe-chips button[data-act=srpe]').forEach((b) => b.classList.toggle('on', b === t)); break;
    case 'restadj': S.timerEnd = Math.max(Date.now(), S.timerEnd + +t.dataset.s * 1000); tick(); break;
    case 'restskip': S.timerEnd = 0; tick(); break;
    case 'finish': finishWorkout(); break;
    case 'revchoice': S.review.diffs[+t.dataset.n].choice = t.dataset.v; renderOverlay(); break;
    case 'revsave': finishWorkout(true); break;
    case 'revcancel': S.review = null; renderOverlay(); break;
    case 'discard':
      if (d.editingId ? true : confirm('Discard this workout? Logged sets will be lost.')) { S.draft = null; S.timerEnd = 0; await setMeta('draft', null); render(); }
      break;
    case 'closepost': S.post = null; S.tab = 'home'; render(); window.scrollTo(0, 0); break;
    case 'editworkout': editWorkout(t.dataset.id); break;
    case 'delworkout': if (confirm('Delete this workout permanently?')) { await db.del('workouts', t.dataset.id); S.data.workouts = S.data.workouts.filter((w) => w.id !== t.dataset.id); S.detail = null; render(); } break;
    case 'delcardio': if (confirm('Delete this activity permanently?')) { await db.del('cardio', t.dataset.id); S.data.cardio = S.data.cardio.filter((c) => c.id !== t.dataset.id); S.detail = null; render(); } break;
    // plan
    case 'planmode': S.planMode = t.dataset.v; render(); break;
    case 'planweek': S.planWeek = +t.dataset.v; render(); break;
    case 'editday': S.editDay = +t.dataset.d; if (S.planWeek == null) S.planWeek = pos().week; render(); window.scrollTo(0, 0); break;
    case 'dayback': S.editDay = null; render(); break;
    case 'editex': S.editEx = t.dataset.key; S.editExK = t.dataset.k != null ? +t.dataset.k : null; render(); window.scrollTo(0, 0); break;
    case 'planswap': S.picker = { mode: 'planswap', day: S.editDay, k: +t.dataset.k }; S.pickQ = ''; renderOverlay(); setTimeout(() => $('#pk-q') && $('#pk-q').focus(), 50); break;
    case 'exback': S.editEx = null; render(); break;
    case 'exup': case 'exdown': { const ex = DAYS[S.editDay].exercises; const n = k + (a === 'exup' ? -1 : 1); if (n >= 0 && n < ex.length) { const [x] = ex.splice(k, 1); ex.splice(n, 0, x); savePlan(); render(); } break; }
    case 'exdel': if (confirm('Remove this exercise from the day (all weeks)?')) { DAYS[S.editDay].exercises.splice(k, 1); savePlan(); render(); } break;
    case 'grpadd': { const w = S.planWeek; const g = DAYS[S.editDay].exercises[k].weeks[w]; const l = g[g.length - 1] || { sets: 1, reps: 10, weight: 0 }; g.push({ ...l }); savePlan(); render(); break; }
    case 'grpdel': { const g = DAYS[S.editDay].exercises[k].weeks[S.planWeek]; if (g.length > 1) { g.splice(+t.dataset.g, 1); savePlan(); render(); } else toast('Keep at least one row. Remove the exercise instead.'); break; }
    case 'warmadd': { const ex = DAYS[S.editDay].exercises[k]; const w0 = ex.weeks[S.planWeek][0]; ex.warm = { sets: 1, reps: 7, weight: r05((w0 ? w0.weight : 20) * 0.6) }; savePlan(); render(); break; }
    case 'warmdel': delete DAYS[S.editDay].exercises[k].warm; savePlan(); render(); break;
    case 'copyweeks': { const ex = DAYS[S.editDay].exercises[k]; if (confirm(`Copy Week ${S.planWeek + 1} rows to all five weeks for this exercise?`)) { const src = JSON.stringify(ex.weeks[S.planWeek]); ex.weeks = [0, 1, 2, 3, 4].map(() => JSON.parse(src)); savePlan(); toast('Copied to all weeks.'); render(); } break; }
    case 'planaddex': S.picker = { mode: 'plan' }; S.pickQ = ''; renderOverlay(); setTimeout(() => $('#pk-q') && $('#pk-q').focus(), 50); break;
    case 'daymove': { const n = S.editDay + +t.dataset.v; if (n >= 0 && n < DAYS.length) { const from = S.editDay; await reorderDays(() => moveDay(from, n)); S.editDay = n; render(); } break; }
    case 'ordopen': S.splitOrder = true; render(); window.scrollTo(0, 0); break;
    case 'orddone': S.splitOrder = false; render(); break;
    case 'ordmove': { const from = i; const to = i + +t.dataset.v; await reorderDays(() => moveDay(from, to)); render(); break; }
    case 'addtyped': { const ty = t.dataset.v; await reorderDays(() => DAYS.push({ id: `D${Date.now()}`, name: ty === 'rest' ? 'Rest' : ty === 'cardio' ? 'Cardio' : 'New lifting day', type: ty, title: ty === 'rest' ? 'Active recovery / rest' : ty === 'cardio' ? 'Easy run or ride' : 'New session', note: ty === 'rest' ? 'Walk, mobility, nothing taxing.' : ty === 'cardio' ? '~1 hour, easy.' : '', exercises: [] })); render(); toast('Added at the end. Move it into place with the arrows.'); break; }
    case 'daydel': if (DAYS.length > 1 && confirm('Delete this day from the plan?')) { const di = S.editDay; await reorderDays(() => DAYS.splice(di, 1)); S.editDay = null; render(); } break;
    case 'addday': await reorderDays(() => DAYS.push({ id: `D${Date.now()}`, name: 'New', type: 'strength', title: 'New session', exercises: [] })); S.editDay = DAYS.length - 1; render(); window.scrollTo(0, 0); break;
    case 'exportplan': download(`max-effort-plan-${todayStr()}.json`, JSON.stringify(exportPlan(), null, 1)); break;
    case 'resetplan': if (confirm('Replace your edited plan with the original 5-week block?')) { resetPlan(); splitShared(todayStr()); await setMeta('plan', exportPlan()); toast('Plan reset.'); render(); } break;
    // progress / me
    case 'progseg': S.progSeg = t.dataset.v; render(); window.scrollTo(0, 0); break;
    case 'meseg': S.meSeg = t.dataset.v; render(); window.scrollTo(0, 0); break;
    case 'install':
      if (installPrompt) { installPrompt.prompt(); const r = await installPrompt.userChoice; installPrompt = null; if (r.outcome === 'accepted') toast('Installing… find Max Effort in your app drawer.'); render(); }
      break;
    case 'daysheet': S.daySheet = { i: +t.dataset.d }; renderOverlay(); break;
    case 'dayclose': S.daySheet = null; renderOverlay(); break;
    case 'dayset': await setDayStatus(S.daySheet.i, t.dataset.v); break;
    case 'daynext': { const di = +t.dataset.d; S.daySheet = null; await moveTo({ week: S.settings.week, dayIdx: di }, pos(), null); break; }
    case 'daylink': S.daySheet = null; S.tab = 'home'; S.detail = t.dataset.id; renderOverlay(); render(); window.scrollTo(0, 0); break;
    case 'skipopen': { const di = +t.dataset.d; S.skipSheet = { dayIdx: di, reason: '', date: todayStr(), note: '' }; renderOverlay(); break; }
    case 'skipreason': S.skipSheet.reason = t.dataset.v; S.skipSheet.date = $('#skip-date').value; S.skipSheet.note = $('#skip-note').value; renderOverlay(); break;
    case 'skipsave': saveSkip(); break;
    case 'skipclose': S.skipSheet = null; renderOverlay(); break;
    case 'undoskip': undoSkip(t.dataset.id); break;
    case 'exskip': S.sheet = { title: `Skip ${d.exercises[i].name}?`, items: ['Pain', 'Fatigue', 'Equipment busy', 'No time', 'Other'].map((r) => ({ label: r, act: 'exskipr', data: { i, v: r } })) }; renderOverlay(); break;
    case 'exskipr': d.exercises[i].skipped = true; d.exercises[i].skipReason = t.dataset.v; S.sheet = null; saveDraft(); render(); break;
    case 'exunskip': d.exercises[i].skipped = false; S.sheet = null; saveDraft(); render(); break;
    case 'trrange': trState().range = t.dataset.v; S.tr.offset = 0; S.tr.sel = null; render(); break;
    case 'trnav': trState().offset += +t.dataset.v; S.tr.sel = null; render(); break;
    case 'trmetric': trState().metric = t.dataset.v; render(); break;
    case 'trtype': { const tr = trState(); const k = t.dataset.v; tr.types = tr.types.includes(k) ? (tr.types.length > 1 ? tr.types.filter((x) => x !== k) : tr.types) : Object.keys(TYPE_META).filter((x) => tr.types.includes(x) || x === k); render(); break; }
    case 'trday': trState().sel = S.tr.sel === t.dataset.d ? null : t.dataset.d; render(); break;
    case 'weekbar': {
      const w = (S.weekBars || [])[i]; if (!w) break;
      const d = new Date(E.toDay(w.weekStart) * 86400000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
      const parts = [w.strengthMin && `strength ${fmtDur(w.strengthMin)}`, w.runMin && `run ${fmtDur(w.runMin)}${w.runKm ? ` (${w.runKm} km)` : ''}`, w.mtbMin && `ride ${fmtDur(w.mtbMin)}${w.mtbKm ? ` (${w.mtbKm} km)` : ''}`].filter(Boolean);
      toast(`Week of ${d}: ${fmtDur(w.strengthMin + w.runMin + w.mtbMin)}${parts.length ? ' — ' + parts.join(', ') : ''}`);
      break;
    }
    case 'openexport': S.exportOpen = true; render(); window.scrollTo(0, 0); break;
    case 'exportback': S.exportOpen = false; render(); break;
    case 'exportday': expState(); S.exp.kind = 'day'; S.exp.day = t.dataset.d; S.detail = null; S.tab = 'me'; S.meSeg = 'data'; S.exportOpen = true; render(); window.scrollTo(0, 0); break;
    case 'expkind': expState().kind = t.dataset.v; if (t.dataset.v === 'block') S.exp.block = (S.settings.blocks || []).length; render(); break;
    case 'expfmt': expState().fmt = t.dataset.v; render(); break;
    case 'expgo': runExport(t.dataset.how); break;
    case 'reportclose': S.report = null; renderReport(); break;
    case 'reportprint': window.print(); break;
    case 'copypacket': { const txt = coachPacket(context()); try { await navigator.clipboard.writeText(txt); toast('Copied. Paste into Claude or Gemini.'); } catch { download('coach-packet.txt', txt, 'text/plain'); toast('Clipboard blocked; downloaded instead.'); } break; }
    case 'savecheckin': {
      const v = (id) => ($(id) ? num($(id).value) : null);
      const c = { date: todayStr(), sleepH: v('#k-sleep'), restingHr: v('#k-rhr'), soreness: v('#k-sore'), motivation: v('#k-mot'), notes: $('#k-notes') ? $('#k-notes').value : '' };
      await db.put('checkins', c); S.data.checkins = S.data.checkins.filter((x) => x.date !== c.date).concat(c); toast('Check-in saved.'); render(); break;
    }
    case 'addinjury': {
      const region = $('#i-region').value.trim(); if (!region) { toast('Say where it hurts.'); return; }
      const sev = +$('#i-sev').value;
      const inj = { id: `inj-${Date.now()}`, region, type: $('#i-type').value, severity: sev, aggravators: $('#i-agg').value, onset: todayStr(), status: 'new', log: [{ date: todayStr(), severity: sev, status: 'new' }] };
      await db.put('injuries', inj); S.data.injuries.push(inj); render(); break;
    }
    case 'maxhrauto': S.settings.maxHrManual = false; if (S.maxHrObserved) S.settings.maxHr = S.maxHrObserved; await saveSettings(); render(); break;
    case 'backup': download(`max-effort-backup-${todayStr()}.json`, JSON.stringify({ ...(await db.exportAll()), app: 'max-effort', plan: exportPlan() })); S.lastBackup = new Date().toISOString(); await setMeta('lastBackup', S.lastBackup); render(); toast('Backup saved to Downloads. Move it to Drive.'); break;
    case 'imprhr': { const rows = parseRestingHr($('#rhr-paste').value, new Date().getFullYear()); if (!rows.length) { toast('No weeks recognised.'); return; } await db.putMany('rhr', rows); S.data.rhr = await db.all('rhr'); toast(`Imported ${rows.length} weeks.`); render(); break; }
    case 'wipe': if (confirm('Erase ALL training data on this phone? Download a backup first.')) { for (const s of ['workouts', 'cardio', 'checkins', 'injuries', 'sleep', 'rhr', 'meta']) await db.clear(s); location.reload(); } break;
    default: break;
  }
});

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.id === 'pk-q') { S.pickQ = el.value; $('#pk-list').innerHTML = pickList(); return; }
  if (el.tagName === 'SELECT') return;
  if (el.type === 'checkbox') return;
  if (onWorkoutField(el)) return;
  onPlanField(el);
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.tagName === 'SELECT' && onWorkoutField(el)) return;
  if (el.type === 'checkbox' && !el.dataset.expinc && onPlanField(el)) return;
  if (el.tagName === 'SELECT' && (el.dataset.pd) && onPlanField(el)) return;
  const a = el.dataset.act;
  if (el.dataset.exp) { const x = expState(); x[el.dataset.exp] = el.dataset.exp === 'block' ? +el.value : el.value; render(); return; }
  if (el.dataset.expinc) { expState().inc[el.dataset.expinc] = el.checked; render(); return; }
  if (a === 'blockstart') {
    if (!el.value) return;
    const b = S.settings.blocks; if (b.length > 1 && el.value <= b[b.length - 2]) { toast('That is before the previous block started.'); render(); return; }
    b[b.length - 1] = el.value; await saveSettings(); toast('Block start updated.'); return;
  }
  if (a === 'cardioplan') {
    const c = S.data.cardio.find((x) => x.id === el.dataset.id); if (!c) return;
    const prevIdx = c.planDayId ? DAYS.findIndex((d) => d.id === c.planDayId) : -1;
    if (prevIdx >= 0 && dayState(prevIdx) === 'done') await markDay(prevIdx, null);
    if (el.value === '') { delete c.planDayId; await db.put('cardio', c); toast('Now an extra session.'); render(); return; }
    const i = +el.value;
    S.skips = (S.skips || []).filter((k) => !(k.week === S.settings.week && dayIndexOf(k) === i && E.daysBetween(k.date, todayStr()) <= 7));
    await setMeta('skips', S.skips);
    c.planDayId = DAYS[i].id; await db.put('cardio', c);
    await markDay(i, 'done');
    toast(`${DAYS[i].name} marked done.`); render(); return;
  }
  if (a === 'trendkey') { S.trendKey = el.value; render(); return; }
  if (a === 'injsev' || a === 'injstatus') {
    const inj = S.data.injuries.find((x) => x.id === el.dataset.id);
    if (a === 'injsev') inj.severity = +el.value; else inj.status = el.value;
    inj.log = (inj.log || []).concat({ date: todayStr(), severity: inj.severity, status: inj.status });
    await db.put('injuries', inj); render(); return;
  }
  if (el.dataset.set) {
    const k = el.dataset.set;
    const v = num(el.value);
    if (v == null) return;
    if (k === 'easyPct') S.settings.easyPct = v > 1 ? v / 100 : v;
    else if (k === 'bodyweight') S.settings.bodyweight = v;
    else if (k === 'maxHr') { S.settings.maxHr = Math.round(v); S.settings.maxHrManual = true; }
    else S.settings[k] = Math.round(v);
    if (k === 'week') {
      S.planWeek = S.settings.week;
      const b = S.settings.blocks; const start = E.addDays(E.weekStartOf(todayStr(), S.settings.weekStart), -7 * S.settings.week);
      if (b.length < 2 || start > b[b.length - 2]) b[b.length - 1] = start;
    }
    await saveSettings(); render(); return;
  }
  const txt = el.files ? await readFile(el) : null;
  if (!txt) return;
  try {
    if (a === 'restore') {
      const data = JSON.parse(txt);
      if (!['max-effort', 'hybrid-coach'].includes(data.app)) throw new Error('not a backup');
      if (!confirm('Replace everything on this phone with this backup?')) return;
      await db.importAll(data);
      if (data.plan) await setMeta('plan', data.plan);
      await setMeta('lastBackup', new Date().toISOString());
      location.reload();
    } else if (a === 'importplan') {
      const p = JSON.parse(txt);
      if (!Array.isArray(p.days) || !p.catalog) throw new Error('not a plan');
      loadPlan(p); splitShared(todayStr()); await setMeta('plan', exportPlan()); toast('Plan imported.'); render();
    } else if (a === 'imphevy') { const r = parseHevy(txt); await db.putMany('workouts', r); S.data.workouts = await db.all('workouts'); toast(`Imported ${r.length} Hevy sessions.`); render(); }
    else if (a === 'impgarmin') { const r = parseGarmin(txt); await db.putMany('cardio', r); S.data.cardio = await db.all('cardio'); await loadAll(); toast(`Imported ${r.length} Garmin activities.`); render(); }
    else if (a === 'impsleep') { const r = parseSleep(txt, new Date().getFullYear()); await db.putMany('sleep', r); S.data.sleep = await db.all('sleep'); toast(`Imported ${r.length} weeks of sleep.`); render(); }
  } catch { toast('That file could not be read.'); }
  el.value = '';
});

// Android back button / gesture closes overlays and sub-screens instead of leaving the app.
history.replaceState({ me: 1 }, '');
history.pushState({ me: 2 }, '');
window.addEventListener('popstate', () => {
  let handled = true;
  if (S.daySheet) S.daySheet = null;
  else if (S.skipSheet) S.skipSheet = null;
  else if (S.report) { S.report = null; renderReport(); }
  else if (S.review) S.review = null;
  else if (S.picker) S.picker = null;
  else if (S.sheet) S.sheet = null;
  else if (S.detail) S.detail = null;
  else if (S.splitOrder) S.splitOrder = false;
  else if (S.editEx) S.editEx = null;
  else if (S.editDay != null) S.editDay = null;
  else if (S.cardioForm) S.cardioForm = false;
  else if (S.exportOpen) S.exportOpen = false;
  else if (S.tab !== 'home') S.tab = 'home';
  else handled = false;
  if (handled) { history.pushState({ me: 2 }, ''); render(); } else history.back();
});

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; render(); });
window.addEventListener('appinstalled', () => { installPrompt = null; toast('Installed. Open Max Effort from your app drawer.'); render(); });

// ---------- boot ----------
(async function boot() {
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    await seedIfEmpty();
    await loadAll();
    if (S.draft) S.tab = 'workout';
    render();
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      // A new deploy installs in the background; when it takes over, reload once so you are on it immediately.
      const hadController = !!navigator.serviceWorker.controller;
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded && !S.draft) { reloaded = true; location.reload(); } else if (hadController && S.draft) toast('Update ready. It will load next time you open the app.'); });
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.tab === 'home' && S.shownDay && S.shownDay !== todayStr()) render(); if (document.visibilityState === 'visible') navigator.serviceWorker.getRegistration().then((r) => r && r.update()).catch(() => {}); });
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(() => navigator.serviceWorker.ready).then(() => { S.swState = 'active'; if (S.tab === 'me' || installPrompt) render(); }).catch(() => { S.swState = 'failed'; render(); });
      setTimeout(() => { if (!S.swState) { S.swState = navigator.serviceWorker.controller ? 'active' : 'failed'; if (S.tab === 'me') render(); } }, 8000);
    }
  } catch (err) {
    $('#app').innerHTML = `<div class="callout bad">Could not start: ${esc(err.message)}. Open the app from its web address (https), not from a downloaded file.</div>`;
  }
})();
