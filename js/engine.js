// Deterministic coaching rules. No DOM, no storage: pure functions over plain data.
// Everything here is either MEASURED (straight from logs) or ESTIMATED (flagged as such).
import { EXERCISES } from './plan.js';

export const round1 = (x) => Math.round(x * 10) / 10;
export const roundTo = (x, step) => Math.round(x / step) * step;
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const sd = (a) => {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
};

// ---- dates (all 'YYYY-MM-DD' strings, no timezone surprises) ----
export const toDay = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000;
export const daysBetween = (a, b) => toDay(b) - toDay(a);
export const addDays = (s, n) => new Date((toDay(s) + n) * 86400000).toISOString().slice(0, 10);
export const weekStartOf = (s, weekStart = 0) => {
  const dow = new Date(toDay(s) * 86400000).getUTCDay(); // 0=Sun
  return addDays(s, -((dow - weekStart + 7) % 7));
};

// ---- strength ----
// Epley with reps-in-reserve folded in. If RPE is missing we use reps as-is (underestimates; flagged by caller).
export function e1rm(weight, reps, rpe, bodyweight = 0) {
  if (!reps || (weight == null)) return null;
  const load = weight + bodyweight;
  if (load <= 0) return null;
  const rir = rpe != null ? Math.max(0, 10 - rpe) : 0;
  const eff = Math.min(reps + rir, 12);
  return round1(load * (1 + eff / 30));
}

export const workSets = (ex) => ex.sets.filter((s) => s.type !== 'warmup' && s.reps);

// All logged sessions that contain this plan exercise (via exercise key), newest first.
export function exerciseHistory(workouts, key) {
  return workouts
    .filter((w) => w.exercises.some((e) => e.key === key && workSets(e).length))
    .sort((a, b) => (a.date + a.start < b.date + b.start ? 1 : -1))
    .map((w) => ({ date: w.date, ex: w.exercises.find((e) => e.key === key), planRef: w.planRef || null }));
}

