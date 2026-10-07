// The 5-week block. Loads in kg. Week index 0..4 = Baseline, Bump, Bump, Peak, Deload.
// Group = {sets, reps, weight}. Warm-ups are identical every week.
const g = (sets, reps, weight) => ({ sets, reps, weight });

export const WEEK_NAMES = ['Baseline', 'Bump', 'Bump', 'Peak', 'Deload'];

// Catalog: aliases = exercise names as they appear in Hevy, so history maps to plan exercises.
// step = smallest sensible load increment (kg). rpe = default target RPE for working sets.
export const EXERCISES = {
  incline_press: { name: 'Incline Swiss Bar Press', muscles: ['chest', 'triceps'], aliases: ['Incline Bench Press (Barbell)'], step: 2.5, rpe: 8, compound: true },
  cable_row: { name: 'Seated Cable Row', muscles: ['back', 'biceps'], aliases: ['Seated Cable Row - Bar Grip', 'Seated Cable Row - Bar Wide Grip'], step: 2.5, rpe: 8, compound: true },
  sbar_ohp: { name: 'Seated Swiss Bar OHP', muscles: ['delts'], aliases: ['Seated Overhead Press (Barbell)'], step: 2.5, rpe: 8, compound: true },
  lat_pulldown: { name: 'Lat Pulldown', muscles: ['back', 'biceps'], aliases: ['Lat Pulldown (Cable)', 'Lat Pulldown - Close Grip (Cable)'], step: 2.5, rpe: 8.5, compound: false },
  face_pull: { name: 'Face Pull', muscles: ['delts', 'traps'], aliases: ['Face Pull'], step: 2.5, rpe: 8.5, compound: false },
  squat: { name: 'BB Back Squat', muscles: ['quads', 'glutes'], aliases: ['Squat (Barbell)'], step: 2.5, rpe: 8, compound: true },
  rdl: { name: 'BB RDL', muscles: ['hams', 'glutes'], aliases: ['Romanian Deadlift (Barbell)'], step: 2.5, rpe: 8, compound: true },
  bss: { name: 'DB Bulgarian Split Squat', muscles: ['quads', 'glutes'], aliases: ['Bulgarian Split Squat (Dumbbell)'], step: 2.5, rpe: 8.5, compound: false },
  upright_row: { name: 'BB Upright Row', muscles: ['delts', 'traps'], aliases: ['Upright Row (Barbell)', 'Upright Row (Cable)'], step: 2.5, rpe: 8.5, compound: false },
  cable_lat_raise: { name: 'Cuff Cable Lateral Raise', muscles: ['delts'], aliases: ['Single Arm Lateral Raise (Cable)'], step: 0.5, rpe: 9, compound: false },
  chin: { name: 'Weighted Parallel Grip Chin-Up', muscles: ['back', 'biceps'], aliases: ['Chin Up (Weighted)', 'Chin Up'], step: 2.5, rpe: 8, compound: true, bodyweight: true },
  db_row: { name: 'DB Chest-Supported Row', muscles: ['back', 'biceps'], aliases: ['Dumbbell Row'], step: 2.5, rpe: 8.5, compound: false },
  db_ohp: { name: 'Seated DB OHP', muscles: ['delts'], aliases: ['Seated Overhead Press (Dumbbell)', 'Shoulder Press (Dumbbell)'], step: 2.5, rpe: 8, compound: true },
  sa_pulldown: { name: 'Single Arm Lat Pulldown', muscles: ['back'], aliases: [], step: 2.5, rpe: 9, compound: false },
  rev_lunge: { name: 'Reverse Lunge', muscles: ['hams', 'glutes'], aliases: [], step: 2.5, rpe: 8.5, compound: false },
  hip_thrust: { name: 'BB Hip Thrust', muscles: ['glutes'], aliases: [], step: 5, rpe: 8.5, compound: false },
};

const squatWork = [
  [g(1, 4, 80), g(1, 6, 70)],
  [g(1, 4, 80), g(1, 7, 70)],
  [g(1, 4, 80), g(2, 7, 70)],
  [g(1, 4, 80), g(3, 7, 70)],
  [g(1, 4, 80), g(1, 6, 70)],
];
const inclineD1 = [
  [g(1, 6, 55), g(2, 8, 50)],
  [g(1, 6, 55), g(2, 8, 50)],
  [g(1, 7, 55), g(2, 9, 50)],
  [g(1, 7, 55), g(2, 10, 50)],
  [g(1, 6, 55), g(1, 8, 50)],
];
const inclineD4 = [
  [g(1, 6, 55), g(2, 8, 50)],
  [g(1, 6, 55), g(2, 8, 50)],
  [g(1, 6, 55), g(3, 8, 50)],
  [g(1, 6, 55), g(3, 8, 50)],
  [g(1, 6, 55), g(1, 8, 50)],
];
const uprightRow = [[g(2, 15, 20)], [g(2, 15, 20)], [g(3, 15, 20)], [g(3, 15, 20)], [g(1, 15, 20)]];
const latRaise = [[g(2, 12, 2.5)], [g(2, 12, 2.5)], [g(2, 12, 2.5)], [g(3, 12, 2.5)], [g(1, 12, 2.5)]];

