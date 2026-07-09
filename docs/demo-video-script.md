# LifePilot — Demo Video Script (Track 3: Unicorn)

> Target length: **2:30–3:00**. Judges watch a lot of these — hook in the first
> 10 seconds, prove the privacy claim on camera, keep it moving.
> Record the phone screen (scrcpy or built-in screen recorder). Voiceover can be
> recorded separately and laid over — cleaner than talking while tapping.
>
> THE ONE MONEY SHOT: airplane mode visibly ON while AI features run. Do not skip it.

---

## 0:00–0:12 — Hook
**On screen:** LifePilot home screen, calm and clean. Pull down the status bar so
the **airplane-mode icon is clearly visible**, then dismiss it.

**VO:** "This is LifePilot — a wellness app with four AI features. Watch the top
of the screen: airplane mode is on. Nothing I show you touches the internet."

---

## 0:12–0:20 — The thesis
**On screen:** Slowly scroll the four feature cards (Overwhelm, Energy,
Hydration, Expense).

**VO:** "Overwhelm, energy, hydration, expenses — every one runs a real AI model,
entirely on the phone. No servers. No account. No data collection."

---

## 0:20–1:05 — Overwhelm Manager (the star)
**On screen:** Open Overwhelm Manager. Type a real, relatable task — e.g.
*"plan my sister's surprise birthday dinner"*. Hit go. Let the steps **stream in
live** (don't cut — the on-device generation happening in real time is the proof).

**VO:** "I'll give it something messy. This is Meta's Llama 3.2 1B, quantized and
running through ExecuTorch on the phone's own compute. It breaks the task into
calm, ordered steps — and it personalizes from memory that never leaves the
device." *(Optional: tap the mic and speak a task to show on-device Whisper.)*

**On screen:** Show the finished 5–8 step breakdown. Brief pause on it.

---

## 1:05–1:35 — Expense Scanner
**On screen:** Open Expense Scanner. Scan a real receipt (or upload a PDF).
Show the OCR → extracted merchant, amount, currency, category populating.

**VO:** "Point it at a receipt. On-device OCR reads it, and trained extraction
and categorization models pull out the merchant, total, and category — it
handles currencies from around the world. Still no network."

---

## 1:35–2:00 — Hydration + Energy (quick)
**On screen:** Hydration screen — show the personalized target and the "why
today" breakdown. Toggle **Live weather** on and show the target update + the
privacy footnote. Then a quick flash of the Energy curve.

**VO:** "Hydration gives a personalized daily target from a trained model. The
only optional network call in the whole app is this weather toggle — off by
default, coarse location only, and it's the exception that proves the rule.
Energy predicts your focus and wind-down windows from your own activity."

---

## 2:00–2:20 — The AMD / architecture story
**On screen:** Cut to a simple slide or the repo — `ml/export/` Dockerfile, or
the architecture diagram from the deck.

**VO:** "So where does AMD come in? The models are trained and exported on AMD
MI300X with ROCm — a containerized pipeline. AMD compute builds the
intelligence; the phone runs it privately. The shipped app never calls the cloud
by design."

---

## 2:20–2:45 — Why it matters (the unicorn line)
**On screen:** Back to the calm home screen, or a title card with the tagline.

**VO:** "Most wellness apps are built to monetize your data. LifePilot removes
the server entirely — which is something the incumbents can't copy without
breaking their own business model. Intelligence that actually stays yours."

---

## 2:45–3:00 — Close
**On screen:** Title card: **LifePilot — private by construction.**
`github.com/kiAnukal/lifepilot`

**VO:** "LifePilot. The smartest wellness app that never phones home. Thanks for
watching."

---

## Recording checklist
- [ ] Phone on Do-Not-Disturb (no notifications mid-take).
- [ ] Airplane mode genuinely ON for the feature demos (this is the whole pitch).
- [ ] Models provisioned beforehand (see RUNBOOK) so nothing stalls on camera.
- [ ] Do a dry run of the Overwhelm generation first — pick a prompt you've seen
      produce a clean result, so the live take doesn't fumble.
- [ ] Screen record at device resolution; add VO in a second pass.
- [ ] Keep total under 3:00. If long, cut the Energy beat first, Hydration second.
