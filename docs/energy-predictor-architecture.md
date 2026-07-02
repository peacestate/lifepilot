# Energy Predictor — On-Device Time-Series Integration Outline

Owner: CTO (lifepilot-cto)
Status: Draft for build — the Mobile Developer builds against this; the AIML Engineer delivers against the contract in §5.
Date: 2026-06-26

This is the technical spec the RN dev builds against for LifePilot's second feature, **Energy Predictor**: on-device time-series/regression model predicts the user's daily energy (and a short forecast) from **sleep + activity + phone usage**. Fully offline. Same golden rule as Overwhelm.

**Golden rule, restated as an engineering constraint:** there is no network call anywhere in the data or inference path. HealthKit/Health Connect data, derived features, the model, and the predictions all stay on device. This is enforced in code (§4), not just by policy.

**Stack is reused, not re-chosen.** We keep the locked Overwhelm stack: Expo SDK 53, React Native New Architecture, `react-native-executorch@0.4.8` (bundles the ExecuTorch v0.6.0 runtime), model provisioned via `expo-file-system`. New for this feature: health-data ingestion libraries (§1) and a **different ExecuTorch inference path** (§2) because this is a numeric model, not an LLM.

---

## 0. Decision summary (TL;DR)

| Decision | Choice | Why |
|---|---|---|
| Inference API | **Generic ExecuTorch module (`useExecutorchModule` / `ExecutorchModule`), NOT `useLLM`** | This is a small numeric regression/sequence model: float tensor in → float tensor out. No tokenizer, no chat template, no token streaming. `useLLM` is the wrong abstraction (see §2.1). |
| Model type | **Small time-series regressor** (TCN / 1D-CNN or tiny GRU, or even gradient-boosted-to-tensor), exported to `.pte` against ExecuTorch v0.6.0 | Tiny (KB–low MB), fast (<50 ms), CPU/XNNPACK is plenty. None of the 1B-LLM size/RAM/latency problems from Overwhelm apply here. |
| Model delivery | **Bundle via `require()` / `expo-asset`** (model is small) — no first-run copy gymnastics | The ~512 MB `require()` ceiling that forced Overwhelm's adb-push seam is irrelevant; a TCN `.pte` is tiny. Still: zero network, ships in the binary, airplane-mode from install. |
| Health ingestion | **`react-native-health` (iOS HealthKit) + `react-native-health-connect` (Android Health Connect)** | The de-facto RN libraries; both read from the OS's **on-device** health store. We read locally and never forward. |
| Phone usage | **Android: `UsageStatsManager` (PACKAGE_USAGE_STATS). iOS: effectively unavailable** without the Screen Time/DeviceActivity entitlement | Asymmetric platform reality (§1.3). The feature vector must degrade gracefully when phone-usage is absent. |
| Local storage | **On-device only** — daily feature rows in SQLite/MMKV/`expo-file-system`; raw health samples are read-through, not warehoused | Smallest footprint that still lets us personalize (§3). Nothing syncs. |
| Personalization | **Cold-start with a generic model + an on-device residual/affine adjustment layer**, not on-device backprop fine-tuning | Realistic with ExecuTorch today (inference-only runtime). True on-device training is not a v1 capability (§3). |
| TS-facing API | A thin **`EnergyService` + `useEnergyPredictor` hook** under `mobile/src/features/energy/` | Mirrors the Overwhelm pattern: screen stays dumb, all ExecuTorch/health calls isolated and reviewable. |

---

## 1. Data ingestion (on-device only)

All inputs come from OS-mediated, on-device stores. We read them, derive a feature vector, and keep both **on the device**. None of it is uploaded — ever.

### 1.1 Sleep + activity — iOS (HealthKit via `react-native-health`)
- Library: `react-native-health`. Reads from **HealthKit**, Apple's on-device health database.
- Data types we request (read-only): `SleepAnalysis` (asleep duration, in-bed, stages where available), `StepCount`, `ActiveEnergyBurned`, `DistanceWalkingRunning`, `HeartRate` / `RestingHeartRate` (optional, improves the signal), `AppleExerciseTime`.
- Setup: `NSHealthShareUsageDescription` in `Info.plist`, the HealthKit entitlement, and a runtime authorization prompt. HealthKit only grants **read**; we never request write.
- Privacy note: HealthKit data never leaves the device through this library — it hands us samples in-process. The off-device risk is entirely *our* code, which is why §4 bans network in this feature.

