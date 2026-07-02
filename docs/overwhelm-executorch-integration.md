# Overwhelm Manager — ExecuTorch + React Native Integration Outline

Owner: CTO (lifepilot-cto)
Status: Draft for build — the Mobile Developer builds against this; the AIML Engineer delivers against the contract in §6.
Date: 2026-06-26

This is the technical spec the RN dev builds against for LifePilot's first feature, **Overwhelm Manager**: user types what is overwhelming them → on-device Llama 3.2 1B → 5–10 actionable micro-steps → checkbox list. Fully offline. Target <2s inference on Snapdragon.

**Golden rule, restated as an engineering constraint:** there is no network call anywhere in the inference path. The model, tokenizer, and all text stay on device. This is enforced in code (§5), not just by policy.

---

## 0. Decision summary (TL;DR)

| Decision | Choice | Why |
|---|---|---|
| ExecuTorch-in-RN binding | **Use `react-native-executorch` (Software Mansion)** — do not hand-roll a native bridge | Maintained, production-proven (powers "Private Mind"), wraps the ExecuTorch C++ runtime on both iOS & Android, ships a typed `useLLM` hook. Custom bridge = months of native work + ongoing ExecuTorch version churn for zero product gain. |
| Model | Llama 3.2 1B Instruct, **4-bit quantized (SpinQuant / QLoRA)** `.pte`, exported by AIML | Meets README mandate; ~1.1 GB at our quant target. Size is the main risk (see §4, §6). |
| Model delivery | **First-run copy from a bundled/asset-shipped `.pte` into app documents dir, load by file path** — NOT a remote download URL | Preserves the offline-first / airplane-mode promise while avoiding the `require()` size ceiling (~512 MB) and keeping the binary loadable. No CDN in the user-data path. |
| TS-facing API | A thin **`OverwhelmService` + `useOverwhelmManager` hook** wrapping `useLLM` | Keeps prompt/parse logic in one reviewable place; screen stays dumb. |
| Threading | Inference runs on the **native ExecuTorch thread** (library handles this); JS only receives batched token callbacks | Keeps the UI thread free; we just manage state transitions. |
| RN architecture | **New Architecture (Fabric/TurboModules) required** | `react-native-executorch` only supports the New Architecture. Non-negotiable setup item. |

---

## 1. ExecuTorch-in-RN architecture

### 1.1 Recommendation: use `react-native-executorch`, not a custom bridge

`react-native-executorch` is Software Mansion's RN wrapper over Meta's ExecuTorch C++ runtime. It:
- Bundles the ExecuTorch runtime for **both iOS (CocoaPods) and Android (Gradle/CMake)**.
- Exposes a declarative, typed hook API (`useLLM`) so we don't touch JNI / Obj-C++ ourselves.
- Is already shipping in a privacy-first production app, so the load/inference/memory paths are battle-tested.

A custom TurboModule bridge would mean owning ExecuTorch's CMake/Pods integration, the JNI/Obj-C++ marshalling for tokens and tensors, and re-doing it every ExecuTorch release. That is exactly the kind of native-platform work the library exists to remove, and it buys us nothing for a single-model feature. **If** we later hit a hard limitation (e.g. need a custom op not surfaced by the hook), we revisit — but we start on the library.

**Version pinning is mandatory.** ExecuTorch `.pte` files are tied to the runtime version that exported them (no forward-compat guarantee). The `.pte` the AIML engineer ships **must** be exported with the ExecuTorch version that matches the `react-native-executorch` release we pin. This is the single most common cause of "model won't load." See §6 contract.

### 1.2 How the `.pte` is bundled and loaded

Two viable load mechanisms in the library:
1. `modelSource: require('../models/overwhelm.pte')` — only works for assets **under ~512 MB**. Our 4-bit 1B model is ~1.1 GB, so **`require()` is not an option** for the model binary.
2. `modelSource: 'file:///.../overwhelm.pte'` — load from an absolute filesystem path.

