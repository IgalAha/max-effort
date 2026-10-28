// Plan templates. Exercises, sets, reps and a target RPE per week are fixed here; the KILOS are worked out when
// you pick a template, from your own estimated max for each lift (best RPE-logged set, recent weeks first):
//   weight = e1RM / (1 + (reps + reps-in-reserve) / 30)   rounded to the exercise's step.
// Week 5 is your deload and is built from Week 4 by your deload rule.
import { e1rm } from './engine.js';

export const TEMPLATE_CATALOG = {
 "squat": {
  "name": "BB Back Squat",
  "muscles": [
   "quads",
   "glutes"
  ],
  "aliases": [
   "Squat (Barbell)"
  ],
  "step": 2.5,
  "rpe": 8,
  "compound": true
 },
 "incline_press": {
  "name": "Incline Swiss Bar Press",
  "muscles": [
   "chest",
   "triceps"
  ],
  "aliases": [
   "Incline Bench Press (Barbell)"
  ],
  "step": 2.5,
  "rpe": 8,
  "compound": true
 },
 "chin": {
  "name": "Weighted Parallel Grip Chin-Up",
  "muscles": [
   "back",
   "biceps"
  ],
  "aliases": [
   "Chin Up (Weighted)",
   "Chin Up"
  ],
  "step": 2.5,
  "rpe": 8,
  "compound": true,
  "bodyweight": true
 },
 "upright_row": {
  "name": "BB Upright Row",
  "muscles": [
   "delts",
   "traps"
  ],
  "aliases": [
   "Upright Row (Barbell)",
   "Upright Row (Cable)"
  ],
  "step": 2.5,
  "rpe": 8.5,
  "compound": false
 },
 "rdl": {
  "name": "BB RDL",
  "muscles": [
   "hams",
   "glutes"
  ],
  "aliases": [
   "Romanian Deadlift (Barbell)"
  ],
  "step": 2.5,
  "rpe": 8,
  "compound": true
 },
 "db_ohp": {
  "name": "Seated DB OHP",
  "muscles": [
   "delts"
  ],
  "aliases": [
   "Seated Overhead Press (Dumbbell)",
   "Shoulder Press (Dumbbell)"
  ],
  "step": 2.5,
  "rpe": 8,
  "compound": true
 },
 "db_row": {
  "name": "DB Chest-Supported Row",
  "muscles": [
   "back",
   "biceps"
  ],
  "aliases": [
   "Dumbbell Row"
  ],
  "step": 2.5,
  "rpe": 8.5,
  "compound": false
 },
 "chest_dip_weighted": {
  "name": "Chest Dip (Weighted)",
  "aliases": [
   "Chest Dip (Weighted)"
  ],
  "step": 2.5,
  "muscles": [
   "chest",
   "triceps"
  ],
  "compound": true,
  "rpe": 8,
  "bodyweight": true
 },
 "bss": {
  "name": "DB Bulgarian Split Squat",
  "muscles": [
   "quads",
   "glutes"
  ],
  "aliases": [
   "Bulgarian Split Squat (Dumbbell)"
  ],
  "step": 2.5,
  "rpe": 8.5,
  "compound": false
 },
 "incline_bench_press_dumbbell": {
  "name": "Incline Bench Press (Dumbbell)",
  "aliases": [
   "Incline Bench Press (Dumbbell)"
  ],
  "step": 2.5,
  "muscles": [
   "chest",
   "triceps"
  ],
  "compound": true,
  "rpe": 8
 },
 "lat_pulldown": {
  "name": "Lat Pulldown",
  "muscles": [
   "back",
   "biceps"
  ],
  "aliases": [
   "Lat Pulldown (Cable)",
   "Lat Pulldown - Close Grip (Cable)"
  ],
  "step": 2.5,
  "rpe": 8.5,
  "compound": false
 },
 "t_bar_row": {
  "name": "T Bar Row",
  "aliases": [
   "T Bar Row"
  ],
  "step": 2.5,
  "muscles": [
   "back",
   "biceps"
  ],
  "compound": true,
  "rpe": 8
 },
 "cable_row": {
  "name": "Seated Cable Row",
  "muscles": [
   "back",
   "biceps"
  ],
  "aliases": [
   "Seated Cable Row - Bar Grip",
   "Seated Cable Row - Bar Wide Grip"
  ],
  "step": 2.5,
  "rpe": 8,
  "compound": true
 },
 "cable_lat_raise": {
  "name": "Cuff Cable Lateral Raise",
  "muscles": [
   "delts"
  ],
  "aliases": [
   "Single Arm Lateral Raise (Cable)"
  ],
  "step": 0.5,
  "rpe": 9,
  "compound": false
 },
 "face_pull": {
  "name": "Face Pull",
  "muscles": [
   "delts",
   "traps"
  ],
  "aliases": [
   "Face Pull"
  ],
  "step": 2.5,
  "rpe": 8.5,
  "compound": false
 },
 "goblet_squat": {
  "name": "Goblet Squat",
  "aliases": [
   "Goblet Squat"
  ],
  "step": 2.5,
  "muscles": [
   "quads",
   "glutes"
  ],
  "compound": true,
  "rpe": 8
 },
 "hip_thrust": {
  "name": "BB Hip Thrust",
  "muscles": [
   "glutes"
  ],
  "aliases": [],
  "step": 5,
  "rpe": 8.5,
  "compound": false
 },
 "sbar_ohp": {
  "name": "Seated Swiss Bar OHP",
  "muscles": [
   "delts"
  ],
  "aliases": [
   "Seated Overhead Press (Barbell)"
  ],
  "step": 2.5,
  "rpe": 8,
  "compound": true
 }
};

