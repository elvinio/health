# Exercise Programme JSON Format

A programme file is a single JSON object that can be imported into the tracker via **Setup → Programme → Import programme JSON**.

Once imported the programme appears in the programme selector and can be assigned per-profile. The tracker reads each profile's `programId` from their config — if no ID is set it falls back to the built-in programme.

---

## Top-level fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | ✓ | Unique identifier. Must not collide with a built-in ID (`strength-40-male`). Use kebab-case, e.g. `my-programme-v2`. |
| `name` | string | ✓ | Display name shown in the programme selector. |
| `description` | string | | Short description shown below the selector. |
| `weeks` | object | ✓ | Keyed by week number (string or integer). Each value is a week-phase descriptor (see below). |
| `weekDefaultReps` | object | ✓ | Default rep count per week for `main`/`finisher` blocks when an exercise has no explicit `reps`/`repsByWeek`. Keyed by week number. |
| `days` | array | ✓ | Array of day-definition objects (see below). |

---

## `weeks` — week-phase descriptor

```json
"weeks": {
  "1": { "phase": "Accumulation", "rpe": "7",   "rest": 45 },
  "2": { "phase": "Strength",     "rpe": "8",   "rest": 90 },
  "3": { "phase": "Volume",       "rpe": "7-8", "rest": 45 },
  "4": { "phase": "Deload",       "rpe": "5-6", "rest": 45 }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `phase` | string | Phase name displayed in the header (e.g. "Accumulation"). |
| `rpe` | string | Target RPE range shown in the header. |
| `rest` | number | Default rest time in seconds between sets. Overridden by block- or exercise-level `restByWeek`. |

---

## `weekDefaultReps`

```json
"weekDefaultReps": { "1": 8, "2": 6, "3": 12, "4": 8 }
```

Applied to any `main` or `finisher` exercise that has no `reps`, `repsByWeek`, `customReps`, or `repsPerRound` field.

---

## Day definition

```json
{
  "day": 1,
  "weekday": "Mon",
  "name": "Strength A — Hinge + Push",
  "type": "strength",
  "purpose": "Horizontal push + pull as the primary strength pair...",
  "blocks": [ ... ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `day` | integer | Day number within the week (1–7). |
| `weekday` | string | Short day label, e.g. `"Mon"`. |
| `name` | string | Day title displayed in the header. |
| `type` | string | `"strength"` \| `"cardio"` \| `"rest"` \| `"recovery"`. Controls which UI view is shown. |
| `purpose` | string | Optional coaching note shown at the top of the day view. |
| `blocks` | array | Array of block objects (strength days). |
| `notes` | array of strings | Plain-text bullet points (rest/recovery/cardio days instead of blocks). |

---

## Block definition

```json
{
  "kind": "main",
  "name": "Block A — Push / Pull Pair",
  "superset": true,
  "roundsByWeek": { "1": 4, "2": 4, "3": 3, "4": 2 },
  "restNote": "Rest 90 s after BOTH A1 + A2 (W2). 45 s elsewhere.",
  "exercises": [ ... ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `kind` | string | `"warmup"` \| `"main"` \| `"finisher"` \| `"core"`. Controls styling and whether `weekDefaultReps` applies. |
| `name` | string | Block heading. |
| `superset` | boolean | If `true`, exercises are shown with a left border indicating they are done back-to-back with minimal rest. |
| `roundsByWeek` | object | Number of rounds per week (used as the `sets` value unless the exercise overrides it). |
| `restByWeek` | object | Default rest in seconds per week for this block (overrides the programme-level `weeks[n].rest`). |
| `restNote` | string | Optional rest note shown in the block header. |
| `exercises` | array | Array of exercise objects (see below). |

---

## Exercise definition

```json
{
  "id": "floor-press",
  "name": "DB Floor Press",
  "weightType": "db-pair",
  "tempo": "3-0-1-0",
  "cue": "Elbows at 45° from torso. Floor stops descent. Full lockout, controlled eccentric."
}
```

### Core fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier used for weight progression and session storage. Only weighted exercises need an `id`. Use kebab-case. |
| `name` | string | Display name on the exercise card. |
| `weightType` | string | `"db-pair"` \| `"db-single"` \| `"kb"` \| `"barbell"` \| `"none"`. Controls the weight input hint and progression increment. |

### Volume fields (all optional — combine as needed)

| Field | Type | Description |
|-------|------|-------------|
| `sets` | number | Fixed set count, overrides block `roundsByWeek`. |
| `setsByWeek` | object | Per-week set count, e.g. `{ "1": 4, "2": 6, "3": 3, "4": 2 }`. |
| `reps` | number | Fixed rep count for all weeks. |
| `repsByWeek` | object | Per-week rep count, e.g. `{ "1": 8, "2": 6, "3": 12, "4": 8 }`. |
| `repsPerRound` | object | Per-week array of reps per round (for descending-rep schemes), e.g. `{ "1": [4, 3, 3], "2": [5, 4, 4] }`. |
| `customReps` | string | Non-numeric reps, e.g. `"20 m"` or `"20 s hold"`. Displayed as-is. |
| `restByWeek` | object | Per-week rest in seconds for this exercise specifically. |
| `restLabel` | string | Label appended to the rest timer, e.g. `"between sides"`. |

### Modifier fields

| Field | Type | Description |
|-------|------|-------------|
| `perSide` | boolean | If `true`, the rep count is shown as "per side". |
| `tempo` | string | Lifting tempo in `eccentric-pause-concentric-pause` notation, e.g. `"3-0-1-0"`. |
| `cue` | string | Coaching cue displayed under the exercise name. |
| `progression` | string | Weight progression strategy: `"default"` \| `"tgu"` \| `"swing-finisher"`. Defaults to `"default"`. |

### Progression strategies

| Strategy | W1 | W2 | W3 | W4 |
|----------|----|----|----|----|
| `default` | baseline | baseline + inc | round(W2 × 0.80) | same as W3 |
| `tgu` | baseline | baseline + 4 kg | baseline | baseline |
| `swing-finisher` | baseline | baseline + 4 kg | baseline | max(0, baseline − 4 kg) |

Increment (`inc`): **2 kg** for dumbbells, **4 kg** for kettlebells.

---

## Complete minimal example

This is the current built-in programme condensed to one day (Day 1) as a working import example.

```json
{
  "id": "my-custom-programme",
  "name": "My Custom Programme",
  "description": "Upper/lower 4-week progressive cycle.",
  "weeks": {
    "1": { "phase": "Accumulation", "rpe": "7",   "rest": 45 },
    "2": { "phase": "Strength",     "rpe": "8",   "rest": 90 },
    "3": { "phase": "Volume",       "rpe": "7-8", "rest": 45 },
    "4": { "phase": "Deload",       "rpe": "5-6", "rest": 45 }
  },
  "weekDefaultReps": { "1": 8, "2": 6, "3": 12, "4": 8 },
  "days": [
    {
      "day": 1,
      "weekday": "Mon",
      "name": "Strength A — Hinge + Push",
      "type": "strength",
      "purpose": "Horizontal push + pull as the primary strength pair; RDL for the posterior chain.",
      "blocks": [
        {
          "kind": "warmup",
          "name": "Warm-up (2 min)",
          "exercises": [
            { "name": "Band pull-apart", "sets": 2, "reps": 15, "weightType": "none" },
            { "name": "Shoulder CARs",   "sets": 1, "reps": 5, "perSide": true, "weightType": "none" }
          ]
        },
        {
          "kind": "main",
          "name": "Block A — Push / Pull Pair",
          "superset": true,
          "roundsByWeek": { "1": 4, "2": 4, "3": 3, "4": 2 },
          "exercises": [
            {
              "id": "floor-press",
              "name": "DB Floor Press",
              "weightType": "db-pair",
              "tempo": "3-0-1-0",
              "cue": "Elbows at 45° from torso. Floor stops descent. Full lockout, controlled eccentric."
            },
            {
              "id": "db-row",
              "name": "Single-arm DB Row",
              "weightType": "db-single",
              "perSide": true,
              "tempo": "2-0-1-1",
              "cue": "Immediately after press. Knee + hand on floor. Pull elbow past hip, feel lat."
            }
          ]
        },
        {
          "kind": "finisher",
          "name": "Finisher — KB Swing",
          "exercises": [
            {
              "id": "kb-swing",
              "name": "KB Swing",
              "weightType": "kb",
              "progression": "swing-finisher",
              "setsByWeek":  { "1": 4, "2": 6, "3": 3, "4": 2 },
              "repsByWeek":  { "1": 8, "2": 6, "3": 12, "4": 8 },
              "restByWeek":  { "1": 30, "2": 30, "3": 30, "4": 30 },
              "cue": "Hike back, explosive hip extension, glutes squeeze at top."
            }
          ]
        },
        {
          "kind": "core",
          "name": "Core",
          "exercises": [
            {
              "name": "Dead Bug",
              "sets": 2,
              "reps": 8,
              "perSide": true,
              "weightType": "none",
              "cue": "Lower back pressed firmly into floor; lower opposite arm/leg slowly."
            }
          ]
        }
      ]
    },
    {
      "day": 2,
      "weekday": "Tue",
      "name": "Rest day",
      "type": "rest",
      "notes": [
        "20–30 min easy walk.",
        "Foam roll 10 min."
      ]
    }
  ]
}
```

> **Tip**: To export the current built-in programme as a starting point, open the browser console on the tracker page and run:
> `JSON.stringify(BUILT_IN_PROGRAMS[0], null, 2)`
> then save the output to a `.json` file, change `id` and `name`, and import it.
