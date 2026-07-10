# Hydration Tracker — On-Device Engine Contract (authoritative)

Owner: AI/ML Engineer · Status: **v1 locked (pending CTO §10)** · Last updated: 2026-06-26

This is the authoritative contract the **mobile dev** codes against, the **designer**
builds the "why today" panel against, and the **CTO** signs off on. Feature #3 in the
README (the "quick win"). Fully on-device, no server, no telemetry (README golden rule).

---

## 0. The honest call first: NO MODEL. This is a deterministic rules engine.

**There is no `.pte` for Hydration. There is no GPU export. There is no tokenizer,
tensor, or quantization.** Hydration need is well-described by physiology, so v1 is a
**transparent, deterministic rules engine** — pure arithmetic.

| | Rules engine (chosen) | ML model (rejected for v1) |
|---|---|---|
| Transparency | Every mL is attributable to a named term → we can render the **exact "why"** (`§2`, `§5`) | Black box; "why" would be post-hoc and unfaithful |
| Correctness | Grounded in published fluid-balance physiology (`§1`) | Needs a labelled per-user fluid-balance dataset we **do not have** and cannot collect on a server (golden rule) |
| Debuggability | A wrong number is a wrong coefficient — one-line fix | A wrong number is a retrain |
| Size / latency | ~0 KB, microseconds, no runtime dependency | A `.pte` + ExecuTorch load for arithmetic a phone does instantly |
| Privacy | Runs in TS, nothing leaves device | Same, but with no upside here |
| Honesty | Shows the user the formula and its assumptions | Hides them |

> "4-bit where quality allows" (README) → here a model **buys nothing** and **costs
> transparency**. A rules engine is the *correct* engineering answer, not a shortcut. The
> moment we want it is if/when we have **consented, on-device** longitudinal data and want
> to *learn* a per-user response — and even then `§6` shows that is a small deterministic
> calibration layer, not a `.pte`. **If that changes, this doc adds the model; the I/O
> contract (`§3`–`§4`) does not change.**

### TL;DR for each role
- **Mobile dev / CTO:** implement the engine in TS at `mobile/src/features/hydration/`
  (canonical home — there is no model to load). Two pure functions: `computeTarget(inputs)`
  → `HydrationTarget` (`§3`–`§4`), and `decideNudge(dayState, now)` → `NudgeDecision`
  (`§5`). Constants table is `§1`; copy it **once** into a frozen `HYDRATION_CONSTANTS`
  object. The Python harness in `ml/test/` is the **reference implementation** — your TS
  must produce identical numbers for the scenarios in `ml/test/hydration_scenarios.json`.
- **Designer:** the "why today" panel binds the **`breakdown[]`** array (`§4`) — each item
  is a named line (`Baseline 2,475 mL`, `Heat +350 mL`, …) with a one-line `why` and a
  `confidence`. The lines **sum to the target**, so the panel is self-explaining. Status is
  `normal | elevated | high` for the headline treatment.
- **AI/ML (me):** I own the formula, coefficients, bounds, and the validation harness
  (`ml/test/hydration_eval.py` + scenarios + report). No `.pte` to deliver — stated plainly.

---

## 1. The recommendation engine — formula, coefficients, bounds

Daily target (mL of **beverage** intake) is the sum of four physiologically-motivated
terms, then clamped to a safe range:

```
target_ml = clamp( baseline + heat_term + activity_term + aqi_term , FLOOR , CEILING )
```

All inputs are validated/clamped to the ranges in `§3` **before** entering these formulas.
`clamp(x,lo,hi) = max(lo, min(hi, x))`.

