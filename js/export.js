// Export: pure functions (no DOM) so they can be tested in node.
// Periods -> filtered data -> tables (CSV / zip), printable report HTML, coach text, raw JSON.
import * as E from './engine.js';
import { EXERCISES, DAYS, WEEK_NAMES, dayIndexOf } from './plan.js';

const inRange = (d, r) => d >= r.from && d <= r.to;
const n1 = (x) => (x == null || Number.isNaN(x) ? '' : Math.round(x * 10) / 10);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtD = (s) => new Date(E.toDay(s) * 86400000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const fmtDur = (m) => { if (!m) return '–'; const h = Math.floor(m / 60); const mm = Math.round(m - h * 60); return h ? `${h}h ${mm}m` : `${mm}m`; };
const exName = (e) => (EXERCISES[e.key] || {}).name || e.name;

// ---------- blocks ----------
// blocks = ascending list of start dates. Block i runs to the day before block i+1 (last one: to today).
export function blockRanges(blocks, today) {
  const b = [...new Set(blocks || [])].filter(Boolean).sort();
  return b.map((start, i) => ({ n: i + 1, from: start, to: i + 1 < b.length ? E.addDays(b[i + 1], -1) : today, current: i === b.length - 1 }));
}

// ---------- periods ----------
export function resolveRange(sel, { today, weekStart = 0, blocks = [] }) {
  const ws = E.weekStartOf(today, weekStart);
  switch (sel.kind) {
    case 'today': return { from: today, to: today, label: 'Today' };
    case 'day': return { from: sel.day, to: sel.day, label: fmtD(sel.day) };
    case 'week': return { from: ws, to: today, label: 'This week' };
    case 'lastweek': return { from: E.addDays(ws, -7), to: E.addDays(ws, -1), label: 'Last week' };
    case 'last30': return { from: E.addDays(today, -29), to: today, label: 'Last 30 days' };
    case 'block': {
      const br = blockRanges(blocks, today);
      const b = br.find((x) => x.n === sel.block) || br[br.length - 1];
      if (!b) return { from: E.addDays(today, -34), to: today, label: 'Last 5 weeks' };
      return { from: b.from, to: b.to, label: `Block ${b.n}${b.current ? ' (current)' : ''}` };
    }
    case 'custom': {
      const from = sel.from <= sel.to ? sel.from : sel.to;
      const to = sel.from <= sel.to ? sel.to : sel.from;
      return { from, to, label: 'Custom' };
    }
    case 'all': default: return { from: '2000-01-01', to: today, label: 'Everything' };
  }
}

// ---------- slice ----------
export function sliceData(data, r) {
  const sessions = E.strengthSessions(data.workouts, data.cardio).filter((s) => inRange(s.date, r)).reverse();
  return {
    range: r, allWorkouts: data.workouts, allCardio: data.cardio,
    workouts: data.workouts.filter((w) => inRange(w.date, r)).sort((a, b) => (a.date + a.start < b.date + b.start ? -1 : 1)),
    sessions,
    cardio: data.cardio.filter((c) => inRange(c.date, r) && c.type !== 'strength-garmin').sort((a, b) => (a.date + a.start < b.date + b.start ? -1 : 1)),
    checkins: data.checkins.filter((c) => inRange(c.date, r)).sort((a, b) => (a.date < b.date ? -1 : 1)),
    skips: (data.skips || []).filter((k) => inRange(k.date, r)).sort((a, b) => (a.date < b.date ? -1 : 1)),
    injuries: data.injuries.filter((i) => i.onset <= r.to && (i.status !== 'resolved' || (i.log || []).some((l) => l.date >= r.from))),
    // weekly health rows whose week overlaps the range
    sleep: data.sleep.filter((s) => s.weekEnd >= r.from && E.addDays(s.weekEnd, -6) <= r.to).sort((a, b) => (a.weekEnd < b.weekEnd ? -1 : 1)),
    rhr: data.rhr.filter((s) => s.weekEnd >= r.from && E.addDays(s.weekEnd, -6) <= r.to).sort((a, b) => (a.weekEnd < b.weekEnd ? -1 : 1)),
  };
}

export function counts(sl) {
  return { lifts: sl.sessions.length, activities: sl.cardio.length, checkins: sl.checkins.length, skips: (sl.skips || []).length };
}

// ---------- tables ----------
export function buildTables(sl, inc, { bodyweight = 0 } = {}) {
  const t = {};
  if (inc.strength) {
    const rows = [['date', 'start', 'workout', 'plan_week', 'plan_day', 'exercise', 'set', 'type', 'weight_kg', 'reps', 'rpe', 'plan_weight_kg', 'plan_reps', 'e1rm_kg', 'pain_0_10', 'pain_where', 'notes']];
    for (const w of sl.workouts) {
      for (const e of w.exercises) {
        let wi = 0;
        const m = EXERCISES[e.key] || {};
        e.sets.forEach((s) => {
          const work = s.type !== 'warmup';
          if (work) wi += 1;
          rows.push([w.date, w.start, w.title, w.planRef ? w.planRef.week + 1 : '', w.planRef && DAYS[dayIndexOf(w.planRef)] ? DAYS[dayIndexOf(w.planRef)].name : '', exName(e),
            work ? wi : 'W', work ? 'working' : 'warm-up', s.weight, s.reps, s.rpe ?? '', s.planWeight ?? '', s.planReps ?? '',
            work && s.reps ? E.e1rm(s.weight, s.reps, s.rpe, m.bodyweight ? bodyweight : 0) ?? '' : '', e.pain ? e.pain.severity : '', e.pain ? e.pain.region : '', e.notes || '']);
        });
      }
    }
    t.sets = rows;
  }
  if (inc.activities) {
    const rows = [['date', 'start', 'type', 'title', 'duration_min', 'distance_km', 'pace_min_per_km', 'climb_m', 'avg_hr', 'max_hr', 'aerobic_te', 'rpe', 'avg_power_w', 'working_sets_logged', 'volume_kg', 'source']];
    const all = [
      ...sl.sessions.map((s) => ({ date: s.date, start: s.start, type: 'strength', title: s.workout ? s.workout.title : (s.garmin.title || 'Strength'), dur: s.durationMin, avgHr: s.avgHr, maxHr: s.garmin ? s.garmin.maxHr : null, te: s.garmin ? s.garmin.te : null, rpe: s.workout ? s.workout.sessionRpe : null,
        sets: s.workout ? s.workout.exercises.reduce((a, e) => a + E.workSets(e).length, 0) : 0, vol: s.workout ? Math.round(s.workout.exercises.reduce((a, e) => a + E.volumeLoad(e), 0)) : '', source: [s.garmin ? 'garmin' : '', s.workout ? s.workout.source : ''].filter(Boolean).join('+') })),
      ...sl.cardio.map((c) => ({ date: c.date, start: c.start, type: c.type, title: c.title, dur: c.durationMin, km: c.distanceKm, asc: c.ascentM, avgHr: c.avgHr, maxHr: c.maxHr, te: c.te, rpe: c.rpe, power: c.power, source: c.source })),
    ].sort((a, b) => (a.date + a.start < b.date + b.start ? -1 : 1));
    for (const a of all) {
      const pace = a.type === 'run' && a.km ? a.dur / a.km : null;
      rows.push([a.date, a.start, a.type, a.title || '', n1(a.dur), a.km ?? '', pace ? `${Math.floor(pace)}:${String(Math.round((pace % 1) * 60)).padStart(2, '0')}` : '', a.asc ?? '', a.avgHr ?? '', a.maxHr ?? '', a.te ?? '', a.rpe ?? '', a.power ?? '', a.sets ?? '', a.vol ?? '', a.source || '']);
    }
    t.activities = rows;
  }
  if (inc.activities && sl.skips && sl.skips.length) t.skipped = [['date', 'plan_week', 'plan_day', 'reason', 'note'], ...sl.skips.map((k) => [k.date, k.week + 1, k.dayName, k.reason, k.note || ''])];
  if (inc.weekly) {
    const rows = [['week_from', 'strength_sessions', 'strength_min', 'run_min', 'run_km', 'ride_min', 'ride_km', 'total_min', 'volume_kg', 'prs']];
    for (let w = E.weekStartOf(sl.range.from, 0); w <= sl.range.to; w = E.addDays(w, 7)) {
      const r = E.weeklyReport({ workouts: sl.allWorkouts || sl.workouts, cardio: sl.allCardio || sl.cardio, weekStartDay: w, bodyweight });
      rows.push([w, r.strengthSessions, r.strengthMin, Math.round(r.runMin), r.runKm, Math.round(r.mtbMin), r.mtbKm, r.totalMin, r.volumeLoad, r.prs.map((p) => `${p.name} ${p.e1rm}`).join('; ')]);
    }
    t.weekly = rows;
  }
  if (inc.health) {
    t.checkins = [['date', 'sleep_h', 'resting_hr', 'soreness_0_10', 'motivation_0_10', 'notes'], ...sl.checkins.map((c) => [c.date, c.sleepH ?? '', c.restingHr ?? '', c.soreness ?? '', c.motivation ?? '', c.notes || ''])];
    t.injuries = [['region', 'type', 'since', 'status', 'pain_now', 'worse_with', 'history'], ...sl.injuries.map((i) => [i.region, i.type, i.onset, i.status, i.severity, i.aggravators || '', (i.log || []).map((l) => `${l.date}: ${l.severity}/10 ${l.status}`).join(' | ')])];
    const weeks = [...new Set([...sl.sleep.map((s) => s.weekEnd), ...sl.rhr.map((s) => s.weekEnd)])].sort();
    t.sleep_and_resting_hr = [['week_ending', 'sleep_avg_min', 'sleep_need_min', 'sleep_score', 'bedtime', 'resting_hr'],
      ...weeks.map((wk) => { const s = sl.sleep.find((x) => x.weekEnd === wk) || {}; const h = sl.rhr.find((x) => x.weekEnd === wk) || {}; return [wk, s.durMin ?? '', s.needMin ?? '', s.score ?? '', s.bed ?? '', h.resting ?? '']; })];
  }
  return t;
}

export function toCSV(rows) {
  const cell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

// ---------- minimal ZIP (store, no compression) ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function makeZip(files) { // files: [{name, text}]
  const enc = new TextEncoder();
  const parts = []; const central = []; let offset = 0;
  const d = new Date(); const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1); const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const name = enc.encode(f.name); const data = enc.encode(f.text); const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
    ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((a, p) => a + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((a, p) => a + p.length, 0));
  let o = 0; for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}