// RPE per week (W1..W4) by role: main = the big lift of the day, acc = other compounds/assistance, iso = small lifts.
const WAVES = {
  minimal: { main: [8.5, 9, 9.5, 9.5], acc: [9, 9.5, 10, 10] },
  classic: { main: [7, 8, 8.5, 9], acc: [7.5, 8, 8.5, 9], iso: [8, 8.5, 9, 9.5] },
};
const EASY = { type: 'cardio', title: 'Easy run or park ride', note: '~1 hour, genuinely easy (conversational pace, Zone 2).' };
const LONG = { type: 'cardio', title: 'Long run or MTB', note: '~2 hours, easy pace. Keep it aerobic.' };
const REST = { type: 'rest', title: 'Rest', note: 'Walk, mobility, nothing taxing.' };
const S = (key, reps, sets, role) => ({ key, reps, sets, role });

export const TEMPLATES = [
  {
    id: 'minimal', name: 'Minimal', wave: 'minimal',
    blurb: '3 full-body days, compounds only, 2 hard sets each (RPE 9–10; big lifts stop at 9.5). About 35–40 min.',
    days: [
      { id: 'MA', short: 'Full', title: 'Full A', ex: [S('squat', 5, [2, 2, 2, 2], 'main'), S('incline_press', 6, [2, 2, 2, 2], 'main'), S('chin', 5, [2, 2, 2, 2], 'main'), S('upright_row', 12, [2, 2, 2, 2], 'acc')] },
      { id: 'MR', short: 'Rest', ...REST },
      { id: 'MB', short: 'Full', title: 'Full B', ex: [S('rdl', 6, [2, 2, 2, 2], 'main'), S('db_ohp', 8, [2, 2, 2, 2], 'acc'), S('db_row', 10, [2, 2, 2, 2], 'acc'), S('chest_dip_weighted', 8, [2, 2, 2, 2], 'acc')] },
      { id: 'ME', short: 'Cardio', ...EASY },
      { id: 'MC', short: 'Full', title: 'Full C', ex: [S('bss', 8, [2, 2, 2, 2], 'acc'), S('incline_bench_press_dumbbell', 8, [2, 2, 2, 2], 'acc'), S('lat_pulldown', 10, [2, 2, 2, 2], 'acc'), S('t_bar_row', 10, [2, 2, 2, 2], 'acc')] },
      { id: 'MR2', short: 'Rest', ...REST },
      { id: 'ML', short: 'Long cardio', ...LONG },
    ],
  },
  {
    id: 'classic', name: 'Classic', wave: 'classic',
    blurb: '3 full-body days, 3–4 sets, balanced effort (RPE 7 → 9.5 over the block). About 60 min.',
    days: [
      { id: 'CA', short: 'Full', title: 'Full A', ex: [S('squat', 5, [3, 3, 4, 4], 'main'), S('incline_press', 7, [3, 3, 4, 4], 'main'), S('cable_row', 10, [3, 3, 3, 3], 'acc'), S('cable_lat_raise', 12, [3, 3, 3, 3], 'iso'), S('face_pull', 12, [3, 3, 3, 3], 'iso')] },
      { id: 'CR', short: 'Rest', ...REST },
      { id: 'CB', short: 'Full', title: 'Full B', ex: [S('rdl', 8, [3, 3, 4, 4], 'main'), S('chin', 6, [3, 3, 4, 4], 'main'), S('db_ohp', 8, [3, 3, 3, 3], 'acc'), S('bss', 10, [3, 3, 3, 3], 'acc'), S('db_row', 10, [3, 3, 3, 3], 'acc')] },
      { id: 'CE', short: 'Cardio', ...EASY },
      { id: 'CC', short: 'Full', title: 'Full C', ex: [S('incline_bench_press_dumbbell', 8, [3, 3, 4, 4], 'main'), S('lat_pulldown', 10, [3, 3, 3, 3], 'acc'), S('goblet_squat', 12, [3, 3, 3, 3], 'acc'), S('hip_thrust', 10, [3, 3, 3, 3], 'acc'), S('upright_row', 15, [3, 3, 3, 3], 'iso')] },
      { id: 'CR2', short: 'Rest', ...REST },
      { id: 'CL', short: 'Long cardio', ...LONG },
    ],
  },
  {
    id: 'upperlower', name: 'Upper / Lower', wave: 'classic',
    blurb: '4 days: two upper, two lower (one heavy squat day, one heavy RDL day). 3–4 sets, RPE 7 → 9.5.',
    days: [
      { id: 'UA', short: 'Upper', title: 'Upper A', ex: [S('incline_press', 6, [3, 3, 4, 4], 'main'), S('cable_row', 10, [3, 3, 4, 4], 'acc'), S('sbar_ohp', 8, [3, 3, 3, 3], 'acc'), S('lat_pulldown', 10, [3, 3, 3, 3], 'acc'), S('face_pull', 12, [3, 3, 3, 3], 'iso')] },
      { id: 'LA', short: 'Lower', title: 'Lower A · Squat', ex: [S('squat', 5, [3, 3, 4, 4], 'main'), S('rdl', 10, [2, 2, 3, 3], 'acc'), S('bss', 10, [3, 3, 3, 3], 'acc'), S('cable_lat_raise', 12, [3, 3, 3, 3], 'iso')] },
      { id: 'UE', short: 'Cardio', ...EASY },
      { id: 'UB', short: 'Upper', title: 'Upper B', ex: [S('chin', 6, [3, 3, 4, 4], 'main'), S('incline_bench_press_dumbbell', 8, [3, 3, 4, 4], 'main'), S('db_row', 10, [3, 3, 3, 3], 'acc'), S('db_ohp', 8, [3, 3, 3, 3], 'acc'), S('chest_dip_weighted', 8, [3, 3, 3, 3], 'acc')] },
      { id: 'LB', short: 'Lower', title: 'Lower B · Hinge', ex: [S('rdl', 6, [3, 3, 4, 4], 'main'), S('squat', 8, [3, 3, 3, 3], 'acc'), S('hip_thrust', 10, [3, 3, 3, 3], 'acc'), S('upright_row', 15, [3, 3, 3, 3], 'iso')] },
      { id: 'UR', short: 'Rest', ...REST },
      { id: 'UL', short: 'Long cardio', ...LONG },
    ],
  },
];