### 1.1 Baseline (body mass, optional sex/age)
```
baseline = mass_kg * BASE_PER_KG * age_factor * sex_factor
```
| Constant | Value | Basis |
|---|---|---|
| `BASE_PER_KG` | **33 mL/kg/day** | Mid-point of the clinical **30–35 mL/kg/day** adult total-fluid guideline (ESPEN / geriatric nutrition refs). Treated here as a **beverage** target; dietary water (~20% of intake, EFSA) is the unmodelled safety buffer. |
| `age_factor` | <55 → **1.00**; 55–65 → **0.95**; >65 → **0.90**; unknown → 1.00 | Older adults' guideline trends toward **30 mL/kg**; thirst response also blunts (flagged in `notes`, not auto-pushed up — that's a clinician call). |
| `sex_factor` | male **1.00**; female **0.95**; unknown → **0.975** | Reflects lower body-water fraction in females (EFSA adequate intake 2.0 L vs 2.5 L); body mass already captures most of the difference, so this factor is small. |

### 1.2 Heat term (temperature, humidity modifier)
```
heat_term = clamp( K_HEAT * max(0, temp_c - T0) * humidity_factor , 0 , HEAT_CAP )

humidity_factor = 1
               + 0.30 * clamp((humidity_pct - 60) / 40, 0, 1)   # humid: sweat evaporates poorly → more loss
               + 0.10 * clamp((30 - humidity_pct) / 30, 0, 1)   # very dry: higher insensible loss
```
| Constant | Value | Basis |
|---|---|---|
| `T0` | **20 °C** | Thermoneutral-ish threshold; below it, ambient heat adds no meaningful fluid loss. |
| `K_HEAT` | **25 mL/°C·day** | Insensible + light sweat loss rises with ambient heat; gives ~+375 mL at 35 °C, ~+500 mL at 40 °C — consistent with hot-day intake guidance. |
| `HEAT_CAP` | **1000 mL** | Ambient heat alone (no exercise) should not drive an unbounded target. |
| humidity coeffs | **+30%** max humid amplification, **+10%** max dry | High RH impairs evaporative cooling (heat-index logic); very low RH raises insensible loss. Humidity only *modulates the heat term* — it is irrelevant when it's cold. |

### 1.3 Activity / sweat term (active minutes / steps / intensity)
```
eff_min   = active_minutes            if active_minutes provided
          = max(0, steps - STEP_BASE) / 1000 * MIN_PER_1K_STEPS   else (steps fallback)
intensity = {light:0.6, moderate:1.0, vigorous:1.5}[workoutIntensity]   # default moderate
            (forced to 'light' when eff_min came from the steps fallback)

heat_activity_factor = clamp(1 + 0.02 * max(0, temp_c - 25), 1.0, 1.3)

activity_term = clamp( eff_min * K_ACT * intensity * heat_activity_factor , 0 , ACT_CAP )
```
| Constant | Value | Basis |
|---|---|---|
| `K_ACT` | **12 mL/min** | Moderate exercise sweat loss ≈ 0.7 L/h → ~12 mL/min replacement (ACSM/NATA replace-what-you-sweat guidance, conservative end). |
| intensity | light 0.6 / **moderate 1.0** / vigorous 1.5 | Scales sweat rate by effort. |
| `heat_activity_factor` | +2%/°C above 25 °C, cap **1.30** | Exercising in heat raises sweat rate; capped so it can't compound absurdly with the heat term. |
| `STEP_BASE` | **5000 steps** | Steps below a normal daily baseline don't imply extra sweat. |
| `MIN_PER_1K_STEPS` | **10 min/1000 steps** | Rough light-activity equivalence for the steps-only fallback. |
| `ACT_CAP` | **1500 mL** | One day's *targeted* activity replacement is bounded; ultra-endurance is out of scope (and would be unsafe to auto-target). |

> **Steps vs active minutes:** `active_minutes` (with `workoutIntensity`) is preferred and
> overrides steps. `steps` is a **fallback only** and always counts as *light* activity.
> Never sum both — that double-counts the same movement.

