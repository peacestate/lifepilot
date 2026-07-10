# Overwhelm Manager — On-Device Model Contract (authoritative)

Owner: AI/ML Engineer · Status: **v1 locked** · Last updated: 2026-06-26

This is the authoritative contract the **mobile dev** codes against and the **CTO**
signs off on. It supersedes the open questions in
`docs/overwhelm-executorch-integration.md` and `design/overwhelm/screen-spec.md`.

Feature: user types what's overwhelming them → on-device **Llama 3.2 1B Instruct
(4-bit)** → **5–10 imperative micro-steps** → checklist. 100% offline.

---

## 0. TL;DR for each role

- **Mobile dev:** integrate the **HF QLoRA `.pte`** now (`§2`). Send the prompt in `§3`.
  Parse output as `- step` lines, trim, clamp to 5–10 (`§4`). **Stream** steps in and
  show a **Stop** button — do *not* design for a <2s full result (`§5`).
- **CTO:** confirm the one thing in `§6` — pin `react-native-executorch` to the release
  whose bundled ExecuTorch matches the `.pte` (HF model = **ExecuTorch v0.6.0**, no
  forward compat). Everything else flows from that pin.
- **AI/ML (me):** HF `.pte` is the v1 deliverable. A reproducible GPU export of a
  custom model lives in `ml/export/` for when we want our own fine-tune. Eval harness in
  `ml/test/`.

---

## 1. Why two model sources

| Source | Use | Why |
|---|---|---|
| **HF `software-mansion/react-native-executorch-llama-3.2` (QLoRA INT4)** | **v1 — ship this** | Already 4-bit, already matched to the `react-native-executorch` runtime, zero export risk. Unblocks the mobile dev today. |
| **Our own GPU export** (`ml/export/`) | Later — custom/fine-tuned model | The owner's 8 GB PC cannot export a 1B model (needs ~12–16 GB). AMD ROCm notebooks (~30 GB RAM + T4/P100) can. Not on the critical path for the first build. |

Both must obey the **same I/O contract** (`§3`–`§4`) so the mobile code never changes
when we swap the HF model for our own.

---

## 2. The `.pte` + tokenizer deliverable

### 2a. v1 — HF model (ship this)
Repo: `software-mansion/react-native-executorch-llama-3.2`.
- Variants offered: **QLoRA (recommended)**, SpinQuant, original. Use **QLoRA INT4** —
  HF states it has the best performance-to-quality ratio.
- Tokenizer: `tokenizer.json` + `tokenizer_config.json` (repo root).
- **Exported with ExecuTorch `v0.6.0`. No forward compatibility.** ← drives the pin in `§6`.
- `react-native-executorch` takes the model via its `modelSource` param (file path or
  URL). Per the CTO doc we **bundle the `.pte` in the app and load by `file://`** (the
  ~1 GB file exceeds the `require()` ceiling), not a remote URL.

**Files to place in `mobile/src/models/overwhelm/`:**
```
llama3_2-1B-qlora.pte        # the QLoRA INT4 model from HF
tokenizer.json
tokenizer_config.json
manifest.json                # {name, source, sha256, executorch_version, bytes}
```
> Exact `.pte` filename inside the HF repo is not listed on the card — confirm at
> download time and record the real name + sha256 in `manifest.json`. The mobile loader
> reads `manifest.json`, never a hard-coded size.

### 2b. Custom export — GPU output (later)
The AMD ROCm notebook (`ml/export/export_llama32_overwhelm.py`) produces the same
file set from a Meta INT4 checkpoint, **pinned to the same ExecuTorch version as the
runtime** (`§6`). Same filenames, same `manifest.json` shape → drop-in replacement.

### Quantization scheme
INT4 weights via SpinQuant or QLoRA (8da4w-style: 4-bit groupwise weights, dynamic 8-bit
activations, EO8 = 8-bit embeddings/output). This is Meta's published mobile recipe; we do
not invent our own quant.

---

## 3. Input / output shape (the part mobile parses)