**Chosen approach — bundled asset → first-run copy → load by path:**
- The `.pte` ships **inside the app** as a platform raw asset (Android `android/app/src/main/assets/`, iOS bundle resource), referenced from the repo source of truth at `mobile/src/models/overwhelm.pte`. (Tokenizer + config JSON are small and ship the same way; they can use `require()`.)
- On first launch (or first Overwhelm use), a `ModelProvisioner` copies the `.pte` from the read-only app bundle into the app's documents directory **once**, then records its path + version hash.
- Subsequent loads call `useLLM({ modelSource: 'file://<docDir>/overwhelm.pte', ... })`.
- **No network is involved at any point.** The optional FastAPI "model CDN" mentioned in the README is explicitly **out of scope** for Overwhelm v1 — we ship the model in the binary so airplane-mode works from install.

> App-size note: a ~1.1 GB in-binary model is a real distribution problem (Play Store / App Store limits, install friction). This is flagged as a top risk in §6. If size forces a download-on-first-run model later, it must be a one-time, user-consented, model-only download (no user data), gated so the feature is unavailable until complete — never silent, never in the inference path.

---

## 2. Inference interface (the TypeScript the mobile dev calls)

Lives in `mobile/src/features/overwhelm/`. The screen never talks to `useLLM` directly — it talks to our hook.

```
mobile/src/
├─ features/overwhelm/
│  ├─ OverwhelmService.ts        # prompt building + output parsing (pure, unit-testable)
│  ├─ useOverwhelmManager.ts     # RN hook wrapping useLLM; exposes the API below
│  ├─ overwhelm.prompt.ts        # system prompt + template (single source of truth)
│  ├─ overwhelm.types.ts         # shared types
│  └─ __tests__/                 # parser tests against AIML's 20-task report outputs
├─ models/
│  ├─ overwhelm.pte              # source-of-truth model binary (AIML deliverable)
│  ├─ tokenizer.bin (or .json)   # AIML deliverable
│  └─ tokenizer_config.json      # AIML deliverable
└─ screens/OverwhelmScreen.tsx   # UI only; consumes the hook
```

### 2.1 Types (`overwhelm.types.ts`)

```ts
export type MicroStep = {
  id: string;          // stable id (index-derived or uuid) for checkbox state
  text: string;        // the actionable step, cleaned (no numbering/bullets)
  done: boolean;       // checkbox state, owned by the screen
};

export type OverwhelmStatus =
  | 'idle'         // model not yet needed
  | 'loading'      // model is being copied/loaded into memory
  | 'ready'        // model in memory, warm, awaiting input
  | 'generating'   // inference in progress
  | 'error';

export type OverwhelmResult = {
  steps: MicroStep[];
  raw: string;       // raw model text, kept for debugging/QA, never logged off-device
};

export type OverwhelmError = {
  kind: 'model_load' | 'inference' | 'parse' | 'timeout';
  message: string;   // user-safe; designer maps to copy
};
```

### 2.2 Hook API (`useOverwhelmManager.ts`)

```ts
export function useOverwhelmManager(): {
  status: OverwhelmStatus;
  progress: number;                 // 0..1, model load/warm-up only
  error: OverwhelmError | null;
  isReady: boolean;                 // status === 'ready'

  /** Generate micro-steps for a freeform overwhelm description. */
  generateSteps(input: string): Promise<OverwhelmResult>;

  /** Stop an in-flight generation (maps to useLLM.interrupt). */
  cancel(): void;

  /** Optional explicit warm-up; otherwise lazy on first generateSteps. */
  warmUp(): Promise<void>;
};
```