### 1.4 Air-quality term (AQI modifier — deliberately soft, low-confidence)
```
aqi_term = 0      if aqi is None or aqi <= 100
         = 150    if 100 < aqi <= 150
         = 300    if aqi > 150          # capped at 300
```
Honest framing: **hydration does not "fix" bad air.** Evidence that drinking more counters
PM2.5 exposure is weak. AQI's real product role is a **behavioral nudge** (move activity
indoors), surfaced in `notes`, plus a small comfort bump for respiratory dryness. This term
is flagged `confidence: 'low'` in the breakdown and is the smallest lever. When AQI is high
**and** activity is outdoor, the UI should suggest indoor activity — and the activity term
may not even apply if the user stays in.

### 1.5 Bounds / safety clamps
| Constant | Value | Why |
|---|---|---|
| `FLOOR` | **1500 mL** | A healthy adult daily minimum; prevents tiny-mass inputs from under-targeting. |
| `CEILING` | **4000 mL** | Hard safety cap. Beverage targets above ~4 L/day risk **hyponatremia / overhydration**; above this we cap and warn, never auto-escalate. |

The clamp difference is **surfaced**, not hidden: `safetyClamp = target_ml - (baseline +
heat + activity + aqi)` becomes a signed breakdown line so the displayed terms **always sum
to the target** (`§4`, asserted by the harness).

### 1.6 Honesty / medical disclaimer (must render)
This is an **estimate for healthy adults**, not medical advice. It does **not** account for
pregnancy/lactation, kidney/heart/liver disease, diuretics, fever/illness, or clinician
fluid restrictions. The engine emits a standing `notes` entry to this effect; the UI must
show it (onboarding + the "why" panel). Age/sex are optional; missing them widens the
estimate and lowers `confidence`.

---

## 2. Worked examples (sanity, not exhaustive — see `ml/test/`)

| Scenario | mass/sex/age | temp/RH | activity | AQI | baseline | heat | activity | aqi | **target** | status |
|---|---|---|---|---|---|---|---|---|---|---|
| Cool sedentary | 75 m, 35 | 15 °C / 50% | — | 30 | 2475 | 0 | 0 | 0 | **2475** | normal |
| Average day | 70 m, 40 | 22 °C / 55% | 30 min mod | 45 | 2310 | 50 | 360 | 0 | **2720** | elevated |
| Hot vigorous workout | 75 m, 35 | 34 °C / 55% | 60 min vig | 80 | 2475 | 350 | 1274 | 0 | **4000**¹ | high |
| Hazy high-AQI | 70 f, 45 | 28 °C / 40% | 20 min mod | 165 | 2194 | 200 | 254 | 300 | **2949** | elevated |
| Hot humid rest | 70 m, 30 | 33 °C / 85% | — | 60 | 2310 | 386 | 0 | 0 | **2696** | elevated |

¹ uncapped sum 4099 → clamped to 4000; `safetyClamp = −99` shown as a breakdown line so the
panel still sums correctly. Numbers are the harness's authoritative output (`§7`).

---

## 3. Input contract (units, ranges, optionality)

Mobile builds this object from weather API + AQI API + the device's activity/health source.
**Validate + clamp every field to these ranges before computing** (the engine assumes it).

| Field | Type | Unit / range | Required | Missing → |
|---|---|---|---|---|
| `bodyMassKg` | number | kg, **30–250** | **yes** | cannot compute → ask onboarding |
| `sex` | `'male'\|'female'` | — | no | `sex_factor = 0.975`, confidence ↓ |
| `ageYears` | number | yr, **13–100** | no | `age_factor = 1.0`, confidence ↓ |
| `temperatureC` | number | °C, **−30…55** | **yes** (weather) | if no weather: assume 20 °C (heat term 0), confidence ↓ |
| `humidityPct` | number | %, **0–100** | **yes** (weather) | assume 50%, confidence ↓ |
| `aqi` | number | US AQI, **0–500** | no | `aqi_term = 0` |
| `activeMinutes` | number | min, **0–600** | no¹ | use `steps` fallback, else 0 |
| `steps` | number | **0–100000** | no¹ | 0 |
| `workoutIntensity` | `'light'\|'moderate'\|'vigorous'` | — | no | `'moderate'` (ignored on steps fallback → light) |

