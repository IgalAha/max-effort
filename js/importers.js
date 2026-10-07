// Parsers for Hevy CSV, Garmin CSV, Garmin sleep CSV and the pasted weekly resting-HR table.
// No DOM. Return plain objects in the app's own format.
import { aliasMap } from './plan.js';

export function parseCSV(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let q = false;
  const t = text.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (ch !== '\r') cur += ch;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  const head = rows.shift().map((h) => h.trim());
  return rows.filter((r) => r.length > 1 || (r[0] || '').trim()).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const num = (s) => {
  if (s == null) return null;
  const t = String(s).replace(/,/g, '').trim();
  if (!t || t === '--') return null;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
};
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const pad = (n) => String(n).padStart(2, '0');
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// "Oct 4, 2026, 8:42 AM" -> {date:'2026-10-04', start:'08:42', min: minutesSinceMidnight}
function parseHevyTime(s) {
  const m = /^([A-Za-z]{3}) (\d{1,2}), (\d{4}), (\d{1,2}):(\d{2}) (AM|PM)$/.exec((s || '').trim());
  if (!m) return null;
  let h = +m[4] % 12;
  if (m[6] === 'PM') h += 12;
  return { date: `${m[3]}-${pad(MON[m[1].toLowerCase()])}-${pad(+m[2])}`, start: `${pad(h)}:${m[5]}`, min: h * 60 + +m[5] };
}

export function parseHevy(text) {
  const rows = parseCSV(text);
  const amap = aliasMap();
  const sessions = new Map();
  for (const r of rows) {
    const st = parseHevyTime(r.start_time);
    if (!st) continue;
    const id = `hevy-${st.date}-${st.start}`;
    if (!sessions.has(id)) {
      const en = parseHevyTime(r.end_time);
      let dur = en ? en.min - st.min : null;
      if (dur != null && dur < 0) dur += 1440;
      sessions.set(id, { id, source: 'hevy', date: st.date, start: st.start, durationMin: dur, title: r.title || 'Workout', planRef: null, sessionRpe: null, notes: '', exercises: [] });
    }
    const w = sessions.get(id);
    const name = r.exercise_title;
    const key = amap[name] || slug(name);
    let ex = w.exercises.find((e) => e.name === name);
    if (!ex) { ex = { key, name, sets: [], pain: null, notes: '' }; w.exercises.push(ex); }
    ex.sets.push({
      type: r.set_type === 'warmup' ? 'warmup' : 'work',
      weight: num(r.weight_kg) ?? 0,
      reps: num(r.reps),
      rpe: num(r.rpe),
      done: true,
    });
  }
  return [...sessions.values()];
}

const TYPE_MAP = { Running: 'run', 'Mountain Biking': 'mtb', Cycling: 'ride', Walking: 'walk', Hiking: 'hike', 'Strength Training': 'strength-garmin', Other: 'other' };
const hms = (s) => {
  if (!s || s === '--') return null;
  const p = s.split(':').map(Number);
  if (p.length === 3) return p[0] * 60 + p[1] + p[2] / 60;
  if (p.length === 2) return p[0] + p[1] / 60;
  return null;
};

// Garmin is the spine for sessions, durations and heart rate. Every activity is kept;
// Hevy sets are attached to the matching Garmin strength session at read time (see engine.strengthSessions).
export function parseGarmin(text) {
  const out = [];
  for (const r of parseCSV(text)) {
    const type = TYPE_MAP[r['Activity Type']];
    if (!type) continue;
    const [date, time] = (r.Date || '').split(' ');
    if (!date) continue;
    const dur = hms(r.Time);
    out.push({
      id: `garmin-${date}-${(time || '00:00').slice(0, 5)}`,
      source: 'garmin',
      type, date, start: (time || '00:00').slice(0, 5),
      title: r.Title || '',
      durationMin: dur != null ? Math.round(dur * 10) / 10 : null,
      distanceKm: num(r.Distance),
      ascentM: num(r['Total Ascent']),
      avgHr: num(r['Avg HR']),
      maxHr: num(r['Max HR']),
      te: num(r['Aerobic TE']),
      power: num(r['Avg Power']),
      gct: num(r['Avg Ground Contact Time']),
      stride: num(r['Avg Stride Length']),
      vo: num(r['Avg Vertical Oscillation']),
      reps: num(r['Total Reps']),
      sets: num(r['Total Sets']),
      rpe: null,
      notes: '',
    });
  }
  return out;
}

// "29 Sep - 5 Oct", "22-28 Sep", "30 Dec 2025 - 5 Jan 2026" -> ISO date of the week's last day.
// Rows are newest-first, so a missing year is inferred by walking backwards.
function weekEnds(labels, refYear) {
  let year = refYear;
  let prev = null;
  return labels.map((label) => {
    const m = /(\d{1,2})\s+([A-Za-z]{3})(?:\s+(\d{4}))?\s*$/.exec(label.trim());
    if (!m) return null;
    const mon = MON[m[2].toLowerCase()];
    let y = m[3] ? +m[3] : year;
    let iso = `${y}-${pad(mon)}-${pad(+m[1])}`;
    if (!m[3] && prev && iso > prev) { y -= 1; iso = `${y}-${pad(mon)}-${pad(+m[1])}`; }
    year = y;
    prev = iso;
    return iso;
  });
}

const durMin = (s) => {
  const m = /(\d+)h\s*(\d+)min/.exec(s || '');
  return m ? +m[1] * 60 + +m[2] : null;
};

export function parseSleep(text, refYear = new Date().getFullYear()) {
  const rows = parseCSV(text);
  const ends = weekEnds(rows.map((r) => r.Date), refYear);
  return rows.map((r, i) => ({
    id: `sleep-${ends[i]}`, weekEnd: ends[i], label: r.Date,
    score: num(r['Avg Score']), quality: r['Avg Quality'],
    durMin: durMin(r['Avg Duration']), needMin: durMin(r['Avg Sleep Need']),
    bed: r['Avg Bedtime'], wake: r['Avg Wake Time'],
  })).filter((x) => x.weekEnd && x.durMin != null);
}

export function parseRestingHr(text, refYear = new Date().getFullYear()) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => /bpm/.test(l));
  const parsed = lines.map((l) => {
    const m = /^(.*?)[\t ]+(\d+)\s*bpm[\t ]+(\d+)\s*bpm/.exec(l);
    return m ? { label: m[1].trim(), resting: +m[2], high: +m[3] } : null;
  }).filter(Boolean);
  const ends = weekEnds(parsed.map((p) => p.label), refYear);
  return parsed.map((p, i) => ({ id: `rhr-${ends[i]}`, weekEnd: ends[i], label: p.label, resting: p.resting, high: p.high })).filter((x) => x.weekEnd);
}
