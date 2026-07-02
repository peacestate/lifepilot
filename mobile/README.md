# LifePilot — Mobile (React Native)

First feature: **Overwhelm Manager**. User types what's overwhelming them →
on-device **Llama 3.2 1B (4-bit `.pte`)** via **ExecuTorch** → 5–10 imperative
micro-steps → checklist. **100% offline. No network call anywhere in the
feature.**

> Machine-safety: this repo's setup is **commands to run, not run for you**. The
> agent wrote the code; the **owner** runs the installs/builds below.

---

## What's built (this PR)

Inference layer — `mobile/src/features/overwhelm/`
- `OverwhelmService.ts` — pure: `buildPrompt`, `parseSteps`, `classify`,
  `buildResult`, `SYSTEM_PROMPT`, `DECODING`, stop token. No React/native/network.
  Parser is **byte-identical to `ml/test/overwhelm_eval.py`** (eval parity).
- `OverwhelmService.test.ts` — Jest; same sample cases as the Python self-test.
- `useOverwhelmManager.ts` — hook wrapping `react-native-executorch`'s `useLLM`:
  `state` (`loading|ready|generating|error`), `steps`, `run`, `stop`, `retry`,
  streaming step append, warm-up on mount.
- `modelProvisioner.ts` — resolves the on-device `.pte` (+ tokenizer) to local
  `file://` paths via **`expo-file-system`**, with a size-vs-manifest integrity guard.
- `types.ts` — `OverwhelmStep`, `OverwhelmResult`, state types.

App shell — `mobile/` (Expo SDK 53, New Architecture on)
- `package.json`, `app.json`, `index.js`, `App.tsx`, `babel.config.js`,
  `metro.config.js`, `tsconfig.json` — runnable Expo project mounting the screen.

UI — to `design/overwhelm/screen-spec.md`
- `src/theme/tokens.ts` — colors/type/spacing/radii/elevation (spec §3).
- `src/screens/OverwhelmScreen.tsx` — the four body states + `overwhelmCopy.ts`.
- `src/components/` — `OverwhelmInput`, `PrimaryButton`, `SecondaryButton`,
  `TaskSummary`, `PulseIndicator`, `StepProgress`, `StepList`, `StepItem`,
  `StepCheckbox`, `MessageBlock`, `PrivacyFootnote`.

Model files — `mobile/src/models/overwhelm/`
- `manifest.json` — describes the model files (AIML fills `sha256`/`bytes`).

### Maps to the three specs
| Spec | Where it's honored |
|---|---|
| `design/overwhelm/screen-spec.md` | `tokens.ts`, `OverwhelmScreen.tsx`, `components/*`, `overwhelmCopy.ts` |
| `docs/overwhelm-executorch-integration.md` | feature folder layout, `useOverwhelmManager`, provisioner, single-instance, warm-up, privacy-in-code |
| `docs/overwhelm-model-contract.md` (**authority for I/O**) | `OverwhelmService.ts` prompt §3 + parser §4 + streaming/Stop §5 |

---

## Running it — see `RUNBOOK.md`

The full step-by-step (install → download model → prebuild → push model to device →
run → verify offline) lives in **[`RUNBOOK.md`](./RUNBOOK.md)**. It is the single
source for the owner-run commands. Summary:

- The app is an **Expo SDK 53** project with **New Architecture on** (`app.json`).
  `react-native-executorch@0.4.8` is autolinked native code → **no Expo Go**; use a
  dev client (`npx expo prebuild` + `npx expo run:android`).
- The model is provisioned to the device's documents dir (dev: `adb push`; release: a
  one-time copy). `modelProvisioner.ts` resolves it via `expo-file-system` — **already
  implemented**, no FS module to choose.

> Pin (model-contract §6): `react-native-executorch@0.4.8` — three-source `useLLM`
> API, runtime matched to the HF `.pte` (HF revision `v0.4.0` = ExecuTorch 0.6.0
> export). **Do NOT use 0.5.0+** (breaking API change).

Still to confirm on-device:
- The `react-native-executorch` **API assumptions** in `useOverwhelmManager.ts`
  (block comment A1–A4) were verified by the CTO against 0.4.8. **A2 was corrected:**
  0.4.x `generate()` takes a **messages array** and applies the Llama chat template
  internally — the hook now passes `[{role:'system'…},{role:'user'…}]`, NOT a raw
  pre-templated string. On device, AIML + mobile must confirm the library's chat
  template produces the same token sequence as model-contract §3 (watch for an
  injected "Cutting Knowledge Date / Today Date" system preamble).

---

## Where to drop the model files (AIML deliverable)

Place in `mobile/src/models/overwhelm/` (names already in `manifest.json`):
```
llama3_2-1B-qlora.pte     # QLoRA INT4, exported with ExecuTorch v0.6.0
tokenizer.json
tokenizer_config.json
manifest.json             # fill sha256.model + bytes.model on delivery
```
The `.pte` is ~1 GB → it ships as a **raw platform asset** (Android
`android/app/src/main/assets/`, iOS bundle resource) and is **copied once** into
the documents dir on first run, then loaded by `file://` (integration §1.2).
It exceeds Metro's `require()` ceiling — do **not** `require()` the `.pte`.

---

## Offline / privacy gates (CTO pre-demo sign-off)

- **ESLint network-ban** (integration §5.1): `.eslintrc.overwhelm.js` bans
  `fetch`/`XMLHttpRequest`/HTTP clients under
  `mobile/src/features/overwhelm/**` and `mobile/src/screens/Overwhelm*`.
  Merge it into the app's ESLint config so CI fails on any network import.
- **Airplane-mode acceptance test** (integration §5.4): enable airplane mode →
  cold start → run Overwhelm end-to-end → must produce a valid step list. This
  is a required pre-demo check.
- **Network audit** (integration §5.5): run a session through a network monitor
  and confirm **zero** outbound requests with user content.
- The feature imports zero networking by construction; grep confirms no
  `http(s)://` literal in the model-loading path.

---

## Still needed before it runs

The app is fully scaffolded and the provisioner is implemented. What remains is
owner-run setup + the model file:

1. **Owner:** run `RUNBOOK.md` — `npm install`, download the `.pte` (HF rev `v0.4.0`),
   `expo prebuild`, push the model to the device, `expo run:android`.
2. **AIML / owner:** fill `manifest.json` `bytes.model` + `sha256.model` + the real
   `.pte` filename from the HF download; optionally run the 20-task report
   (`ml/test/`) on a device for real latency.
3. **On-device verify (P1):** chat-template parity vs model-contract §3 (date-preamble
   check) and `configure` key names in 0.4.8. Optional haptics on check (spec §5b).