// ---------- printable report ----------
export function reportHtml(sl, inc, { bodyweight = 0, title = 'Max Effort', blockInfo = '' } = {}) {
  const r = sl.range;
  const ws = sl.sessions; const cd = sl.cardio;
  const sum = (a, f) => a.reduce((x, y) => x + (f(y) || 0), 0);
  const runs = cd.filter((c) => c.type === 'run'); const rides = cd.filter((c) => ['mtb', 'ride'].includes(c.type));
  const sets = sl.workouts.reduce((a, w) => a + w.exercises.reduce((b, e) => b + E.workSets(e).length, 0), 0);
  const vol = Math.round(sl.workouts.reduce((a, w) => a + w.exercises.reduce((b, e) => b + E.volumeLoad(e), 0), 0));
  const totalMin = sum(ws, (s) => s.durationMin) + sum(cd, (c) => c.durationMin);
  let h = `<h1>${esc(title)} — training report</h1><div class="sub">${esc(r.label)} · ${fmtD(r.from)}${r.from !== r.to ? ` – ${fmtD(r.to)}` : ''}${blockInfo ? ` · ${esc(blockInfo)}` : ''}</div>
    <div class="kpis"><div><b>${ws.length}</b><span>strength sessions</span></div><div><b>${n1(sum(runs, (c) => c.distanceKm))} km</b><span>running (${runs.length})</span></div><div><b>${n1(sum(rides, (c) => c.distanceKm))} km</b><span>MTB / ride (${rides.length})</span></div><div><b>${fmtDur(totalMin)}</b><span>total time</span></div><div><b>${sets}</b><span>working sets</span></div><div><b>${vol.toLocaleString()} kg</b><span>volume</span></div></div>`;
  if (inc.strength && sl.workouts.length) {
    // per-exercise summary: best set and e1RM in the period
    const by = {};
    for (const w of sl.workouts) for (const e of w.exercises) {
      const m = EXERCISES[e.key] || {};
      const b = E.sessionBest(e, bodyweight, !!m.bodyweight);
      const k = exName(e);
      by[k] = by[k] || { n: 0, sets: 0, best: null };
      by[k].n += 1; by[k].sets += E.workSets(e).length;
      if (b && (!by[k].best || b.e1rm > by[k].best.e1rm)) by[k].best = { ...b, date: w.date };
    }
    h += `<h2>Lifts</h2><table><tr><th>Exercise</th><th class="n">Sessions</th><th class="n">Sets</th><th>Best set</th><th class="n">e1RM</th></tr>${Object.entries(by).sort((a, b) => b[1].sets - a[1].sets).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n">${v.n}</td><td class="n">${v.sets}</td><td>${v.best ? `${n1(v.best.weight)} kg × ${v.best.reps}${v.best.rpe ? ` @${v.best.rpe}` : ''} <span class="mut">(${fmtD(v.best.date)})</span>` : '–'}</td><td class="n">${v.best ? v.best.e1rm + (v.best.estimated ? '*' : '') : '–'}</td></tr>`).join('')}</table><div class="mut small">* no RPE recorded, so the estimate is low.</div>`;
    h += '<h2>Sessions</h2>';
    for (const w of sl.workouts) {
      const g = ws.find((s) => s.workout === w);
      h += `<div class="sess"><div class="sh"><b>${esc(w.title)}</b> <span class="mut">${fmtD(w.date)}${g && g.durationMin ? ` · ${fmtDur(g.durationMin)}` : ''}${g && g.avgHr ? ` · ${g.avgHr} bpm` : ''}${w.sessionRpe ? ` · session RPE ${w.sessionRpe}` : ''}</span></div>
        <table class="sets">${w.exercises.map((e) => `<tr><td>${esc(exName(e))}${e.pain ? ` <span class="bad">pain ${e.pain.severity}/10 ${esc(e.pain.region || '')}</span>` : ''}</td><td>${e.sets.filter((s) => s.type !== 'warmup').map((s) => `${n1(s.weight)}×${s.reps}${s.rpe ? `@${s.rpe}` : ''}`).join(', ')}</td></tr>`).join('')}</table></div>`;
    }
    const garminOnly = ws.filter((s) => !s.workout);
    if (garminOnly.length) h += `<div class="mut small">Plus ${garminOnly.length} Garmin strength session${garminOnly.length > 1 ? 's' : ''} with no sets logged (${garminOnly.map((s) => fmtD(s.date)).join(', ')}).</div>`;
  }
  if (inc.activities && cd.length) {
    h += `<h2>Running & riding</h2><table><tr><th>Date</th><th>Type</th><th class="n">km</th><th class="n">Time</th><th class="n">Climb</th><th class="n">Avg HR</th><th class="n">RPE</th></tr>${cd.map((c) => `<tr><td>${fmtD(c.date)}</td><td>${esc(c.type)}</td><td class="n">${n1(c.distanceKm)}</td><td class="n">${fmtDur(c.durationMin)}</td><td class="n">${c.ascentM ? Math.round(c.ascentM) + ' m' : ''}</td><td class="n">${c.avgHr ?? ''}</td><td class="n">${c.rpe ?? ''}</td></tr>`).join('')}</table>`;
  }
  if (sl.skips && sl.skips.length) h += `<h2>Skipped</h2><table><tr><th>Date</th><th>Planned</th><th>Reason</th></tr>${sl.skips.map((k) => `<tr><td>${fmtD(k.date)}</td><td>${esc(k.dayName)} (week ${k.week + 1})</td><td>${esc(k.reason)}${k.note ? ` — ${esc(k.note)}` : ''}</td></tr>`).join('')}</table>`;
  if (inc.health) {
    if (sl.checkins.length) h += `<h2>Daily check-ins</h2><table><tr><th>Date</th><th class="n">Sleep h</th><th class="n">Rest HR</th><th class="n">Soreness</th><th class="n">Motivation</th><th>Notes</th></tr>${sl.checkins.map((c) => `<tr><td>${fmtD(c.date)}</td><td class="n">${c.sleepH ?? ''}</td><td class="n">${c.restingHr ?? ''}</td><td class="n">${c.soreness ?? ''}</td><td class="n">${c.motivation ?? ''}</td><td>${esc(c.notes || '')}</td></tr>`).join('')}</table>`;
    if (sl.sleep.length || sl.rhr.length) {
      const weeks = [...new Set([...sl.sleep.map((s) => s.weekEnd), ...sl.rhr.map((s) => s.weekEnd)])].sort();
      h += `<h2>Sleep & resting HR (Garmin, weekly)</h2><table><tr><th>Week ending</th><th class="n">Sleep</th><th class="n">Need</th><th class="n">Score</th><th class="n">Rest HR</th></tr>${weeks.map((wk) => { const s = sl.sleep.find((x) => x.weekEnd === wk) || {}; const x = sl.rhr.find((y) => y.weekEnd === wk) || {}; return `<tr><td>${fmtD(wk)}</td><td class="n">${s.durMin ? E.fmtMin(s.durMin) : ''}</td><td class="n">${s.needMin ? E.fmtMin(s.needMin) : ''}</td><td class="n">${s.score ?? ''}</td><td class="n">${x.resting ?? ''}</td></tr>`; }).join('')}</table>`;
    }
    if (sl.injuries.length) h += `<h2>Injuries & niggles</h2><table><tr><th>Where</th><th>Status</th><th class="n">Pain</th><th>Since</th></tr>${sl.injuries.map((i) => `<tr><td>${esc(i.region)}</td><td>${esc(i.status)}</td><td class="n">${i.severity}/10</td><td>${fmtD(i.onset)}</td></tr>`).join('')}</table>`;
  }
  return `<article class="report">${h}<div class="mut small foot">Generated by Max Effort on ${fmtD(new Date().toISOString().slice(0, 10))}. Durations and heart rate from Garmin; sets from Max Effort and Hevy.</div></article>`;
}

// ---------- coach text ----------
export function coachText(sl, prompt, extra = {}) {
  const lifts = sl.workouts.map((w) => ({ date: w.date, title: w.title, plan: w.planRef ? `W${w.planRef.week + 1} ${DAYS[dayIndexOf(w.planRef)] ? DAYS[dayIndexOf(w.planRef)].name : ''}` : undefined, sessionRpe: w.sessionRpe ?? undefined,
    exercises: w.exercises.map((e) => ({ name: exName(e), sets: E.workSets(e).map((s) => `${s.reps}x${s.weight}${s.rpe != null ? '@' + s.rpe : '@?'}${s.planWeight != null ? ` (plan ${s.planReps}x${s.planWeight})` : ''}`), pain: e.pain || undefined, notes: e.notes || undefined })) }));
  const packet = {
    note: 'Exported from the Max Effort app for this period only. Sessions, durations and HR from Garmin; sets from the app/Hevy. "@?" = RPE not recorded. Nothing here is invented.',
    period: { label: sl.range.label, from: sl.range.from, to: sl.range.to }, ...extra,
    strengthSessions: sl.sessions.map((s) => ({ date: s.date, min: s.durationMin, avgHr: s.avgHr ?? undefined, setsLogged: !!s.workout })),
    lifts,
    cardio: sl.cardio.map((c) => ({ date: c.date, type: c.type, min: c.durationMin, km: c.distanceKm ?? undefined, climbM: c.ascentM ?? undefined, avgHr: c.avgHr ?? undefined, maxHr: c.maxHr ?? undefined, rpe: c.rpe ?? 'not recorded' })),
    skipped: (sl.skips || []).map((k) => ({ date: k.date, day: k.dayName, week: k.week + 1, reason: k.reason, note: k.note || undefined })),
    checkins: sl.checkins, injuries: sl.injuries, sleepWeeks: sl.sleep, restingHrWeeks: sl.rhr,
  };
  const ask = sl.range.from === sl.range.to ? 'Analyse this session/day using the post-workout format above.'
    : (sl.range.label || '').startsWith('Block') ? 'Review this whole training block: progress per lift, fatigue, injury risk, what worked, and what to change in the next block.'
      : 'Using the weekly-analysis format above, analyse this period and give next-week recommendations.';
  return `${prompt}\n\n=== DATA FROM MY TRAINING APP (${sl.range.from} to ${sl.range.to}) ===\n${JSON.stringify(packet, null, 1)}\n\n${ask}`;
}

export const REPORT_CSS = `
.report{font:14px/1.45 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#111;background:#fff;padding:20px;max-width:800px;margin:0 auto}
.report h1{font-size:22px;margin:0 0 2px}.report h2{font-size:15px;margin:22px 0 6px;padding-bottom:4px;border-bottom:2px solid #111;text-transform:uppercase;letter-spacing:.5px}
.report .sub{color:#555;margin-bottom:14px}.report .mut{color:#666}.report .small{font-size:12px;margin-top:4px}.report .bad{color:#b00020;font-size:12px}
.report .kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.report .kpis div{border:1px solid #ddd;border-radius:8px;padding:8px 10px}.report .kpis b{display:block;font-size:18px}.report .kpis span{font-size:12px;color:#555}
.report table{width:100%;border-collapse:collapse;font-size:13px}.report th,.report td{text-align:left;padding:5px 4px;border-bottom:1px solid #e3e3e3;vertical-align:top}.report th{font-size:11px;text-transform:uppercase;color:#555}.report .n{text-align:right;font-variant-numeric:tabular-nums}
.report .sess{margin:10px 0;break-inside:avoid}.report .sh{margin-bottom:2px}.report table.sets td:first-child{width:42%}.report .foot{margin-top:24px}`;