export const DAYS = [
  {
    id: 'D1', name: 'Day 1 · Upper', type: 'strength', title: 'Upper A',
    exercises: [
      { id: 'incline_press', warm: g(1, 7, 40), weeks: inclineD1 },
      { id: 'cable_row', weeks: [[g(2, 10, 60)], [g(2, 10, 70)], [g(3, 10, 70)], [g(3, 10, 70)], [g(1, 10, 60)]] },
      { id: 'sbar_ohp', weeks: [
        [g(1, 5, 50), g(1, 10, 40)], [g(1, 5, 50), g(2, 10, 40)], [g(1, 6, 50), g(2, 10, 45)],
        [g(1, 7, 50), g(2, 10, 45)], [g(1, 5, 50), g(1, 10, 40)] ] },
      { id: 'lat_pulldown', weeks: [[g(2, 10, 55)], [g(2, 10, 55)], [g(2, 11, 55)], [g(2, 12, 55)], [g(1, 10, 55)]] },
      { id: 'face_pull', weeks: [[g(3, 12, 20)], [g(3, 10, 20)], [g(3, 10, 20)], [g(4, 10, 20)], [g(1, 10, 20)]] },
    ],
  },
  { id: 'D2', name: 'Day 2 · Cardio', type: 'cardio', title: 'Easy run or park ride', note: '~1 hour, genuinely easy (conversational pace, Zone 2).' },
  {
    id: 'D3', name: 'Day 3 · Lower', type: 'strength', title: 'Lower A',
    exercises: [
      { id: 'squat', warm: g(1, 7, 50), weeks: squatWork },
      { id: 'rdl', weeks: [
        [g(1, 8, 80), g(1, 10, 70)], [g(1, 8, 80), g(1, 10, 70)], [g(1, 8, 80), g(2, 10, 70)],
        [g(1, 8, 80), g(3, 10, 70)], [g(1, 8, 80), g(1, 10, 70)] ] },
      { id: 'bss', weeks: [[g(2, 10, 20)], [g(2, 10, 20)], [g(2, 10, 20)], [g(3, 10, 20)], [g(1, 10, 20)]] },
      { id: 'upright_row', weeks: uprightRow },
      { id: 'cable_lat_raise', weeks: latRaise },
    ],
  },
  {
    id: 'D4', name: 'Day 4 · Upper', type: 'strength', title: 'Upper B',
    exercises: [
      { id: 'chin', warm: g(1, 5, 10), weeks: [
        [g(1, 5, 15), g(1, 6, 12.5)], [g(1, 5, 15), g(1, 6, 12.5)], [g(1, 5, 15), g(2, 6, 12.5)],
        [g(1, 5, 15), g(3, 6, 12.5)], [g(1, 5, 15), g(1, 6, 12.5)] ] },
      { id: 'incline_press', warm: g(1, 7, 40), weeks: inclineD4 },
      { id: 'db_row', weeks: [[g(2, 10, 20)], [g(2, 10, 20)], [g(3, 10, 20)], [g(3, 10, 20)], [g(1, 10, 20)]] },
      { id: 'db_ohp', weeks: [
        [g(1, 6, 22.5), g(1, 8, 20), g(1, 10, 17.5)],
        [g(1, 6, 22.5), g(1, 8, 20), g(2, 10, 17.5)],
        [g(1, 6, 22.5), g(2, 8, 20), g(2, 10, 17.5)],
        [g(2, 6, 22.5), g(2, 8, 20), g(2, 10, 17.5)],
        [g(1, 6, 22.5), g(1, 8, 20), g(1, 10, 17.5)] ] },
      { id: 'sa_pulldown', weeks: [[g(3, 15, 20)], [g(3, 15, 20)], [g(3, 15, 20)], [g(4, 15, 20)], [g(1, 15, 20)]] },
    ],
  },
  {
    id: 'D5', name: 'Day 5 · Lower', type: 'strength', title: 'Lower B',
    exercises: [
      { id: 'squat', warm: g(1, 7, 50), weeks: squatWork },
      // Week 3 reverse lunge was 20 kg in the sheet; treated as a typo for 40 kg.
      { id: 'rev_lunge', weeks: [[g(2, 10, 40)], [g(2, 10, 40)], [g(3, 10, 40)], [g(4, 10, 40)], [g(1, 10, 40)]] },
      { id: 'hip_thrust', weeks: [[g(2, 10, 40)], [g(2, 10, 40)], [g(2, 12, 40)], [g(3, 12, 40)], [g(1, 10, 40)]] },
      { id: 'upright_row', weeks: uprightRow },
      { id: 'cable_lat_raise', weeks: latRaise },
    ],
  },
  { id: 'D6', name: 'Day 6 · Rest', type: 'rest', title: 'Active recovery / rest', note: 'Walk, mobility, nothing taxing.' },
  { id: 'D7', name: 'Day 7 · Long cardio', type: 'cardio', title: 'MTB or long run', note: '~2 hours, easy pace. Keep it aerobic; this is not a race.' },
];

