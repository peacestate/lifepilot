# LifePilot — Run the app

> **For hackathon judges:** the linked **demo video is the primary evidence this
> app works end-to-end** — it shows all 4 features running live, on-device, in
> airplane mode. The instructions below let a technically-inclined reviewer
> reproduce that themselves, but they are not required to judge the submission.
> They exist for credibility/completeness, not as a live judging step.
>
> If you do want to run it yourself: you'll need an Android phone or emulator,
> `adb`, and about 10 minutes (most of it is a ~1.2 GB one-time file push).

Every AI feature (Overwhelm Manager / Llama 3.2, Energy Predictor, Hydration
Tracker, Expense Scanner) runs **fully on-device via ExecuTorch**. No user data
ever leaves the phone — the app works in airplane mode by design, not as an
edge case.

Pinned stack (do not drift — model-contract §6): `react-native-executorch@0.4.10`
· Expo SDK 53 · New Architecture ON · ExecuTorch runtime **v0.6.0**.

> ⚠️ **Voice input adds a new native module — existing APKs won't have it.**
> `react-native-audio-api@0.13.1` is a brand-new native dependency for
> on-device speech-to-text in the Overwhelm Manager. Two things had to be
> worked around to get it to actually build, both already fixed in this repo:
>
> 1. **Metro can't bundle without `react-native-gesture-handler`.** Audio-api
>    bundles an unused UI component (`Audio/controls/AudioControls.tsx`, which
>    this app never renders) that imports gesture-handler — Metro still needs
>    every import reachable through the package's barrel export to *resolve*.
>    Fixed by adding `react-native-gesture-handler@^2.28.0` as a real
>    dependency (safe, no native codegen conflicts).
> 2. **That same unused component also imports `react-native-reanimated` —
>    do NOT install the real package.** The real reanimated bundles its own
>    native "worklets" C++ codegen (`NativeWorkletsModuleSpecJSI`), which
>    collides at native-build time with the standalone `react-native-worklets`
>    package audio-api itself needs (`redefinition of
>    'NativeWorkletsModuleSpecJSI'` — two sources define the same symbol).
>    Fixed by stubbing reanimated at the Metro resolver level instead —
>    `mobile/stubs/react-native-reanimated.js` (a plain-JS stand-in for the
>    exact 3 bindings that one file needs: `Animated.View`, `useAnimatedRef`,
>    `useSharedValue`) wired via `metro.config.js`'s
>    `resolver.extraNodeModules`. **`react-native-reanimated` must NOT appear
>    in `package.json` or `node_modules` at all** — if a future `npm install`
>    or dependency bump re-adds it for some other reason, this collision
>    comes back.
> - `react-native-worklets@0.7.1` (needed by `react-native-audio-api`'s own
>   peer dep) — **pinned, not latest.** Its 0.8.0+ line requires
>   react-native 0.81+; this project is on react-native 0.79.5.
>
> Any APK built *before* this change (including `lifepilot-preview.apk`
> referenced in the Quick Start above) does **not** include any of this —
> you need a **fresh `npm install` + `expo prebuild` + EAS build**. Before
> spending a full EAS build cycle re-checking a fix, reproduce the two
> failure points locally first — much faster than a cloud build cycle:
> ```bash
> # Reproduces EAS's EAGER_BUNDLE phase (JS/Metro resolution errors):
> npx expo export:embed --eager --platform android --dev false \
>   --bundle-output /tmp/eager-test-bundle.js
> ```
> A clean "Bundled NNNms index.js (N modules)" means the JS bundling step
> will pass — it does **not** catch native Gradle/C++ codegen collisions
> like the worklets one above, which only surface in the real cloud build's
> "Run gradlew" phase. If a build fails there, decode the log (it's
> brotli-compressed — `pip install brotli`, then `brotli.decompress(...)`)
> and grep for `FAILURE:` / `error:` rather than guessing.

---

## Quick start (reviewer path — standalone build, no Metro required)