### 1.2 Sleep + activity — Android (Health Connect via `react-native-health-connect`)
- Library: `react-native-health-connect` (matinzd). Reads from **Health Connect**, Google's on-device health store (built into Android 14+; an installable APK on 13).
- Record types we request (read-only): `SleepSession`, `Steps`, `ActiveCaloriesBurned`, `TotalCaloriesBurned`, `ExerciseSession`, `HeartRate`/`RestingHeartRate` (optional).
- Setup:
  - Declare permissions in the `health_permissions` string-array resource, e.g. `androidx.health.permission.SleepSession.READ`, `androidx.health.permission.Steps.READ`, `androidx.health.permission.ActiveCaloriesBurned.READ`. (Missing manifest declarations are the #1 cause of the `READ_SLEEP SecurityException`.)
  - Runtime: `initialize()` → `requestPermission([{ accessType:'read', recordType:'SleepSession' }, ...])` → `readRecords('SleepSession', { timeRangeFilter: { operator:'between', startTime, endTime } })`.
  - Production gate: Google requires a data-use declaration form before a Health-Connect app ships. We state plainly: **read-only, on-device inference, no transmission.**
- Privacy note: Health Connect stores data locally and gates each record type behind explicit user permission. We read locally and stop there.

### 1.3 Phone-usage signals (asymmetric — design for absence)
- **Android:** `UsageStatsManager` (system `PACKAGE_USAGE_STATS` "special access", granted via a Settings deep-link, not a normal runtime permission). Gives screen-on time, per-app foreground time, unlock counts (via `UsageEvents`). Needs a thin native module or an existing community wrapper; treat as a small native-bridge task.
- **iOS:** there is **no general API** for an app to read its own user's Screen Time. The Screen Time / `DeviceActivity` (FamilyControls) framework requires a special Apple entitlement intended for parental-controls apps and does not expose raw usage to us. **Assume phone-usage is unavailable on iOS for v1.**
- **Consequence:** phone-usage is an **optional feature group**. The feature vector (§2.3) carries an availability mask so the model behaves on iOS (usage-absent) and on Android (usage-present). The AIML engineer must train/handle the usage-missing case (zero-fill + mask, or a usage-free model variant). Flagged as an open item (§5.3).

### 1.4 Local storage & the hard rule
- We compute one **daily feature row** per day (sleep hours, sleep regularity, steps, active energy, exercise minutes, resting HR delta, usage minutes/unlocks if available, plus day-of-week/cyclical encodings). Raw HealthKit/Health Connect samples are **read-through**: aggregated into the daily row and not warehoused.
- Persist daily rows on-device only — SQLite (`expo-sqlite`) or MMKV or a JSON file in `expo-file-system` documentDirectory. This local history is what powers the look-back window (§2.3) and personalization (§3).
- **Hard rule:** no row, no raw sample, and no prediction is ever written to a network sink, analytics, or crash payload. The on-device DB never syncs. Airplane mode is a supported, tested operating mode (§4).

---

## 2. Inference path (the non-LLM ExecuTorch path)

### 2.1 Why `useLLM` does NOT apply here
`useLLM` is built for autoregressive text models: it owns a tokenizer (`tokenizerSource` + `tokenizerConfigSource`), applies a chat template, samples tokens, and streams decoded text into `response`. Energy Predictor has **no text, no tokenizer, no sampling, no streaming** — it's a single forward pass over a fixed-shape numeric tensor returning a fixed-shape numeric tensor. Forcing it through `useLLM` is impossible (there's no tokenizer to give it) and conceptually wrong.

The correct path is `react-native-executorch`'s **generic module API**: `ExecutorchModule` (imperative) or `useExecutorchModule` (the React hook). This exposes the raw ExecuTorch `Module.forward(...)` over tensors — exactly the numeric-in/numeric-out shape we need.

### 2.2 The generic-module call shape
In the current `react-native-executorch` generic API, `forward` works with **`TensorPtr`** objects:

- `dataPtr` — the data buffer: a `TypedArray` (e.g. `Float32Array`) or `ArrayBuffer`.
- `sizes` — the tensor shape, e.g. `[1, T, F]` (batch, look-back days, features).
- `scalarType` — a `ScalarType` enum, e.g. `ScalarType.FLOAT` for a float32-exported model.