// History for a plan exercise. A day's own copy of an exercise ("split" from a shared one) also counts the original's
// sessions from before the split date, so splitting never throws away progression data.
export function historyFor(workouts, key, depth = 0) {
  const own = exerciseHistory(workouts, key);
  const m = EXERCISES[key];
  if (!m || !m.historyFrom || m.historyFrom.off || depth > 4) return own;
  const seen = new Set(own.map((h) => h.date + (h.ex && h.ex.name)));
  const prior = historyFor(workouts, m.historyFrom.id, depth + 1).filter((h) => h.date < m.historyFrom.until && !seen.has(h.date + (h.ex && h.ex.name)));
  return own.concat(prior).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export function sessionBest(ex, bodyweight = 0, isBw = false) {
  let best = null;
  for (const s of workSets(ex)) {
    const v = e1rm(s.weight, s.reps, s.rpe, isBw ? bodyweight : 0);
    if (v != null && (best == null || v > best.e1rm)) best = { e1rm: v, weight: s.weight, reps: s.reps, rpe: s.rpe ?? null, estimated: s.rpe == null };
  }
  return best;
}

export function volumeLoad(ex) {
  return workSets(ex).reduce((s, x) => s + (x.weight || 0) * x.reps, 0);
}

const LOWER = ['quads', 'hams', 'glutes', 'calves'];
const isHardEndurance = (c) => ['run', 'mtb', 'ride', 'hike'].includes(c.type) && ((c.durationMin || 0) >= 90 || (c.type === 'mtb' && (c.ascentM || 0) >= 300) || (c.type === 'run' && (c.durationMin || 0) >= 60));

// How far above/below the plan you actually lifted, from the latest non-deload session that recorded plan loads.
// This is what makes progression accumulate: next time = plan + carried + adjustment.
export function carriedOffset(history, step = 2.5) {
  for (const h of history.slice(0, 6)) {
    if (h.planRef && h.planRef.week === 4) continue;
    const ws = workSets(h.ex).filter((x) => x.planWeight != null && x.weight != null);
    if (!ws.length) continue;
    return roundTo(mean(ws.map((x) => x.weight - x.planWeight)), step);
  }
  return 0;
}

function sessionStats(ex) {
  const work = workSets(ex);
  const rpes = work.map((x) => x.rpe).filter((r) => r != null);
  const withPlan = work.filter((x) => x.planReps != null);
  const missed = withPlan.reduce((a, x) => a + Math.max(0, x.planReps - x.reps), 0);
  return {
    work, rpes, mean: mean(rpes), hardest: rpes.length ? Math.max(...rpes) : null,
    repsKnown: withPlan.length > 0, missed, worstMiss: withPlan.reduce((a, x) => Math.max(a, x.planReps - x.reps), 0),
  };
}

/**
 * Decide the load for the next exposure of an exercise.
 * Returns {action, delta (kg relative to the PLAN loads), carried, rpeTarget, why[], flags[], last}.
 * Order of checks follows the coaching brief: pain -> time off -> recovery -> phase -> performance (reps, RPE, trend) -> context.
 * Sets and reps always come from the plan; only load moves.
 */
export function suggestExercise({ key, history, today, week, recovery, bodyweight, yesterday = [] }) {
  const meta = EXERCISES[key] || { step: 2.5, rpe: 8, muscles: [] };
  const step = meta.step || 2.5;
  const why = [];
  const flags = [];
  const rpeTarget = week === 4 ? Math.min(meta.rpe, 7) : meta.rpe;
  const hist = history.slice(0, 3);
  const carried = carriedOffset(history, step);
  let lastInfo = null;
  const out = (action, delta) => { const d = roundTo(delta, step); return { action, delta: d === 0 ? 0 : d, carried, rpeTarget, why, flags, last: lastInfo }; };

  if (!hist.length) {
    why.push('No logged history for this exercise yet. Use the plan loads and record RPE on every working set.');
    return out('Follow plan', 0);
  }
  const last = hist[0];
  const gap = daysBetween(last.date, today);
  const st = sessionStats(last.ex);
  const top = sessionBest(last.ex, bodyweight, !!meta.bodyweight);
  const topW = top ? top.weight : 0;
  lastInfo = { date: last.date, gapDays: gap, meanRpe: st.mean != null ? round1(st.mean) : null, hardest: st.hardest, missed: st.missed, top };
  const carriedTxt = carried ? ` (you were ${carried > 0 ? '+' : ''}${carried} kg vs plan last time)` : '';

  // 1. pain
  if (last.ex.pain && last.ex.pain.severity >= 4) {
    flags.push(`Pain ${last.ex.pain.severity}/10 (${last.ex.pain.region || 'unspecified'}) logged last time. No load increase; reduce range of motion or load if it returns.`);
    why.push('Holding load because of logged pain.');
    return out('Hold / modify', carried);
  }
  if (last.ex.pain && last.ex.pain.severity >= 1) flags.push(`Mild discomfort (${last.ex.pain.severity}/10, ${last.ex.pain.region || 'unspecified'}) logged last time. Watch it.`);

  // 2. time off
  if (gap > 28) {
    const pct = gap > 56 ? 0.1 : 0.05;
    why.push(`Last done ${gap} days ago: start ~${pct * 100}% lighter and build back over two sessions.`);
    return out('Reduce', carried - pct * topW);
  }

  // 3. recovery
  if (recovery && recovery.status === 'RED') {
    why.push('Recovery is RED: ~5% lighter today, and drop the last working set if the first one feels heavy.');
    return out('Reduce', carried - 0.05 * topW);
  }

  // 4. deload: plan loads (never above them), low effort
  if (week === 4) {
    why.push('Deload week: plan loads, stay at RPE ≤7, no progression.');
    return out('Deload', Math.min(carried, 0));
  }

  // 5. performance
  if (!st.rpes.length) {
    why.push(`No RPE recorded last time, so load is not progressed${carriedTxt}. Record RPE on every working set.`);
    return out('Hold', carried);
  }
  const prev = hist[1] ? sessionStats(hist[1].ex) : null;
  const prevTop = hist[1] ? sessionBest(hist[1].ex, bodyweight, !!meta.bodyweight) : null;
  const sameLoad = !!(prevTop && top && Math.abs(prevTop.weight - top.weight) <= 1);

  if (st.mean >= 9.5 && prev && prev.mean != null && prev.mean >= 9.5 && sameLoad) {
    why.push(`RPE ≥9.5 at the same load two sessions running (${round1(prev.mean)} → ${round1(st.mean)}). Back off ~5% to restore rep quality.`);
    return out('Reduce', carried - 0.05 * topW);
  }
  if (st.repsKnown && st.missed > 0) {
    if (st.worstMiss >= 3 && prev && prev.repsKnown && prev.missed > 0 && sameLoad) {
      why.push(`Missed reps two sessions running (${st.missed} short last time). Back off ~5%.`);
      return out('Reduce', carried - 0.05 * topW);
    }
    why.push(`Missed ${st.missed} rep${st.missed > 1 ? 's' : ''} vs plan last time. Hold load until every set hits its reps${carriedTxt}.`);
    return out('Hold', carried);
  }
  if (st.hardest >= 9.5) {
    why.push(`A set hit RPE ${st.hardest} last time, too close to failure to add load${carriedTxt}.`);
    return out('Hold', carried);
  }
  if (st.hardest > rpeTarget + 0.5) {
    why.push(`Hardest set was RPE ${st.hardest} (target ${rpeTarget}). Hold load until it comes down${carriedTxt}.`);
    return out('Hold', carried);
  }

  const easyNow = st.mean <= rpeTarget - 1 && st.rpes.length >= 2;
  const easyTrend = prev && sameLoad && prev.mean != null && st.mean <= rpeTarget - 0.5 && prev.mean <= rpeTarget - 0.5 && !(prev.repsKnown && prev.missed > 0);
  if (easyNow || easyTrend) {
    // regression guard: e1RM falling over the last three sessions
    const e1 = hist.map((h) => sessionBest(h.ex, bodyweight, !!meta.bodyweight)).filter((b) => b && !b.estimated).map((b) => b.e1rm);
    if (e1.length >= 3 && e1[0] < Math.max(e1[1], e1[2]) * 0.93) {
      flags.push(`Estimated 1RM is down ${Math.round((1 - e1[0] / Math.max(e1[1], e1[2])) * 100)}% over your last three sessions. Check sleep and recent load before pushing.`);
      why.push('RPE says you could add load, but performance is trending down, so hold.');
      return out('Hold', carried);
    }
    if (recovery && recovery.status === 'YELLOW') {
      why.push(`RPE (avg ${round1(st.mean)}) says you could add load, but recovery is YELLOW, so hold this time.`);
      return out('Hold', carried);
    }
    const hard = yesterday.filter(isHardEndurance);
    if (hard.length && (meta.muscles || []).some((m) => LOWER.includes(m))) {
      const c = hard[0];
      why.push(`Ready to progress, but yesterday's ${Math.round(c.durationMin)}-min ${c.type.toUpperCase()}${c.ascentM ? ` (${Math.round(c.ascentM)} m climbing)` : ''} loaded your legs. Hold today, add next time.`);
      return out('Hold', carried);
    }
    why.push(easyNow
      ? `Avg RPE ${round1(st.mean)}, hardest ${st.hardest}, target ${rpeTarget}${st.repsKnown ? ', all reps hit' : ''}: add ${step} kg.`
      : `Two sessions in a row under target at this load (${round1(prev.mean)}, ${round1(st.mean)}): add ${step} kg.`);
    return out('Increase', carried + step);
  }
  why.push(st.mean > rpeTarget + 0.5 ? `Avg RPE ${round1(st.mean)} is above target ${rpeTarget}. Hold load until it feels easier${carriedTxt}.` : `Avg RPE ${round1(st.mean)} is on target (${rpeTarget}). Hold load and aim for clean reps${carriedTxt}.`);
  return out('Hold', carried);
}

// In-session advice after a logged set (rules from the coaching brief).
export function inSessionAdvice({ setIndex, workIndex, set, rpeTarget, step = 2.5 }) {
  if (set.rpe == null || set.type === 'warmup') return null;
  if (workIndex === 0 && set.rpe >= 9) {
    const lo = roundTo(set.weight * 0.95, step);
    return `Set 1 hit RPE ${set.rpe}. Drop the remaining sets by 2.5–5% (≈${lo} kg) or cut one set.`;
  }
  if (set.rpe <= 7 && set.rpe < rpeTarget - 0.5) {
    return `RPE ${set.rpe} is easy. If the reps were clean, add ${step} kg on the next set.`;
  }
  if (set.rpe >= 10) return 'RPE 10 means failure. Do not chase more load today.';
  return null;
}

// ---- training load ----
// Session load = minutes × RPE (session-RPE). Missing RPE is estimated and flagged.
export function estimateRpe(item) {
  if (item.rpe != null) return { rpe: item.rpe, estimated: false };
  if (item.te != null && item.te > 0) return { rpe: Math.max(2, Math.min(9, round1(2 + item.te * 1.2))), estimated: true };
  return { rpe: item.type === 'strength' ? 6 : 4, estimated: true };
}

// Garmin is the spine: every Garmin strength activity is a session (duration, HR). Hevy/app sets attach to the
// Garmin session on the same date (closest start time). Sessions with sets but no Garmin match are kept too.
const hm = (t) => { const [h, m] = (t || '00:00').split(':').map(Number); return h * 60 + (m || 0); };
export function strengthSessions(workouts, cardio) {
  const gs = cardio.filter((c) => c.type === 'strength-garmin').map((g) => ({ g, used: false }));
  const out = [];
  for (const w of workouts) {
    let best = null;
    let bd = Infinity;
    for (const x of gs) {
      if (x.used || x.g.date !== w.date) continue;
      const d = Math.abs(hm(x.g.start) - hm(w.start));
      if (d < bd) { bd = d; best = x; }
    }
    if (best) best.used = true;
    out.push({ date: w.date, start: w.start, workout: w, garmin: best ? best.g : null, durationMin: best && best.g.durationMin ? best.g.durationMin : w.durationMin, avgHr: best ? best.g.avgHr : null });
  }
  for (const x of gs) if (!x.used) out.push({ date: x.g.date, start: x.g.start, workout: null, garmin: x.g, durationMin: x.g.durationMin, avgHr: x.g.avgHr });
  return out.sort((a, b) => (a.date + a.start < b.date + b.start ? 1 : -1));
}

// Effort (1–10) for a strength session: logged session RPE, else set RPEs, else Garmin training effect.
export function strengthEffort(ss) {
  const w = ss.workout;
  if (w && w.sessionRpe != null) return { rpe: w.sessionRpe, estimated: false };
  if (w) {
    const rp = w.exercises.flatMap((e) => workSets(e)).map((x) => x.rpe).filter((x) => x != null);
    return rp.length ? { rpe: Math.max(3, mean(rp) - 1), estimated: true } : { rpe: 6, estimated: true };
  }
  return estimateRpe({ te: ss.garmin ? ss.garmin.te : null, type: 'strength' });
}
export const typeGroup = (t) => (t === 'run' ? 'run' : ['mtb', 'ride'].includes(t) ? 'ride' : t === 'strength-garmin' || t === 'strength' ? 'strength' : 'other');

// One entry per calendar day between from and to (inclusive), split by activity type.
export function dailySeries(workouts, cardio, from, to) {
  const blank = () => ({ min: 0, load: 0, km: 0, n: 0, ascent: 0 });
  const map = {};
  for (let d = from; d <= to; d = addDays(d, 1)) map[d] = { date: d, types: { strength: blank(), run: blank(), ride: blank(), other: blank() }, sets: 0, volume: 0, items: [] };
  for (const ss of strengthSessions(workouts, cardio)) {
    const day = map[ss.date];
    if (!day || !ss.durationMin) continue;
    const e = strengthEffort(ss);
    const t = day.types.strength;
    t.min += ss.durationMin; t.load += ss.durationMin * e.rpe; t.n += 1;
    let sets = 0; let vol = 0;
    if (ss.workout) for (const ex of ss.workout.exercises) { sets += workSets(ex).length; vol += volumeLoad(ex); }
    day.sets += sets; day.volume += vol;
    day.items.push({ type: 'strength', title: ss.workout ? ss.workout.title : (ss.garmin && ss.garmin.title) || 'Strength', min: ss.durationMin, effort: round1(e.rpe), estimated: e.estimated, sets });
  }
  for (const c of cardio) {
    if (c.type === 'strength-garmin') continue;
    const day = map[c.date];
    if (!day || !c.durationMin) continue;
    const e = estimateRpe({ ...c, type: 'cardio' });
    const t = day.types[typeGroup(c.type)];
    t.min += c.durationMin; t.load += c.durationMin * e.rpe; t.n += 1; t.km += c.distanceKm || 0; t.ascent += c.ascentM || 0;
    day.items.push({ type: typeGroup(c.type), kind: c.type, title: c.title || c.type, min: c.durationMin, km: c.distanceKm, ascent: c.ascentM, avgHr: c.avgHr, effort: round1(e.rpe), estimated: e.estimated });
  }
  return Object.values(map);
}

// Totals over a series for the selected activity types.
export function summarize(series, types) {
  const out = { min: 0, load: 0, sessions: 0, activeDays: 0, runKm: 0, rideKm: 0, ascent: 0, sets: 0, volume: 0, byType: {} };
  for (const k of types) out.byType[k] = { min: 0, n: 0, km: 0 };
  for (const d of series) {
    let active = false;
    for (const k of types) {
      const t = d.types[k];
      if (!t.n) continue;
      active = true;
      out.min += t.min; out.load += t.load; out.sessions += t.n; out.ascent += t.ascent;
      out.byType[k].min += t.min; out.byType[k].n += t.n; out.byType[k].km += t.km;
      if (k === 'run') out.runKm += t.km;
      if (k === 'ride') out.rideKm += t.km;
    }
    if (types.includes('strength')) { out.sets += d.sets; out.volume += d.volume; }
    if (active) out.activeDays += 1;
  }
  out.effort = out.min ? round1(out.load / out.min) : null;
  return out;
}

export function dailyLoads(workouts, cardio, endDay, days = 42) {
  const out = {};
  for (let i = 0; i < days; i++) out[addDays(endDay, -i)] = { load: 0, estimated: false, minutes: 0 };
  const add = (date, minutes, rpe, est) => {
    if (!out[date] || !minutes) return;
    out[date].load += minutes * rpe;
    out[date].minutes += minutes;
    if (est) out[date].estimated = true;
  };
  for (const ss of strengthSessions(workouts, cardio)) {
    const r = strengthEffort(ss);
    add(ss.date, ss.durationMin, r.rpe, r.estimated);
  }
  for (const c of cardio) {
    if (c.type === 'strength-garmin') continue;
    const r = estimateRpe({ ...c, type: 'cardio' });
    add(c.date, c.durationMin, r.rpe, r.estimated);
  }
  return out;
}

export function loadMetrics(workouts, cardio, today) {
  const d = dailyLoads(workouts, cardio, today, 28);
  const days = Object.keys(d).sort();
  const last7 = days.slice(-7);
  const acute = last7.reduce((s, k) => s + d[k].load, 0);
  const acuteMin = last7.reduce((s, k) => s + d[k].minutes, 0);
  const chronicWeekly = days.reduce((s, k) => s + d[k].load, 0) / 4;
  const chronicMinWeekly = days.reduce((s, k) => s + d[k].minutes, 0) / 4;
  const loads7 = last7.map((k) => d[k].load);
  const m = mean(loads7);
  const sdev = sd(loads7);
  const monotony = sdev && sdev > 0 ? round1(m / sdev) : null;
  const active = days.filter((k) => d[k].load > 0);
  const first = active[0];
  return {
    acute: Math.round(acute),
    chronicWeekly: Math.round(chronicWeekly),
    acuteMin: Math.round(acuteMin),
    chronicMinWeekly: Math.round(chronicMinWeekly),
    acuteEffort: acuteMin ? round1(acute / acuteMin) : null,
    chronicEffort: chronicMinWeekly ? round1(chronicWeekly / chronicMinWeekly) : null,
    acwr: chronicWeekly > 0 ? round1(acute / chronicWeekly) : null,
    monotony,
    strain: monotony ? Math.round(acute * monotony) : null,
    daysWithData: active.length,
    // the comparison only means something with ~3 weeks of logged training behind it
    enough: !!first && daysBetween(first, today) >= 20 && active.length >= 8,
    estimatedDays: active.filter((k) => d[k].estimated).length,
    anyEstimated: active.some((k) => d[k].estimated),
    unit: 'min × effort',
  };
}

// Plain-language reading of the load numbers.
export function fatigueLabel(lm, recovery) {
  if (!lm || lm.acwr == null || !lm.enough) {
    return { label: 'Not enough history', tone: 'hold', level: 'unknown', pct: null,
      why: 'Needs about 3 weeks of logged training (or imported Garmin history) before the comparison means anything.',
      advice: 'Keep logging, and import your Garmin activities in Me › Data to get this working right away.' };
  }
  const pct = Math.round((lm.acwr - 1) * 100);
  let label; let tone; let level; let advice;
  if (lm.acwr > 1.5) { label = 'Much more than usual'; tone = 'down'; level = 'very-high'; advice = 'Keep the next 2–3 days easy and don\'t add extra sessions. One dense week is fine; a second one in a row raises injury risk.'; }
  else if (lm.acwr > 1.25) { label = 'More than usual'; tone = 'hold'; level = 'high'; advice = 'Fine for a build week. Keep easy days genuinely easy and sleep well.'; }
  else if (lm.acwr >= 0.8) { label = 'About your usual'; tone = 'up'; level = 'normal'; advice = 'Normal training load. Carry on with the plan.'; }
  else { label = 'Lighter than usual'; tone = 'hold'; level = 'low'; advice = 'Fine if planned (deload, travel, illness). Otherwise there is room to train as planned.'; }
  const diff = pct >= 0 ? `${pct}% more` : `${Math.abs(pct)}% less`;
  const why = `Your last 7 days had ${diff} training stress than your usual week.`;
  return { label, tone, level, pct, why, advice };
}

// ---- recovery ----
export function rpeCreep(workouts, bodyweight = 0) {
  const out = [];
  for (const key of Object.keys(EXERCISES)) {
    const h = historyFor(workouts, key).slice(0, 2);
    if (h.length < 2) continue;
    const meta = EXERCISES[key];
    const a = sessionBest(h[0].ex, bodyweight, !!meta.bodyweight);
    const b = sessionBest(h[1].ex, bodyweight, !!meta.bodyweight);
    if (!a || !b || Math.abs(a.weight - b.weight) > 1) continue;
    const ra = mean(workSets(h[0].ex).map((s) => s.rpe).filter((x) => x != null));
    const rb = mean(workSets(h[1].ex).map((s) => s.rpe).filter((x) => x != null));
    if (ra != null && rb != null && ra - rb >= 1) out.push({ key, from: round1(rb), to: round1(ra) });
  }
  return out;
}

export function recoveryStatus({ checkin, sleepWeeks = [], rhrWeeks = [], injuries = [], load, creeps = [], recentSleepDaily = [] }) {
  const reasons = [];
  const info = [];
  const conflicts = [];
  const missing = [];
  let yellow = 0;
  let red = false;

  // injuries
  const active = injuries.filter((i) => i.status !== 'resolved');
  for (const i of active) {
    if (i.status === 'worsening' || i.severity >= 7) { red = true; reasons.push(`${i.region}: ${i.status}, pain ${i.severity}/10. Reduce or stop the aggravating movement and consider a professional assessment.`); }
    else if (i.severity >= 4) { yellow++; reasons.push(`${i.region}: pain ${i.severity}/10 (${i.status}). Modify loading of anything that aggravates it.`); }
    else if (i.severity >= 1) info.push(`${i.region}: mild (${i.severity}/10, ${i.status}).`);
  }

  // sleep: weekly import baseline + daily check-ins
  const sw = [...sleepWeeks].sort((a, b) => (a.weekEnd < b.weekEnd ? 1 : -1));
  let sleepNow = null;
  let baseline = null;
  if (recentSleepDaily.length >= 4) sleepNow = mean(recentSleepDaily.map((x) => x * 60));
  else if (sw.length) sleepNow = sw[0].durMin;
  if (sw.length >= 5) baseline = mean(sw.slice(1, 13).map((x) => x.durMin));
  if (sleepNow != null && baseline != null) {
    if (sleepNow <= baseline - 90) { yellow++; reasons.push(`Sleep ${fmtMin(sleepNow)} vs your usual ${fmtMin(baseline)} (−${Math.round(baseline - sleepNow)} min).`); }
  } else missing.push('sleep');
  if (sw.length) {
    const need = sw[0].needMin;
    const deficit = need - mean(sw.slice(0, 4).map((x) => x.durMin));
    if (deficit >= 60) info.push(`Chronic sleep gap: about ${Math.round(deficit)} min/night below Garmin's estimated need over the last 4 weeks. Not a trigger on its own, but it lowers your margin.`);
  }

  // resting HR
  const rw = [...rhrWeeks].sort((a, b) => (a.weekEnd < b.weekEnd ? 1 : -1));
  let rhrBase = null;
  if (rw.length >= 5) rhrBase = mean(rw.slice(1, 5).map((x) => x.resting));
  const rhrNow = checkin && checkin.restingHr ? checkin.restingHr : rw.length ? rw[0].resting : null;
  if (rhrNow != null && rhrBase != null) {
    if (rhrNow >= rhrBase + 3) { yellow++; reasons.push(`Resting HR ${rhrNow} vs ${Math.round(rhrBase)} baseline (+${Math.round(rhrNow - rhrBase)} bpm).`); }
  } else missing.push('resting HR');

  // subjective
  if (checkin) {
    if (checkin.soreness >= 7) { yellow++; reasons.push(`Soreness ${checkin.soreness}/10.`); }
    if (checkin.motivation != null && checkin.motivation <= 3) { yellow++; reasons.push(`Motivation ${checkin.motivation}/10.`); }
    if (checkin.sleepH != null && checkin.sleepH < 5.5) { yellow++; reasons.push(`Last night ${checkin.sleepH} h of sleep.`); }
  } else missing.push('today\'s check-in');

  // load + performance
  if (load && load.acwr != null && load.enough !== false) {
    const pct = Math.round((load.acwr - 1) * 100);
    if (load.acwr > 1.5) { yellow++; reasons.push(`Your last 7 days had ${pct}% more training stress than your usual week.`); }
    if (load.acwr < 0.7 && load.daysWithData >= 10) info.push(`Your last 7 days were ${Math.abs(pct)}% lighter than your usual week. Fine if intentional (deload or travel).`);
  }
  if (creeps.length >= 2) { yellow++; reasons.push(`RPE creep at the same load on ${creeps.length} lifts (${creeps.map((c) => `${EXERCISES[c.key].name} ${c.from}→${c.to}`).join(', ')}).`); }
  else if (creeps.length === 1) info.push(`RPE creep on ${EXERCISES[creeps[0].key].name} (${creeps[0].from}→${creeps[0].to}).`);

  // wearable vs performance conflicts: say so rather than pick a side
  if (sleepNow != null && baseline != null && sleepNow <= baseline - 60 && rhrNow != null && rhrBase != null && rhrNow <= rhrBase + 1 && creeps.length === 0) {
    conflicts.push('Sleep is down but resting HR and lift RPE are normal. I am not treating that as under-recovery yet; one more short week would change that.');
  }
  if (sleepNow != null && baseline != null && sleepNow >= baseline - 30 && creeps.length >= 2) {
    conflicts.push('Sleep looks normal but RPE is creeping up. Trust the lifts over the watch and consider extra rest.');
  }

  let status = 'GREEN';
  if (red || yellow >= 3) status = 'RED';
  else if (yellow >= 1) status = 'YELLOW';
  return { status, reasons, info, conflicts, missing };
}

export function fmtMin(m) {
  const h = Math.floor(m / 60);
  const mm = Math.round(m - h * 60);
  return `${h}h${String(mm).padStart(2, '0')}`;
}

// ---- hybrid sequencing ----
// Warn when a hard session lands on top of a hard one.
export function sequencingWarnings({ dayType, dayTitle, today, cardio, workouts }) {
  const out = [];
  const prev = (n) => addDays(today, -n);
  const longSince = (n) => cardio.filter((c) => c.date === prev(n) && c.durationMin >= 90 && ['run', 'mtb', 'ride', 'hike'].includes(c.type));
  const lowerSince = (n) => workouts.filter((w) => w.date === prev(n) && w.exercises.some((e) => ['squat', 'rdl', 'bss', 'rev_lunge', 'hip_thrust'].includes(e.key)));
  const isLower = /Lower/i.test(dayTitle || '');
  if (isLower) {
    const l = longSince(1);
    if (l.length) out.push(`Yesterday: ${l[0].durationMin} min ${l[0].type.toUpperCase()}${l[0].ascentM ? ` with ${l[0].ascentM} m climbing` : ''}. Expect heavy legs; squat top sets are the first thing to drop.`);
    if (lowerSince(1).length) out.push('Lower session yesterday. Today is back-to-back lower work, so keep it at RPE ≤8.');
  }
  if (dayType === 'cardio') {
    if (lowerSince(1).length) out.push('Lower session yesterday. Keep today strictly easy (HR in zone 2, no surges).');
  }
  return out;
}

// ---- weekly aggregates ----
export function weeklyReport({ workouts, cardio, weekStartDay, bodyweight = 0, allWorkouts = workouts }) {
  const end = addDays(weekStartDay, 6);
  const inWeek = (d) => d >= weekStartDay && d <= end;
  const w = workouts.filter((x) => inWeek(x.date));
  const c = cardio.filter((x) => inWeek(x.date) && x.type !== 'strength-garmin');
  const ss = strengthSessions(workouts, cardio).filter((x) => inWeek(x.date));
  const setsByMuscle = {};
  let vol = 0;
  for (const s of w) {
    for (const e of s.exercises) {
      const meta = EXERCISES[e.key];
      const n = workSets(e).length;
      vol += volumeLoad(e);
      for (const m of meta ? meta.muscles : []) setsByMuscle[m] = (setsByMuscle[m] || 0) + n;
    }
  }
  const minsOf = (types) => c.filter((x) => types.includes(x.type)).reduce((s, x) => s + (x.durationMin || 0), 0);
  const strengthMin = ss.reduce((s, x) => s + (x.durationMin || 0), 0);
  const prs = [];
  for (const s of w) {
    for (const e of s.exercises) {
      const prior = allWorkouts.filter((x) => x.date < weekStartDay).flatMap((x) => x.exercises.filter((y) => y.key === e.key));
      const priorBest = Math.max(0, ...prior.map((y) => (sessionBest(y, bodyweight, !!(EXERCISES[e.key] || {}).bodyweight) || { e1rm: 0 }).e1rm));
      const now = sessionBest(e, bodyweight, !!(EXERCISES[e.key] || {}).bodyweight);
      if (now && priorBest > 0 && now.e1rm > priorBest + 0.4) prs.push({ key: e.key, name: (EXERCISES[e.key] || {}).name || e.name, e1rm: now.e1rm, prev: priorBest, estimated: now.estimated });
    }
  }
  return {
    weekStart: weekStartDay,
    strengthSessions: ss.length,
    strengthMin: Math.round(strengthMin),
    runMin: minsOf(['run']),
    runKm: round1(c.filter((x) => x.type === 'run').reduce((s, x) => s + (x.distanceKm || 0), 0)),
    mtbMin: minsOf(['mtb', 'ride']),
    mtbKm: round1(c.filter((x) => ['mtb', 'ride'].includes(x.type)).reduce((s, x) => s + (x.distanceKm || 0), 0)),
    totalMin: Math.round(strengthMin + minsOf(['run', 'mtb', 'ride', 'hike', 'walk', 'other'])),
    volumeLoad: Math.round(vol),
    setsByMuscle,
    prs: dedupePr(prs),
  };
}
const dedupePr = (a) => Object.values(a.reduce((m, p) => { if (!m[p.key] || m[p.key].e1rm < p.e1rm) m[p.key] = p; return m; }, {}));

// Next-week recommendations from rules only.
export function nextWeekAdvice({ week, recovery, lm, creeps, report, prevReport }) {
  const out = [];
  if (week === 3) out.push('Next week is the Deload (Week 5). Keep loads, do the single set per slot, and use the freed time for sleep.');
  if (week === 4) out.push('Start a new block at Week 1. Use this week\'s best sets to re-check the baseline loads before adding weight.');
  if (recovery && recovery.status === 'YELLOW') out.push('Recovery is YELLOW: hold all loads next week and cut one set from the lower-body accessories.');
  if (recovery && recovery.status === 'RED') out.push('Recovery is RED: treat next week as a deload regardless of the plan.');
  const ok = lm && lm.acwr != null && lm.enough !== false;
  if (ok && lm.acwr > 1.3) out.push(`Your last 7 days had ${Math.round((lm.acwr - 1) * 100)}% more training stress than usual: don't add running or MTB time next week.`);
  if (ok && lm.acwr < 0.8 && recovery && recovery.status === 'GREEN') out.push(`Training has been lighter than usual and recovery is GREEN: there is room to progress as planned.`);
  if (creeps && creeps.length) out.push(`RPE creep on ${creeps.map((c) => EXERCISES[c.key].name).join(', ')}: hold load before touching volume.`);
  if (report && report.mtbMin + report.runMin > 0 && report.strengthSessions < 3) out.push('Fewer than 3 strength sessions this week. Missing sessions is a consistency problem, not a reason to add sets later.');
  if (!out.length) out.push('Continue the plan as written.');
  return out;
}