This uses the `preview` EAS build profile, which bundles the JS into the APK
itself — unlike a `development` build, it does **not** need Metro running.
Install the APK, push the model files once, launch the app.

### 0. Prerequisites
- Android phone or emulator, **USB or Wireless debugging enabled**, `adb` on PATH.
- The release APK (`lifepilot-preview.apk`) and the model bundle
  (`lifepilot-models.zip`) — both attached to the submission's GitHub Release.
  (Model files are **not** in the git repo — they're large binaries, gitignored
  by design; see `.gitignore` → `**/*.pte`, `/models/`.)

### 1. Install the APK
```bash
adb install lifepilot-preview.apk
```

### 2. Unzip the model bundle
```bash
unzip lifepilot-models.zip -d lifepilot-models
cd lifepilot-models
ls
# llama3_2_qat_lora.pte   tokenizer.json   tokenizer_config.json   (Overwhelm Manager)
# energy_predictor.pte                                             (Energy Predictor)
# hydration_predictor.pte                                          (Hydration Tracker)
# expense_line_tagger.pte  expense_category.pte                    (Expense Scanner)
```

### 3. Push every model file into the app's private storage
Git-bash mangles device-side absolute paths (e.g. `/data/local/tmp/`) into
Windows paths — set this once per shell session before any of the commands below:
```bash
export MSYS_NO_PATHCONV=1
```

Push each feature's files to a staging area, then copy them into the app's
sandbox with `run-as` (works on any debuggable build — `preview`/`development`
profiles both are). **Do not wrap the copy in `sh -c "..."`** — nested quoting
silently breaks it (`cp: Needs 1 argument`); call `cp` directly.