Load + run looks like (imperative form):
```ts
const model = new ExecutorchModule();
await model.load(/* local .pte source */);
const out = await model.forward([{ dataPtr: x, sizes: [1, T, F], scalarType: ScalarType.FLOAT }]);
// out: TensorPtr[]; read out[0].dataPtr as a Float32Array view, shape = out[0].sizes
model.delete(); // release native resources
```
The hook form (`useExecutorchModule`) wraps this with `isReady`, load-progress, and automatic cleanup — preferred for the screen lifecycle, same way `useLLM` is used in Overwhelm.

> ⚠️ **API ASSUMPTION — CTO must verify on the pinned 0.4.8 build (same rigor as the Overwhelm A1–A4 notes).** The generic `forward` signature changed across versions: **0.3.x** used `forward(input, shape)` with separate args; the **current** API uses the `TensorPtr` object above; a **later** API moves to static factories (`Module.fromCustomModel(...)`). 0.4.8 sits in the `TensorPtr` era, but the exact `load()` vs constructor shape, the `ScalarType` enum members, and whether the hook is named `useExecutorchModule`/`useModule` must be confirmed against the installed 0.4.8 typings before the mobile dev wires real tensors. Isolate the single call site (see `EnergyModel.ts` below) so a version delta is a one-spot change — this is the same containment strategy used in `useOverwhelmManager.ts`.

### 2.3 Input / output types (the contract the mobile dev codes to)
Feature folder: `mobile/src/features/energy/`.

```ts
// energy.types.ts

/** One day's derived, normalized-on-device features (order is contract-fixed, §5). */
export type DailyFeatures = {
  date: string;                 // ISO yyyy-mm-dd (local)
  sleepHours: number;           // total asleep duration
  sleepRegularity: number;      // e.g. stddev of sleep-midpoint over window, or 0..1 score
  steps: number;
  activeEnergyKcal: number;
  exerciseMinutes: number;
  restingHrDelta?: number;      // vs personal baseline; optional
  usageMinutes?: number;        // Android only; undefined on iOS
  unlockCount?: number;         // Android only
  // cyclical day-of-week encoding added at vectorization time (sin/cos)
};

/** The fixed-shape model input: T look-back days x F features, plus an availability mask. */
export type EnergyFeatureVector = {
  data: Float32Array;           // length = T * F, row-major [day][feature]
  mask: Float32Array;           // length = T * F, 1 = present, 0 = imputed/missing
  shape: [1, number, number];   // [1, T, F]
};

/** The model output the UI renders. */
export type EnergyPrediction = {
  today: number;                // predicted energy for today, normalized score (see units, §5)
  forecast: { date: string; value: number; confidence?: number }[]; // short horizon, e.g. next 1–3 days
  generatedAt: string;          // ISO timestamp, local
  basis: 'generic' | 'personalized'; // which model path produced it (§3)
};

export type EnergyState = 'loading' | 'no-permission' | 'insufficient-data' | 'ready' | 'predicting' | 'error';

export type EnergyError = { kind: 'model_load' | 'inference' | 'health_permission' | 'data'; message: string };
```

- **Input shape:** `[1, T, F]` — `T` = look-back window (decide with AIML; e.g. 7 or 14 days), `F` = feature count (§5). Row-major `Float32Array`. Normalization is applied **on device before** the tensor is built, using stats baked into the model contract (§5.1) — never learned at runtime in a way that diverges from training.
- **Output shape:** AIML's call, but the UI needs at minimum a scalar "today" value plus a short forecast vector. Define as `[1, H]` (H = horizon points) or `[1, H, 2]` if confidence is emitted. Locked in §5.
- **Units:** energy is a normalized score (e.g. 0–100) the designer maps to a friendly scale; agree the exact range with AIML + designer (§5.4) so the chart axis is stable.

