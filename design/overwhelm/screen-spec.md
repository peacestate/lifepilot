# Overwhelm Manager — Screen Spec (v1)

**Feature:** Overwhelm Manager (build priority #1)
**Platform:** React Native (Android + iOS), ExecuTorch on-device inference
**Model:** Llama 3.2 1B (4-bit, `.pte`) → 5–10 actionable micro-steps
**Owner (design):** lifepilot-designer · **Builds against this:** lifepilot-mobile-developer
**Status:** Ready for handoff · **Date:** 2026-06-26

> Design north star: **calm, not complex.** One thing on screen at a time. Generous whitespace, soft neutrals, one quiet accent. Every state must reinforce the privacy promise — *this runs on your phone, nothing leaves it.*

---

## 0. Screen at a glance

A single screen, `OverwhelmManagerScreen`, with one persistent layout that swaps its body between four states:

1. **Empty / Input** — the resting state. Prompt + text box + submit.
2. **Loading / Inference** — model running locally, reassuring offline message.
3. **Results** — numbered checklist of micro-steps with checkboxes + progress.
4. **Error / Empty-result** — gentle recovery with retry.

The input area stays anchored; results render below it. No navigation away from this screen for the core loop.

---

## 1. Screen states & flow

### Flow summary
```
[Empty/Input] --submit (non-empty)--> [Loading] --model returns steps--> [Results]
                                          |                                  |
                                          |-- returns 0 steps / parse fail ->[Empty-result]
                                          |-- runtime/model error ---------->[Error]
[Results] --"Start over" / clear--> [Empty/Input]
[Error/Empty-result] --"Try again"--> [Loading] (re-run same input)
```

### 1a. Empty / Input state
The default state on screen mount and after "Start over".

- Heading prompt + subtext (privacy reassurance).
- Multiline text input with placeholder.
- Primary CTA **"Break it down"** — **disabled** until input has ≥ 1 non-whitespace character.
- Small offline/privacy footnote pinned low on screen.

**On submit:** dismiss keyboard, trim input, transition to Loading, kick off on-device inference. Keep the submitted text visible (read-only or in a collapsed "You asked…" chip) so the user has context while waiting and in results.

```
┌─────────────────────────────────────┐
│                                      │
│  What's overwhelming you today?      │  ← H1 prompt
│  Type it out. I'll break it into     │  ← subtext
│  small, doable steps — right here    │
│  on your phone.                      │
│                                      │
│  ┌─────────────────────────────────┐ │
│  │ e.g. "Plan my sister's          │ │  ← input, placeholder
│  │  birthday next weekend"         │ │
│  │                                 │ │
│  └─────────────────────────────────┘ │
│                                      │
│  ┌─────────────────────────────────┐ │
│  │        Break it down            │ │  ← primary CTA (disabled if empty)
│  └─────────────────────────────────┘ │
│                                      │
│                                      │
│  ⦿ Runs fully on your device.        │  ← privacy footnote
│     Nothing is sent anywhere.        │
└─────────────────────────────────────┘
```

### 1b. Loading / Inference state
Local inference target < 2s on Snapdragon, but plan UX for up to ~5s (older devices, cold model load). **Do not** use a spinner that implies network. Use a calm, breathing pulse.

- Show the submitted task (so it doesn't feel lost).
- Calm animated indicator (3 dots fading in sequence, or a soft pulsing dot). ~1.4s loop.
- Reassuring, offline-aware copy.
- No cancel button in v1 unless inference may exceed ~5s (see open questions) — if added, label it **"Stop"** and return to Input with text preserved.

```
┌─────────────────────────────────────┐
│  You asked:                          │
│  "Plan my sister's birthday…"        │  ← collapsed task chip
│                                      │
│                                      │
│            • • •                     │  ← breathing pulse
│                                      │
│   Thinking this through on your      │  ← reassurance copy
│   device…                            │
│                                      │
│   ✈ Works in airplane mode. Your     │  ← offline reinforcement
│   words never leave this phone.      │
│                                      │
└─────────────────────────────────────┘
```

### 1c. Results state
Numbered, checkable micro-steps. Calm, scannable, one column.

- Task summary at top (the original input, lightly styled).
- Progress line ("2 of 6 done") + thin progress bar.
- Step list: number + step text + checkbox.
- Checked steps get a strikethrough + dimmed text (gentle, not harsh).
- Footer actions: **"Start over"** (clears, back to Input) and **"Try again"** (regenerate from same input).
- Optional micro-celebration when all steps checked (see 5e).

```
┌─────────────────────────────────────┐
│  Plan my sister's birthday           │  ← task summary (H2)
│  2 of 6 done   ▓▓▓░░░░░░░            │  ← progress text + bar
│                                      │
│  ┌─────────────────────────────────┐ │
│  │ 1  Pick a date & confirm with   │☑│ │  ← checked: strikethrough+dim
│  │    her                          │ │ │
│  ├─────────────────────────────────┤ │
│  │ 2  Decide a budget              │☑│ │
│  ├─────────────────────────────────┤ │
│  │ 3  Make the guest list          │☐│ │
│  ├─────────────────────────────────┤ │
│  │ 4  Choose venue or home setup   │☐│ │
│  ├─────────────────────────────────┤ │
│  │ 5  Order cake                   │☐│ │
│  ├─────────────────────────────────┤ │
│  │ 6  Send invites                 │☐│ │
│  └─────────────────────────────────┘ │
│                                      │
│   Start over            Try again    │  ← secondary actions
└─────────────────────────────────────┘
```

### 1d. Error / Empty-result state
Two sub-cases, same calm layout, different copy.

- **Empty-result** — model returned nothing usable (0 steps / unparseable).
- **Error** — runtime/model load/inference failure.

Both keep the original input so "Try again" re-runs without retyping. Never blame the user. Never imply a network problem (there is none).

```
┌─────────────────────────────────────┐
│  You asked:                          │
│  "Plan my sister's birthday…"        │
│                                      │
│            ◌                         │  ← soft neutral glyph (not alarming)
│                                      │
│   I couldn't break that one down     │
│   just now. Let's try again.         │
│                                      │
│   ┌───────────────┐  ┌────────────┐  │
│   │   Try again   │  │   Edit     │  │  ← retry / back to input
│   └───────────────┘  └────────────┘  │
└─────────────────────────────────────┘
```

---

## 2. Layout & components

Single scroll container, vertical stack. Max content width 480 (center on tablets). Screen horizontal padding `space.5 (20)`.

### Component hierarchy
```
OverwhelmManagerScreen (SafeAreaView)
├─ Header (prompt H1 + subtext)            [Input state only]
├─ TaskChip / TaskSummary                   [Loading, Results, Error]
├─ Body (state switch)
│  ├─ InputBlock      (TextInput + SubmitButton)   [Input]
│  ├─ LoadingBlock    (PulseIndicator + reassure)  [Loading]
│  ├─ ResultsBlock    (ProgressBar + StepList)     [Results]
│  └─ MessageBlock    (Glyph + copy + actions)     [Error/Empty]
└─ PrivacyFootnote                          [Input, Loading]
```

### 2a. TextInput (`OverwhelmInput`)
- Multiline, auto-grows from 3 lines (min height `96`) to ~6 lines, then scrolls internally.
- Padding `space.4 (16)` all sides. Radius `radii.lg (16)`. Border `1` `color.border`.
- States:
  - **Default:** bg `color.surface`, border `color.border`.
  - **Focused:** border `color.accent`, subtle elevation `e1`.
  - **Filled:** same as focused/default; CTA enables.
  - **Disabled (during loading):** not shown — input is replaced by Loading body.
- `maxLength` 500 (see open questions). Show no counter unless near limit.

### 2b. Submit CTA (`PrimaryButton` "Break it down")
- Full-width, height `52`, radius `radii.lg (16)`, bg `color.accent`, label `color.onAccent`, weight 600.
- States:
  - **Default/Enabled:** bg `color.accent`.
  - **Disabled (empty input):** bg `color.accentMuted`, label `color.textTertiary`, no press.
  - **Pressed:** opacity 0.85 / bg `color.accentPressed`.
- Min touch target 52 ≥ 44pt. Spacing above: `space.5 (20)`.

### 2c. TaskSummary / TaskChip
- **Chip (Loading/Error):** small label "You asked:" (caption) + truncated task (1 line, ellipsis). Muted bg `color.surfaceAlt`, radius `radii.md (12)`, padding `space.3 (12)`.
- **Summary (Results):** task as H2, full text, no truncation. Spacing below to progress `space.3 (12)`.

### 2d. ProgressBar + label (`StepProgress`)
- Text "{done} of {total} done" — caption, `color.textSecondary`.
- Bar: height `6`, radius `radii.pill`, track `color.surfaceAlt`, fill `color.accent`, animated width 200ms ease-out.
- Hidden until ≥ 1 step exists.

### 2e. StepList + StepItem (`StepItem`)
- Vertical list, items separated by `1` hairline `color.border` OR `space.2 (8)` gap inside a single card — use the **card-with-dividers** approach (one card, `color.surface`, radius `radii.lg`, divider rows).
- Each row: number badge (left) · step text (center, flex) · checkbox (right).
- Row min height `56`, vertical padding `space.3 (12)`, horizontal `space.4 (16)`.
- Number badge: caption weight 600, `color.textTertiary`, fixed width `24`.
- Step text: body, `color.textPrimary`.
- States:
  - **Default (unchecked):** full-opacity text, empty checkbox.
  - **Checked:** checkbox filled accent + check glyph; text gets strikethrough + `color.textTertiary` (animate over 150ms).
  - **Pressed:** whole row pressable, brief bg tint `color.surfaceAlt`.
- The **entire row** toggles the checkbox (bigger target), not just the box.

### 2f. Checkbox (`StepCheckbox`)
- Size `24×24`, radius `radii.sm (8)` (rounded square). Hit slop expands to ≥ 44×44.
- Unchecked: border `2` `color.border`, transparent fill.
- Checked: fill `color.accent`, white check glyph, border `color.accent`. 120ms scale-in pop (1.0→1.08→1.0).

### 2g. Secondary actions (Results & Error)
- Text buttons, no fill. Label `color.accent`, weight 600, height `44`.
- "Start over" (left) and "Try again" (right) in a row with `space.between`.
- Error state uses "Try again" (primary-styled) + "Edit" (text button).

### 2h. PrivacyFootnote
- Caption, `color.textSecondary`, leading lock/device glyph.
- Centered, pinned near bottom with `space.6 (24)` above safe-area inset.

---

## 3. Visual design tokens

Implement as a single `tokens.ts`. Values are concrete — no guessing.

### 3a. Color (light, calm — primary theme)
| Token | Hex | Use |
|---|---|---|
| `color.background` | `#F7F8F6` | screen background (soft off-white, faint warm green) |
| `color.surface` | `#FFFFFF` | input, cards |
| `color.surfaceAlt` | `#EEF1ED` | progress track, chip bg, pressed tint |
| `color.border` | `#E1E5DF` | hairlines, input border |
| `color.textPrimary` | `#2C322E` | headings, step text (not pure black — softer) |
| `color.textSecondary` | `#5C645E` | subtext, captions |
| `color.textTertiary` | `#9AA29B` | disabled, checked/struck text, number badge |
| `color.accent` | `#6B9080` | sage green — CTA, checkbox, progress, links |
| `color.accentPressed` | `#5A7C6E` | CTA pressed |
| `color.accentMuted` | `#C7D6CF` | disabled CTA bg |
| `color.onAccent` | `#FFFFFF` | text/glyph on accent |
| `color.error` | `#A86B6B` | error glyph/accent (muted, non-alarming) |

> One quiet accent only (sage `#6B9080`). No reds for normal flow; error uses a desaturated clay, never bright red.

**Dark theme (optional, v1.1):** background `#1A1E1B`, surface `#232824`, textPrimary `#E6EAE5`, accent `#8FB3A3`. Flag for later — not required for first build.

### 3b. Typography
System font (San Francisco / Roboto) for native feel and zero bundle cost. Optional rounded display font flagged as open question.

| Role | Size | Line height | Weight |
|---|---|---|---|
| H1 (prompt) | 26 | 34 | 600 |
| H2 (task summary) | 20 | 28 | 600 |
| Body (steps, input) | 17 | 26 | 400 |
| Subtext | 15 | 22 | 400 |
| Caption (progress, footnote, number) | 13 | 18 | 400/600 |

Letter spacing 0. Respect OS Dynamic Type / font scaling (see accessibility).

### 3c. Spacing scale (4pt base)
`space.1=4 · space.2=8 · space.3=12 · space.4=16 · space.5=20 · space.6=24 · space.7=32 · space.8=48`

- Screen horizontal padding: `space.5 (20)`
- Prompt → input: `space.5 (20)`
- Input → CTA: `space.5 (20)`
- Between cards/sections: `space.6 (24)`
- Inside list rows: `space.3 (12)` vertical

### 3d. Corner radii
`radii.sm=8 · radii.md=12 · radii.lg=16 · radii.xl=24 · radii.pill=999`

### 3e. Elevation
Keep nearly flat for calm. Use borders over shadows where possible.
- `e0`: none (default surfaces).
- `e1` (focused input, results card): y2, blur 8, `rgba(44,50,46,0.06)`.
- No heavy shadows anywhere.

---

## 4. Microcopy

Warm, plain, second person. Short. Never clinical, never hype.

| Location | Copy |
|---|---|
| H1 prompt | **What's overwhelming you today?** |
| Subtext | Type it out. I'll break it into small, doable steps — right here on your phone. |
| Input placeholder | e.g. "Plan my sister's birthday next weekend" |
| Submit CTA | **Break it down** |
| Privacy footnote (input) | Runs fully on your device. Nothing is sent anywhere. |
| Loading title | Thinking this through on your device… |
| Loading offline line | Works in airplane mode. Your words never leave this phone. |
| Task chip label | You asked: |
| Results progress | {done} of {total} done |
| All-complete celebration | Nicely done. You handled it, one step at a time. |
| Empty-result message | I couldn't break that one down just now. Let's try again — or tweak the wording. |
| Error message | Something hiccuped on this end. Your text is safe — let's try again. |
| Retry button | Try again |
| Edit/back button | Edit |
| Start over button | Start over |

Tone rules:
- Never say "server", "upload", "cloud", "internet" — except to reassure ("never leaves this phone").
- Never imply the user did something wrong.
- Keep all copy ≤ 2 short lines.

---

## 5. Interaction & accessibility

### 5a. Keyboard
- TextInput: `multiline`, `returnKeyType="default"` (Return inserts newline — do NOT submit on Return for multiline). Submit only via CTA.
- On submit: `Keyboard.dismiss()` then transition.
- `KeyboardAvoidingView` so CTA stays visible above keyboard (iOS `padding`, Android `height`).
- Auto-focus the input on first mount of Input state (gentle — consider not auto-focusing to avoid keyboard jump; flag as preference). Default: **do not** auto-focus; let the calm screen breathe first.

### 5b. Checkbox interaction
- Tap anywhere on the row toggles. Hit slop ensures ≥ 44×44 target on the box itself too.
- Toggle is instant, optimistic, local state only (no async).
- Light haptic on check (`Haptics.selectionAsync` / `impactLight`) — subtle, can be disabled by OS reduce-motion/haptic settings.

### 5c. Completion feedback
- Progress bar animates on each toggle (200ms).
- When all steps checked: show celebration line (5a copy) with a soft fade-in; one gentle haptic `notificationSuccess`. No confetti — stays calm. Auto-dismiss celebration after ~4s or on next interaction.

### 5d. Touch targets
- All interactive elements ≥ 44×44pt. CTA 52 tall. Rows 56 tall. Checkbox hit slop to 44.

### 5e. Contrast (WCAG AA)
- textPrimary `#2C322E` on background `#F7F8F6`: ratio ~11:1 (pass).
- textSecondary `#5C645E` on `#F7F8F6`: ~5.4:1 (pass for body).
- onAccent `#FFFFFF` on accent `#6B9080`: ~3.3:1 — **OK for large text/UI but borderline for small text.** CTA label is 17/600 (large-ish); acceptable. If smaller accent text appears, darken accent to `#5A7C6E`. Flag for CTO/design QA.
- Disabled CTA must still read as disabled (lower contrast intentional) but stay perceivable.

### 5f. Screen reader (VoiceOver / TalkBack)
- Prompt H1: `accessibilityRole="header"`.
- Input: `accessibilityLabel="Describe what's overwhelming you"`, hint = placeholder intent.
- CTA: `accessibilityLabel="Break it down"`, `accessibilityState={{disabled}}`.
- Loading: `accessibilityLiveRegion="polite"` announcing "Thinking on your device".
- Step row: `accessibilityRole="checkbox"`, `accessibilityState={{checked}}`, label = "Step {n}: {text}".
- Progress: announce "{done} of {total} steps done" politely on change.
- Respect `prefers-reduced-motion`: replace pulse/pop animations with simple opacity fade.

### 5g. Step text from model
- Render as plain text; strip any leading numbering/markdown the model emits (the UI owns numbering). Trim whitespace. Handle long steps gracefully (wrap, no truncation in results).

---

## 6. Notes / handoff

### For the mobile developer
- This is **one screen, four body states** driven by a single state enum: `'input' | 'loading' | 'results' | 'error'` (+ an `errorKind: 'empty' | 'failure'`). Keep step list in local component state `Step[] = { id, text, checked }`.
- Checkbox state is ephemeral/local for v1 — **no persistence** across app restarts unless CTO wants it (see open questions). If persistence is added later, use on-device storage only (AsyncStorage / MMKV) — never a network call.
- Numbering is presentation-only; derive from index. Do not trust model numbering.
- Build `tokens.ts` from section 3 first; everything references tokens, no hardcoded hex/spacing.
- No network code anywhere on this screen. The privacy promise is literal — there is nothing to call.
- Loading UX must tolerate up to ~5s (cold start / slower devices) without feeling broken; the breathing pulse + reassurance copy covers this.
- Empty vs error are distinct copy paths but share layout — parameterize `MessageBlock`.

### Open questions for CTO / AIML engineer
1. **Model output shape:** What exactly does inference return — a JSON array of step strings, a newline-delimited string, or raw text needing parsing? This determines parsing/sanitizing in the UI. Requesting a stable contract, ideally `{ steps: string[] }`.
2. **Step count guarantee:** README says 5–10. Can the model under/over-produce? UI handles any count but progress/empty logic assumes ≥1. Confirm min/max enforcement happens in model wrapper vs UI.
3. **Latency reality:** Is < 2s realistic on mid/low-tier Snapdragon and on cold model load? If p95 can exceed ~5s, do we need a cancel/"Stop" affordance and/or a streaming reveal (steps appear as generated)? Streaming would change the Results/Loading design — want to know before build.
4. **Cancel during inference:** Can ExecuTorch inference be interrupted mid-run? If not, "Stop" can only hide UI, not free compute — affects whether we offer it.
5. **Input limits:** Is 500 chars a sane max for the model's context/prompt budget? Need the real ceiling.
6. **Persistence expectation:** Should a user's checklist survive app backgrounding/restart? (On-device only.) Affects whether we wire MMKV in v1.
7. **Contrast tweak:** OK to darken accent to `#5A7C6E` if any small accent text appears, to stay AA? Design-side call but flagging.
8. **Failure taxonomy:** What distinct failure modes should map to "error" vs "empty-result" (model load fail, OOM, timeout, empty output)? Helps copy + logging (on-device logs only).

### Needs sign-off
- **CTO:** confirm no-network architecture for this screen and the model output contract (Q1–Q5).
- **AIML:** the `{ steps: string[] }` (or agreed) contract + realistic latency numbers for the loading UX decision (streaming vs single reveal).
- **Designer (me):** will produce Figma visual mockups of all four states from this spec next; this Markdown is the build-against source of truth in the meantime.