// Expand an exercise's plan for a given week into flat set prescriptions.
export function expandWeek(dayIdx, week) {
  const day = DAYS[dayIdx];
  if (!day || day.type !== 'strength') return [];
  return day.exercises.map((ex) => {
    const meta = EXERCISES[ex.id] || { name: ex.id, muscles: [], aliases: [], step: 2.5, rpe: 8, compound: false };
    const sets = [];
    if (ex.warm) sets.push({ type: 'warmup', reps: ex.warm.reps, weight: ex.warm.weight });
    for (const grp of ex.weeks[week]) {
      for (let i = 0; i < grp.sets; i++) sets.push({ type: 'work', reps: grp.reps, weight: grp.weight });
    }
    return { id: ex.id, ...meta, sets };
  });
}

// alias lookup: Hevy exercise name -> plan exercise id
export function aliasMap() {
  const m = {};
  for (const [id, e] of Object.entries(EXERCISES)) for (const a of e.aliases) m[a] = id;
  return m;
}

export const MUSCLES = ['chest', 'back', 'delts', 'biceps', 'triceps', 'quads', 'hams', 'glutes', 'traps'];

// ---- editable plan: the arrays/objects above are mutated in place so every importer sees live data ----
const DEFAULT_SNAPSHOT = JSON.stringify({ days: DAYS, catalog: EXERCISES });
export const exportPlan = () => JSON.parse(JSON.stringify({ days: DAYS, catalog: EXERCISES }));
export function loadPlan(p) {
  if (!p || !Array.isArray(p.days) || !p.catalog) return;
  DAYS.splice(0, DAYS.length, ...p.days);
  for (const k of Object.keys(EXERCISES)) delete EXERCISES[k];
  Object.assign(EXERCISES, p.catalog);
}
export const resetPlan = () => loadPlan(JSON.parse(DEFAULT_SNAPSHOT));
// Days were defined with shared arrays (e.g. the squat rows on both Lower days). Re-load from a deep copy so every
// day owns its own rows and editing one day can never change another.
resetPlan();

// A day's own copy of an exercise: same name and settings, inherits the original's history up to `today`.
export function copyForDay(id, day, today) {
  const base = EXERCISES[id] || { name: id, muscles: [], aliases: [], step: 2.5, rpe: 8, compound: false };
  const taken = new Set(DAYS.flatMap((d) => (d.exercises || []).map((e) => e.id)));
  let nid = `${id}__${day.id}`;
  let n = 2;
  while (taken.has(nid)) nid = `${id}__${day.id}_${n++}`;
  if (!EXERCISES[nid]) EXERCISES[nid] = { ...JSON.parse(JSON.stringify(base)), aliases: [], historyFrom: { id, until: today } };
  return nid;
}
export const dayUsing = (id, exceptDayIdx = -1) => DAYS.findIndex((d, i) => i !== exceptDayIdx && (d.exercises || []).some((e) => e.id === id));

// Every day owns its exercises. If an exercise id appears on more than one day, the first day keeps it and each
// other day gets its own copy, which inherits the original's history up to today.
export function splitShared(today) {
  const seen = new Map();
  let made = 0;
  DAYS.forEach((d) => {
    (d.exercises || []).forEach((slot) => {
      const first = seen.get(slot.id);
      if (first === undefined) { seen.set(slot.id, d.id); return; }
      if (first === d.id) return;
      slot.id = copyForDay(slot.id, d, today);
      seen.set(slot.id, d.id);
      made++;
    });
  });
  return made;
}

// Day numbers come from position. Names are stored as "Day N · Label"; call after any reorder/add/delete.
export const dayLabel = (d) => (d.name || '').replace(/^Day\s*\d+\s*·\s*/, '').trim() || 'Day';
export function renumberDays() { DAYS.forEach((d, i) => { d.name = `Day ${i + 1} · ${dayLabel(d)}`; }); }
// Stable reference to a plan day: by id when available, otherwise by the position it had.
export function dayIndexOf(ref) {
  if (!ref) return -1;
  if (ref.dayId) { const i = DAYS.findIndex((d) => d.id === ref.dayId); if (i >= 0) return i; }
  // older records (before day ids): match the day by its label, e.g. "Cardio", since positions may have changed
  if (ref.dayName) {
    const lbl = dayLabel({ name: ref.dayName });
    const hits = DAYS.map((d, i) => ({ d, i })).filter(({ d }) => dayLabel(d) === lbl && (!ref.title || d.title === ref.title));
    if (hits.length === 1) return hits[0].i;
    if (hits.length > 1) { const near = hits.find((h) => h.i === ref.dayIdx); return (near || hits[0]).i; }
  }
  return ref.dayIdx != null && ref.dayIdx < DAYS.length ? ref.dayIdx : -1;
}
