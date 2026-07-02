# LifePilot — Run the app (Overwhelm Manager)

Exact steps to take the app from source → running on a device with the real
on-device model. **You run these** (owner machine-safety rule); the agents only
wrote the code. Android is the primary target (matches Snapdragon + works on
Windows). **iOS needs a Mac** — notes inline.

Pinned stack (do not drift — model-contract §6):
`react-native-executorch@0.4.8` · Expo SDK 53 · New Architecture ON · model =
HF QLoRA INT4 `.pte` at revision **v0.4.0**.

---

## 0. Prerequisites (one-time)
- **Node 18+**, **JDK 17**, **Android Studio** + an SDK platform + an emulator or a
  physical Android phone (a Snapdragon phone with **≥6 GB RAM** for the real latency).
- `adb` on PATH (ships with Android SDK platform-tools).
- This app uses native code → it **cannot run in Expo Go**. We use a dev client / prebuild.

## 1. Install JS deps
```bash
cd D:/LifePilot/mobile
npm install
```
If npm flags a peer-dep conflict, accept Expo's resolution: `npx expo install --fix`.

## 2. Get the model files
Download the **QLoRA INT4** artifacts from
`software-mansion/react-native-executorch-llama-3.2` **at revision `v0.4.0`**
(not `main` — main may be re-exported for a newer runtime):
```bash
pip install -U "huggingface_hub[cli]"
huggingface-cli download software-mansion/react-native-executorch-llama-3.2 \
  --revision v0.4.0 --local-dir ./_model_dl
# from _model_dl, identify the 1B QLoRA .pte + tokenizer.json + tokenizer_config.json
```
- Confirm the real `.pte` filename and set it in `src/models/overwhelm/manifest.json`
  → `files.model`. Also fill `bytes.model` (file size) and `sha256.model`:
  ```bash
  # sizes/hashes for the manifest
  stat -c %s llama3_2-1B-qlora.pte         # -> bytes.model
  sha256sum llama3_2-1B-qlora.pte          # -> sha256.model
  ```
- Keep `tokenizer.json` + `tokenizer_config.json` filenames as-is (manifest already
  points at them).

> Need your OWN model instead of the HF one? Export it on **Kaggle**
> (`ml/export/kaggle_export_llama32_overwhelm.py`) with `EXECUTORCH_REF` = the
> ExecuTorch version matching r-n-e 0.4.8 (v0.6.0). Never export on this PC (8 GB RAM).

## 3. Generate the native project (prebuild)
```bash
npx expo prebuild --platform android
```
This creates `android/` with New Architecture enabled (set in `app.json`).

## 4. First run (it will show the model-load error — that's expected)
```bash
npx expo run:android      # builds + installs the dev client, launches Metro
```
On launch you'll see the calm **error** state. Open the Metro/adb logs — the
`ModelNotProvisioned` message prints the **exact path** the app expects, e.g.
`file:///data/user/0/com.lifepilot.app/files/models/overwhelm/...`. That confirms
where to put the model.

## 5. Get the model onto the device (dev build)
Push the three files into the app's private files dir (`run-as` works on the debug
build). From the folder holding the downloaded files:
```bash
PKG=com.lifepilot.app
adb push llama3_2-1B-qlora.pte /data/local/tmp/
adb push tokenizer.json        /data/local/tmp/
adb push tokenizer_config.json /data/local/tmp/
adb shell run-as $PKG mkdir -p files/models/overwhelm
for f in llama3_2-1B-qlora.pte tokenizer.json tokenizer_config.json; do
  adb shell run-as $PKG sh -c "cp /data/local/tmp/$f files/models/overwhelm/$f"
done
adb shell rm /data/local/tmp/llama3_2-1B-qlora.pte   # ~1 GB, clean up
```
Reload the app (shake → Reload, or `r` in Metro). The provisioner now finds the
files, warms the model, and you reach the **input** screen.

> For a shippable build (not dev), the `.pte` is placed as a native bundle asset and
> copied on first launch instead of adb — that's the app-size decision flagged in
> `docs/overwhelm-model-contract.md` §8. Dev uses adb so we don't bloat the APK while
> iterating.

## 6. Use it
Type a real task → **Break it down** → steps stream in from the on-device model →
check them off. This is the genuine Llama 3.2 1B output, not the canned preview.

## 7. Verify the privacy promise
```bash
# 1) Lint: the feature must contain no network calls
npx eslint --config .eslintrc.overwhelm.js "src/**/*.{ts,tsx}"
# 2) Airplane-mode test: enable airplane mode on the device, generate steps.
#    It must still work end-to-end (proves zero network in the inference path).
# 3) (optional) Watch traffic with `adb shell` / a proxy during a generation:
#    expect ZERO outbound from the app.
```

## 8. Tests
```bash
npm test          # OverwhelmService.test.ts — parse/clamp parity with the eval
npm run typecheck
```

---

## Two things to confirm on-device (CTO punch-list P1)
1. **Chat-template parity (A2 follow-up):** confirm `react-native-executorch`'s
   Llama-3.2 template produces the same tokens as model-contract §3 — watch for an
   injected "Cutting Knowledge Date / Today Date" system preamble. If present, align
   the eval prompt and the app so the device behaves like the 20-task report.
2. **`configure` keys:** verify 0.4.8 honors `maxNewTokens` + `stopTokenIds` (the call
   is wrapped in try/catch, so a wrong key won't crash — but an unbounded
   `maxNewTokens` hurts latency). Llama stops on `<|eot_id|>` via tokenizer config
   regardless.

## iOS (needs a Mac)
`npx expo prebuild --platform ios && npx expo run:ios`. Add the model under the app's
documents dir (e.g. via Xcode "Devices" → app container, or the same one-time-copy
seam). New Architecture is on by default in SDK 53.
```
