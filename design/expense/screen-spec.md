# OCR Expense — Screen Spec (v1)

**Feature:** OCR Expense (build priority #4 — *receipts scanned on-device, never uploaded*)
**Platform:** React Native (Android + iOS). On-device OCR + field extraction (ExecuTorch / on-device vision). **No network calls. The photo and everything read from it stays on the phone.**
**Engine:** On-device receipt reader → from a camera frame (or picked photo), extract **merchant, date, total, category** (and optionally line items), each with a confidence signal, for the user to review and correct.
**Owner (design):** lifepilot-designer · **Builds against this:** lifepilot-mobile-developer
**Status:** Ready for handoff · **Date:** 2026-06-26

> Design north star (shared with Overwhelm Manager, Energy Predictor, Hydration Tracker): **calm, not complex.** One thing on screen at a time, generous whitespace, the single sage accent. Reuses `mobile/src/theme/tokens.ts` **verbatim** — same sage palette, type scale, spacing, radii, warm second-person voice. No new visual language.
>
> Privacy story for this feature is the **strongest in the app and the simplest to tell**: like the sleep data in Energy Predictor, the receipt photo and every detail read from it are processed **entirely on your phone and never uploaded.** Unlike Hydration, there is **no network nuance** — there is no network at all in this flow. The camera is the most sensitive-feeling surface in the app (a live lens), so the promise must be made *concrete and visible* right where the camera lives, not buried in a footnote.
>
> Tone reminder: this is a **wellness app, not accounting software.** Expense tracking here is for calm awareness of spending, not bookkeeping. Resist every urge toward dense tables, tax fields, multi-currency ledgers, and receipt archives. Minimal, glanceable, forgiving.

---

## 0. Screen at a glance

Three surfaces:

- **`ExpenseCaptureScreen`** — the camera/scan surface: frame a receipt, capture (or pick an existing photo), and the on-device **"reading…"** processing state. Handles blurry/partial/failed scans gracefully.
- **`ExpenseReviewScreen`** — the extracted-fields screen: review & correct merchant, date, total, category (and optionally line items). Every field easily editable. Low-confidence fields flagged gently for a glance-check. Save → adds to the list.
- **`ExpenseListScreen`** — the running list of saved expenses + simple totals (by day / category / month) + an empty state. This is the feature's home; the floating **+** / "Scan a receipt" action launches capture.

Plus **`ExpenseOnboardingFlow`** — a short one-time flow before the first camera use: the on-device privacy promise made concrete → OS camera (and optional photo-library) permission → handoff. Denied → manual-entry fallback. Reuses the Energy/Hydration onboarding pattern (calm steps + outcome screens, progress dots).

Navigation flow:
```
ExpenseListScreen ──"Scan a receipt"──▶ [camera perm?]
        ▲                                   │ first run / not granted → ExpenseOnboardingFlow
        │                                   │ granted → ExpenseCaptureScreen
        │                                         │ capture / pick photo → [reading…]
        │                                         │   success → ExpenseReviewScreen ──Save──┐
        │                                         │   blurry/partial/failed → recovery (retake / enter manually)
        └─────────────────────────────────────────────────────────────────────────────────┘
"Enter manually" (from list, capture recovery, or denied perm) ──▶ ExpenseReviewScreen (blank, no confidence flags)
```

---

## 1. Capture flow — `ExpenseCaptureScreen`

Goal: snap a receipt fast and calmly, with the privacy promise visible *on the camera screen itself*, and never punish a bad photo.

### 1.0 Capture surface decision

A **live camera preview with a soft receipt-shaped guide frame**, a single large shutter, a "pick from photos" affordance, and a persistent on-device privacy line. We deliberately avoid a busy "document scanner" chrome (corner-magnets, auto-crop reticles, flash/HDR/filter toolbars). One gentle guide + one shutter. Auto-capture is **off by default** in v1 (a surprise auto-snap feels un-calm and out of the user's control); the user taps to capture. (Auto-capture-when-steady is a flagged future option, §6.)

**Guardrails to keep it calm, not a scanner app:**
- One **receipt guide**: a soft rounded-rect outline (`color.surface` @ low opacity stroke) hinting "fit the receipt in here," with a one-line tip. No aggressive edge-detection animation, no red "align!" warnings.
- One **shutter** (large, centered, `color.onAccent` ring) — the only primary control.
- One secondary affordance: **photo library** thumbnail/icon (left of shutter). One tertiary: **close/back** (top-left).
- **No** flash/grid/ratio/filter clutter on screen. A single small **flash auto/off** toggle is permitted top-right *only if* low-light receipts need it (flag, §6) — default hidden.
- The privacy line is **always visible** on the camera screen (this is the point of maximum sensitivity).

### 1a. Camera-ready state

```
┌─────────────────────────────────────┐
│ ✕                          ⚡(opt)   │  ← close (top-left); optional flash toggle
│                                      │
│   ┌─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┐    │
│   ┆                            ┆    │  ← soft receipt guide frame
│   ┆      (live camera          ┆    │     (rounded, low-opacity stroke)
│   ┆       preview)             ┆    │
│   ┆                            ┆    │
│   ┆   Fit the whole receipt    ┆    │  ← one calm tip (caption)
│   ┆   inside the frame         ┆    │
│   ┆                            ┆    │
│   └─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┘    │
│                                      │
│                                      │
│   ▢            ◉            (Manual) │  ← [photos]  [shutter]  [enter manually]
│  photos      capture                 │
│                                      │
│  ⦿ Read on your phone. The photo     │  ← persistent privacy line (always shown)
│     never leaves this device.        │
└─────────────────────────────────────┘
```

- **Shutter** `◉`: large (≥ `72` diameter), centered, calm sage/white ring; light haptic on press.
- **Photos** `▢`: opens the OS photo picker to choose an existing receipt image (§1e). Labeled for SR.
- **Enter manually**: text affordance (right) → `ExpenseReviewScreen` blank, skipping OCR (always available, also the denied-permission fallback, §4).
- **Privacy line** pinned at the very bottom, on a subtle scrim so it's legible over any camera content. This is the camera-screen equivalent of the sibling footnotes, and it carries extra weight here.

### 1b. Captured → on-device "reading…" state

After capture (or photo pick), freeze the captured frame and overlay the calm processing state. **Never a network spinner.** Same breathing-pulse language as Overwhelm's loading (§1b there). Target on-device extraction is fast, but plan UX for up to ~3–5s on older devices / cold model load.

```
┌─────────────────────────────────────┐
│                                      │
│   ┌────────────────────────────┐     │
│   │                            │     │  ← the captured receipt image,
│   │   (captured receipt,       │     │     gently dimmed / softly blurred
│   │    dimmed behind overlay)  │     │
│   │                            │     │
│   └────────────────────────────┘     │
│                                      │
│            • • •                     │  ← breathing pulse (not a spinner)
│                                      │
│      Reading your receipt…           │  ← reassurance copy
│                                      │
│   ✈ Works in airplane mode. The      │  ← offline reinforcement
│      photo stays on your phone.      │
│                                      │
└─────────────────────────────────────┘
```

- Show the captured image behind the overlay so the user knows *which* photo is being read.
- Breathing pulse `• • •` (~1.4s loop), reduced-motion → static dots / opacity fade.
- No cancel needed for a ~3–5s op; if p95 runs longer (§6), add a **"Cancel"** that discards and returns to camera-ready (image not saved).
- On success → `ExpenseReviewScreen` (§2). On low-quality/failed read → §1c.

### 1c. Blurry / partial / failed scan — graceful recovery

OCR is never perfect, and receipts are crumpled, faded, and photographed in bad light. We **never** dead-end and **never** blame the user. Three sub-cases, one calm layout, different copy. The key principle: **always offer a path forward that doesn't require a perfect photo** — retake *and* "enter it by hand" are always present.

- **Too blurry / unreadable** — OCR confidence below a floor across the board (couldn't read enough to fill fields).
- **Partial** — got *some* fields but missed/low-confidence on key ones (e.g. read merchant + date but not total). Prefer to still go to Review with the partial data pre-filled and the missing field flagged (§2), rather than a failure screen — failing on a partial read feels worse than letting the user finish it. Only show the failure layout if too little was read to be useful.
- **No receipt found** — model didn't detect a receipt-like document at all.

```
┌─────────────────────────────────────┐
│  ✕                                   │
│                                      │
│            ◌                         │  ← soft neutral glyph (not alarming)
│                                      │
│   That photo was a little hard to    │  ← gentle, never "error"/"failed"
│   read. A clearer, flatter shot in   │
│   good light usually does it.        │
│                                      │
│   ┌───────────────┐ ┌──────────────┐ │
│   │   Retake      │ │ Enter by hand│ │  ← retake / manual (both always)
│   └───────────────┘ └──────────────┘ │
│                                      │
│   Tip: lay the receipt flat and fill │  ← one quiet, practical tip
│   the frame.                         │
│                                      │
│  ⦿ Nothing was uploaded. That photo  │  ← reinforce: even a failed read
│     stayed on your phone.            │     never left the device
└─────────────────────────────────────┘
```

- **Retake** → back to camera-ready (§1a).
- **Enter by hand** → `ExpenseReviewScreen` blank (§2), no confidence flags.
- Copy stays warm: "a little hard to read," never "Error" / "Failed" / "Invalid."
- Privacy reinforced even on failure — a failed read is a moment users might worry "did it send my receipt somewhere?"; answer it before they ask.

### 1d. Permission-needed (entry to capture without grant)

If the user taps "Scan a receipt" without camera permission (first run, or revoked later), route to `ExpenseOnboardingFlow` (§4) — not a raw OS dialog, not an error. From a revoked state, the onboarding's permission step deep-links to Settings.

### 1e. Pick an existing photo

- **Photos** affordance opens the OS image picker (single select). On many setups this can use the **limited / single-photo picker** (iOS `PHPicker`, Android Photo Picker) which needs **no broad library permission** — preferred, since it grants access to just the chosen image. Confirm picker mechanics with CTO (§6) so onboarding only asks for what's needed.
- Chosen image flows into the same **"reading…"** state (§1b) and onward. Same on-device promise — a picked photo is read locally too, never uploaded.
- If the picked image isn't a readable receipt → same recovery (§1c).

---

## 2. Review & correct — `ExpenseReviewScreen`

Goal: let the user confirm or fix what was read in **seconds**, with editing that feels like *tidying a card*, not *filling a form*. OCR is never perfect, so every field is one tap from editable; low-confidence fields are flagged **gently** for a glance-check without turning the screen into a sea of warnings.

### 2.0 Field model & confidence

Fields surfaced (v1): **merchant, date, total, category.** Optional **line items** are flagged out of scope for v1 pending the model contract (§6) — if cheap and reliable they can show as a collapsed, read-only detail; full line-item editing is explicitly *not* a v1 goal (that's accounting software).

Each field carries a confidence the model returns (§6). The UI maps confidence to **two visual tiers only** (calm > granular):
- **Confident** — normal styling, no flag. (Assume e.g. confidence ≥ ~0.8; threshold owned by AIML, §6.)
- **Glance-check** — a single quiet inline marker (a soft `◔` dot + "double-check this") on *that one field*. Never red, never a banner, never a count. Used most importantly for the **total** (the field people care about getting right). At most one or two fields should ever be flagged; if the model is unsure about everything, that's the partial/failed path (§1c), not a wall of flags.

Missing field (not read at all) → shown empty with a soft prompt placeholder ("Add total"), treated like a glance-check (it needs attention) but phrased as "add," not "fix."

### 2a. Review state (fields pre-filled)

```
┌─────────────────────────────────────┐
│  ✕                          Receipt ▢│  ← close; tap thumbnail to view photo
│                                      │
│  Here's what I read                  │  ← H1
│  Tap anything to fix it.             │  ← subtext: editing is expected
│                                      │
│  ┌─────────────────────────────────┐ │
│  │ Merchant                        │ │  ← field card (label + value)
│  │ Blue Bottle Coffee          ✎  │ │     pencil affordance on the right
│  ├─────────────────────────────────┤ │
│  │ Date                            │ │
│  │ Thu, Jun 26, 2026           ✎  │ │
│  ├─────────────────────────────────┤ │
│  │ Total              ◔ double-check│ │  ← glance-check marker (quiet)
│  │ $18.40                      ✎  │ │
│  ├─────────────────────────────────┤ │
│  │ Category                        │ │
│  │ ☕ Coffee & cafés         ⌄    │ │  ← opens category picker (§2d)
│  └─────────────────────────────────┘ │
│                                      │
│  Items on this receipt          ⌄    │  ← optional line items (collapsed, §2e)
│                                      │
│  ┌─────────────────────────────────┐ │
│  │            Save                 │ │  ← primary CTA
│  └─────────────────────────────────┘ │
│            Discard                   │  ← text button (confirm before delete)
│                                      │
│  ⦿ Read and saved on your phone.     │  ← privacy footnote
│     Nothing was uploaded.            │
└─────────────────────────────────────┘
```

- **Card-with-dividers** (same pattern as Overwhelm StepList §2e / Energy DriverRow / Hydration intake): one `color.surface` card, `radii.lg`, `1px color.border`, divider rows. Each field is a row.
- **Receipt thumbnail** (top-right): tap to view the captured photo full-screen (so the user can read it while correcting). The image lives on-device only.
- **Save** writes the expense to the on-device list (§3) and returns there.
- **Discard** → confirm ("Discard this receipt?") then drop it (and its photo) — never silent data loss, but never a heavy dialog either.

### 2b. Field editing interaction (the heart of this screen)

Editing must feel light. Each field type uses the **right** lightweight input, inline, not a separate form page:

| Field | Tap target | Editor | Notes |
|---|---|---|---|
| **Merchant** | whole row / ✎ | inline text field (keyboard) | autocaps words; the value becomes editable in place, keyboard rises, CTA stays reachable (KeyboardAvoidingView). |
| **Date** | whole row / ✎ | native date picker (wheel/calendar) | defaults to read value or today; no manual typing of date formats. |
| **Total** | whole row / ✎ | inline numeric field, currency-formatted | numeric keypad; currency symbol from settings/locale (§6); no forced decimals while typing, format on blur. The **most likely field to be wrong** — make it the easiest to edit and it carries the glance-check most often. |
| **Category** | whole row / ⌄ | category picker sheet (§2d) | single tap to open a calm chip/list picker. |

- **Tap anywhere on the row** opens that field's editor (big target), not just the ✎ glyph (mirrors Overwhelm's "whole row toggles" rule).
- Editing is **optimistic and local** — no async, no save-per-field. Nothing persists until **Save**.
- Editing a flagged field **clears its glance-check marker** (the user has now verified it) — a quiet, satisfying signal that they've handled it.
- Inline validation is gentle: an empty total or merchant softly prompts ("Add a total to save") rather than blocking with a red error; **Save** can stay enabled and nudge to the empty field, OR disable until total present — recommend: require **total** (the one field an expense needs) and let everything else be optional/blank. Confirm minimum-required set with CTO (§6).

### 2c. Confidence, shown gently

- Glance-check marker = one `◔` glyph + caption "double-check this" in `color.textSecondary`, sitting on the field's label row. **Not** red, **not** a top-of-screen banner, **not** a number.
- Reserve flags for genuinely uncertain reads — over-flagging trains users to ignore them and feels anxious. Default: flag the **total** when below threshold; flag others only if clearly low.
- A field the model **didn't read** shows an empty value with a soft placeholder ("Add total") and is treated as needing attention, phrased as add/complete, not fix/error.
- No global "X fields need review" counter (clutter + mild anxiety). The markers on the fields themselves are enough.

### 2d. Category picker

- Opens as a calm bottom sheet (or inline expand) with a **small, fixed set of warm categories** + icons — wellness-app simple, not a chart of accounts. Proposed default set (confirm/trim with CTO, §6):
  `☕ Coffee & cafés · 🍽 Food & groceries · 🚌 Transport · 🛍 Shopping · 🎬 Fun & leisure · 🏥 Health · 🏠 Home & bills · ✈ Travel · ✦ Other`
  (Render category icons as calm monochrome/sage glyphs in-app rather than full-color emoji to fit the palette — emoji shown here only as shorthand.)
- The model proposes one category (how it's assigned is an open question, §6); the picker lets the user change it in one tap. Selected category gets the sage accent check.
- Single-select, no nesting, no custom-category creation in v1 (flag as possible later). Keep it to one screen of chips, no scrolling-forever list.

```
Choose a category
┌─────────────────────────────────────┐
│ ☕ Coffee & cafés        ✓           │  ← selected (sage check)
│ 🍽 Food & groceries                  │
│ 🚌 Transport                         │
│ 🛍 Shopping                          │
│ 🎬 Fun & leisure                     │
│ 🏥 Health                            │
│ 🏠 Home & bills                      │
│ ✈ Travel                             │
│ ✦ Other                              │
└─────────────────────────────────────┘
```

### 2e. Line items (optional, collapsed, read-only in v1)

Only shown if the model reliably returns them (§6). Collapsed by default ("Items on this receipt ⌄"). Expanded = a quiet read-only list (item name · price), card-with-dividers. **No** per-item editing in v1 — that's data entry we explicitly avoid. If line items are noisy/unreliable, **omit the section entirely** rather than show messy rows. Decision gated on model output (§6).

```
Items on this receipt            ⌃
┌─────────────────────────────────────┐
│ Latte                       $4.50   │
│ Croissant                   $3.90   │
│ Cold brew                   $5.00   │
│ …                                   │
└─────────────────────────────────────┘
```

---

## 3. Expense list / overview — `ExpenseListScreen`

Goal: a calm running list of saved expenses with **simple, glanceable totals** — emphatically *not* an accounting dashboard. This is the feature's home screen and the launch point for scanning.

### 3.0 What we show (and deliberately don't)

- **Show:** a short total for the current period (this month by default), a light way to switch period (day / month) and/or see by category, and a reverse-chronological list of expenses (merchant · category · amount · date).
- **Don't:** budgets, charts-heavy dashboards, tax categories, export/CSV, multi-account, currency conversion, running balances. (All flagged as out-of-scope; revisit only if users ask — this is wellness, not finance.)

### 3a. List state (has expenses)

```
┌─────────────────────────────────────┐
│  Spending                            │  ← H1
│  June 2026                      ⌄    │  ← period switcher (Month default)
│                                      │
│  $312.80                             │  ← period total (large, calm)
│  this month                          │  ← subtext
│                                      │
│  By category                    ⌄    │  ← collapsible mini-breakdown (§3c)
│                                      │
│  ┌─────────────────────────────────┐ │
│  │ ☕ Blue Bottle Coffee           │ │  ← expense row
│  │    Coffee & cafés      $18.40   │ │     merchant · category · amount
│  │    Jun 26                       │ │     date (quiet)
│  ├─────────────────────────────────┤ │
│  │ 🍽 Trader Joe's                  │ │
│  │    Food & groceries    $54.20   │ │
│  │    Jun 25                       │ │
│  ├─────────────────────────────────┤ │
│  │ 🚌 Metro Transit                 │ │
│  │    Transport            $2.75   │ │
│  │    Jun 25                       │ │
│  └─────────────────────────────────┘ │
│                                      │
│  ⦿ All your receipts stay on this    │  ← privacy footnote
│     phone. Nothing is uploaded.      │
│                                      │
│            ┌───────────────┐         │
│            │ ◉ Scan receipt│         │  ← primary action (FAB / pinned button)
│            └───────────────┘         │
└─────────────────────────────────────┘
```

- **Period total** is the hero number, large and calm (`type.h1` or a `display` size — flag, §6). Subtext names the period.
- **Period switcher**: at minimum **This month** (default) and **Today**; optionally a simple month back/forward. Keep it to a quiet chevron/segmented control, not a date-range builder.
- **Expense rows**: card-with-dividers. Leading category glyph (sage) · merchant `body` `textPrimary` · category + amount line (`subtext` `textSecondary` for category, amount `body`/`captionStrong` `textPrimary`) · date quiet `caption` `textTertiary`.
- **Tap a row** → opens it in `ExpenseReviewScreen` (read/edit mode) to fix or delete (swipe-to-delete optional; confirm before delete).
- **Scan receipt** primary action persistently reachable (FAB or pinned bottom button) — the main job of this screen.

### 3b. Empty state (no expenses yet)

Warm, inviting, sets the privacy tone before the first scan. Never a barren "No data."

```
┌─────────────────────────────────────┐
│  Spending                            │  ← H1
│                                      │
│              ◧                       │  ← soft receipt glyph (sage)
│                                      │
│   No receipts yet.                   │
│   Snap one and I'll pull out the     │  ← warm, explains the value
│   merchant, date, and total — all    │
│   read right here on your phone.     │
│                                      │
│   ┌─────────────────────────────────┐│
│   │       ◉  Scan a receipt         ││  ← single clear primary action
│   └─────────────────────────────────┘│
│            Enter one by hand         │  ← secondary, always available
│                                      │
│   ⦿ Your receipts never leave this   │  ← privacy reassurance up front
│      phone.                          │
└─────────────────────────────────────┘
```

### 3c. "By category" mini-breakdown (collapsible)

Collapsed by default to keep first paint calm. Expanded = a few quiet rows (category · this-period total), largest first. **No** pie chart, **no** percentages-shouted — at most a thin sage proportion bar per row if it stays calm (optional; can omit). Cap to top ~5 categories + "Other."

```
By category                       ⌃
┌─────────────────────────────────────┐
│ 🍽 Food & groceries        $142.10  │
│ 🛍 Shopping                 $78.00  │
│ ☕ Coffee & cafés           $46.20  │
│ 🚌 Transport                $21.50  │
│ ✦ Other                    $25.00  │
└─────────────────────────────────────┘
```

---

## 4. Permissions / onboarding — `ExpenseOnboardingFlow`

Goal: by the end, the user can say *"the app uses my camera to read receipts, and the photo and everything read from it stay on my phone — nothing is uploaded."* This is the **easiest privacy story in the app to tell** (no network at all in this flow), so tell it plainly and confidently. Reuses the Energy/Hydration onboarding pattern (calm steps + outcome screens, progress dots, "Not now" always available, never punished).

Permissions needed:
- **Camera** (required to scan; without it → manual entry still works).
- **Photo library** — *ideally none*, if we use the single-photo OS picker (§1e); otherwise a read scope for "pick existing photo." Confirm with CTO (§6) so we ask for the minimum.

### Flow summary
```
[1 Privacy promise (on-device, concrete)] → [2 Camera ask (soft pre-prompt → OS dialog)] → handoff to ExpenseCaptureScreen
        │                                          │ granted → ExpenseCaptureScreen
        │                                          │ denied  → [Denied recovery] → manual entry / Settings deep-link
        └─ "Not now" at any step → ExpenseListScreen (empty), "Enter one by hand" available
```

Two calm steps is enough here (vs. three for Energy) — there's no health data and no network nuance to unpack; over-explaining would undercut how simple the promise is.

### 4a. Step 1 — Privacy promise (concrete, the headline)

```
┌─────────────────────────────────────┐
│  ● ○                                 │  ← step dots
│                                      │
│            ◧ (sage receipt+lock      │  ← single calm glyph
│               glyph)                 │
│                                      │
│  Scan receipts. They never          │  ← H1
│  leave your phone.                   │
│                                      │
│  Point your camera at a receipt and  │  ← subtext, warm + concrete
│  LifePilot reads the merchant, date, │
│  and total — all on this device.     │
│                                      │
│  ✓ The photo stays on your phone     │  ← three plain checks
│  ✓ Everything read from it stays too │
│  ✓ Nothing is ever uploaded          │
│                                      │
│  ┌─────────────────────────────────┐ │
│  │          Continue               │ │  ← primary CTA
│  └─────────────────────────────────┘ │
│            Not now                   │  ← text button
└─────────────────────────────────────┘
```

The middle check — *"everything read from it stays too"* — is the concrete promise the brief asks for: not just the image, but the extracted merchant/date/total/category never leave the device.

### 4b. Step 2 — Camera ask (soft pre-prompt → OS dialog)

Show our own soft ask first, then trigger the native camera permission dialog, so the OS sheet isn't a surprise and a one-shot denial is less likely (same discipline as Energy/Hydration).

```
┌─────────────────────────────────────┐
│  ○ ●                                 │
│                                      │
│            ◉ (sage camera glyph)     │
│                                      │
│  Let's turn on the camera           │  ← H1
│                                      │
│  Next, your phone will ask to let    │  ← pre-empt OS dialog
│  LifePilot use the camera. It's only │
│  used to read receipts you scan —    │
│  the photo stays on this device.     │
│                                      │
│  ┌─────────────────────────────────┐ │
│  │       Turn on camera            │ │  ← triggers OS camera dialog
│  └─────────────────────────────────┘ │
│         Enter receipts by hand       │  ← explicit skip → manual entry
└─────────────────────────────────────┘
```

On CTA: request **camera** permission. After the OS dialog resolves → camera-ready (granted) or denied recovery (4c). Photo-library access, if needed at all, is requested **lazily** the first time the user taps "Photos" (not up front), and ideally avoided via the single-photo picker (§1e, §6).

### 4c. Denied recovery

Never a dead end, never nagging. The feature still works via manual entry; camera can be enabled later from Settings.

```
┌─────────────────────────────────────┐
│            ◌ (neutral glyph)         │
│                                      │
│  No problem.                        │  ← H1, accepting tone
│  Without the camera you can still    │
│  add expenses by hand. Nothing was   │
│  shared, and nothing left your phone.│
│                                      │
│  You can turn on the camera anytime  │
│  in Settings.                        │
│                                      │
│  ┌─────────────────────────────────┐ │
│  │       Enter one by hand         │ │  ← primary path forward
│  └─────────────────────────────────┘ │
│        Open camera settings          │  ← deep-link to OS settings
└─────────────────────────────────────┘
```

- **Enter one by hand** → `ExpenseReviewScreen` blank (no OCR, no confidence flags).
- **Open camera settings** deep-links to the app's permission page (OS dialogs fire once; recovery routes to Settings).
- Manual entry is a **first-class path**, not a consolation prize — frame it neutrally.

---

## 5. Layout, components, tokens, microcopy, accessibility

### 5a. Component hierarchy

```
ExpenseListScreen (SafeAreaView, single ScrollView, maxContentWidth 480)
├─ Header (H1 "Spending" + period switcher)
├─ PeriodTotal (large total + subtext)               [has expenses]
├─ CategoryBreakdown (collapsible "By category")     [has expenses]
├─ ExpenseList (ExpenseRow[], card-with-dividers)    [has expenses]
├─ EmptyState (glyph + warm copy + scan/manual CTAs) [no expenses]
├─ PrivacyFootnote
└─ ScanReceiptAction (FAB / pinned primary)          [all states]

ExpenseCaptureScreen (full-bleed camera)
├─ CameraPreview (+ ReceiptGuideFrame)
├─ TopBar (close; optional flash toggle)
├─ CaptureControls (PhotoPickerBtn · Shutter · ManualEntryLink)
├─ ReadingOverlay (captured image dim + PulseIndicator + reassure)  [reading state]
├─ ScanRecoveryOverlay (glyph + copy + Retake/Manual)               [blurry/partial/failed]
└─ CameraPrivacyLine (always visible)

ExpenseReviewScreen (SafeAreaView, single ScrollView)
├─ TopBar (close + ReceiptThumbnail)
├─ Header (H1 "Here's what I read" + subtext)
├─ FieldCard (card-with-dividers: MerchantField, DateField, TotalField, CategoryField)
│  └─ ConfidenceMarker (glance-check, per field)
├─ LineItemsSection (collapsible, read-only)         [optional, if model returns]
├─ SaveButton (primary) + DiscardButton (text)
└─ PrivacyFootnote
   └─ CategoryPickerSheet (bottom sheet)             [on category tap]
   └─ DatePicker (native)                            [on date tap]

ExpenseOnboardingFlow (separate stack, 2 steps + outcomes)
├─ ProgressDots
├─ OnboardingStep (Promise | CameraAsk)
└─ Outcome (Denied recovery / Settings deep-link)
```

### 5b. Key components

- **ReceiptGuideFrame:** rounded-rect (`radii.lg`/`xl`) dashed-or-soft stroke at low opacity over the live preview; non-interactive; one caption tip. No edge-detection animation in v1.
- **Shutter:** ≥ `72` circle, `color.onAccent`/sage ring on a subtle scrim, hit-slop generous; light haptic on press.
- **ReadingOverlay:** captured frame dimmed (`color.textPrimary` @ low opacity scrim) + breathing `• • •` + reassurance + offline line. Mirrors Overwhelm loading §1b; reduced-motion → static.
- **FieldCard / FieldRow:** card-with-dividers (the app's recurring pattern). Row = label (`captionStrong` `textSecondary`) on top, value (`body` `textPrimary`) below, trailing affordance (✎ for text/number, ⌄ for category) in `color.textTertiary`/`accent`. Whole row tappable, ≥ `56` tall.
- **ConfidenceMarker:** `◔` glyph + "double-check this" `caption` `textSecondary`, inline on the label row. Quiet, single accent-free tone. Clears when the field is edited.
- **CategoryPickerSheet:** bottom sheet, single-select chips/rows with sage check on selection. Calm, one screen, no nesting.
- **PeriodTotal:** large amount `textPrimary` + period subtext `textSecondary`.
- **ExpenseRow:** leading category glyph `accent` · merchant `body` · category `subtext` `textSecondary` + amount `captionStrong`/`body` `textPrimary` · date `caption` `textTertiary`. Tappable → review/edit.
- **ScanReceiptAction:** primary sage button/FAB; on capture screens the **Shutter** is the equivalent.

### 5c. Design tokens used

All from `mobile/src/theme/tokens.ts` — **no new tokens invented.** The only additions are *opacity variants* of existing tokens (camera scrim from `color.textPrimary`; guide-frame stroke and any soft fill from `color.surface`/`color.accent`), computed inline — not new tokens unless CTO prefers naming them. The camera screen is the one dark-ish surface in an otherwise light app; it uses the live preview as its "background," with sage/white controls and the same scrim-over-text discipline for legibility.

| Element | Token |
|---|---|
| Screen bg (list, review, onboarding) | `color.background` `#F7F8F6` |
| Cards (field card, expense rows, breakdown, line items) | `color.surface` `#FFFFFF`, `radii.lg`, `1px color.border` |
| Shutter ring, category glyphs, selected-category check, CTAs, ✎/⌄ active, scan action | `color.accent` `#6B9080` |
| Guide-frame stroke / soft fills | `color.surface` or `color.accent` @ low opacity (computed) |
| Camera dim scrim (reading/recovery) | `color.textPrimary` `#2C322E` @ low opacity (computed) |
| Collapsed-section bg, pressed tint, chip bg | `color.surfaceAlt` `#EEF1ED` |
| Hairlines, field/card borders, dividers | `color.border` `#E1E5DF` |
| Headings, field values, merchant, amounts, period total | `color.textPrimary` `#2C322E` |
| Field labels, subtext, category text, "double-check this", reassurance | `color.textSecondary` `#5C645E` |
| Dates, unit/detail, affordance glyphs at rest, placeholder | `color.textTertiary` `#9AA29B` |
| CTA label / shutter glyph / check on accent | `color.onAccent` `#FFFFFF` |
| Failure/neutral glyph tint | `color.error` `#A86B6B` *(muted clay; use sparingly — recovery copy is warm, not alarming; prefer `textTertiary` `◌` over error red)* |
| Type roles | `type.h1` headers + period total · `type.h2` reserved (large value option) · `type.body` field values / merchant / amounts · `type.subtext` field copy / category · `type.caption`/`captionStrong` labels, dates, markers |
| Spacing | `space.5 (20)` screen padding · `space.6 (24)` between sections · `space.4 (16)` inside cards · `space.3 (12)` row padding / card gaps |
| Elevation | `e0` default; `e1` only on the active CategoryPickerSheet / focused field — keep flat |
| Layout | `layout.maxContentWidth 480`, `layout.minTouchTarget 44` |

### 5d. Microcopy bank

| Location | Copy |
|---|---|
| Capture tip (guide) | Fit the whole receipt inside the frame |
| Capture privacy line | Read on your phone. The photo never leaves this device. |
| Manual-entry affordance | Enter manually |
| Reading title | Reading your receipt… |
| Reading offline line | Works in airplane mode. The photo stays on your phone. |
| Blurry/failed title | That photo was a little hard to read. A clearer, flatter shot in good light usually does it. |
| Blurry/failed tip | Tip: lay the receipt flat and fill the frame. |
| Failed privacy reinforce | Nothing was uploaded. That photo stayed on your phone. |
| Retake button | Retake |
| Manual fallback button | Enter by hand |
| Review H1 | Here's what I read |
| Review subtext | Tap anything to fix it. |
| Field labels | Merchant · Date · Total · Category |
| Glance-check marker | double-check this |
| Empty-field placeholders | Add merchant · Add date · Add total · Choose a category |
| Save CTA | Save |
| Discard | Discard |
| Discard confirm | Discard this receipt? |
| Review privacy footnote | Read and saved on your phone. Nothing was uploaded. |
| Category picker title | Choose a category |
| Line items header | Items on this receipt |
| List H1 | Spending |
| Period total subtext | this month / today |
| Category breakdown header | By category |
| Scan action | Scan a receipt |
| List privacy footnote | All your receipts stay on this phone. Nothing is uploaded. |
| Empty-list title | No receipts yet. |
| Empty-list body | Snap one and I'll pull out the merchant, date, and total — all read right here on your phone. |
| Empty-list secondary | Enter one by hand |
| Onboarding 1 H1 | Scan receipts. They never leave your phone. |
| Onboarding 1 subtext | Point your camera at a receipt and LifePilot reads the merchant, date, and total — all on this device. |
| Onboarding 1 checks | The photo stays on your phone · Everything read from it stays too · Nothing is ever uploaded |
| Onboarding 2 H1 | Let's turn on the camera |
| Onboarding 2 subtext | Next, your phone will ask to let LifePilot use the camera. It's only used to read receipts you scan — the photo stays on this device. |
| Camera CTA | Turn on camera |
| Denied H1 | No problem. |
| Denied body | Without the camera you can still add expenses by hand. Nothing was shared, and nothing left your phone. |
| Denied settings | Open camera settings |

Tone rules (inherited): never "server/upload/cloud/internet" except to reassure ("never leaves this phone," "nothing is uploaded"); never "Error"/"Failed"/"Invalid" — say "a little hard to read"; never blame the user; gentle and forward-looking; all copy ≤ 2 short lines.

### 5e. Accessibility

- **Camera screen:**
  - Shutter: `accessibilityLabel="Capture receipt"`, `accessibilityRole="button"`, hit-slop ≥ 44.
  - Photo picker, close, manual-entry, optional flash: each clearly labelled buttons.
  - The privacy line is real text (not baked into an image) so screen readers read it.
  - Receipt guide is decorative (`accessibilityElementsHidden` / `importantForAccessibility="no"`); the tip text is exposed.
  - Reading state: `accessibilityLiveRegion="polite"` announcing "Reading your receipt on your phone."
  - Recovery: announce the message; Retake / Enter-by-hand are labelled buttons.
- **Review form:**
  - Each field row: `accessibilityRole="button"` (opens editor) with label = "{field name}, {value}. Double tap to edit." Flagged fields append "needs a double-check."
  - Glance-check is conveyed in the label text, **not** by color alone (palette is monochrome sage anyway).
  - Category field announces current selection + "opens category picker."
  - Save/Discard labelled; Save announces success politely ("Expense saved on your phone").
  - Date picker and numeric/text inputs use native accessible controls; keep `KeyboardAvoidingView` so the focused field and Save stay reachable.
- **List:** each ExpenseRow labelled "{merchant}, {category}, {amount}, {date}. Double tap to edit." Period total exposed as text. Collapsible "By category" header exposes `accessibilityState={{expanded}}`.
- **Contrast (WCAG AA), same checks as siblings:** `textPrimary` on `background` ~11:1 (pass); `textSecondary` on `background` ~5.4:1 (pass); sage `#6B9080` on `#F7F8F6` ~3.3:1 — fine for the shutter ring, glyphs, and UI (non-text/large), but **do not** set small body text in pure accent. On the **camera screen**, control text/icons sit on a live, unpredictable background → always place them on a subtle scrim and/or use `color.onAccent` white with the scrim to guarantee legibility; verify the privacy line meets AA over the scrim. If small accent text appears (e.g. "double-check this" must stay `textSecondary`, not accent), keep to `textSecondary`/`accentPressed` to stay AA (same note as siblings §5e).
- **Dynamic Type / `allowFontScaling`:** review fields, list rows, and onboarding tolerate ~130% scale (rows grow/wrap; camera controls keep min sizes; tip/privacy text wraps). Field values must never truncate the **total** — wrap or shrink, never hide the amount.
- **Reduced-motion:** reading pulse, any guide-frame animation, sheet transitions, and category-check pop degrade to static/instant.
- **Touch targets ≥ 44×44:** shutter (≥ 72), field rows (≥ 56), ✎/⌄ affordances and thumbnail get hit-slop to 44, category chips ≥ 44 tall.

### 5f. Refresh / state behavior

- The list reflects on-device saved expenses immediately on Save (optimistic). No network, no sync, no pull-to-refresh-from-server (there is no server). Pull-to-refresh, if present, only re-reads local storage.
- Editing an existing expense (tap a row) reuses `ExpenseReviewScreen` and updates in place on Save.
- Deleting requires a gentle confirm; deleting an expense also deletes its stored photo (see persistence, §6).

---

## 6. Handoff notes + open questions

### For the mobile developer

- **Three screens + one onboarding stack.** `ExpenseListScreen` is home; `ExpenseCaptureScreen` is a full-bleed camera modal; `ExpenseReviewScreen` is reused for new (post-OCR), manual (blank), and edit (existing) flows — drive it with a mode/`initialFields` prop. Onboarding is a 2-step stack reused on first camera use and from a revoked-permission re-entry.
- **No network anywhere in this flow.** Camera → on-device OCR/extraction → local save. The privacy copy is literal; there is nothing to call. Keep it that way — this is the app's strongest privacy story and it must stay auditably true.
- **Build the field/confidence rendering as dumb presentation** taking the model's extraction result `{ fields, confidence, lineItems? }` and mapping each field to confident vs. glance-check via a single threshold. Don't hardcode field-specific logic until the contract (Q1) is locked; keep the threshold a config owned by AIML.
- **Partial reads prefer Review over failure:** if any usable fields came back, go to `ExpenseReviewScreen` with them pre-filled + missing/low-confidence flagged, rather than the recovery screen. Reserve recovery (§1c) for too-little-to-use.
- **Manual entry is a first-class path** (blank Review, no flags) reachable from camera, recovery, denied-permission, and the empty list. It must fully work with zero permissions.
- **Persistence is required and on-device only** (MMKV/AsyncStorage + local file store for images, or store images in app sandbox). Expenses + their photos survive restart; deleting an expense deletes its photo. **Never** a network call, never cloud backup in v1 (flag if backup is ever wanted — must stay on-device/user-controlled).
- **Camera controls live over a live preview** → always scrim control text/icons for legibility (§5e); the one place the app isn't on the light `background`.
- Everything references `mobile/src/theme/tokens.ts`. No new hex/spacing. Opacity variants computed inline (or named with CTO's blessing, e.g. `color.scrim`, `color.accentFillSoft`).
- Reduced-motion, Dynamic Type, and AA contrast as in §5e — same discipline as Overwhelm/Energy/Hydration.

### Open questions for CTO / AIML engineer

1. **Extraction output contract (blocks the whole Review screen):** What exactly does the on-device reader return per receipt? I need a stable shape, ideally:
   `{ merchant?: {value, confidence}, date?: {value:ISO, confidence}, total?: {value:number, currency?, confidence}, category?: {value, confidence}, lineItems?: {name, price}[], overallConfidence }`.
   Confirm field names, types (date as ISO? total as minor units?), and that each field carries its own confidence.
2. **Confidence shape + thresholds (blocks the glance-check UI):** Is confidence a 0–1 per field? What threshold separates "confident" from "double-check"? I've designed **two tiers only** (confident / glance-check) and default to flagging mainly the **total**. Need the real per-field thresholds, and whether a global "too low → recovery" floor exists (and its value) to drive §1c.
3. **Line items in scope for v1?** Does the model reliably return line items? If yes and clean, I show them **collapsed, read-only** (§2e); if noisy/unreliable, I **omit the section entirely**. v1 explicitly does **not** do per-item editing. Please confirm reliability so I finalize whether the section ships.
4. **How is category assigned?** Does the model classify category from receipt content/merchant, or is it a heuristic (merchant-name lookup), or absent (user picks)? This determines whether the picker pre-selects a model guess (§2d) and whether category gets a confidence flag. Also: confirm/trim the **category set** (§2d proposes 9) — fewer is calmer.
5. **Minimum required fields to save:** Which fields must be present to save an expense? I propose **total required**, everything else optional/blank (so a fuzzy read still saves fast). Confirm — affects Save-enable logic and empty-field handling (§2b).
6. **Currency / units:** What currency does total use — single locale currency, or does the model read a currency symbol off the receipt? Default + is it user-settable? Affects total formatting, the list totals, and category breakdown. (Spec written currency-agnostic with a `$` placeholder.)
7. **Photo handling (CTO):** Where are receipt images stored on-device (app sandbox / encrypted at rest?), are they retained after extraction or discardable, and is deletion cascade (delete expense → delete photo) the intended behavior? Any size/format constraints from the OCR model (min resolution, supported formats)? This affects the "view receipt" thumbnail and storage growth.
8. **Photo-library access for "pick existing" (CTO):** Can we use the single-photo OS picker (iOS PHPicker / Android Photo Picker) so we need **no** broad library permission (§1e)? If a read scope is required, I'll add a lazy ask + onboarding mention. Want to ask for the minimum.
9. **OCR latency (blocks loading UX):** p95 on-device extraction time on mid/low Snapdragon, incl. cold model load? My "reading…" state covers ~3–5s calmly; if p95 exceeds that, I'll add a Cancel affordance (§1b) and/or progressive field reveal.
10. **Auto-capture / flash:** Should v1 support auto-capture-when-steady and/or a flash toggle for low-light receipts? Default in this spec: **manual shutter only, flash hidden** (calmest). Confirm whether OCR quality on dim/crumpled receipts needs flash exposed (§1.0, §1a).
11. **Receipt detection signal:** Does the pipeline expose a "no receipt detected" vs. "receipt detected but unreadable" distinction? It lets me pick the right recovery copy (§1c: "no receipt found" vs. "hard to read").
12. **Display size token:** the list **period total** may want to be larger than `type.h1` (26). OK to add a shared `type.display` (~34–40) — same question Hydration raised for the ring center — or keep within scale? One decision serves both features.

### Needs sign-off

- **CTO:** confirm the **no-network architecture** for this entire flow (camera → on-device OCR → local save; nothing leaves the device, no cloud backup in v1) — this is the feature's core promise and must be literally true. Approve **photo storage/retention + deletion cascade** (Q7), the **camera permission model** and whether "pick existing" can avoid a library permission (Q8), and the **currency** default (Q6). Rule on **auto-capture/flash** (Q10).
- **AIML:** the **extraction output contract** (Q1), **confidence shape + thresholds** (Q2), **line-item reliability/scope** (Q3), **category assignment + set** (Q4), **receipt-detection signal** (Q11), and **p95 latency** (Q9) — these gate the Review screen, the glance-check UI, the line-items section, the category picker, and the loading/recovery UX.
- **Designer (me):** will produce Figma mockups of all capture/review/list states + the 2-step onboarding from this spec next. This Markdown is the build-against source of truth in the meantime, and it reuses the Overwhelm/Energy/Hydration token set unchanged — same sage palette, type scale, spacing, radii, and warm second-person voice.