¹ At least one activity signal is desirable but none is required (then activity term = 0).

```ts
export type Sex = 'male' | 'female';
export type WorkoutIntensity = 'light' | 'moderate' | 'vigorous';

export interface HydrationInputs {
  bodyMassKg: number;            // required, 30–250
  sex?: Sex;
  ageYears?: number;             // 13–100
  temperatureC: number;          // required, −30…55
  humidityPct: number;           // required, 0–100
  aqi?: number;                  // US AQI, 0–500
  activeMinutes?: number;        // 0–600 (preferred activity signal)
  steps?: number;                // 0–100000 (fallback only; counts as light)
  workoutIntensity?: WorkoutIntensity; // default 'moderate'
}
```

---

## 4. Output contract (what mobile + designer consume)

```ts
export type HydrationUnit = 'ml' | 'oz' | 'cup';
export type HydrationStatus = 'normal' | 'elevated' | 'high';
export type Confidence = 'high' | 'medium' | 'low';

export type HydrationTermKey =
  'baseline' | 'heat' | 'activity' | 'airQuality' | 'safetyClamp';

export interface HydrationBreakdownItem {
  key: HydrationTermKey;
  label: string;        // "Baseline", "Heat", "Activity", "Air quality", "Safety cap"
  amountMl: number;     // SIGNED; the array sums EXACTLY to targetMl
  confidence: Confidence;
  why: string;          // one-line human reason for the "why today" panel
}

export interface HydrationTarget {
  targetMl: number;                 // final, clamped daily target (mL)
  baselineMl: number;               // baseline term only — "your normal" reference
  status: HydrationStatus;          // normal | elevated | high (headline treatment)
  breakdown: HydrationBreakdownItem[]; // sums to targetMl (safetyClamp line included iff clamped)
  servingMl: number;                // default serving for nudges (personalized, §6); default 250
  confidence: Confidence;           // overall, downgraded by missing/assumed inputs
  clamped: boolean;                 // true if FLOOR/CEILING was hit
  notes: string[];                  // disclaimer + AQI/behavioral + assumption flags
}
```

**Status thresholds** (mobile-checkable, deterministic):
- `high` if `clamped` at `CEILING` **or** `targetMl >= 3500`.
- else `elevated` if `targetMl > baselineMl * 1.15`.
- else `normal`.

**Overall `confidence`:** start `high`; drop one level for each of {missing weather (temp
or RH assumed), missing both age and sex, no activity signal on a day the user logged a
workout}. `high`→`medium`→`low`, floor at `low`.

**Unit display** is a UI concern: store/compute in **mL**; convert for display
(`oz = ml/29.5735`, `cup = ml/240`). The engine never returns oz/cups.

---

## 5. Nudge logic (deterministic, explainable)

A second pure function decides *when to prompt a drink*. It is driven by **pace vs. logged
intake** plus **event spikes**, gated by **quiet hours** and **debounce**. No randomness.

```ts
export interface HydrationDayState {
  date: string;          // local YYYY-MM-DD
  targetMl: number;      // from computeTarget (§4)
  loggedMl: number;      // sum of today's logged drinks
  wakeHour: number;      // local hour, default 7 (learned, §6)
  bedHour: number;       // local hour, default 23 (learned, §6)
  servingMl: number;     // default serving (§6), default 250
  lastDrinkAt?: number;  // epoch ms of last logged drink
  lastNudgeAt?: number;  // epoch ms of last nudge shown
  recentActivityEndedAt?: number; // epoch ms a workout ended (spike trigger)
  recentActivityMl?: number;      // sweat replacement owed from that workout
  currentTempC?: number;          // for heat-spike cadence
  dndUntil?: number;     // user Do-Not-Disturb override, epoch ms
}

export type NudgeReason =
  'behindPace' | 'postActivity' | 'heatSpike' | 'gentlePacing' | 'none';

export interface NudgeDecision {
  shouldNudge: boolean;
  reason: NudgeReason;
  suggestedMl: number;       // rounded to servingMl
  message: string;           // explainable, e.g. "You're ~1 glass behind — sip 250 mL"
  nextCheckMinutes: number;  // when to re-evaluate
}
```