### 2.4 TS-facing service + hook (what the screen calls)
```
mobile/src/features/energy/
├─ EnergyModel.ts          # ISOLATED ExecuTorch generic-module call site (TensorPtr in/out)
├─ EnergyService.ts        # pure: health rows → DailyFeatures → normalized EnergyFeatureVector; output tensor → EnergyPrediction
├─ healthSources.ts        # iOS HealthKit + Android Health Connect read adapters (platform-split)
├─ usageSource.android.ts  # UsageStatsManager bridge (Android only); .ios.ts returns "unavailable"
├─ featureStore.ts         # on-device daily-row persistence (SQLite/MMKV) — never networks
├─ useEnergyPredictor.ts   # RN hook: permissions → ingest → vectorize → forward → EnergyPrediction
├─ energy.types.ts
├─ energy.normalization.json   # AIML deliverable: per-feature mean/std (or min/max) + feature order
└─ __tests__/              # vectorizer + denorm tests against AIML fixtures
mobile/src/models/energy/
├─ energy-predictor.pte    # AIML deliverable (small; require()-able)
└─ manifest.json           # {name, version, executorch_version, T, F, H, sha256, bytes}
```

```ts
// useEnergyPredictor.ts — the only thing the screen imports
export function useEnergyPredictor(): {
  state: EnergyState;
  prediction: EnergyPrediction | null;
  error: EnergyError | null;
  hasUsageSignals: boolean;          // false on iOS; lets the UI hide usage-derived copy
  requestPermissions(): Promise<boolean>;
  refresh(): Promise<void>;          // re-ingest + re-predict (cheap; <50 ms inference)
};
```

- **Pure core is unit-testable without a device:** `EnergyService.vectorize(rows)` and `EnergyService.toPrediction(tensor)` are pure functions tested against AIML fixtures, exactly like `OverwhelmService` parse tests.
- The screen never imports `react-native-executorch`, `react-native-health`, or `react-native-health-connect` directly — only the hook.

### 2.5 Threading / performance
- A small TCN/GRU forward is **sub-50 ms on CPU/XNNPACK**; no NPU needed, no warm-up theater required (we may still do one throwaway forward to prime allocators).
- The expensive part is **health ingestion**, not inference. Health Connect / HealthKit reads are async OS calls; run them off the render path and cache the daily rows. Predict once per day (or on explicit `refresh()`), not on every render.
- Single module instance, disposed on unmount (`model.delete()` / hook cleanup). Unlike the LLM, memory pressure is a non-issue.
- This means **Energy Predictor and Overwhelm Manager can coexist** — the "one LLM instance app-wide" constraint (Overwhelm §6.6) does not bind the generic module, but keep each feature's module instance scoped to its own screen.

---

## 3. Personalization (cold-start → personalized)

**Reality check on ExecuTorch:** the on-device runtime that ships with `react-native-executorch` is **inference-only**. There is no exposed autograd/optimizer/training loop in the RN binding. So "on-device fine-tuning" in the backprop sense is **not** a v1 capability. We design around that.

**Decision: ship a generic model + an on-device residual/affine adjustment layer; revisit periodic re-fit later.**

Three options considered:
1. **On-device gradient fine-tuning** — rejected for v1. The RN ExecuTorch runtime doesn't expose training; ExecuTorch's experimental on-device training APIs aren't surfaced by the library and aren't production-safe for us. Months of native work for marginal gain.
2. **Lightweight on-device adjustment layer (CHOSEN).** The generic `.pte` outputs a population-level prediction; we apply a cheap, on-device **personal correction** computed from the user's own recent error:
   - Track the user's actual-vs-predicted residual where ground truth exists (e.g. an optional "how was your energy today?" tap, or a proxy from activity), and learn a simple **affine correction** (bias + scale, or a small per-feature linear adjustment) by closed-form least squares / running averages — no backprop, runs in JS, fully on device.
   - This is the realistic "personalizes over days" story: cold-start = pure generic model (`basis: 'generic'`); after N days of personal data the correction kicks in (`basis: 'personalized'`). The `basis` field lets the UI honestly communicate this.
3. **Periodic re-fit** — keep as a **later, opt-in** path: if we ever want a real per-user model refresh, it happens off the critical path. Any such re-fit must stay **on-device** (no uploading features to a server to train) or it breaks the golden rule. Deferred; not v1.

**Coordinate with the AIML engineer — they must decide/deliver:**
- The generic model architecture + look-back `T` + horizon `H` + feature set `F` (drives §2.3 and §5).
- The normalization stats (`energy.normalization.json`) — baked from training, applied identically on device.
- Whether personalization is the **affine correction** above (mobile implements, AIML specifies the form + how residual ground truth is defined) **or** a per-user re-fit they own later.
- The **usage-missing** strategy (iOS): zero-fill+mask vs. a separate usage-free model variant.

---

## 4. The privacy guarantee, in code

