# Hydration Tracker — Weather + AQI + Activity Integration Outline

Owner: CTO (lifepilot-cto)
Status: Draft for build — the Mobile Developer builds against this; the AIML Engineer delivers the hydration engine spec against the contract in §5.
Date: 2026-06-26

This is the technical spec the RN dev builds against for LifePilot's third feature, **Hydration Tracker**: combine live **weather** + **air quality (AQI)** + the user's **activity** into a personalized daily water target, and fire **real-time local nudges** to drink. Same golden rule as Overwhelm and Energy — with one deliberate, scoped exception (§0, §4).

**Golden rule, restated as an engineering constraint:** no *user data* ever leaves the device. The user's activity, body params, intake logs, and the computed hydration target/recommendation are computed and stored **on device only**. This is the first feature that legitimately needs the network — for *environmental* data (weather/AQI) that is not user data — and we treat that one call as a tightly-fenced, auditable exception, not a loosening of the rule.

**Stack is reused, not re-chosen.** Expo SDK 53, React Native New Architecture, feature-folder convention (`mobile/src/features/<feature>/` with a pure service + a hook), the ESLint network-ban pattern, and the airplane-mode acceptance test all carry over from `docs/overwhelm-executorch-integration.md` and `docs/energy-predictor-architecture.md`. **New for this feature:** outbound HTTP (weather/AQI only), `expo-location` (coarse), and `expo-notifications` (local scheduling). Health ingestion (`react-native-health` / `react-native-health-connect`) is **reused directly from Energy Predictor** — Hydration consumes the same on-device activity rows.

---

## 0. Decision summary (TL;DR)

| Decision | Choice | Why |
|---|---|---|
| Weather + AQI provider | **Open-Meteo** (`api.open-meteo.com/v1/forecast` + `air-quality-api.open-meteo.com/v1/air-quality`) | Free, **no API key**, no signup, JSON over plain GET, CC-BY 4.0. AQI data is Copernicus/CAMS-backed; supports `us_aqi`/`european_aqi`, `temperature_2m`, `relative_humidity_2m`, `apparent_temperature`. No key = nothing to leak, no per-user account tying requests to a person. Fallback provider: OpenWeather (One Call + Air Pollution) if we need a paid SLA later. |
| **Location strategy (the key tension)** | **(c) coarse grid-rounding on-device + (a) direct device fetch** — request **low-accuracy / reduced** location via `expo-location`, **round to ~0.1° (~11 km) grid on-device**, send only the rounded lat/lon to Open-Meteo. **No** backend proxy for v1. | This is the minimum-exposure path that still works offline-first and adds no infrastructure. What leaves the device is a coarse grid cell (city-block-blind, ~11 km), no key, no account, no user identifier. See §1.2 for the full justification and why the FastAPI proxy is *documented but deferred* (§5.3). |
| What crosses the network | **Only** a rounded `{lat, lon}` → Open-Meteo, returning impersonal weather/AQI JSON. Nothing else, ever. | §1.4 table is the contract. |
| Hydration engine | **Deterministic physiology formula, on-device, NO `.pte` for v1** (pending AIML confirmation, §5.1) | Daily water need is a well-understood function of body mass, activity energy, temperature/humidity, and an AQI nudge factor. A transparent formula is explainable, auditable, instant, and needs no model load. AIML may later supply a learned correction; the interface is built to accept one without a rewrite. |
| TS-facing API | A thin **`HydrationService` (pure) + `useHydrationTracker` hook** under `mobile/src/features/hydration/` | Same pattern as Overwhelm/Energy: screen stays dumb, all network/notification/compute isolated and reviewable. |
| Intake + body params storage | **On-device only** (`expo-sqlite`/MMKV); never networked | Intake logs and body params are user data — they never appear in any request. |
| Nudges | **`expo-notifications`, local scheduling only** — no push, no server | Local notifications work in Expo Go and dev builds; no remote push = no server in the nudge path. Quiet hours computed on-device (§3). |
| Offline behavior | **Cache last-known weather/AQI; degrade to activity+body formula** when offline | Airplane mode is a supported, tested mode — target still computes, nudges still fire (§3.4, §4.4). |

