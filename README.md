# Max Effort — v9.7.2

Personal training app for strength, running and MTB: Hevy-style workout logger with RPE-based progression,
editable 5-week plan, Garmin-based activity feed and training load, recovery status, injury log and a coach packet
for Claude/Gemini. Plain HTML/JS, no build step. Data stays on the phone (IndexedDB).

## Install on Android
1. Host this folder over https: drag the `max-effort` folder onto app.netlify.com/drop (free; create an account so it doesn't expire).
2. Open the URL in Chrome on your phone, then ⋮ menu › Install app.
3. First launch loads data/seed.json (your Garmin, Hevy, sleep and resting-HR history).
Privacy: seed.json contains your health history and is downloadable by anyone with the URL. Delete it before hosting
if you prefer, and import the CSVs from Me › Data instead.
After changing any file, bump CACHE in sw.js (max-effort-v2, …) so the phone picks up the new version.

## Tabs
Home – today's session, recovery, this week, Garmin activity feed (tap for details / edit / delete)
Workout – routines from the plan, empty workout, cardio logging; the set logger (Previous column, rest timer)
Plan – current position, plan by week or whole block, edit days/exercises/sets per week, export/import/reset
Progress – lift e1RM trends, weekly training time and fatigue, coach recommendations + packet
Me – health (check-in, sleep, resting HR, injuries), settings, backup/restore and imports

## Data model
Garmin is the backbone: every Garmin activity is a session (duration, HR). Sets logged here or in Hevy attach to the
Garmin strength session on the same day. Max HR defaults to the highest Garmin-recorded value.

## Dev
Regenerate seed: node tools/build-seed.mjs <folder with Hevy.csv, Garmin.csv, Sleep_1.csv>
Tests: DATA_DIR=<folder with Sleep_1.csv> node tests/engine.test.mjs

## Progression rules (engine.js › suggestExercise)
Sets and reps come from the plan; the engine only moves load. Next load = plan + carried + adjustment, where
"carried" is how far above/below plan you actually lifted last time (deload sessions don't reset it).
Checked in order, first match wins:
1. Pain ≥4/10 last time → hold.        2. >28 days off → 5% lighter (>56 days → 10%).
3. Recovery RED → 5% lighter.          4. Deload week → plan loads, RPE ≤7.
5. No RPE last time → hold.            6. RPE ≥9.5 twice at the same load → 5% lighter.
7. Missed planned reps → hold (badly, twice → 5% lighter).
8. Any set RPE ≥9.5, or hardest set above target +0.5 → hold.
9. Increase one load step when avg RPE ≤ target−1 (≥2 sets), or two sessions in a row ≤ target−0.5 at the same load —
   unless e1RM is falling over 3 sessions, recovery is YELLOW, or (leg exercises) yesterday had a ≥90-min / hilly ride or ≥60-min run.
10. Otherwise hold.
Load steps: 2.5 kg for barbell and dumbbell lifts, 0.5 kg for the cable lateral raise (editable per exercise).

## Changes in v3
- Progression accumulates (was stuck at plan + one step); reps vs plan checked; hardest set no longer hidden by averaging;
  two-session trend and e1RM regression guard; long breaks reduce load; yesterday's long ride/run holds leg progression.
- When you finish with more/fewer sets than planned, or with an exercise not in the plan, the app asks whether to keep
  the change: just this time / rest of this block / all weeks (deload untouched) / add exercise to the day.
- Dumbbell load step 2.5 kg. Jump to any day from Home, back a day, undo.

## Changes in v4
- Export (Me › Data › Export, or "Export this day" on any activity): Today / a day / this week / last week / a block /
  30 days / custom dates / everything. Formats: spreadsheet (CSV, several tables zipped), PDF report (print → Save as PDF),
  coach text (copied for Claude/Gemini, asks for a block review when you export a block), raw JSON. Share or download.
- Training blocks are dated: a new block starts when the plan wraps from Week 5 to Week 1. The current block's start
  date is shown and editable in Plan › You are here. Changing the week there by hand re-dates the current block.

## Changes in v5 (install fix)
- Install on Android failed when data/seed.json was removed: the offline layer (service worker) refused to start, so
  Chrome only offered a shortcut. The offline layer no longer depends on that file.
- Separate maskable icon, manifest id, Netlify _headers so updates are picked up immediately.
- Me › Settings › App shows "Offline ready" and an Install button when Chrome allows it; Home shows an install banner.
- This zip ships WITHOUT data/seed.json (privacy). Import your CSVs on the phone in Me › Data.

## Changes in v6
- Swap an exercise on one day only: Plan › Edit day › ⇄ next to the exercise (keeps sets, reps and kg; check the kg).
- Exercises used on more than one day are labelled "also on …"; their settings screen warns that name/muscles/step/RPE
  are shared and offers "Use a different exercise on this day only".
- Fixed: Lower A and Lower B shared the same rows in memory (squat, upright row, lateral raise), so editing one day's
  sets could change the other.
- New exercises get muscles and compound/isolation guessed from the name (editable).

## Changes in v7 — every day is independent
- No exercise is shared between days any more. On first launch, any exercise used on several days is split: the first
  day keeps it, the others get their own copy (e.g. "BB Back Squat" on Lower B becomes its own exercise).
- Anything you change on a day — name, muscles, load step, target RPE, sets/reps/kg, swaps — affects only that day.
  Adding an exercise that another day already has creates a copy for this day.
- History isn't lost: a copy counts the original's sessions from before the split (toggle "Count sessions before …"
  in the exercise screen if you turned it into a different lift). After the split, each day progresses from its own
  sessions only.
- Progress › Lifts groups exercises with the same name into one trend line (e.g. both squats).

## Changes in v8 — skipping and logging out of order
- Skip a planned day (Home › Skip): pick a reason (swapped days, tired, sick, pain, no time, travel, weather, other),
  the date it was planned for, and a note. It shows in the feed, exports (skipped.csv / PDF) and the coach packet.
  Open it in the feed to undo.
- The app tracks which days of the week are done or skipped. "Next" is the first day from your current one that is
  neither, so doing Lower A before Cardio keeps Cardio waiting until you do or skip it. Home's strip shows
  done (green) and skipped (struck through).
- Log a workout on a past date: change the date at the top of the logger; enter minutes (or Garmin's duration is used).
- Skip a single exercise mid-workout (⋯ › Skip exercise, with a reason). It's saved as skipped and doesn't count
  against progression.
- Logging cardio asks which plan day it counts as (or "Extra session").

## Changes in v9 — change the split
- Plan › Manage plan › Change split order: move days up/down; add rest, cardio or lifting days.
- Day numbers follow position ("Day 3 · Cardio" after moving), names keep their label.
- Moving days never mixes up history: workouts, this week's done/skipped marks and skips are linked to the day itself,
  not its position. Your "next" day stays the same day after a reorder.

## Changes in v9.2 — training load in plain language
- Progress › Training "Fatigue" is now "Training load": hours and average effort (x/10) for the last 7 days and
  your usual week, the difference in %, a verdict in words (Lighter than usual / About your usual / More than usual /
  Much more than usual), a "What to do" line, and an explanation.
- No verdict until there are ~3 weeks of training logged (or imported); a short history no longer triggers YELLOW.
- Updates load automatically after a deploy (from v9.1).

## Changes in v9.3
- Weekly training time chart: week start dates under the bars, hours on top, tap a bar for the breakdown.

## Changes in v9.4 — Training chart
- Progress › Training: one column per day. Week / Month / Block (W1–W5 with phase names), ‹ › to move between periods.
- Show: Time, Stress (time × effort) or Distance. Filter: Lift, Run, Ride, Other.
- Tap a day to see what you did. Summary for the period: time, sessions, active days, effort, run/ride km, climb,
  lifting sets and volume, comparison with the same part of the previous period, and a breakdown per type.

## Changes in v9.5
- Log cardio › Counts as: lists every cardio day of the week. Skipped days show "(was skipped)"; logging one marks it done and removes the skip. Defaults to the earliest open or skipped cardio day.

## Changes in v9.7.2
- Home shows today's date and "Day N of 7".
- File pickers (restore, plan import, Garmin/Hevy CSV) no longer filter by type, so Android shows the files.
- Age and height moved out of the coaching brief into Me › Settings.

## Changes in v9.7
- Day status sheet: tap any day in the Home week strip, or the status pill on a routine or a Plan card, to see that day's status and everything logged for it this week.
- Change a day to To do / Done / Skipped in one tap. To do also removes any skip and unlinks cardio that counted for it. Skipped opens the skip reason sheet.
- Start or log the day straight from the sheet, or make it your next day.
- Status pills (✓ Done, Skipped, Next, To do) are always visible on Workout › Routines and on the current week in Plan.

## Changes in v9.6
- Fixed: undoing a skip made before reordering the split un-skipped the wrong day. Older skips are now matched by the day's name.
- Any run/ride from the last 7 days (logged or imported from Garmin) has a "Counts as" selector in its detail page to link it to a plan day, or back to an extra session.