### 5.1 Pacing model
- **Waking window:** `[wakeHour, bedCutoff)` where `bedCutoff = bedHour - 1` (stop targeting
  intake ~1 h before bed to avoid nocturia).
- **Expected-by-now** (v1: linear, front-load is a `§8` option):
  `frac = clamp((nowHour - wakeHour) / (bedCutoff - wakeHour), 0, 1)`,
  `expectedMl = targetMl * frac`.
- **Deficit:** `deficit = expectedMl - loggedMl`.

### 5.2 Decision order (first match wins)
1. **Quiet hours / DND →** `none`, `shouldNudge=false`. True when `nowHour < wakeHour`,
   `nowHour >= bedHour`, or `now < dndUntil`. `nextCheck` = minutes until `wakeHour`.
2. **Debounce →** suppress (`none`) if `now - lastNudgeAt < MIN_NUDGE_GAP_MIN` (45) **or**
   `now - lastDrinkAt < JUST_DRANK_MIN` (20). Re-check after the remaining gap.
3. **postActivity spike →** if `recentActivityEndedAt` within the last 90 min and
   `recentActivityMl` not yet replaced → `shouldNudge=true`, `suggestedMl =
   roundToServing(min(recentActivityMl, ACT_CAP_PER_NUDGE))`, `nextCheck = 30`.
4. **heatSpike cadence →** if `currentTempC >= 30`, lower the deficit threshold to
   `0.5*servingMl` and set `nextCheck = 45`; otherwise threshold = `servingMl`,
   `nextCheck = 90`.
5. **behindPace →** if `deficit >= threshold` → `shouldNudge=true`, `suggestedMl =
   roundToServing(deficit)`, `reason='behindPace'`.
6. **gentlePacing →** if on/ahead of pace but it's been `>= GENTLE_GAP_MIN` (120) since the
   last drink and we're mid-window → a soft single-serving nudge.
7. else `none`, `shouldNudge=false`, `nextCheck = 60`.

| Nudge constant | Value |
|---|---|
| `MIN_NUDGE_GAP_MIN` | 45 |
| `JUST_DRANK_MIN` | 20 |
| `POST_ACTIVITY_WINDOW_MIN` | 90 |
| `HEAT_SPIKE_TEMP_C` | 30 |
| `GENTLE_GAP_MIN` | 120 |
| `ACT_CAP_PER_NUDGE` | 750 mL |
| default `servingMl` | 250 mL |

### 5.3 Adapting to logged intake
Every logged drink updates `loggedMl` and `lastDrinkAt`, which immediately changes `deficit`
and silences nudges when **ahead of pace** (deficit < 0). Logging a workout sets
`recentActivityEndedAt`/`recentActivityMl` (the activity term re-computed for that bout),
which triggers the post-activity spike. All explainable: the `message` always states the
reason ("behind pace", "after your workout", "hot out — sip more").

---

## 6. Personalization (on-device state, no server)

All learning is **local, deterministic, inspectable, resettable** — same philosophy as the
Energy Predictor's calibration layer. Stored in the app's local store, never synced.

```ts
export interface HydrationProfile {
  preferredUnit: HydrationUnit;        // learned from how the user logs / sets
  typicalServingMl: number;            // median of logged drink sizes → servingMl
  typicalWakeHour: number;             // EMA of first-interaction / first-log hour
  typicalBedHour: number;              // EMA of last-log hour
  intakeEmaMl: number;                 // EMA of actual daily intake (context, not the target)
  responsiveness: number;              // 0..1 EMA: P(drink logged within 30m of a nudge)
  manualTargetMl?: number;             // explicit user override (wins, still clamped FLOOR..CEILING)
}
```