---

## 1. Data sources & flow

### 1.1 Weather + AQI — Open-Meteo (the one sanctioned network call)
- **Weather:** `GET https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature&hourly=temperature_2m,relative_humidity_2m&forecast_days=1`
- **AQI:** `GET https://air-quality-api.open-meteo.com/v1/air-quality?latitude={lat}&longitude={lon}&hourly=pm2_5,pm10,us_aqi&forecast_days=1`
- **No API key, no auth header, no cookie, no account.** This is a deliberate provider choice: a keyless, accountless API means there is no per-user credential that could correlate requests to an identity. The request carries only a coarse coordinate (§1.2).
- One combined fetch on app foreground / first nudge-tick of the day, then cached (§2.4). At most a handful of calls/day/user — far inside Open-Meteo's free 10k/day non-commercial tier. **Attribution required** (CC-BY 4.0): add "Weather & air-quality data by Open-Meteo.com" to the app's about/legal screen — designer owns placement.

### 1.2 Location strategy — minimize exposure (the architectural tension, decided)
Weather/AQI are inherently location-keyed, so *some* coarse location must leave the device. We minimize it three ways, in order:

1. **Coarse acquisition.** Request `expo-location` foreground permission with **low accuracy** (`Accuracy.Low`/`Lowest`). On **iOS 14+**, additionally accept **reduced accuracy** (`requestForegroundPermissionsAsync` → the user can grant "Approximate") — we never ask for precise/full accuracy. We never request **background** location; weather is fetched while the app is foreground.
2. **Grid rounding on-device (the real privacy lever).** Before any request, round lat/lon to **~0.1° (~11 km at the equator)** — `round(coord * 10) / 10`. The third party only ever sees a coarse grid cell, not a street or building. Weather/AQI are spatially smooth at this scale, so accuracy is unaffected. This rounding happens in `weatherSource.ts` and is the single enforced choke point — the un-rounded coordinate never reaches `fetch`.
3. **Direct device fetch, no account, no key.** The rounded cell goes straight to Open-Meteo. Open-Meteo sees the request's source IP (unavoidable for any direct client call) and a coarse cell — but **no user id, no device id, no app account, no health/activity/intake data**. There is nothing on our side tying that request to a person.

**Why NOT route through the LifePilot FastAPI backend as a privacy proxy (option b) for v1:**
- The proxy's *only* privacy gain is hiding the user's **IP** from Open-Meteo. But a coarse ~11 km grid cell already reveals more about location than the IP does, and the IP is not user data we hold — so the proxy trades real infrastructure (a deployed, maintained, logged FastAPI endpoint) for a marginal IP-masking benefit. Worse, a naïve proxy that logs requests would *centralize* coarse-location data we currently never see — strictly worse for privacy unless built with strict no-log discipline.
- It adds an always-on server dependency to an otherwise offline-first feature, and a single point of failure for a "quick win" feature.
- **Conclusion:** ship **coarse + grid-round + direct** for v1. The proxy is **documented and ready to spec** (§5.3) as a clean upgrade *if* we later want IP-anonymization or to switch to a keyed paid provider (the proxy would then hold the API key server-side and strip the IP) — at which point it carries **only** a rounded cell, **logs nothing**, and still touches **zero user data**. That decision is reversible without changing the device-side contract, because the device always emits the same rounded-cell request shape.

### 1.3 Activity — reuse Energy Predictor's on-device health adapters
- Source the day's **active energy / steps / exercise minutes** from the same `react-native-health` (iOS HealthKit) / `react-native-health-connect` (Android Health Connect) adapters built for Energy Predictor (`mobile/src/features/energy/healthSources.ts`). Hydration reads the already-ingested **daily activity row** rather than re-querying — avoids duplicate permission prompts and duplicate native calls.
- If the user hasn't granted health permission, hydration **degrades gracefully** to a body-params + weather/AQI baseline (activity term = 0), with honest UI copy. Never blocks the target.
- Activity data is read-through and **never** forwarded to Open-Meteo or anywhere else.

