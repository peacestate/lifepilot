# Play Store listing — draft + Data Safety answers

Draft copy and the factual basis for every Play Console form. The Data Safety answers
below are grounded in the app's actual network behavior (audited 2026-07-16), not
aspirational — keep them in sync if any network touch is ever added.

## The app's complete network surface (ground truth)

1. **Model download** (first run + lazy Overwhelm bundle): plain GETs to
   `github.com/peacestate/lifepilot/releases/download/...` for immutable model weights.
   No user data in the request — no id, no telemetry, no body, no cookies.
2. **Weather/AQI for Hydration** (OFF by default, opt-in): GET to `api.open-meteo.com`
   and `air-quality-api.open-meteo.com` with **coarse** latitude/longitude only. No
   account, no identifier. Response is used on-device and cached locally.
3. **Model-update check** (OFF by default — `remoteRegistryUrl` is unset): GET of a
   public model catalog. Nothing about the user sent.

That is everything. All inference, all health data, all task text, all receipts: on-device only.

## Store listing copy

**App name** (max 30 chars):
> LifePilot: Private AI Planner

**Short description** (max 80 chars):
> Break overwhelming tasks into doable steps. AI on your phone — 100% private.

**Full description** (max 4000 chars):

> **For when starting is the hardest part.**
>
> A task that feels too big to begin. A day that got away from you. LifePilot takes
> the thing that's overwhelming you and breaks it into small, doable steps — using a
> full AI language model that runs entirely on your phone.
>
> **Nothing you type ever leaves your device.** Not to a server, not to us, not to
> anyone. Put your phone in airplane mode: every feature still works. That's not a
> fallback — it's the whole design.
>
> **🧠 Overwhelm Manager**
> Type (or say) what's weighing on you. The on-device AI breaks it into 5–8 small
> steps you can actually start. It privately remembers what worked for you — on your
> phone only — and gets more helpful over time. Built for brains that struggle with
> task paralysis, executive function, and "I don't know where to start" — if you have
> ADHD or just an overwhelming week, this is for you.
>
> **⚡ Energy Planner**
> A trained on-device model predicts your energy curve for the day from your sleep and
> activity (via Health Connect, read-only, with your permission). Schedule hard things
> when you'll have the energy for them.
>
> **💧 Hydration Tracker**
> A personalized daily water target from an on-device model — optionally weather-aware
> (the one opt-in network lookup, coarse location only, off by default).
>
> **🧾 Expense Scanner**
> Point your camera at a receipt. On-device OCR and trained models extract, categorize,
> and total it — the receipt image never leaves your phone. Works with receipts and
> currencies worldwide.
>
> **Why on-device matters**
> What overwhelms you, how you sleep, what you spend — this is the most personal data
> there is. LifePilot's AI models live on your phone, so using AI doesn't mean handing
> that data to anyone. No account. No sign-up. No analytics. No ads. Ever.
>
> **The honest fine print**
> • One-time model download on first use (the core app needs ~0.2 MB; the Overwhelm
>   Manager's language model is a ~1.5 GB one-time download over Wi-Fi, resumable).
> • The only network calls the app can ever make are: fetching model files, and the
>   optional weather lookup you can turn on for hydration. Both send nothing about you.
>
> Take back your day — privately.

**Category**: Productivity (alt: Health & Fitness — Productivity reaches the
task-paralysis search intent better and avoids the stricter health-app review lane
where possible; note Health Connect usage triggers health review regardless).

**Tags/keywords woven into the description** (Play indexes description text): ADHD,
executive function, task paralysis, overwhelmed, break tasks into steps, offline AI,
private AI, on-device AI, no account.

## Data Safety form (Play Console → App content → Data safety)

| Question | Answer | Basis |
|---|---|---|
| Does your app collect or share any of the required user data types? | **Yes** (location only — see below) | Weather opt-in transmits coarse lat/lon off-device |
| **Location → Approximate location** | Collected: **Yes, optional** (user can use app without it). Shared: **No** (service-provider processing). Processed **ephemerally**; **not linked** to identity (no account/identifier exists); **not used for tracking**; purpose: **App functionality** | `weatherSource.ts` sends coarse lat/lon to Open-Meteo only when the user enables weather; nothing is stored server-side by us (we have no server) |
| Health info (sleep, activity, heart rate) | **Not collected** in Data Safety terms: read via Health Connect, processed **on-device only**, never transmitted off the device | `healthConnectSource.ts` — no network path exists for this data |
| Photos, camera (receipts) | **Not collected**: processed on-device, never transmitted | Expense OCR is fully local |
| Microphone/voice | **Not collected**: on-device transcription only, never transmitted | `useVoiceInput.ts` |
| Messages/text the user types | **Not collected**: on-device inference only | LlamaProvider imports zero networking |
| Data encrypted in transit? | Yes (the two GET-only calls are HTTPS) | |
| Deletion mechanism? | All data is local; uninstalling deletes everything. In-app: stores live in app documents dir | |

**Nuance to answer carefully**: Google's policy treats data "transmitted off device
but processed only ephemerally" as still needing disclosure for location. Declaring
approximate location as *optional, ephemeral, app-functionality, not linked, not
tracked* is the honest maximal disclosure. Everything else genuinely never leaves the
device, which the airplane-mode demo proves.

## Health Connect — separate mandatory step

Reading `READ_SLEEP` / `READ_STEPS` / `READ_HEART_RATE` requires, beyond Data Safety:
- The **Health Connect by Android declaration form** in Play Console (justify each
  permission; ours: on-device energy prediction, data never leaves the device).
- A **privacy policy URL** (required for all apps, doubly for health). Needs a simple
  public page — the README's privacy section adapted works; host via GitHub Pages.
- Health apps face longer review; submit the declaration early.

## Permissions the listing must justify

| Permission | Why (user-facing wording) |
|---|---|
| Camera | Scan receipts. Images are processed on your phone and never uploaded. |
| Coarse location | Optional weather-aware hydration target. Off by default. |
| Health Connect (sleep/steps/heart rate) | Read-only, to predict your daily energy on-device. |
| Record audio | Speak a task instead of typing. Transcribed on your phone. |
| Notifications | Gentle nudges (hydration, focus windows, next steps). Optional. |

## Release-engineering checklist (owner actions)

- [ ] Play Console developer account ($25 one-time) — needs identity verification.
- [ ] Build an **AAB** (not APK): `eas build --platform android --profile production`
      or local `./gradlew bundleRelease`; Play requires app bundles.
- [ ] **Play App Signing**: Play re-signs; the current local keystore stays for the
      GitHub-release APK. Both can coexist (different distribution channels), but a
      Play install won't upgrade a GitHub-APK install (different signatures) — worth
      a README note.
- [ ] `versionCode` bump + `targetSdkVersion` per current Play minimum (34+ as of 2026).
- [ ] Assets: 512×512 icon, 1024×500 feature graphic, ≥4 phone screenshots
      (onboarding privacy step, Overwhelm steps, Energy curve, Expense scan), optional
      30s video (the demo video, trimmed).
- [ ] Privacy policy URL live before submitting Data Safety.
- [ ] Content rating questionnaire (should land "Everyone").
- [ ] Countries: all; the app has no regional dependency.

## What NOT to claim

- No medical/diagnostic claims ("helps ADHD symptoms", "improves mental health") —
  keeps us out of the medical-app category and is honest: it's a productivity tool
  that is *friendly to* neurodivergent users, not a treatment.
- No "works forever offline" absolutism in *first-run* copy — the model download needs
  one connection; the copy above words this honestly.