- **Input** = a single user-turn string (the raw text from the screen's input field).
- **System / instruction prompt is owned MOBILE-SIDE** so we can iterate wording without
  re-exporting the model. Llama 3.2's chat template does **not** hard-code a system role —
  if no system block is supplied it just isn't there — so injecting our own is safe.
- **Output** = newline-separated `- ` bullet lines, nothing else. Example raw output:

```
- Open your laptop and create a new empty document
- Write the single sentence that states what the report is about
- List the three sections the report needs as headings
- Fill in bullet points under the first heading only
- Take a 5-minute break, then do the second heading
```

### Prompt template (Llama 3.2 chat format)
The mobile layer assembles exactly this (literal special tokens):

```
<|begin_of_text|><|start_header_id|>system<|end_header_id|>

You are a calm assistant that helps an overwhelmed person take action. Break the
user's situation into 5 to 10 small, concrete, single-action steps. Each step must
start with a verb and be doable in a few minutes. Output ONLY a markdown bullet list
using "- ", one step per line. No intro, no numbering, no extra text.<|eot_id|><|start_header_id|>user<|end_header_id|>

{USER_INPUT}<|eot_id|><|start_header_id|>assistant<|end_header_id|>

```
> The system prompt string is the single source of truth for output format and step
> count. Keep it identical between the eval harness (`ml/test/`) and the app, or the
> on-device behavior will drift from the report.

### Token IDs / stop conditions
- BOS `128000` · EOT `128009` (stop here) · EOS `128001`.
- **Stop on `<|eot_id|>` (128009).**

---

## 4. Parsing rules (mobile owns these)

The on-device output is text, not JSON, so mobile normalizes it:

1. Split on newlines.
2. Keep lines matching `^\s*[-*•]\s+` **or** `^\s*\d+[.)]\s+` (model sometimes numbers).
3. Strip the leading marker/number and surrounding whitespace.
4. Drop empties and any pre-amble line that isn't a step.
5. **Clamp to 5–10:** if >10, keep the first 10; if <5, treat as a degenerate result (`§4a`).
6. **UI owns the numbering** — render `1..n` yourself; never trust model numbering.

TypeScript target shape (matches the CTO doc / designer's list items):
```ts
type OverwhelmStep = { id: string; text: string; done: boolean };
type OverwhelmResult = { steps: OverwhelmStep[] };
```

### 4a. Degenerate cases → which screen state
| Condition | Map to (designer's states) |
|---|---|
| 0 usable step lines, or only a refusal/apology | **empty-result** state ("Couldn't break that down — try rephrasing") |
| 1–4 steps | accept but it's thin → show as **results**; log for prompt tuning |
| >10 steps | clamp to 10, show **results** |
| Model errored / didn't load / OOM | **error** state |
| Refusal ("I can't help with that") detected | **empty-result**, not error |

---

## 5. Latency reality → design verdict

Llama 3.2 1B INT4 over XNNPACK on a modern Snapdragon (8 Gen 2/3) realistically decodes
**~20–50 tokens/sec**; cold start (first model load + warm-up) adds **~1–3 s** the first
time.

- A 5–10 step list is ~120–220 output tokens → **full generation ≈ 4–10 s** on most
  devices (best-case flagship ~4–5 s; mid-tier slower). The QNN/HTP NPU backend can be
  faster but `react-native-executorch` ships XNNPACK by default.
- **Time to *first* step ≈ <2 s is achievable. Time to the *whole* list is not.**

### Verdict (designer + CTO, please build to this)
- **Stream steps in as they generate** (token callback → append a step each time a full
  `- ...\n` line completes). The screen fills progressively; perceived latency is the
  first step, not the last.
- **Provide a real Stop button.** `react-native-executorch`'s `useLLM` exposes an
  **`interrupt()`** — generation **is** cancelable. The designer's "Stop" affordance is
  functional, not cosmetic. *(CTO: confirm the exact method name in the pinned version.)*
- **Warm the model once on screen mount** (or app start) so the first real request isn't
  paying cold-start. The designer's loading state covers the warm-up on first entry.
- v1 may resolve-on-complete with a calm loading state **if** streaming wiring slips, but
  streaming is the target and the data contract above already supports it.

---

## 6. The ONE thing the CTO must confirm (blocking)

**Version pin.** The `.pte` format has **no forward-compatibility guarantee**. The HF
model was exported with **ExecuTorch v0.6.0**.

➡️ **CTO action:** pick the `react-native-executorch` npm version whose bundled ExecuTorch
runtime == the `.pte`'s export version, and pin it. Then:
- v1: just use the HF QLoRA `.pte` (already v0.6.0-matched) — lowest risk.
- Custom export: the AMD ROCm notebook's `EXECUTORCH_REF` variable **must be set to that same
  version/tag** before exporting, or the model won't load on device.

If the CTO pins a newer `react-native-executorch`, tell me the ExecuTorch version it bundles
and I'll re-export on the AMD ROCm notebook against that tag. **Mismatched versions are the #1 cause of
"model won't load."**

---

## 7. What ships where (file map)

```
mobile/src/models/overwhelm/   llama3_2-1B-qlora.pte, tokenizer.json, tokenizer_config.json, manifest.json
ml/export/                     export_llama32_overwhelm.py  (AMD ROCm GPU notebook)
ml/export/README.md            how to run the export on the AMD ROCm notebook
ml/test/overwhelm_eval.py      20-task harness (step-count / format / latency)
ml/test/tasks.json             the 20 representative test inputs
ml/test/REPORT_TEMPLATE.md     the 20-task report to fill in
docs/overwhelm-model-contract.md   ← this file
```

---

## 8. Open items (non-blocking for the dev build)

- App size: a ~1 GB in-binary model may breach store limits (CTO's flag). Decide
  ship-in-binary vs one-time consented download before *release* — does not block the build.
- Whether to later fine-tune a smaller/faster custom model (the custom-export path exists for this).
- QNN/HTP backend for faster decode if XNNPACK latency disappoints in real testing.