### 1.4 What crosses the network vs. what never does (the hard contract)

| Data | Crosses network? | Destination | Notes |
|---|---|---|---|
| Rounded coarse coordinate (`~0.1°` grid cell) | **YES** (the one sanctioned egress) | Open-Meteo weather + AQI endpoints | No key, no account, no identifier attached |
| Weather JSON (temp, humidity, apparent temp) | inbound only | from Open-Meteo | impersonal environmental data |
| AQI JSON (pm2_5, pm10, us_aqi) | inbound only | from Open-Meteo | impersonal environmental data |
| **Precise location / street address** | **NEVER** | — | rounded away on-device before any fetch |
| **Activity** (steps, active energy, exercise) | **NEVER** | — | read-through from HealthKit/Health Connect, used in local formula |
| **Body params** (weight, sex, age) | **NEVER** | — | entered once, stored on-device only |
| **Water intake logs** | **NEVER** | — | on-device SQLite/MMKV only |
| **Computed daily target / hydration recommendation** | **NEVER** | — | computed and rendered on-device |
| **Any user/device id, analytics, telemetry** | **NEVER** | — | none in this feature |

---

## 2. The hydration engine (on-device)

### 2.1 Where the target is computed
A **deterministic physiology formula**, evaluated in `HydrationService.ts` (pure TS). **No `.pte` model for v1** (pending AIML sign-off, §5.1). Rationale: daily water requirement is a well-characterized function we can compute transparently, instantly, and offline, with no model-load cost and full explainability ("why this number?"). The function signature is built so AIML can later drop in a learned correction term **without changing the hook or the screen**.