Same rigor as Overwhelm §5. This feature touches **health data**, so the bar is higher, not lower.

1. **No network in the data or inference path.** `EnergyService`, `EnergyModel`, `healthSources`, `usageSource`, `featureStore`, and `useEnergyPredictor` import **zero** networking modules (no `fetch`, `XMLHttpRequest`, `axios`, analytics SDKs). Enforced by an ESLint `no-restricted-imports`/`no-restricted-globals` rule **scoped to `mobile/src/features/energy/**`** (extend the existing `.eslintrc.overwhelm.js` pattern → add an `energy` config or a shared `feature-network-ban` config covering both). CI fails on violation.
2. **Health data is read-through, never uploaded.** HealthKit/Health Connect samples are aggregated into daily rows on device and the raw samples dropped. The daily-row store and predictions live only in app-private storage; no row is serialized into any network call. A grep/lint check asserts no `http(s)://` literal in this feature.
3. **No telemetry of health content.** Daily features, residuals, and predictions are never logged off-device or attached to crash reports. Crash reporters (if any) must scrub `features`, `prediction`, and `residual` fields.
4. **Airplane-mode is a test, not a hope.** Acceptance test: airplane mode → grant health permission → ingest → predict end-to-end → must produce a prediction. Required pre-demo gate.
5. **Network-access audit.** Run a Health-Connect/HealthKit ingestion + a prediction through a network monitor (mitmproxy / Android Network Inspector) and confirm **zero outbound requests**. Attached to CTO pre-demo sign-off.
6. **Permissions handling is explicit and honest.**
   - iOS: `NSHealthShareUsageDescription` copy states on-device-only use; request read-only scopes.
   - Android: declare only the `androidx.health.permission.*.READ` types we use; Google data-use form states read-only / on-device / no transmission. `PACKAGE_USAGE_STATS` is an optional special-access ask, surfaced only on Android and only if the user opts into usage-based accuracy.
   - The UI must handle **denied / partial** permission gracefully (`state: 'no-permission'`) and the **not-enough-history** case (`state: 'insufficient-data'`) — never crash, never silently send anything.
7. **Backend stays out.** FastAPI is not referenced anywhere in this feature. No optional CDN in the user-data path.

CTO sign-off (required before any demo), in order: **(a) privacy** — lint + airplane-mode + network audit + permission-deny path; **(b) correctness** — vectorizer matches AIML fixtures, denorm matches, missing-usage path works on iOS; **(c) performance** — ingestion is off the render path, forward < target latency.

---

## 5. Contract & open items

### 5.1 Contract: AIML `.pte` deliverable → mobile integration
The AIML engineer (`lifepilot-aiml-engineer`) delivers into `mobile/src/models/energy/` (source of truth; also `ml/models/energy/`):