```bash
PKG=com.lifepilot.app

# --- Overwhelm Manager (Llama 3.2 1B — the big one, ~1.18 GB, budget a few minutes) ---
adb push llama3_2_qat_lora.pte   /data/local/tmp/
adb push tokenizer.json          /data/local/tmp/
adb push tokenizer_config.json   /data/local/tmp/
adb shell run-as $PKG mkdir -p files/models/overwhelm
adb shell run-as $PKG cp /data/local/tmp/llama3_2_qat_lora.pte files/models/overwhelm/llama3_2_qat_lora.pte
adb shell run-as $PKG cp /data/local/tmp/tokenizer.json        files/models/overwhelm/tokenizer.json
adb shell run-as $PKG cp /data/local/tmp/tokenizer_config.json files/models/overwhelm/tokenizer_config.json

# --- Energy Predictor ---
adb push energy_predictor.pte /data/local/tmp/
adb shell run-as $PKG mkdir -p files/models/energy
adb shell run-as $PKG cp /data/local/tmp/energy_predictor.pte files/models/energy/energy_predictor.pte

# --- Hydration Tracker ---
adb push hydration_predictor.pte /data/local/tmp/
adb shell run-as $PKG mkdir -p files/models/hydration
adb shell run-as $PKG cp /data/local/tmp/hydration_predictor.pte files/models/hydration/hydration_predictor.pte

# --- Expense Scanner (two models: line tagger + category classifier) ---
adb push expense_line_tagger.pte /data/local/tmp/
adb push expense_category.pte    /data/local/tmp/
adb shell run-as $PKG mkdir -p files/models/expense
adb shell run-as $PKG cp /data/local/tmp/expense_line_tagger.pte files/models/expense/expense_line_tagger.pte
adb shell run-as $PKG cp /data/local/tmp/expense_category.pte    files/models/expense/expense_category.pte

# --- Voice input (Whisper tiny.en, speak-a-task on Overwhelm Manager) ---
adb push whisper_tiny_en_xnnpack_encoder.pte /data/local/tmp/
adb push whisper_tiny_en_xnnpack_decoder.pte /data/local/tmp/
adb push whisper_tokenizer.json              /data/local/tmp/
adb shell run-as $PKG mkdir -p files/models/voice
adb shell run-as $PKG cp /data/local/tmp/whisper_tiny_en_xnnpack_encoder.pte files/models/voice/whisper_tiny_en_xnnpack_encoder.pte
adb shell run-as $PKG cp /data/local/tmp/whisper_tiny_en_xnnpack_decoder.pte files/models/voice/whisper_tiny_en_xnnpack_decoder.pte
adb shell run-as $PKG cp /data/local/tmp/whisper_tokenizer.json              files/models/voice/whisper_tokenizer.json

# --- Text embeddings (semantic Overwhelm Manager memory — "Clean my room" / "Tidy my bedroom") ---
adb push multi-qa-MiniLM-L6-cos-v1_xnnpack.pte /data/local/tmp/
adb push tokenizer.json                        /data/local/tmp/embeddings_tokenizer.json
adb push tokenizer_config.json                 /data/local/tmp/embeddings_tokenizer_config.json
adb shell run-as $PKG mkdir -p files/models/embeddings
adb shell run-as $PKG cp /data/local/tmp/multi-qa-MiniLM-L6-cos-v1_xnnpack.pte files/models/embeddings/multi-qa-MiniLM-L6-cos-v1_xnnpack.pte
adb shell run-as $PKG cp /data/local/tmp/embeddings_tokenizer.json             files/models/embeddings/tokenizer.json
adb shell run-as $PKG cp /data/local/tmp/embeddings_tokenizer_config.json      files/models/embeddings/tokenizer_config.json

# --- Manifests (each feature's manifest.json ships inside the APK's JS bundle already; no push needed) ---

# --- Clean up the staging copies on-device (the .pte files, ~1.3 GB total) ---
adb shell rm -f /data/local/tmp/llama3_2_qat_lora.pte /data/local/tmp/tokenizer.json \
  /data/local/tmp/tokenizer_config.json /data/local/tmp/energy_predictor.pte \
  /data/local/tmp/hydration_predictor.pte /data/local/tmp/expense_line_tagger.pte \
  /data/local/tmp/expense_category.pte /data/local/tmp/whisper_tiny_en_xnnpack_encoder.pte \
  /data/local/tmp/whisper_tiny_en_xnnpack_decoder.pte /data/local/tmp/whisper_tokenizer.json \
  /data/local/tmp/multi-qa-MiniLM-L6-cos-v1_xnnpack.pte /data/local/tmp/embeddings_tokenizer.json \
  /data/local/tmp/embeddings_tokenizer_config.json
```

### Getting the Whisper tiny.en files (voice input)
Same download pattern as Llama — official pre-exported artifact, no custom training:
```bash
huggingface-cli download software-mansion/react-native-executorch-whisper-tiny.en \
  --revision v0.4.0 --local-dir ./_whisper_dl
# take xnnpack/whisper_tiny_en_xnnpack_encoder.pte, xnnpack/whisper_tiny_en_xnnpack_decoder.pte,
# and whisper_tokenizer.json (root of the repo, not under xnnpack/)
```
After downloading, fill in `mobile/src/models/voice/manifest.json`'s `sha256`/`bytes` fields
(currently `null` placeholders) the same way `overwhelm/manifest.json` was filled in for Llama —
`stat -c %s <file>` for bytes, `sha256sum <file>` for the hash.