Reference shape of the formula (exact coefficients are AIML's deliverable, §5.1 — these are placeholders, not final):
```
baseMl      = weightKg * BASE_ML_PER_KG            // ~30–35 ml/kg baseline
activityMl  = activeEnergyKcal * ML_PER_KCAL       // sweat-loss proxy from exercise
heatMl      = f(apparentTempC, humidity)           // step-up above a comfort threshold
aqiMl       = g(us_aqi)                             // modest increase in poor air (hydration aids mucociliary clearance); capped
targetMl    = clamp(baseMl + activityMl + heatMl + aqiMl, MIN_ML, MAX_ML)  // safety clamp both ends
```
- **Safety clamp is mandatory** (`MIN_ML`/`MAX_ML`): never recommend a dangerous volume. Water intoxication is a real harm; the upper clamp and a per-hour pacing cap (§3) are non-negotiable. AIML + a medical-sanity review own the coefficients and bounds.
- The AQI term is a **modest, capped** adjustment — we do not overstate a hydration/air-quality link; designer copy must not make medical claims (§5.4).

### 2.2 TS-facing service + hook
```
mobile/src/features/hydration/
├─ HydrationService.ts        # PURE: (body params + activity + weather + aqi) → DailyHydrationTarget; intake math; progress. Unit-testable, no I/O.
├─ weatherSource.ts           # ISOLATED network choke point: coarse-locate → grid-round → fetch Open-Meteo → WeatherConditions. The ONLY file in this feature that imports fetch.
├─ hydrationStore.ts          # on-device persistence: body params, intake logs, cached conditions (SQLite/MMKV). Never networks.
├─ nudgeScheduler.ts          # expo-notifications scheduling, quiet-hours + pacing logic (§3). No network.
├─ useHydrationTracker.ts     # RN hook: orchestrates locate→fetch→compute→schedule; exposes the API below.
├─ hydration.types.ts         # shared types (below)
├─ hydration.config.json      # AIML deliverable: formula coefficients, thresholds, clamps, AQI curve, nudge cadence defaults
└─ __tests__/                 # formula + intake + grid-rounding + quiet-hours tests against AIML fixtures
```
The screen imports **only** `useHydrationTracker` — never `fetch`, `expo-location`, `expo-notifications`, or the health adapters directly.

### 2.3 Input / output types (`hydration.types.ts`)
```ts
export type BodyParams = {
  weightKg: number;
  sex?: 'male' | 'female' | 'unspecified';  // optional refinement
  age?: number;                              // optional refinement
};

export type ActivitySnapshot = {
  date: string;                 // ISO yyyy-mm-dd (local)
  activeEnergyKcal: number;     // from HealthKit/Health Connect daily row (0 if unavailable)
  exerciseMinutes: number;
  steps: number;
  available: boolean;           // false if health permission denied -> activity term = 0
};

export type WeatherConditions = {
  apparentTempC: number;
  temperatureC: number;
  humidityPct: number;
  usAqi: number;                // us_aqi from Open-Meteo
  pm25?: number;
  gridCell: { lat: number; lon: number };  // the ROUNDED cell actually queried (for transparency/debug)
  fetchedAt: string;            // ISO timestamp; drives cache staleness (§2.4)
  source: 'live' | 'cache';     // honest provenance for the UI
};

export type DailyHydrationTarget = {
  targetMl: number;             // clamped daily goal
  breakdown: {                  // explainability: where the number came from
    baseMl: number; activityMl: number; heatMl: number; aqiMl: number;
  };
  basis: 'full' | 'no-activity' | 'no-conditions';  // honest degradation state
  computedAt: string;
};

export type IntakeEntry = { id: string; amountMl: number; at: string };  // on-device only

export type HydrationProgress = {
  target: DailyHydrationTarget;
  consumedMl: number;
  remainingMl: number;
  pctComplete: number;          // 0..1
};

export type HydrationState =
  | 'loading' | 'location-denied' | 'ready' | 'offline-cached' | 'error';

export type HydrationError = { kind: 'location' | 'network' | 'compute' | 'storage'; message: string };
```

### 2.4 Caching weather/AQI for offline
- After a successful fetch, persist `WeatherConditions` (with `fetchedAt`) in `hydrationStore`.
- **Staleness policy:** treat cached conditions as usable for **~6–12 h** (weather/AQI drift slowly relative to a hydration target). On app open, if cache is fresh enough, **skip the network entirely**; otherwise refresh.
- **Offline / fetch failure → `source: 'cache'`**, and if no cache exists at all, compute with `basis: 'no-conditions'` (body + activity only). The target **always** computes. The UI shows honest provenance ("using last-known conditions" / "based on your activity").

---

## 3. Real-time nudges (local, on-device)

### 3.1 Mechanism — `expo-notifications`, local only
- **No remote push, no server.** We schedule **local** notifications only — these work in Expo Go and dev builds and require no Expo push token or backend. This keeps the nudge path inside the privacy fence.
- **Android channels are mandatory.** Call `setNotificationChannelAsync('hydration', { importance: HIGH })` **before** scheduling — Android 8+ silently drops channel-less notifications (the #1 cause of "nudges never appear"). A separate low-importance channel for quiet-window/silent variants.
- **Permissions:** request POST_NOTIFICATIONS on Android 13+; on iOS rely on `ios.status` granularity (provisional vs full). Handle denial gracefully — the target/progress UI still works without nudges.

### 3.2 Timing logic
- Derive an **even pacing schedule** across the user's waking window: `remainingMl / numberOfRemainingSlots`, nudging every ~1.5–2 h to drink a portion. Re-pace after each logged intake so a user who drinks ahead isn't over-nudged and one who's behind gets gently caught up.
- **Pacing cap (safety):** never schedule nudges that would imply drinking faster than a safe per-hour ceiling, even if behind target. Ties to the §2.1 clamp.
- Heat/AQI can **tighten cadence modestly** (hotter day → slightly more frequent) within the cap.
- Use `SchedulableTriggerInputTypes` DATE/TIME_INTERVAL triggers (cross-platform). Avoid iOS-only CALENDAR triggers for the core schedule so behavior matches across platforms; compute concrete next-fire times on-device.

### 3.3 Quiet hours — computed, not built-in
- **There is no built-in quiet-hours API in expo-notifications** — we implement it. Store a user quiet window (e.g. 22:00–07:00); when computing the next nudge time, **skip any fire time inside the window** and roll it to the window's end. Default quiet window shipped; user-adjustable.
- During quiet hours we **do not schedule** (preferred) rather than schedule-silent, to avoid background-delivery throttling.

### 3.4 Battery / permission / offline behavior
- **Battery:** local scheduled notifications are cheap (OS alarm manager). We do **not** run background location or background fetch for nudges — the schedule is computed when the app is foregrounded and persisted. No wake-locks, no polling loop.
- **Android exact alarms / Doze:** for reliable timing on Android 12+, nudges may need `SCHEDULE_EXACT_ALARM`; default to **inexact** alarms (Doze-tolerant, no special permission) and only escalate to exact if QA shows unacceptable drift — exact-alarm permission is increasingly restricted and not worth it for a "drink water" nudge.
- **Persist scheduled IDs** (in `hydrationStore`) so we can cancel/reschedule when intake is logged or the quiet window changes, and restore after relaunch.
- **Force-stop caveat (Android):** if the user force-stops the app, scheduled notifications stop until next open — documented limitation, surface nothing misleading.
- **Offline:** nudges are fully offline — they depend only on the locally-computed target and schedule, not on any network. Airplane mode does not stop nudges.

---

## 4. Privacy in code

This feature is the **test case** for "controlled network access without breaking the promise." We make the boundary verifiable.

1. **Exactly one file may touch the network: `weatherSource.ts`.** The ESLint `no-restricted-imports`/`no-restricted-globals` ban (reused pattern from Overwhelm §5 / Energy §4) is applied **scoped to `mobile/src/features/hydration/**` with a single-file allowlist exception for `weatherSource.ts`**. Every other file in the feature — `HydrationService`, `hydrationStore`, `nudgeScheduler`, `useHydrationTracker` — still **bans `fetch`/`XMLHttpRequest`/`axios`/analytics**. CI fails on any violation. This makes "where can data leave?" a one-file audit.
2. **The one allowed request is provably user-data-free.** `weatherSource.ts` is structured so the **only** values interpolated into the URL are the **rounded** `lat`/`lon`. There is no code path that can place activity, body params, intake, or any identifier into the request — and a unit test asserts exactly that: given a known precise coordinate, the outbound URL contains only the grid-rounded cell and the fixed weather/AQI param list, nothing else. No headers carry auth/cookies/ids.
3. **Grid-rounding is enforced and tested.** A test feeds a precise coordinate and asserts the value passed to `fetch` is rounded to the 0.1° grid (precise coordinate never appears in the request).
4. **User data is structurally isolated from the network file.** `weatherSource.ts` imports **no** store, no health adapter, no body params — it takes a coordinate in and returns `WeatherConditions` out. It cannot see user data, by construction. `HydrationService` (which does see user data) imports **no** networking. The two never mix.
5. **Network-access audit (belt-and-suspenders).** Run a full hydration session through a network monitor (mitmproxy / Android Network Inspector) and confirm the **only** outbound requests are the two Open-Meteo GETs carrying a rounded cell — no payload, no user data. Attached to CTO pre-demo sign-off.
6. **Airplane-mode acceptance test (adapted).** Unlike Overwhelm/Energy where airplane mode is pure, here the test is: airplane mode → app still computes a target from cached/last-known conditions (or body+activity if no cache) → logs intake → fires nudges. The feature must **degrade, never break**, with no network access. Required pre-demo gate.
7. **No telemetry.** Body params, intake, activity, target, and the resolved coordinate are never logged off-device or attached to crash reports. Crash reporters (if any) scrub these fields.
8. **Backend stays out of the user-data path.** FastAPI is **not** referenced by the device feature in v1. If the optional proxy (§5.3) is ever added, it carries only a rounded cell and logs nothing — still zero user data.

CTO sign-off (required before any demo), in order: **(a) privacy** — single-file network scope + user-data-free request test + grid-round test + network audit + airplane-degrade test all pass; **(b) correctness** — formula matches AIML fixtures, intake/progress math, quiet-hours skip logic, safety clamps; **(c) performance** — no background drain, fetch debounced/cached, nudge scheduling cheap.

---

## 5. Contract & open items

### 5.1 Contract: AIML hydration-engine deliverable → mobile integration
The AIML engineer (`lifepilot-aiml-engineer`) delivers the **engine spec** (not necessarily a `.pte`) into `mobile/src/features/hydration/` source of truth:

| Artifact | Requirement |
|---|---|
| `hydration.config.json` | The formula coefficients + thresholds: `BASE_ML_PER_KG`, `ML_PER_KCAL`, the `heatMl(apparentTemp, humidity)` curve, the `aqiMl(us_aqi)` curve (capped), `MIN_ML`/`MAX_ML` safety clamps, per-hour pacing cap, default nudge cadence + quiet window. |
| Formula spec doc | Plain-language definition of each term + **medical-sanity sourcing** for the baseline (ml/kg) and the clamps. The upper clamp and pacing cap must be defensible — this is a safety item. |
| Fixture set | `(body params + activity + weather + aqi) → expected targetMl + breakdown` examples across hot/cold, active/sedentary, good/bad AQI, and the degraded (`no-activity`, `no-conditions`) cases. Become the mobile `HydrationService` unit-test fixtures (analog of Overwhelm's 20-task report / Energy's fixtures). |
| **Optional later:** `.pte` correction model + `manifest.json` | If/when AIML wants a learned personal-correction term, it ships as a small generic-module `.pte` (same path as Energy: `ExecutorchModule`, ExecuTorch v0.6.0 against pinned `react-native-executorch@0.4.8`). The hook is built to accept it without screen changes. **Not required for v1.** |

**Behavioral contract both sides sign:**
- **Inputs to the engine:** `BodyParams`, `ActivitySnapshot`, `WeatherConditions` (units fixed: ml, kg, kcal, °C apparent, % humidity, `us_aqi`). Missing activity → activity term 0, `basis:'no-activity'`. Missing conditions → heat/aqi terms 0, `basis:'no-conditions'`.
- **Output:** `DailyHydrationTarget` with `breakdown` (explainability) and `basis` (honest degradation). Mobile owns the TS implementation of the formula; **AIML owns the coefficients, curves, and clamps** and signs off they are medically defensible.
- **Decision AIML must make (Q1):** is v1 **pure-formula (no `.pte`)** — recommended — or does AIML want a model from day one? Everything in §2 assumes pure-formula; confirm.

### 5.2 Contract: mobile ↔ designer
- Designer delivers `design/hydration/`: the daily-target hero (ring/number) with `breakdown` explainability, intake-logging affordance (quick-add presets), the state table below, the quiet-hours setting, body-params onboarding, and the **Open-Meteo attribution** placement (§1.1).
- States the UI must represent (the state contract): `loading`, `location-denied` (calm rationale: "we use only a rough area to read weather & air quality"), `ready`, `offline-cached` (honest "last-known conditions"), `error`. Plus `basis` copy: `full` vs `no-activity` vs `no-conditions`.
- **No medical claims.** Copy frames hydration as wellness guidance, not medical advice; the AQI term is "a little more on poor-air days," not a treatment claim. Designer + AIML align wording.

### 5.3 Backend proxy — spec (documented, DEFERRED, non-user-data only)
If we later choose to mask the device IP or move to a keyed paid weather provider, add a **single stateless FastAPI endpoint**. Spec, ready to build when/if triggered:
- `GET /v1/conditions?lat={rounded}&lon={rounded}` → returns the merged weather+AQI JSON.
- **Holds the provider API key server-side** (so the device ships no key); **strips/does not log the client IP**; **logs nothing per-request** (no coordinates, no IPs, no timestamps tied to a request).
- Accepts **only** a rounded grid cell — server-side it re-rounds defensively and rejects sub-grid precision. Carries **zero user data** — there is no user identifier in the contract, by design.
- Caches by grid cell across all users (a given cell's weather is identical for everyone), which also amortizes provider quota.
- **Trigger to build:** a decision to anonymize IP or adopt a keyed provider. Until then, **direct device fetch (§1.2) is the shipping path** and the device contract is identical either way (device always emits a rounded-cell GET), so this is a non-breaking future swap.

### 5.4 Open questions / risks
1. **Pure-formula vs `.pte` for v1** — recommend pure-formula. AIML confirms (§5.1 Q1). *Blocking the engine deliverable's shape, not the mobile build (mock the config).* 
2. **Safety clamps + medical sourcing** — the `MAX_ML` clamp and per-hour pacing cap are a **safety requirement**, not a nicety. AIML must source defensible numbers; CTO will not sign off a hydration target without an enforced upper bound. **Blocking for demo.**
3. **iOS reduced-accuracy UX** — if the user grants only "Approximate" on iOS, our grid-rounding makes that perfectly sufficient; ensure the permission-rationale copy reflects we *prefer* coarse. No precise-location ask anywhere.
4. **Android exact-alarm vs Doze drift** — start inexact; QA nudge timing on a real Android 12+ device before deciding to request `SCHEDULE_EXACT_ALARM`. Platform caveat.
5. **Health permission reuse** — confirm Hydration reads the Energy Predictor daily activity row rather than issuing its own HealthKit/Health Connect prompts (avoid double prompts). **Blocking dependency on Energy's `healthSources.ts`** — coordinate build order with the mobile dev.
6. **Open-Meteo non-commercial tier / attribution** — free tier is non-commercial; at commercial launch we either buy the Open-Meteo commercial tier, self-host (AGPL codebase), or move to OpenWeather behind the §5.3 proxy. Attribution string required now. **Blocking for commercial release, not for the dev build.**
7. **Cold-start body params** — target needs `weightKg`. Onboarding must collect it (designer); until then, degrade to a generic baseline with a prompt to personalize.

### 5.5 Build sequencing / blocking dependencies
1. **CTO:** confirm the network-ban single-file-allowlist ESLint scope + the location/grid-round decision (this doc). → unblocks the privacy fence.
2. **AIML:** lock `hydration.config.json` (coefficients, curves, **clamps**) + formula spec + fixtures; confirm pure-formula vs `.pte` (Q1). → unblocks real target computation.
3. **Mobile:** build `useHydrationTracker` + `weatherSource` + `nudgeScheduler` + `hydrationStore` against this spec; start immediately with a **mock `hydration.config.json`** and a **stub `weatherSource`** so the screen, intake logging, and nudge UX proceed before AIML's coefficients land. Reuse Energy's health adapters.
4. **Designer:** target/intake visuals + state table + attribution + quiet-hours setting in `design/hydration/`.
5. **CTO:** code review + privacy/correctness/perf sign-off before demo.

---

## References
- Open-Meteo Weather API (free, no key): https://open-meteo.com/en/docs
- Open-Meteo Air Quality API (`us_aqi`, `pm2_5`, CAMS-backed): https://open-meteo.com/en/docs/air-quality-api
- Open-Meteo Geocoding (city → coords, if ever needed): https://geocoding-api.open-meteo.com/v1/search
- expo-notifications (local scheduling, channels, triggers): https://docs.expo.dev/versions/latest/sdk/notifications/
- expo-location (accuracy levels, iOS reduced accuracy): https://docs.expo.dev/versions/latest/sdk/location/
- Reuse precedent (stack, pin, privacy pattern, health adapters): `docs/overwhelm-executorch-integration.md`, `docs/energy-predictor-architecture.md`
