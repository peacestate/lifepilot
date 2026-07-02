# LifePilot

An on-device wellness app. **Every AI feature runs on-device via ExecuTorch. No user data ever touches a server.** That is the core promise.

## Features (and build priority)
1. **Overwhelm Manager** — *(first: simplest, highest value)* an on-device LLM (Llama 3.2 1B) breaks a task into 5–10 actionable micro-steps. Works in airplane mode.
2. **Energy Predictor** — *(core differentiator)* on-device time-series model predicts daily energy from usage/sleep/activity.
3. **Hydration Tracker** — *(quick win)* on-device engine combines weather + AQI + activity into real-time nudges.
4. **OCR Expense** — receipts scanned on-device, never uploaded.
5. **Smart Glasses** — Meta Smart Glasses integration, hands-free wellness nudges on the glasses chip.

## Stack
- **Mobile:** React Native + ExecuTorch runtime (loads `.pte` models on Android & iOS)
- **Models:** ExecuTorch `.pte`, quantized (4-bit where possible), targeting Qualcomm Snapdragon
- **Backend:** Python/FastAPI — *only* for non-user-data concerns. Never user data, never inference.

## The team (Claude Code agents)
Invoke any of these by name (`.claude/agents/`):

| Agent | Role | Owns |
|---|---|---|
| `lifepilot-cto` | Technical lead | Architecture, ExecuTorch runtime integration, code review, performance, tech decisions |
| `lifepilot-aiml-engineer` | On-device AI | `.pte` models, quantization, Snapdragon targeting, Overwhelm/Energy/Hydration/OCR models |
| `lifepilot-mobile-developer` | App | React Native screens, UI logic, model integration, offline operation, Glasses SDK |
| `lifepilot-designer` | UX/UI | Calm minimal design, onboarding (privacy benefit), Figma specs before build |

## Repo layout
```
LifePilot/
├─ .claude/agents/   # the four specialized agents
├─ design/           # Designer: specs, mockups, Figma exports
│  └─ overwhelm/
├─ ml/               # AI/ML Engineer: model export + .pte outputs
│  ├─ export/
│  └─ models/
│     └─ overwhelm/
├─ mobile/           # Mobile Developer: React Native app
│  └─ src/
│     ├─ screens/
│     ├─ components/
│     └─ models/     # bundled .pte files for on-device inference
├─ backend/          # CTO: optional non-user-data services only
└─ docs/             # architecture, decisions
```

## Current focus: Overwhelm Manager
- **Designer:** single calm input screen ("What's overwhelming you today?") → numbered checkbox step list. Figma in 2 days.
- **AI/ML:** Llama 3.2 1B → 5–10 micro-steps → `.pte`, 4-bit quant, <2s on Snapdragon. Deliver model + 20-task test report.
- **Mobile:** one RN screen, integrate `.pte`, run on submit fully offline, checkboxes per step.
- **CTO:** ExecuTorch runtime in RN, loads on both platforms, no data leaves device, review before demo.

## Notes
- **Machine safety:** the owner is security-cautious — agents write files and propose commands but do **not** install/build/run on the machine without explicit OK.
- **Telegram reporting:** planned for a later stage. The agents are on-demand, not always-on, so this needs a small Telegram bot + a notification hook that posts task results / build failures to chat. Set up with the owner's OK when the app is further along.
