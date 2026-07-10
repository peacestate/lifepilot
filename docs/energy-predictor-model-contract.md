# Energy Predictor — On-Device Model Contract (authoritative)

Owner: AI/ML Engineer · Status: **v1 locked (pending CTO §10)** · Last updated: 2026-06-26

This is the authoritative contract the **mobile dev** codes against, the **designer**
builds the forecast viz against, and the **CTO** signs off on. Feature #2 in the README.

Feature: predict the user's **energy across the day** from their **sleep, activity, and
phone-usage** signals — fully on-device via ExecuTorch. No user data ever leaves the
phone (README golden rule). This is a **time-series regression** model, **not an LLM** —
there is **no tokenizer, no prompt, no text**. Input is a numeric tensor, output is a
numeric tensor.

---

## 0. TL;DR for each role

- **Mobile dev:** you build the **feature tensor** (`§3`) and consume a **24-number
  hourly energy curve, 0–100** (`§4`). Two things are **mobile-owned, not in the `.pte`**:
  (a) **normalization** — apply the fixed scaler in `§3.3` byte-for-byte identically, and
  (b) **personalization** — a deterministic post-processing layer (`§5`), no on-device
  training. Derive peak/dip/overall from the 24-point curve yourself (`§4.2`); they are
  not separate model outputs.
- **Designer:** the model gives you a **24-point curve, one value per hour, 0–100**
  (`§4`). Design the forecast viz around that shape plus three derived headline numbers
  (peak time, dip time, overall level) and a **confidence/calibrating** state for
  cold-start (`§3.4`). Exact shape + states are in `§4.2`–`§4.3`.
- **CTO:** confirm the one thing in `§10` — the **ExecuTorch version pin** (same rule as
  Overwhelm: `.pte` has no forward-compat). This model targets **XNNPACK** (CPU) by
  default; QNN/HTP is optional and unnecessary at this size. Also confirm the
  **personalization + normalization live in TS** (`§3.3`, `§5`), since they must run
  every prediction and must never drift from the values baked at export.
- **AI/ML (me):** v1 is a **tiny 1D-CNN/TCN** trained on a **documented synthetic
  dataset** (`§6`) and exported on the **AMD ROCm notebook** to a **`.pte` pinned to ExecuTorch v0.6.0**
  (`§7`). The model is **honest about its priors** — it encodes physiology, not the
  specific user; the user fit comes from `§5`. Eval harness + report in `ml/test/`.

---

## 1. Why this shape of solution

| Decision | Choice | Why |
|---|---|---|
| Model family | **Tiny 1D-CNN / TCN** (2 conv layers + linear head) | Conv1d + ReLU + Linear + sigmoid all delegate cleanly to XNNPACK (`§2`). A 7-day window is short, so depth is unnecessary; this is ~10–30k params, **< 200 KB** at fp32. |
| Why not an LSTM/GRU | Avoided for v1 | RNN control-flow/state lowers less cleanly to ExecuTorch than a feed-forward conv stack, for **zero accuracy gain** on a 7-step window. Documented as a non-goal, revisit only if longer horizons need it. |
| Why not gradient-free (sklearn/GBDT) | Avoided | Tree ensembles do **not** export to `.pte` (ExecuTorch runs ATen/edge ops, not tree traversal). A conv/linear net is the smallest thing that both fits the data **and** exports. |
| Quantization | **fp32 XNNPACK is the v1 default**; int8 PT2E is an optional switch | The model is already **< 200 KB**. 4-bit (the LLM recipe) buys nothing here and is poorly supported for small conv nets in XNNPACK. "4-bit where quality allows" (README) → here quality does **not** allow and size does **not** require it. Honest call. |
| Backend | **XNNPACK delegate** (Snapdragon CPU) | At this size inference is **sub-millisecond to a few ms**; the < 50 ms target is met with huge margin on CPU. QNN/HTP is not worth the build complexity for v1 (`§8`). |
| Personalization | **Generic base `.pte` + deterministic on-device calibration in TS** (`§5`) | On-device **training** in ExecuTorch is experimental; we do **not** depend on it. Per-user fit is plain arithmetic over the user's own history + check-ins, persisted locally. |

---

## 2. Exportability to `.pte` (op support)

The whole network is built from ops with first-class XNNPACK/edge support, so the entire
graph lowers to a single delegated partition:

| Layer | ATen op | XNNPACK support |
|---|---|---|
| `Conv1d(k=3, pad=1)` ×2 | `aten.convolution` | yes (conv blocks delegate) |
| `ReLU` | `aten.relu` | yes |
| `Flatten` | `aten.view` | yes (no-op reshape) |
| `Linear(→24)` | `aten.addmm`/`aten.linear` | yes |
| output `sigmoid` then `×100` | `aten.sigmoid`, `aten.mul` | yes |

- **Static shapes only.** Input is a **fixed** `[1, 12, 7]` tensor (`§3.2`), output a fixed
  `[1, 24]`. No dynamic shapes, no data-dependent control flow → clean
  `torch.export` → `to_edge_transform_and_lower(..., XnnpackPartitioner())`.
- The output bounding (`sigmoid * 100`) is **inside the model**, so the `.pte` already
  emits values in **[0, 100]**; mobile never has to clamp the range (it still defensively
  clamps per `§4.1`).

---

## 3. Input feature schema (mobile builds this exact tensor)

### 3.1 The window
A prediction for "today" uses a rolling window of the **last 7 days** of daily features.
The window is the model input; there is **no separate "today" vector** — today's row holds
the **morning-known** signals (last night's sleep, wake time, day-of-week) and the
activity/usage fields for today are filled with **0 after normalization** (i.e. the
feature's population mean before normalization) because they haven't happened yet. The
model is trained the same way, so it learns to lean on history + last night for the early-
morning forecast.

> Window convention: `row[6]` = **today**, `row[0]` = 7 days ago. Oldest first.

### 3.2 Tensor layout
```
input  : float32, shape [1, 12, 7]   # [batch, feature, day]   (channels = features)
output : float32, shape [1, 24]      # 0..100, one value per local clock hour 00..23
```
Channel-major (`[feature, day]`) because the conv runs over the **day** axis per feature.
Mobile builds a `[12][7]` matrix and feeds it as `[1, 12, 7]`.

### 3.3 The 12 features (fixed order) + normalization
Mobile computes each **raw** daily value, then applies **`z = (raw − mean) / std`** using
the **exact constants below**. These constants are **frozen at export** and also shipped in
`manifest.json`; the mobile loader reads them from the manifest — **never hard-code a
second copy**. If these drift from what the model was trained on, predictions are garbage.

| idx | feature | raw unit / definition | mean | std |
|---|---|---|---|---|
| 0 | `sleep_duration_h` | hours asleep last night | 7.0 | 1.3 |
| 1 | `sleep_quality` | 0–1 (efficiency or device score) | 0.80 | 0.12 |
| 2 | `sleep_midpoint_h` | clock hour of mid-sleep (e.g. 3.5 = 03:30) | 4.0 | 1.5 |
| 3 | `wake_time_h` | clock hour of wake (e.g. 7.25) | 7.0 | 1.5 |
| 4 | `steps_k` | steps ÷ 1000 (that day; today = 0 pre-event) | 7.0 | 4.0 |
| 5 | `active_minutes` | minutes of moderate+ activity | 35.0 | 30.0 |
| 6 | `movement_intensity` | mean accel magnitude proxy, 0–1 | 0.30 | 0.18 |
| 7 | `screen_time_h` | screen-on hours that day | 4.5 | 2.5 |
| 8 | `phone_pickups` | unlocks that day | 60.0 | 35.0 |
| 9 | `late_night_screen_min` | screen-on minutes 23:00–03:00 | 25.0 | 30.0 |
| 10 | `dow_sin` | `sin(2π·dow/7)`, dow 0=Mon | 0.0 | 0.71 |
| 11 | `dow_cos` | `cos(2π·dow/7)` | 0.0 | 0.71 |

Notes:
- `dow_sin/cos` encode day-of-week cyclically (Mon adjacent to Sun); **no separate
  is_weekend feature** — the model learns weekend structure from these two.
- For **today's row**, activity/usage features (idx 4–9) describe events that haven't
  happened yet → set **raw = the mean** (so `z = 0`). Sleep/timing/dow (idx 0–3, 10–11)
  are known in the morning → use real values.
- Missing single fields (e.g. a night with no sleep data) → set raw = mean (`z = 0`), and
  reduce confidence (`§3.4`).

### 3.4 Cold-start (how many days before a first prediction)
- **Minimum to predict: 3 days** of observed history. Below that, show the designer's
  **"calibrating"** state, not a forecast.
- **Full window: 7 days.** With 3–6 days, **back-fill** the missing oldest rows by
  repeating the earliest **observed** day (clamp, don't zero — zeros would read as
  "no sleep / no activity" and bias the curve down).
- **Confidence** (mobile computes, designer surfaces):
  `confidence = clamp(days_observed, 0, 7) / 7`. Render < 7 days as a softened/"still
  learning" forecast. This is a UI signal, not a model output.

---

## 4. Output contract (mobile + designer consume this)

### 4.1 Raw model output
- `float32 [1, 24]`, **already in [0, 100]** (sigmoid×100 baked in, `§2`).
- Index = **local clock hour** 0–23. `out[9]` = predicted energy at 09:00.
- Units: **0 = depleted, 100 = peak energy.** Unitless relative scale, not calories/HRV.
- Mobile still **defensively clamps to [0, 100]** and rounds for display.

### 4.2 Derived headline numbers (mobile computes, NOT separate outputs)
The designer wants a few key numbers; they are **cheap derivations of the curve**, so we
do **not** spend model outputs on them (keeps one source of truth):
```
peakHour    = argmax(curve)
dipHour     = argmin(curve)              # typically post-lunch
overall     = round(mean(curve))         # 0..100 day-level energy
morning/afternoon/evening = mean of curve over [6..11],[12..17],[18..23]
```

### 4.3 TypeScript shape (CTO types, designer binds)
```ts
// Raw from the .pte (after defensive clamp/round)
export type EnergyCurve = number[];        // length 24, each 0..100, index = clock hour

export type EnergyForecast = {
  curve: EnergyCurve;                       // the 24-point hourly curve (the viz)
  peakHour: number;                         // 0..23
  dipHour: number;                          // 0..23
  overall: number;                          // 0..100
  blocks: { morning: number; afternoon: number; evening: number }; // each 0..100
  confidence: number;                       // 0..1 (cold-start, §3.4) — UI only
  personalized: boolean;                    // §5 calibration applied?
  generatedAtHour: number;                  // local hour the forecast was made
};
```
- This is the object the forecast screen renders. `curve` is the chart; `peak/dip/overall`
  are the headline stats; `confidence` drives the calibrating treatment.

---

## 5. Personalization (generic base + deterministic on-device calibration)

The `.pte` is a **frozen, population-level** model. It will be **systematically off** for an
individual (some people are larks, some run hot in the evening). We correct this **without
any on-device training** — pure arithmetic the **mobile dev/CTO own**:

1. **Per-user bias (level).** Track an EMA of the user's reported-vs-predicted gap from
   light **energy check-ins** (a 1-tap "how's your energy now?"). `bias ← bias + α·(actual
   − predicted_at_that_hour)`, α≈0.1. Add `bias` to every curve point, then clamp.
2. **Per-hour shape correction (optional, phase 2).** Keep a length-24 residual vector,
   each entry an EMA of (actual − predicted) at that hour. Add elementwise. Persist it
   locally (e.g. encrypted store). This nudges the larks-vs-owls shape over weeks.
3. **All state is local.** bias + residuals live on-device only, never synced. This is the
   only "learning" and it is deterministic, inspectable, and reset-able.

What is realistic to **export/run on device:** only the frozen base inference (the `.pte`).
What **mobile/CTO must implement:** the calibration math above, the local persistence, and
the check-in capture. Stated plainly so nobody expects the `.pte` to self-train.

> ExecuTorch **does** have an experimental on-device training path. We are **not** using it
> in v1 — the calibration layer above gets ~90% of the benefit at ~0% of the runtime risk.
> Flagged as a future option in `§8`.

---

## 6. Training data + bootstrap (honest about priors)

There is **no real user dataset** yet. v1 is trained on a **documented synthetic
generator** (in the export script, `§7`) so a generic model exists day one:

- **Physiological prior:** the **two-process model of sleep regulation** (Borbély) —
  Process C (a ~24 h circadian sinusoid, peak late-morning/early-evening, trough
  mid-afternoon and overnight) plus Process S (homeostatic sleep pressure that builds with
  wake time and is paid down by sleep). Energy(hour) ≈ circadian − sleep-pressure, modulated
  by **sleep debt** (short/poor sleep lowers and flattens the curve), **activity** (moderate
  activity lifts daytime energy; late high intensity can dent it), **late-night screen use**
  (pushes the curve down and later), and **day-of-week** (weekend phase shift). Gaussian
  noise + per-synthetic-user random offsets create variety.
- **Scale:** ~2–5k synthetic "users" × ~30 days → windowed samples. Fully reproducible from
  a fixed seed; **no privacy surface** (no real data touched).
- **Honesty:** this model encodes **our assumptions**, not the truth for any individual.
  That is fine and intentional — the generic base gets the **shape** right; `§5` corrects
  the **person**. When real, **consented, on-device** data or a public reference set
  (e.g. PMData / MMASH-style wearable sleep+activity sets, used only on the AMD ROCm notebook for offline
  validation — never user data) is available, we retrain the base and re-export. The I/O
  contract (`§3`–`§4`) does **not** change, so mobile/design code is unaffected.

Assumptions are listed in-script (`SYNTH_ASSUMPTIONS`) so they are reviewable, not hidden.

---

## 7. Export + eval (AMD ROCm, pinned)

Same pattern as Overwhelm: **train + export on the AMD ROCm notebook, never on the owner's 8 GB PC**
(though this model is tiny, we keep the toolchain off the dev machine for consistency and
because building ExecuTorch needs the room). The `.pte` is pinned to the runtime version.

```
ml/export/export_energy_predictor.py   # train synth → export .pte (ExecuTorch v0.6.0, XNNPACK)
ml/export/README.md                           # §"Option C — Energy Predictor"
ml/test/energy_eval.py                        # shape / range / latency harness (+ --selftest)
ml/test/energy_samples.json                   # named scenario archetypes for eval
ml/test/ENERGY_REPORT_TEMPLATE.md             # the report to fill in
ml/models/energy/energy_predictor.pte         # ← deliverable (produced on the AMD ROCm notebook)
ml/models/energy/manifest.json                # name, executorch_version, quant, scaler, sha256
```

Export pipeline (v0.6.0 API, in the script):
`export_for_training(model).module()` → *(optional)* `XNNPACKQuantizer` + `prepare_pt2e` →
calibrate → `convert_pt2e` → `torch.export.export` →
`to_edge_transform_and_lower(..., partitioner=[XnnpackPartitioner()])` → `to_executorch()`
→ `write_to_file("energy_predictor.pte")`.

`EXECUTORCH_REF = "v0.6.0"` in the script **must** equal the ExecuTorch version bundled by
the pinned `react-native-executorch` (`§10`).

Eval harness checks, per the contract:
- output is exactly `[1, 24]`,
- every value in **[0, 100]**,
- curve is **non-degenerate** (not flat, plausible single daytime peak + afternoon dip),
- inference **latency p50/p95 < 50 ms** (CPU; will be far lower on-device),
and writes a filled `ENERGY_REPORT_TEMPLATE.md`.

---

## 8. Open items (non-blocking for the dev build)

- **QNN/HTP backend.** Not needed at this size (XNNPACK CPU is already < a few ms). Revisit
  only if we fold Energy into a larger multi-model graph.
- **int8 PT2E quant.** Switch exists in the script (`QUANTIZE = True`); off by default
  because size is already negligible. Turn on only if a future bigger base model needs it.
- **On-device training** (ExecuTorch experimental) to replace the `§5` calibration math —
  future, not v1.
- **Real-data retrain** once consented on-device data or a public validation set exists
  (`§6`). I/O contract stays fixed.
- **Multi-model coexistence.** Overwhelm's `useLLM` is single-instance; Energy is a tiny
  separate `.pte` and can load independently — CTO to confirm both can be resident (it
  should be trivial vs the 1B LLM's footprint).

---

## 9. File map (what ships where)

```
ml/export/export_energy_predictor.py   AMD ROCm: train synth + export .pte
ml/export/README.md                           run instructions (Option C section)
ml/test/energy_eval.py                        shape/range/latency harness
ml/test/energy_samples.json                   eval scenario archetypes
ml/test/ENERGY_REPORT_TEMPLATE.md             report template
ml/models/energy/energy_predictor.pte         the deliverable model (from the AMD ROCm notebook)
ml/models/energy/manifest.json                version + scaler constants + sha256
mobile/src/models/energy/                      app copy of .pte + manifest (mobile owns)
docs/energy-predictor-model-contract.md        ← this file
```

---

## 10. The ONE thing the CTO must confirm (blocking)

**Version pin** (identical rule to Overwhelm §6). `.pte` has **no forward-compatibility**.
This model is exported with **ExecuTorch v0.6.0** to match `react-native-executorch@0.4.8`.

➡️ **CTO action:** confirm the pinned `react-native-executorch` bundles **ExecuTorch
v0.6.0**. If you pin a newer runtime, tell me its ExecuTorch version and I set
`EXECUTORCH_REF` to that tag and re-export. Also confirm:
- **normalization (`§3.3`) and personalization (`§5`) run in TS**, reading the scaler from
  `manifest.json` (single source of truth, no second copy);
- both the Energy `.pte` and the Overwhelm model can be resident without contention
  (Energy is tiny; expected fine).

Everything else in this contract is locked pending that confirmation.