### 4. Verify the files landed
```bash
adb shell run-as $PKG ls -la files/models/overwhelm files/models/energy files/models/hydration files/models/expense files/models/voice
```
Expect to see (sizes approximate, confirm they're non-zero):

| Feature | File | Size |
|---|---|---|
| Overwhelm Manager | `llama3_2_qat_lora.pte` | ~1,181,451,008 bytes (~1.1 GB) |
| Overwhelm Manager | `tokenizer.json` | ~9,906,781 bytes |
| Overwhelm Manager | `tokenizer_config.json` | ~54,527 bytes |
| Energy Predictor | `energy_predictor.pte` | ~44,512 bytes |
| Hydration Tracker | `hydration_predictor.pte` | ~11,152 bytes |
| Expense Scanner | `expense_line_tagger.pte` | ~88,724 bytes |
| Expense Scanner | `expense_category.pte` | ~87,708 bytes |
| Voice input | `whisper_tiny_en_xnnpack_encoder.pte` | check after download, no hardcoded size yet |
| Voice input | `whisper_tiny_en_xnnpack_decoder.pte` | check after download, no hardcoded size yet |
| Voice input | `whisper_tokenizer.json` | check after download, no hardcoded size yet |

### 5. Launch and use
```bash
adb shell am start -n com.lifepilot.app/.MainActivity
```
Walk through onboarding, then try each feature:
- **Overwhelm Manager** — type a task (e.g. "Clean my room") → "Break it down" →
  steps stream in from the on-device Llama 3.2 model.
- **Energy Planner** — shows a predicted 24h energy curve with focus/wind-down windows.
- **Hydration** — shows a personalized daily target (mL).
- **Expense Scanner** — scan or upload a receipt; fields extract on-device.

### 6. Verify the privacy promise (optional, but the whole point of the app)
Put the phone in **airplane mode** and repeat step 5 — every feature above
must still work identically. That's the on-device guarantee: zero network
calls in any inference path.

### 7. Energy Predictor — Health Connect permission (first launch only)

The Energy Predictor reads real sleep/step/heart-rate data from Android's
**Health Connect** app (see `docs/energy-predictor-model-contract.md` §5 and
`mobile/src/features/energy/healthConnectSource.ts`). The first time you open
the Energy screen, a system permission dialog appears — grant it, or the
screen falls back to the manual-entry form automatically (no error shown,
per design).

**For this to show real, personalized data (not the manual-entry form),
Health Connect itself needs sleep/step data from somewhere** — it's a shared
store, not a sensor; something (Google Fit, Samsung Health, a smartwatch app,
etc.) has to be writing into it already. If the reviewer's/demo phone has
nothing feeding Health Connect, use the **"Enter today manually"** link on
the Energy screen instead (3 fields: sleep time, wake time, rough steps) —
this feeds the identical model input Health Connect would.

**Scope note (2026-07-06):** this integration covers sleep, steps, and heart
rate only. Screen time and phone-pickup count have no Health Connect
equivalent (they'd need Android's separate `UsageStatsManager` permission,
a different system entirely) — that is **not built yet**, and those two
fields still use the model's generic population-average value rather than
this user's real number. If a judge asks, the honest answer is "sensor
pipeline for sleep/activity is real and on-device today; phone-usage signal
is the next milestone." There is currently no "Usage Access" toggle to grant
for this feature — don't spend demo setup time looking for one; it isn't
wired to anything yet.

If Health Connect itself isn't installed/updated on a device (rare — it
ships built-in on Android 14+, and Play Store-installable on Android 9-13),
the app treats it as unavailable and goes straight to manual entry — no
crash, no error dialog.

---

## For developers — building from source

The reviewer path above uses a pre-built APK. To build it yourself:

### 0. Prerequisites (one-time)
- **Node 18+**, **JDK 17**, **Android Studio** + an SDK platform + an emulator or a
  physical Android phone. `adb` on PATH (ships with Android SDK platform-tools).
- This app uses native code → it **cannot run in Expo Go**.

### 1. Install JS deps
```bash
cd D:/LifePilot/mobile
npm install
```
If npm flags a peer-dep conflict, accept Expo's resolution: `npx expo install --fix`.

### 2. Get the model files
Model files are never committed (`.gitignore`: `**/*.pte`, `/models/`). Either:
- Download the reviewer bundle (`lifepilot-models.zip`) from the project's
  GitHub Release, **or**
