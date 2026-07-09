# LifePilot — Slide Deck (Track 3: Unicorn / Open Innovation)

> AMD Developer Hackathon: ACT II. Human-judged on creativity, product/market
> potential, completeness, and use of AMD platforms. Target: 8–10 slides.
> Speaker notes are the *why*; keep on-slide text sparse.

---

## Slide 1 — Title
**LifePilot**
*Your on-device wellness co-pilot. Nothing leaves your phone.*

- LifePilot logo (sage-green emblem) centered on the calm off-white background.
- Sub-line: "4 AI features. 0 servers. Works in airplane mode."
- Footer: AMD Developer Hackathon ACT II · Track 3 (Unicorn) · [your name / handle]

**Speaker note:** One breath. "LifePilot is a wellness app where *every* AI
feature runs entirely on the phone — no cloud, no account, no data collection."

---

## Slide 2 — The problem
**Wellness apps want your data. That's the business model.**

- Three bullets, each with a small icon:
  - Health, mood, spending, location → shipped to servers you don't control.
  - "Privacy policy" = permission to monetize the most intimate data you have.
  - Turn off the internet and most "AI" wellness apps stop working entirely.

**Speaker note:** The status quo trades your intimacy for convenience. We asked:
what if you never had to make that trade?

---

## Slide 3 — The solution
**Every AI inference runs on-device via ExecuTorch.**

- Big statement: "The app works *identically* in airplane mode. That's not a
  fallback — it's the whole architecture."
- One line: "The only network calls that exist are opt-in and off by default:
  a coarse-location weather lookup, and optional model updates. Neither ever
  sends anything about you."

**Speaker note:** This is the core promise. Not "privacy-friendly." Privacy by
*construction* — there is no server to leak, because there is no server.

---

## Slide 4 — What LifePilot does (the 4 features)
**Four on-device models, one calm app.**

| Feature | On-device model | What it does |
|---|---|---|
| 🧠 Overwhelm Manager | Llama 3.2 1B (QAT-LoRA, ExecuTorch) | Breaks a freeform task into 5–8 calm steps; personalizes from on-device memory. Optional voice input (Whisper tiny.en). |
| ⚡ Energy Planner | Trained time-series model | Predicts a 24h energy curve from sleep/activity (Health Connect). |
| 💧 Hydration Tracker | Trained regression model | Personalized daily water target; optional local weather/AQI. |
| 🧾 Expense Scanner | On-device OCR + field extraction/categorization | Camera/PDF receipt → structured expense. Worldwide currencies. |

**Speaker note:** Each feature is backed by its *own* trained model, not one
generic LLM doing everything. This is what "technically impressive" looks like
on-device.

---

## Slide 5 — Live demo
**(Switch to the phone / demo video.)**

- Airplane mode ON, visibly. Then: run Overwhelm on a real task, watch it stream
  steps. Scan a receipt. Show the hydration target + live-weather toggle.
- One callout: "Everything you just saw ran with the radio off."

**Speaker note:** The demo *is* the proof. Keep talking to a minimum here.

---

## Slide 6 — Architecture
**Bundled-first, update-optional, pin-gated.**

- Simple diagram: `Phone` box containing `ExecuTorch runtime → 4 .pte models`,
  `ModelRegistry` (bundled-first, atomic + rollback), feature stores (on-disk,
  sandboxed). A dashed line out to "opt-in weather" and "opt-in model updates,"
  both crossed by a small lock.
- Bullets: React Native (Expo, New Architecture) · ExecuTorch v0.6.0 ·
  ships a working model per feature that works offline forever.

**Speaker note:** The ModelRegistry means we can *release* better on-device
models over time (like an app update), without ever compromising the offline
guarantee. That's the productization story.

---

## Slide 7 — Use of AMD
**AMD MI300X / ROCm is our training + export pipeline.**

- "The shipped app never calls AMD or any cloud at inference — that's the point.
  AMD is where the models are *made*."
- `ml/export/` is containerized (Dockerfile) and runs on the AMD hackathon
  Jupyter instance / MI300X (ROCm) to train and export the Energy, Hydration,
  and Expense `.pte` models. The Overwhelm Llama artifact is quantized/exported
  through the same ExecuTorch path.
- One line: "AMD compute produces the intelligence; the phone runs it privately."

**Speaker note:** Be honest and it lands harder: our AMD story is the *pipeline*,
not fake runtime calls. That's a genuine, defensible use of AMD platforms.

---

## Slide 8 — Why this is a unicorn
**A privacy moat that big platforms structurally can't copy.**

- Market: wellness apps are a $6B+ category built on data monetization.
- Wedge: the growing set of users (and regulators) who won't accept that trade.
- Moat: incumbents' revenue *depends* on the cloud pipeline we removed — they
  can't follow us without breaking their own business model.
- Expansion: same on-device engine → more life domains (sleep, focus, finance),
  plus an audio-only Smart Glasses I/O layer (phone-as-brain, no cloud).

**Speaker note:** "Unicorn" = product/market potential. Our differentiation
isn't a feature — it's an architecture competitors can't adopt cheaply.

---

## Slide 9 — Completeness
**Built, and running on a real phone today.**

- Checklist: 4 features live · all on-device · verified in airplane mode ·
  worldwide expense parsing · persistent on-device stores · custom onboarding +
  icon · test coverage on core logic.
- "MIT-licensed own code; Built with Llama (compliant)."

**Speaker note:** This isn't a mockup. It installs and runs as a standalone APK.

---

## Slide 10 — Close
**LifePilot — intelligence that stays yours.**

- Repo: github.com/kiAnukal/lifepilot
- "On-device. Private by construction. Made with AMD compute."
- Thank you + contact.

**Speaker note:** End on the one sentence you want them to remember:
"The smartest wellness app that never phones home."