- **Serving size:** `typicalServingMl ← median(logged drink sizes)` → feeds `servingMl` so
  nudges suggest realistic amounts (a 330 mL bottle user isn't told "sip 250").
- **Preferred unit:** remembered from logging/settings; display only (engine stays mL).
- **Wake/bed hours:** EMA of first/last daily interaction → personal pacing window (`§5.1`),
  better than the 07:00–23:00 default.
- **Responsiveness → nudge fatigue control:** EMA of "did a drink follow a nudge within
  30 min." If low (user ignores nudges), **increase `MIN_NUDGE_GAP_MIN`** (back off, up to
  ~90 min) so we don't nag; if high, allow the default cadence. Pure UX, never changes the
  *target*.
- **`intakeEmaMl`:** tracked for the "you usually drink X" context line only. It is **not**
  fed back into the physiological target — the formula stays the source of truth so the
  engine can't drift into rewarding chronic under-drinking. (A future, safety-bounded
  "comfort calibration" is a `§8` option, capped to ±10% and never below `FLOOR`.)
- **Manual override:** if the user sets their own goal, it wins (still clamped to
  `FLOOR..CEILING`), and the breakdown shows a `manualOverride`-style note.

No on-device training, no model — this is the only "learning" and it is arithmetic.

---

## 7. Validation harness (`ml/test/`) — NO `.pte`

Same deliverable pattern as Overwhelm/Energy, minus the model. The Python harness is the
**reference implementation** of `§1` — the TS must match it number-for-number.

```
ml/test/hydration_eval.py          reference engine + scenario assertions + report writer
ml/test/hydration_scenarios.json   representative scenarios with expected ranges/status
ml/test/HYDRATION_REPORT_TEMPLATE.md  the report it fills in
```

`python ml/test/hydration_eval.py` (stdlib only — no executorch, no numpy) runs all
scenarios and asserts, per the contract:
- **Range:** `FLOOR <= targetMl <= CEILING` for every scenario.
- **Breakdown sums:** `sum(breakdown.amountMl) == targetMl` (within 0.5 mL) — the "why"
  panel is guaranteed to add up.
- **Per-scenario bounds:** target lands in each scenario's expected `[min_ml, max_ml]` and
  `status` matches.
- **Relational sanity:** hot workout > cool sedentary; hot day > cool day (same person);
  workout day > rest day; higher mass > lower mass; high-AQI adds a (small, bounded) bump.
- **Nudge logic:** quiet-hours suppress; behind-pace fires; ahead-of-pace stays silent;
  post-activity spike fires once; debounce holds.

It then writes `hydration_report.md` from the template (verdict + per-scenario table). There
is **no `--pte` flag and no GPU export script** — and that is correct for this feature.

---

## 8. Open items (non-blocking)

- **Front-loaded pacing curve** (more intake by midday) vs. the v1 linear pace.
- **Safety-bounded comfort calibration** (±10% from `intakeEmaMl`, never below `FLOOR`) once
  there's enough consented on-device history to trust it.
- **Indoor/outdoor activity flag** so high-AQI can *remove* the outdoor activity term, not
  just warn.
- **Illness/fever, pregnancy, clinical-restriction modes** — explicitly out of scope for v1;
  need a medical-review gate before we ship any of them.
- **Wearable sweat/skin-temp signals** (if a future Glasses/watch source exists) to replace
  the ambient-heat proxy with measured loss.

---

## 9. File map (what ships where)

```
docs/hydration-engine-contract.md          ← this file (authoritative)
ml/test/hydration_eval.py                  reference engine + asserts + report writer
ml/test/hydration_scenarios.json           representative scenarios + expected bounds
ml/test/HYDRATION_REPORT_TEMPLATE.md       report template
mobile/src/features/hydration/             CANONICAL TS engine (computeTarget, decideNudge,
                                           HydrationProfile) — coordinate with CTO
```
No `ml/models/hydration/`, no `.pte`, no `ml/export/` script — by design (`§0`).

---

## 10. The ONE thing the CTO must confirm (blocking)