- Reproduce them yourself:
  - **Overwhelm/Llama** — official pre-quantized artifact, not a custom export,
    no AMD/GPU step needed:
    ```bash
    pip install -U "huggingface_hub[cli]"
    huggingface-cli download software-mansion/react-native-executorch-llama-3.2 \
      --revision v0.4.0 --local-dir ./_model_dl
    # take llama-3.2-1B/QLoRA/llama3_2_qat_lora.pte + tokenizer.json + tokenizer_config.json
    ```
  - **Energy / Hydration / Expense — the canonical path is `ml/export/Dockerfile`
    run on AMD MI300X (ROCm).** This container is this project's actual, provable
    "Use of AMD Platforms" story for the hackathon — the deployed app never
    touches AMD/cloud at inference time by design, so this export pipeline is
    where AMD hardware genuinely gets used:
    ```bash
    cd ml/export
    docker build -t lifepilot-export .
    docker run --gpus all lifepilot-export python export_energy_predictor.py
    docker run --gpus all lifepilot-export python export_hydration.py
    docker run --gpus all lifepilot-export python export_expense_extractor.py
    ```
    Despite the `export_*.py` filenames (a holdover from where the scripts
    were first debugged), these are the real training+export scripts, hardware-agnostic
    (ROCm or CUDA) — they're the ones referenced by each model's manifest.
    Each script prints/writes its own `manifest.json` with real sha256/bytes — don't hand-edit.
    > **Status as of this writing:** the `.pte` files currently bundled were run
    > on the AMD ROCm notebook's free CPU tier (proving the scripts work, catching two real
    > environment bugs — see `ml/export/README.md`), not yet on AMD MI300X. The
    > MI300X re-export is a required, tracked step once the hackathon's AMD
    > compute window opens (2026-07-06) — the scripts are hardware-agnostic, so
    > this should be a re-run, not a rewrite. **The final submission's model
    > bundle should be regenerated from that AMD run before the deadline.**

### 3. Build a dev client (requires Metro — NOT the standalone reviewer path)
```bash
npx expo prebuild --platform android
npx expo run:android      # builds + installs the dev client, launches Metro
```
On first launch you'll see a calm **error** state — the `ModelNotProvisioned`
message in the Metro/adb logs prints the exact path the app expects
(`file:///data/user/0/com.lifepilot.app/files/models/<feature>/...`). Push the
model files as in the Quick Start section above, then reload (shake → Reload,
or `r` in Metro).

**Dev-client caveat:** a `development`-profile build does not bundle the JS —
it needs Metro running (`npx expo start --dev-client`) plus
`adb reverse tcp:8081 tcp:8081`, then a deep link to load the bundle:
```bash
adb shell am start -a android.intent.action.VIEW \
  -d "exp+lifepilot://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"
```
This is why the reviewer Quick Start above uses the standalone `preview`
profile instead — no Metro dependency, no extra terminal.

### 4. Build a standalone `preview` APK (matches the reviewer path)
```bash
eas build --profile preview --platform android
# download the resulting APK once the build finishes
```

### 5. Verify the privacy promise
```bash
# 1) Lint: on-device feature code must contain no network calls
npx eslint --config .eslintrc.overwhelm.js "src/**/*.{ts,tsx}"
# 2) Airplane-mode test (see Quick Start step 6)
# 3) (optional) Watch traffic with a proxy during a generation: expect ZERO outbound
```

### 6. Tests
```bash
npm test          # OverwhelmService.test.ts — parse/clamp parity with the eval
npm run typecheck
```

---

## iOS (needs a Mac)
`npx expo prebuild --platform ios && npx expo run:ios`. Add the model files
under the app's documents dir (e.g. via Xcode "Devices" → app container, or the
same one-time-copy seam used on Android). New Architecture is on by default in
SDK 53.

---