// Your current estimated max per exercise: best RPE-logged set in the last 9 weeks, else the last 6 months.
export function estimatedMaxes(workouts, catalog, bodyweight, today) {
  const best = { recent: {}, older: {} };
  const ago = (d) => (Date.parse(today) - Date.parse(d)) / 86400000;
  for (const w of workouts) {
    const age = ago(w.date); if (age < 0 || age > 183) continue;
    for (const e of w.exercises || []) {
      if (e.skipped) continue;
      const bw = (catalog[e.key] || {}).bodyweight ? bodyweight : 0;
      for (const s of e.sets || []) {
        if (s.type === 'warmup' || !s.reps || s.rpe == null) continue;
        const v = e1rm(s.weight || 0, s.reps, s.rpe, bw);
        const b = age <= 63 ? best.recent : best.older;
        if (v != null && v > (b[e.key] || 0)) b[e.key] = v;
      }
    }
  }
  return { ...best.older, ...best.recent };
}
export function loadFor(key, reps, rpe, maxes, catalog, bodyweight) {
  const m = maxes[key]; const c = catalog[key] || {}; const step = c.step || 2.5;
  if (!m) return 0;
  const w = m / (1 + (reps + (10 - rpe)) / 30) - (c.bodyweight ? bodyweight : 0);
  return w <= 0 ? 0 : Math.max(step, Math.round(w / step) * step);
}

// Turn a template into a plan ({days, catalog, opts}) for you.
export function buildTemplatePlan(t, { workouts, catalog, bodyweight, today, opts }) {
  const cat = JSON.parse(JSON.stringify(catalog));
  for (const d of t.days) for (const x of d.ex || []) if (!cat[x.key]) cat[x.key] = JSON.parse(JSON.stringify(TEMPLATE_CATALOG[x.key]));
  const maxes = estimatedMaxes(workouts, cat, bodyweight, today);
  const missing = [];
  const days = t.days.map((d, i) => {
    const base = { id: d.id, name: `Day ${i + 1} · ${d.short}`, type: d.type || 'strength', title: d.title };
    if (!d.ex) return { ...base, note: d.note };
    return { ...base, exercises: d.ex.map((x) => {
      const rpe = WAVES[t.wave][x.role] || WAVES[t.wave].acc;
      const weeks = [0, 1, 2, 3].map((w) => [{ sets: x.sets[w], reps: x.reps, weight: loadFor(x.key, x.reps, rpe[w], maxes, cat, bodyweight) }]);
      if (!maxes[x.key]) missing.push(cat[x.key].name);
      weeks.push([{ sets: Math.max(1, Math.ceil(x.sets[3] / 2)), reps: x.reps, weight: weeks[3][0].weight }]);
      const slot = { id: x.key, weeks, rpe: [...rpe, Math.min(rpe[3], 7)] };
      const w1 = weeks[0][0].weight;
      if (x.role === 'main' && w1 >= 20 && !cat[x.key].bodyweight) slot.warm = { sets: 1, reps: 6, weight: Math.max(cat[x.key].step || 2.5, Math.round((w1 * 0.6) / (cat[x.key].step || 2.5)) * (cat[x.key].step || 2.5)) };
      return slot;
    }) };
  });
  return { plan: { days, catalog: cat, opts: opts || { deload: 'load' } }, missing: [...new Set(missing)], maxes };
}