Unlike Overwhelm/Energy there is **no ExecuTorch version pin** — there is no model.
Instead the CTO confirms **where the engine lives and that there is a single source of
truth for the constants**:

➡️ **CTO action:**
1. Confirm the canonical engine lives in **`mobile/src/features/hydration/`** as pure TS
   (no `.pte`, no native module) and the constants table (`§1`) exists in exactly **one**
   frozen object that both `computeTarget` and `decideNudge` import.
2. Confirm `HydrationProfile` personalization state (`§6`) persists in the **local
   encrypted store only**, never synced (golden rule).
3. Confirm the **medical disclaimer** (`§1.6`) renders in onboarding and the "why" panel —
   product/legal gate before demo.
4. Confirm the TS port is checked against the Python reference (`§7`) in CI (or pre-demo)
   so the two never drift.

Everything else in this contract is locked pending that confirmation.

---

## 11. ExecuTorch model — OWNER DIRECTIVE (supersedes §0's "no model" call)

Per the owner's hard rule — **privacy-absolute, every AI feature runs on-device via
ExecuTorch** — Hydration now ships an ExecuTorch `.pte` model. The deterministic engine
(`§1`–`§7`) is **retained**, now serving three roles: **(a)** the training-data generator,
**(b)** the device-side **safety clamp**, **(c)** the **offline fallback** when the model
isn't loaded.

- **Model:** tiny regression MLP, `8 → 32 → 32 → 4`, Softplus output, ~2k params, **<50 KB**,
  fp32, XNNPACK (mirrors Energy Predictor). Exports cleanly to ExecuTorch v0.6.0.
- **Pin:** `.pte` exported against **ExecuTorch v0.6.0** to match `react-native-executorch@0.4.8`
  (same pin as Overwhelm/Energy — this REPLACES §10's "no version pin"). See
  [[lifepilot-executorch-version-pin]].
- **Input** `float32 [1, 8]` (normalized): `[body_mass_kg, is_female, age_years,
  temperature_c, humidity_pct, aqi, active_minutes, workout_intensity]`. Frozen scaler ships
  in `manifest.json` (single source of truth), applied identically in TS.
- **Output** `float32 [1, 4]` = the **named components** `[baseline_ml, heat_ml, activity_ml,
  aqi_ml]`. The "why today" breakdown is preserved — the model learned the physiology
  decomposition, so the panel binds to these exactly as before. Device **sums → target**,
  then **clamps to [1500, 4000] mL** (safety enforced regardless of model output).
- **Loading:** generic ExecuTorch module path (NOT `useLLM`), same as Energy Predictor. Tiny
  model → `require()`-bundled.
- **Export/eval:** `ml/export/export_hydration.py` (AMD ROCm, v0.6.0); the existing
  `ml/test/hydration_eval.py` engine is the reference the model approximates and the fallback
  the app uses offline.
- **`HydrationTarget` output contract (§8) is unchanged** — mobile/designer code is unaffected;
  only the internal producer changed (model instead of formula).

## 12. The network question — DUAL MODE (privacy by default)

Hydration is the only feature that *can* touch the network (weather/AQI is external). Per the
owner's "do not expose users by any means," it ships **two modes, offline by default**:

- **Mode A — Fully offline (DEFAULT):** the user sets a home city/climate once (or enters
  conditions manually). **Zero network, ever.** Nothing about the user — not even a coarse
  area — leaves the device. The privacy-maximal path and the default.
- **Mode B — Opt-in live weather:** only if the user explicitly enables it. Coarse area only
  (0.1° grid, ~11 km), **no identity, no precise location, no health/intake data** in the
  request; provider with no per-user credential; offline fallback to last-known/manual. One
  sanctioned egress, isolated to `weatherSource.ts` (the ESLint network-ban's single allowlist).

The weather/AQI values (however obtained) feed the §11 model identically. Mode is a user
setting; the CTO architecture implements both, defaulting to Mode A.
See [[privacy-absolute-executorch-everywhere]].
