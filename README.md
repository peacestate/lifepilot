# LifePilot

An on-device wellness co-pilot. **Every AI feature runs on-device via ExecuTorch. No user data ever touches a server.** That is the core promise — not a fallback mode, the only mode. Put the phone in airplane mode and every feature still works.

Built for the **AMD Developer Hackathon: ACT II**, Track 3 (Unicorn). See [`docs/hackathon-submission.md`](docs/hackathon-submission.md) for the full submission pitch.

## Running it / seeing it work
The demo video is the primary evidence this app works end-to-end — all
features running live, on-device, in airplane mode. For a technical reviewer
who wants to reproduce that themselves (install APK, push model files, launch),
see **[`mobile/RUNBOOK.md`](mobile/RUNBOOK.md)** for exact, copy-pasteable
`adb` commands. Running it yourself is not required to evaluate the
submission — the video is.

## Features
1. **Overwhelm Manager** — an on-device Llama 3.2 1B model breaks a freeform task description into a concrete 5–8 step plan, and lets you break any step down further. Gets more personalized with use via on-device-only memory of past tasks.
2. **Energy Planner** — a trained time-series model predicts a 24h energy curve from recent sleep/activity (via Health Connect or manual entry), surfacing a focus window and a wind-down window.
3. **Hydration Tracker** — a trained regression model combines body metrics, activity, and (optionally) local weather/AQI into a personalized daily water target, and explains why.
4. **Expense Scanner** — camera or PDF receipt → on-device OCR → trained field-extraction + categorization models, with currency auto-detected. Nothing photographed or parsed ever leaves the device.

**Smart Glasses (optional, v1 = audio-only)** — the phone stays the brain; the glasses are used as a plain Bluetooth audio sink for on-device TTS nudges. No Meta Wearables Toolkit, no capture, nothing routed through Meta's cloud — output-only, so it exposes nothing. No new model; reuses the four models above. See `docs/glasses-architecture.md`.

## Roadmap (deliberately not built yet)
- **Glasses microphone capture** (hands-free voice/camera/button input via the glasses) — needs Meta's gated Wearables Toolkit, which risks routing audio through Meta's cloud. Deferred until it can be done opt-in-only without breaking the on-device guarantee.

## Stack
- **Mobile:** React Native (Expo, New Architecture) + `react-native-executorch` runtime, loading `.pte` models directly on-device (Android).
- **Models:** ExecuTorch `.pte` — Llama 3.2 1B uses Software Mansion's official pre-quantized QAT-LoRA artifact; Energy/Hydration/Expense are custom-trained and were **trained + exported on AMD Instinct MI300X GPUs via ROCm** (on AMD's ROCm cloud notebooks; scripts in `ml/export/`). That is this project's real "Use of AMD Platforms" story — the deployed app itself never calls AMD or any cloud at inference time by design.
- **Backend:** Python/FastAPI (`backend/model_registry/`) — a versioned model catalog only. Never touches user data, never does inference.

## Repo layout
```
LifePilot/
├─ design/                 # UX specs, mockups, Figma exports (per feature)
│  └─ overwhelm/ energy/ hydration/ expense/ glasses/
├─ ml/
│  ├─ export/              # training + export scripts, containerized (Dockerfile) for AMD MI300X/ROCm
│  ├─ models/              # exported .pte outputs per feature (gitignored — large binaries)
│  └─ test/                # eval scripts + reports per feature model
├─ mobile/                 # React Native app
│  ├─ RUNBOOK.md           # exact run/reproduce instructions
│  └─ src/
│     ├─ screens/ components/ features/ core/
│     └─ models/           # per-feature manifest.json (the .pte files themselves are gitignored)
├─ backend/model_registry/ # versioned model catalog API — no user data, no inference
├─ models/                 # local scratch: downloaded/exported .pte + build artifacts (gitignored)
└─ docs/                   # architecture notes, model contracts, hackathon submission
```

## License
LifePilot's own code is **MIT-licensed** (see [`LICENSE`](LICENSE)). The bundled Llama 3.2 model is used under **Meta's Llama 3.2 Community License** — this project is **"Built with Llama"** (see [`NOTICE`](NOTICE)).

## Notes
- **Privacy is architectural, not a setting.** The only opt-in network touch anywhere in the app is Hydration's optional weather lookup — everything else, including every model inference, runs fully offline.
