# Hackathon submission draft — AMD Developer Hackathon: ACT II, Track 3 (Unicorn)

Draft copy for the lablab.ai submission form. Edit here, then paste into the
platform fields once ready — keeps a version-controlled record separate from
the web form.

---

## Project Title

**LifePilot**

---

## Short Description

*(aim: 1–2 sentences, the elevator pitch)*

LifePilot is an on-device wellness co-pilot — task breakdown, energy
prediction, hydration tracking, and receipt scanning — that runs its AI
entirely on your phone. No cloud, no accounts, no data leaving the device,
ever.

---

## Long Description

**The problem.** Every "AI wellness app" today works the same way: your
tasks, your sleep patterns, your spending, your health documents — all of it
gets shipped to someone else's server before you get an answer. Users have
no real choice between "use AI" and "keep your data private." LifePilot
removes that trade-off entirely by making it a non-choice: every model runs
on the device itself.

**What it does.** LifePilot is a calm, minimal wellness app built around four
features, each backed by its own on-device model:

- **Overwhelm Manager** — describe what's overwhelming you in plain language;
  an on-device Llama 3.2 1B model breaks it into a concrete 5–8 step plan,
  and gets better at personalizing steps the more you use it (on-device
  memory of past tasks, never synced anywhere).
- **Energy Planner** — a trained time-series model predicts your energy
  curve for the day from recent sleep/activity patterns, surfacing a
  suggested focus window and wind-down window.
- **Hydration Tracker** — a trained regression model combines body
  metrics, activity, and (optionally) local weather/AQI into a personalized
  daily water target.
- **Expense Scanner** — point the camera at a receipt; on-device OCR plus two
  trained models (a line-item field extractor and a spend categorizer) tag and
  classify the receipt, with currency auto-detected — no photo or text ever
  uploaded.

**Why it's real, not a slogan.** "Privacy-first" is a claim most apps make
and few actually build for. LifePilot's models are exported to ExecuTorch
`.pte` format and run through `react-native-executorch` directly on the
phone's own chip — there is no server-side inference path to fall back to,
because there is no server-side inference path at all. You can put the phone
in airplane mode and every feature still works exactly the same. That's not
a fallback mode; it's the only mode.

**Where AMD actually fits.** Because the product's whole premise is that
inference never touches the cloud, AMD's role isn't in the runtime — it's in
how the models get *made*. The energy, hydration, and expense models (four
trained `.pte` artifacts in all) are **trained and exported on AMD Instinct
MI300X GPUs via ROCm**, on AMD's ROCm cloud notebooks (notebooks.amd.com) —
real GPU training producing the exact `.pte` files that ship inside the app
(the shipped artifacts' checksums match the AMD build; see
`ml/export/amd_notebook_run.py` and the recorded provenance). That's the
honest version of "built on AMD": not a checkbox API call at request time,
but the actual GPU compute behind every trained model the app carries.

**What's deliberately absent.** We didn't wire in a hosted inference API
(Fireworks or otherwise) for the shipped app, and that's a design decision,
not an oversight — routing any user input through a cloud model would break
the one guarantee the whole product is built on. Where a hosted API could
add value without compromising that guarantee (e.g., augmenting the
synthetic datasets used to train the small on-device models), that's a
legitimate future extension — but it never sits between a user and their
own data.

**Market potential.** Every category LifePilot touches — task management,
health tracking, expense tracking — already has cloud-based incumbents.
None of them can credibly claim zero data exposure, because their business
model or architecture doesn't allow it. LifePilot demonstrates that a full
four-feature AI product doesn't need a backend to be genuinely useful — a
meaningful wedge for privacy-conscious users, regulated environments
(financial data), and anyone who wants AI features without an ongoing
account relationship with a company.

**Completeness.** All four features are built, integrated with real trained
models (not stubs), and running end-to-end on a physical Android device —
including the on-device Llama 3.2 agent workflow generating real multi-step
task breakdowns in airplane mode. See the demo video for the full walkthrough.

---

## Technology and Category Tags

`on-device-ai` `executorch` `llama-3.2` `react-native` `amd-mi300x` `rocm`
`privacy` `wellness` `personal-productivity` `mobile-app` `edge-ai`
`quantization`

---

## Notes for whoever fills the form in
- The AMD MI300X re-export **was completed on 2026-07-10** on AMD's ROCm cloud
  notebook (notebooks.amd.com): all four trained models (`energy_predictor`,
  `hydration_predictor`, `expense_line_tagger`, `expense_category`) were trained
  on the MI300X GPU (`torch.cuda.is_available()` True, ROCm/HIP 7.2, torch 2.9.1)
  and exported with ExecuTorch 0.6.0. The resulting `.pte` files are the ones
  bundled in the app, and their sha256 checksums are recorded in each
  `mobile/src/models/<feature>/manifest.json`. So the strong AMD wording above
  is factual, not aspirational.
- Fill in the Category Tags against whatever controlled vocabulary the
  lablab.ai form actually offers — the list above is a starting point, not
  guaranteed to match their exact taxonomy.