## Known issues (low priority, deliberately not fixed this round)
- **Decoding config (`temperature`/`topP`/`maxNewTokens`) in `useOverwhelmManager.ts` is
  not actually reaching the model.** The pinned `react-native-executorch` version's real
  `configure()` signature only accepts `{ chatConfig, toolsConfig }` — there is no
  generation-sampling API in this version at all (confirmed by reading the installed
  package's source, not just its types). The call silently no-ops instead of throwing.
  Stop-token handling is unaffected (the native controller reads `tokenizer_config.json`'s
  own `eos_token` directly, a separate working path). Net effect: Llama runs on whatever
  the native runtime's built-in default sampling is, not this app's tuned values — already
  true in every prior test, including the working 6-step "Clean my room" run recorded
  2026-07-02. Not fixed because this version has no exposed lever to fix it with, and
  bumping the pinned version this close to the deadline is its own risk.
- **`@llamaindex/liteparse-wasm` is pinned as `"*"` in `mobile/package.json`** — no version
  lock on the WASM PDF-parsing dependency Expense Scanner's `pdfSource.ts` uses for PDF
  receipt uploads (iOS table-aware path; Android falls back to the regex extractor).
  Could silently pick up a breaking change on a fresh `npm install`.
- **iOS LiteParse (Polygen AOT) path is unconfigured** — `app.json` has no Polygen plugin
  registered, despite code comments in `liteparseService.ts` describing an "iOS AOT" path
  as ready. Moot in practice (this project is Android-only, no test iPhone), but the
  comments overstate what's actually wired if anyone builds for iOS later.
- **Voice input (Whisper STT) is permanently unavailable on-device** —
  `org.pytorch.executorch.HuggingFaceTokenizer.initHybrid` throws
  `"No implementation found... is the library loaded?"` the moment `useSpeechToText`
  tries to load, because the native `.so` in `react-native-executorch@0.4.10`'s
  JitPack-built Android package is missing that JNI symbol. Confirmed as a real upstream
  bug, not our code: same class, same error, filed as
  [software-mansion/react-native-executorch#507](https://github.com/software-mansion/react-native-executorch/issues/507).
  **The fix exists upstream** — v0.7.0's release notes ("switched a library for
  tokenization, resulting in 64% reduction in package size") replaced this tokenizer
  entirely; confirmed via GitHub code search that `HuggingFaceTokenizer` no longer
  appears anywhere in the current upstream source tree. Not applied here because v0.7.0
  is three minor versions past our pin, and v0.6.0 alone bumps the ExecuTorch runtime to
  v1.0.0 — breaking every custom-exported `.pte` (Energy Predictor, Hydration Predictor,
  Expense line-tagger/category tagger) per [[lifepilot-executorch-version-pin]]'s
  no-forward-compat rule. Fixing it for real means re-exporting all three custom models
  on the AMD ROCm notebook against the new runtime, plus re-verifying the bundled Llama/Whisper/MiniLM
  registry entries (renamed/restructured across v0.8.0–v0.9.0). Owner decision
  2026-07-06: not worth the risk 5 days from the hackathon deadline — ship the honest UX
  (`MicButton` shows a visibly disabled state + `"Voice input isn't available on this
  device — type your task instead."`) and revisit the version bump post-hackathon.
  Llama (separate JS-side tokenizer) and the rest of the app are unaffected; MiniLM
  embeddings silently fall back to keyword-overlap matching for the same underlying
  reason.
- **Overwhelm Manager generation is unreliable under severe system memory pressure —
  TWO distinct failure modes, both mitigated (neither fixable from our side).** Root of
  both: the pinned `react-native-executorch@0.4.x` native LLM runtime does not degrade
  gracefully when the device is memory-starved. Observed repeatedly on-device 2026-07-06/07
  on a Tecno CK9n (8 GB) sitting at **80–160 MB free RAM with 1.3–2 GB in swap** (WhatsApp,
  Chrome, banking apps etc. all resident). `adb shell 'am force-stop'`-ing the heavy apps
  frees ~1 GB and makes runs behave; swiping them from the recents switcher does NOT (HiOS
  keeps them cached).
    - **Mode A — orphaned JS promise (the common one).** The native `generate()` finishes
      (or stalls) but NEVER resolves the JS promise it returned. PROVEN 2026-07-07: `adb
      shell top` showed the app at **0% CPU** (done computing) while the UI stayed stuck on
      "Thinking this through…" indefinitely (observed 15+ min on one PID), and our own
      crash-recovery draft file (`overwhelm_draft.json`) survived the whole run — i.e.
      `run()`'s `finally` never executed, so `await safeGenerate(...)` never returned.
      Tapping **Stop** recovered the UI cleanly (and did NOT segfault), confirming the JS
      thread was alive and only that one promise was orphaned. **Mitigation shipped:** a
      generation **watchdog** (`generateWatchdogged` in `useOverwhelmManager.ts`) races
      `generate()` against a progress-aware timeout — every streamed token resets a 45 s
      idle window (`GEN_IDLE_MS`), with a 150 s hard ceiling (`GEN_HARD_MS`). On timeout it
      calls `interrupt()` and returns control so the screen shows a "took too long — free
      memory and Try again" retry instead of an infinite spinner. `stop()` now also clears
      the draft (its own `finally` may never run for the same orphaned-promise reason).
    - **Mode B — process death.** Either a native `SIGSEGV` (`code 2 SEGV_ACCERR`, tombstone
      backtrace rooted in `libexecutorch_jni.so`'s XNNPACK path:
      `pthreadpool_parallelize_1d_tile_1d` → `XNNExecutor::forward` → `TextDecoderRunner::step`
      → `example::Runner::generate` — a real memory-access bug in the prebuilt `.so`, NOT an
      `lmkd` kill), OR a plain OS memory-reclaim kill when the app is backgrounded mid-run on
      this starved device. Either way the process dies with no catchable JS exception.
      **Mitigation shipped:** `overwhelmDraft.ts` persists the typed task the instant a run
      starts; a leftover file on next launch means the process died mid-`generate()`, and
      `useOverwhelmManager`'s `recoveredDraft` + `OverwhelmScreen`'s banner ("The app closed
      before finishing your last task" / Resume·Discard) recover the input instead of losing it.
  Why not fix upstream: our pin predates upstream's `GlobalThreadPool` threading rework
  ([PR #603](https://github.com/software-mansion/react-native-executorch/pull/603), merged
  2025-09-24) — consistent with an immature threading/lifecycle path here — but bumping the
  pin breaks every custom `.pte` per the voice-input bullet above, so it's out of scope this
  close to the deadline. **Verification status:** Mode B's draft-recovery banner is verified
  on-device (seen firing with a REAL orphaned draft on 2026-07-07 — "Clean my room" — plus a
  `run-as` simulated draft on 2026-07-06; Resume/Discard both work, file is one-shot). The
  Mode A watchdog is implemented + typechecks clean + loads without regression, but its 45 s
  auto-recovery has NOT yet been directly observed firing on-device, because this test device
  is so memory-starved that the process keeps hitting Mode B (dying) before the 45 s window
  elapses. Re-verify the watchdog on a device with more free RAM / a charged battery: submit
  a task under moderate memory pressure and confirm the UI flips to the retry screen at ~45 s
  of no streamed tokens instead of spinning forever.

## adb gotchas (all confirmed workarounds, not guesses)
- Git-bash mangles device-side absolute paths — `export MSYS_NO_PATHCONV=1`
  before any `adb push`/`adb shell` command with a leading-slash path.
- `adb shell run-as $PKG sh -c "cp src dest"` (nested quoting) silently breaks
  (`cp: Needs 1 argument`) — call `run-as $PKG cp src dest` directly, no `sh -c`.
- Large-file `adb push` over Wi-Fi can run as slow as ~4 MB/s — the 1.18 GB
  Llama file alone can take several minutes. Don't assume a small-file speed
  test generalizes.
- Wireless debugging: pair once per session (`adb pair <ip>:<port> <code>`,
  then `adb connect <ip>:<port>` with the *different* port shown on the main
  Wireless-debugging screen) — the pairing does not persist across the phone's
  own Wireless-debugging toggle being turned off.