Notes for the mobile dev:
- **One model instance app-wide.** `react-native-executorch` supports only one active `useLLM` at a time. Mount the hook once (feature-level provider or the Overwhelm screen), never two LLM consumers concurrently.
- `generateSteps` resolves with the final parsed `OverwhelmResult`. Token streaming is handled internally for the <2s feel; the screen can keep a simple spinner/skeleton (designer's call, §4.4). If the designer wants progressive reveal, we expose a streaming variant later — start with resolve-on-complete.
- Checkbox `done` state is **screen-owned** (local component state / store). The service is stateless per request.
- The pure functions in `OverwhelmService.ts` (`buildPrompt(input)`, `parseSteps(raw)`) are exported separately so they can be unit-tested without a device/model.

---

## 3. Llama 3.2 1B specifics

### 3.1 Tokenizer
- Llama 3.2 uses a **Tiktoken-style BPE** tokenizer. The library needs `tokenizerSource` (the tokenizer binary/JSON) and `tokenizerConfigSource` (the `tokenizer_config.json` that carries the chat template + special tokens).
- These files **must come from the same export run as the `.pte`** (AIML deliverable, §6). Mismatched tokenizer = garbage output even when the model loads fine.
- They are small (a few MB), so they ship via `require()` and need no copy step.

### 3.2 Prompt template (`overwhelm.prompt.ts`)
We use the chat message format and pass a fixed system prompt via `configure({ chatConfig: { systemPrompt } })`. The user's text is the single `user` turn. Keep it tight and deterministic:

```
SYSTEM:
You are LifePilot's Overwhelm Manager. The user will describe something that
is overwhelming them. Break it into between 5 and 10 small, concrete,
immediately-doable micro-steps. Rules:
- Each step starts with a verb and is one short sentence.
- Steps are ordered so the easiest, anxiety-reducing action comes first.
- No preamble, no encouragement, no closing remarks — output ONLY the steps.
- Output each step on its own line, prefixed with "- ".
- Do not include sub-bullets, numbers, or markdown other than the "- " prefix.

USER:
<the raw user input>
```

Decoding config for reliability (passed via `configure`/`generationConfig`):
- `temperature` low (~0.3) — we want consistent structure, not creativity.
- `topP` ~0.9, `repetitionPenalty` ~1.1 to avoid loops.
- Cap generated tokens (a max-new-tokens bound) — 10 short steps fit comfortably under ~256 tokens; bounding output protects the <2s budget.

### 3.3 Parsing raw output → `MicroStep[]` (`parseSteps`)
The model is told to emit `- step` lines, but we must be defensive (LLMs add stray preamble). `parseSteps(raw)`:
1. Split on newlines.
2. Strip any leading list markers: `-`, `*`, `•`, `1.`, `1)`, etc. (regex `^\s*([-*•]|\d+[.)])\s*`).
3. Drop empty lines and any line that doesn't look like a step (e.g. trailing "Let me know if…").
4. Trim, collapse whitespace, drop duplicates.
5. **Clamp to 5–10 steps:** if >10, keep first 10; if <5, surface a `parse` error so the UX can offer a one-tap retry (do not show a 2-step list as success).
6. Map to `MicroStep` with stable ids and `done: false`.

Reliability levers, in order of preference:
1. Strong system prompt + low temperature (above).
2. Defensive parser (above).
3. **One automatic retry** with a stricter reminder if the first parse yields <5 steps.
4. Escalation path if the model proves unreliable: AIML constrains generation (grammar/structured decoding) at export time — tracked as an open item in §6, not required for v1 if 1–3 pass the 20-task report.

The parser is validated against the **AIML engineer's 20-task test report** outputs — those become parser unit-test fixtures.

---

## 4. Threading & performance

### 4.1 Off the JS/UI thread
- ExecuTorch inference runs on a **native thread** inside the library; it does not block JS. Our hook only receives token-batch callbacks and flips state.
- We enable **token batching** (`outputTokenBatchSize` / `batchTimeInterval`, defaults ~10 tokens / 80 ms) so we are not re-rendering per token. Since v1 resolves on completion, re-render pressure is low regardless, but batching is on for the future streaming variant.
- All prompt building and parsing is synchronous and cheap; it runs in JS but on strings only.

### 4.2 Load / warm-up strategy
Model load (copy + mmap + into RAM) is the expensive one-time cost, **not** per-inference. Strategy:
- **Provision once** (first-run copy, §1.2), then load lazily when the user navigates to the Overwhelm screen, OR eagerly warm up just after onboarding completes (designer's choice — recommend warming on screen mount with a clear loading state).
- After load, run a **tiny throwaway warm-up generation** (e.g. 1–2 tokens) so the first real request doesn't eat allocator/JIT-style first-run overhead. This protects the <2s budget on the user's first real tap.
- Keep the single instance resident while the feature is in use; release on memory-pressure / app background (see 4.3).

### 4.3 Memory
- A 1B 4-bit model needs significant RAM (hundreds of MB resident). On low-end devices this is the crash risk.
- Hold **exactly one** instance. On OS memory-pressure warnings or when the app backgrounds for a while, dispose the model and re-load on return (cheap relative to a crash).
- QA must include a low/mid-tier Snapdragon device, not just a flagship.

### 4.4 Hitting <2s on Snapdragon
- The <2s target is **inference latency on a warm model**, not cold-load. Cold load (seconds) is covered by the loading-state UX, not counted against the 2s.
- Budget levers: 4-bit quant (AIML), bounded max-new-tokens (~ enough for 10 short steps), low temperature (less wasted sampling), warm-up pre-pass, and Snapdragon-targeted export (XNNPACK / QNN backend — AIML's call at export, §6).
- We measure on real hardware with the AIML 20-task set and record p50/p95 latency. If p95 > 2s warm, escalate to AIML (further quant / shorter output cap / backend tuning) before the demo.

### 4.5 Loading-state UX contract (ties to designer)
The screen must represent these states; the hook drives them:
| `status` | UX contract |
|---|---|
| `loading` | Calm, non-blocking loader with `progress` (0..1) for first-run copy/load. Copy from designer: "Getting things ready, fully on your device." |
| `ready` | Input enabled, submit enabled. |
| `generating` | Submit becomes a cancel affordance; show a thinking/skeleton state. Target feels instant (<2s warm). |
| `error` (`model_load`) | "Couldn't start the on-device model" + retry. |
| `error` (`parse`/`inference`/`timeout`) | "Let's try that again" + one-tap retry; never show a broken/short list as success. |

Designer owns exact copy and visuals (`design/overwhelm/`); this table is the state contract they design against.

---

## 5. The privacy guarantee, in code

This is the product. We make it verifiable, not aspirational.

1. **No network in the inference path.** `OverwhelmService`, `useOverwhelmManager`, and the prompt/parse code import **zero** networking modules (no `fetch`, no `axios`, no analytics). Enforced by an ESLint `no-restricted-imports`/`no-restricted-globals` rule scoped to `mobile/src/features/overwhelm/**` that **bans `fetch`, `XMLHttpRequest`, and any HTTP client**. CI fails the build on violation.
2. **Model + tokenizer load from local file paths / bundled assets only** — never a URL in v1 (§1.2). A grep/lint check asserts no `http(s)://` literal in the model-loading code.
3. **No telemetry of user content.** User input and model output are never logged, persisted off the feature, or sent anywhere. `raw` in `OverwhelmResult` exists only for in-session debugging and is never written to a remote sink. Crash reporters (if any) must scrub these fields.
4. **Airplane-mode is a test, not a hope.** Acceptance test: enable airplane mode → cold start app → run Overwhelm end-to-end → must produce a valid step list. This is a required pre-demo check and a CI/manual QA gate.
5. **Network-access audit.** As a belt-and-suspenders verification, we run the app through a network monitor (e.g. mitmproxy / Charles, or Android `Network Inspector`) during an Overwhelm session and confirm **zero outbound requests** containing user content. Result attached to the CTO pre-demo sign-off.
6. **Backend stays out.** The FastAPI service is not referenced anywhere in the Overwhelm feature. Optional model-CDN is out of scope for v1.

CTO sign-off (required before any demo) checks, in order: **(a) privacy** — lint + airplane-mode test + network audit pass; **(b) correctness** — parser handles the 20-task fixtures, 5–10 steps clamp works; **(c) performance** — warm p95 < 2s on target Snapdragon.

---

## 6. Interfaces, contract & open items

### 6.1 Contract: AIML deliverable → mobile integration
The AIML engineer (`lifepilot-aiml-engineer`) delivers into `mobile/src/models/` (source of truth; also kept in `ml/models/overwhelm/`):

| Artifact | Requirement |
|---|---|
| `overwhelm.pte` | Llama 3.2 1B Instruct, 4-bit quant, **exported with the exact ExecuTorch version matching our pinned `react-native-executorch`**. Snapdragon-targeted backend (XNNPACK and/or QNN) stated explicitly. |
| `tokenizer.*` | The tokenizer file (binary or JSON) from the **same export run**. |
| `tokenizer_config.json` | Includes the chat template + special tokens used. |
| Version manifest | A small JSON: model version, ExecuTorch export version, quant scheme, expected backend, sha256 of `.pte`. Mobile uses sha256 to validate the first-run copy. |
| 20-task test report | Input → raw output → parsed steps + warm latency (p50/p95) per task, on a named Snapdragon device. Becomes our parser test fixtures and perf baseline. |

**Behavioral contract both sides sign:**
- Input to model: single user-turn string (the overwhelm text); fixed system prompt owned by mobile (§3.2). If AIML bakes a chat template into `tokenizer_config.json`, the mobile system prompt must be expressed through it — **agree where the system prompt lives** (open item Q3).
- Output from model: free text expected to be `- step` lines; mobile owns parsing and the 5–10 clamp. AIML's job is to make 5–10 well-formed steps the model's natural output on the 20-task set.

### 6.2 Contract: mobile ↔ designer
- Mobile implements the §4.5 state table; designer delivers copy + visuals for each state in `design/overwhelm/`, plus empty/first-run-loading and the two error variants.
- Agree on resolve-on-complete (spinner) vs. streaming reveal for v1. Recommendation: resolve-on-complete for v1, streaming later.

### 6.3 Open questions / risks
1. **App size (top risk).** ~1.1 GB in-binary model likely breaches store limits / install UX. Decision needed: (a) ship in binary (cleanest privacy, biggest size), (b) one-time consented model-only download on first run (smaller binary, needs network once, still no user data). Recommend deciding before AIML finalizes quant — a more aggressive quant or smaller distill could change the math. **Blocking for release, not for the dev build.**
2. **ExecuTorch version pin.** Lock the `react-native-executorch` version and hand it to AIML **before** they export, to avoid `.pte` incompatibility churn. Blocking dependency: AIML cannot finalize the `.pte` until this is pinned.
3. **System prompt location.** Mobile-side `configure` vs. baked into the exported chat template. Recommend mobile-side so we can iterate prompt without re-exporting the model. AIML must confirm the chat template doesn't hard-code a conflicting system role.
4. **Reliability fallback.** If prompt + parser + 1 retry don't reliably yield 5–10 clean steps on the 20-task set, do we need structured/grammar-constrained decoding at export? Tracked; decided after the first test report.
5. **New Architecture migration.** `react-native-executorch` requires RN New Architecture. Confirm the `mobile/` app is (or will be) on Fabric/TurboModules. Setup blocker.
6. **Single-instance discipline.** When Energy Predictor (feature 2) lands, two on-device models may want to coexist. Out of scope here, but the one-LLM-instance constraint will shape that architecture — note for later.

### 6.4 Build sequencing / blocking dependencies
1. **CTO:** pin `react-native-executorch` version + confirm New Architecture on `mobile/`. → unblocks AIML export and mobile setup.
2. **AIML:** export `.pte` + tokenizer against that version; deliver 20-task report. → unblocks real on-device integration.
3. **Mobile:** build `OverwhelmScreen` + `useOverwhelmManager` against this spec; can start immediately with a **mock service** (stubbed `generateSteps`) so UI work proceeds in parallel before the `.pte` lands.
4. **Designer:** state-table copy/visuals in parallel; needed before pre-demo polish.
5. **CTO:** code review + privacy/correctness/perf sign-off before demo.

---

## References
- React Native ExecuTorch — docs: https://docs.swmansion.com/react-native-executorch
- `useLLM` hook: https://docs.swmansion.com/react-native-executorch/docs/hooks/natural-language-processing/useLLM
- Loading models (local `.pte` / file path / 512MB note): https://docs.swmansion.com/react-native-executorch/docs/fundamentals/loading-models
- Llama 3.2 `.pte` + tokenizer (Software Mansion): https://huggingface.co/software-mansion/react-native-executorch-llama-3.2
- GitHub: https://github.com/software-mansion/react-native-executorch