| Artifact | Requirement |
|---|---|
| `energy-predictor.pte` | Small time-series regressor, **exported with ExecuTorch v0.6.0** (matches the pinned `react-native-executorch@0.4.8` runtime — same pin as Overwhelm). XNNPACK/CPU backend stated. |
| `energy.normalization.json` | Per-feature **mean/std** (or min/max), **the canonical feature order**, and the look-back `T`, feature count `F`, horizon `H`. Mobile applies these identically before building the tensor. |
| `manifest.json` | `{ name, version, executorch_version, inputShape:[1,T,F], outputShape, scalarType, sha256, bytes }`. Loader reads this; nothing hard-coded. |
| Fixture set | A handful of `(input feature rows → expected normalized tensor → expected model output → expected denormalized prediction)` examples. Become the mobile vectorizer/denorm unit-test fixtures (the analog of Overwhelm's 20-task report). |

**Behavioral contract both sides sign:**
- **Input:** float32 tensor `[1, T, F]`, row-major `[day][feature]`, feature order fixed by `energy.normalization.json`, normalized on device using the supplied stats. Missing features (iOS usage) are imputed per the agreed strategy (§3) and flagged in the `mask`.
- **Output:** float32 tensor of locked shape (`[1, H]` or `[1, H, 2]` with confidence). Mobile denormalizes to the `EnergyPrediction` units (§5.4). AIML owns model quality; mobile owns tensor marshalling + denorm.
- **Version pin:** identical discipline to Overwhelm §6 — `.pte` export version must equal the runtime bundled by the pinned `react-native-executorch`. Do not bump `executorch_version` without re-pinning. Mismatched versions = "model won't load."

### 5.2 Contract: mobile ↔ designer (forecast visualization)
The designer needs a **stable output shape to chart**. Deliver to them:
- `today`: a single scalar in a fixed range (§5.4) → the hero number / ring.
- `forecast[]`: an ordered list of `{ date, value, confidence? }` over horizon `H` → a small line/area forecast. Confidence (if AIML emits it) → a band; if not emitted, the design must not imply false precision.
- `basis`: `'generic' | 'personalized'` → honest copy ("learning your patterns" vs "tuned to you").
- States the UI must represent: `loading`, `no-permission` (with a calm permission-rationale screen), `insufficient-data` (need N days of history first), `ready`, `predicting`, `error`. Designer owns copy/visuals in `design/energy/`; this list is the state contract.

### 5.3 Permissions / platform caveats (for everyone)
- **Phone usage is Android-only** for v1; iOS predictions run usage-free. The forecast quality may differ by platform — designer/AIML must be OK with that, and copy must not promise usage-based insight on iOS.
- **Health Connect availability:** Android 14+ built-in; Android 13 needs the Health Connect app installed — handle the "Health Connect not available" path.
- **Google data-use declaration** required before Android release. **Apple HealthKit review** scrutinizes health apps — our on-device, no-transmission posture is the strongest possible review story; document it.
- **Cold-start data gap:** the model needs `T` days of history. First-run users hit `insufficient-data` until the look-back fills (or AIML supplies a short-window fallback). Decide with AIML.

### 5.4 Open questions / risks
1. **Exact `forward` API on 0.4.8** (blocking the real wiring). Confirm `useExecutorchModule`/`ExecutorchModule` names, `TensorPtr` vs `(input, shape)` signature, and `ScalarType` members against the installed typings. Isolated in `EnergyModel.ts` so it's a one-spot fix. **CTO to verify before mobile wires tensors.**
2. **Feature set, `T`, `H`, output shape, and units** — AIML must lock these; everything in §2.3/§5.1 depends on them. **Blocking for the real model; mobile can build against a mock `EnergyModel` in parallel.**
3. **Usage-missing strategy (iOS)** — zero-fill+mask vs. usage-free model variant. AIML decides.
4. **Personalization form** — affine correction (mobile implements) vs. AIML-owned re-fit. Confirm residual ground-truth source (self-report tap vs proxy). AIML + designer.
5. **Ground-truth / labels** — what is "energy" trained against? If there's no on-device label, personalization (§3) needs a signal (optional daily self-report). Product + AIML decision; affects the UI.
6. **App size** — non-issue here (small model); explicitly the opposite of Overwhelm's top risk.

### 5.5 Build sequencing / blocking dependencies
1. **CTO:** confirm the 0.4.8 generic-module API (§5.4 Q1) + reuse the version pin. → unblocks real inference wiring.
2. **AIML:** lock feature schema + `T`/`F`/`H` + output shape + normalization + usage-missing strategy; deliver `.pte` + `energy.normalization.json` + fixtures. → unblocks real prediction.
3. **Mobile:** build `useEnergyPredictor` + health adapters + vectorizer against this spec; start immediately with a **mock `EnergyModel`** (returns a plausible `EnergyPrediction`) so the screen, permissions flow, and ingestion proceed before the `.pte` lands.
4. **Designer:** forecast visualization + state-table copy in `design/energy/`, against §5.2.
5. **CTO:** code review + privacy/correctness/perf sign-off before demo.

---

## References
- React Native ExecuTorch — generic module (`ExecutorchModule` / `useExecutorchModule`, `TensorPtr`, `ScalarType`): https://docs.swmansion.com/react-native-executorch/docs/typescript-api/executorch-bindings/ExecutorchModule
- Running your own (non-LLM) models: https://docs.swmansion.com/react-native-executorch (Module API section)
- `react-native-health` (iOS HealthKit): https://github.com/agencyenterprise/react-native-health
- `react-native-health-connect` (Android Health Connect): https://matinzd.github.io/react-native-health-connect/
- Android UsageStatsManager: https://developer.android.com/reference/android/app/usage/UsageStatsManager
- Overwhelm precedent (stack, pin, privacy pattern): `docs/overwhelm-executorch-integration.md`, `docs/overwhelm-model-contract.md`
