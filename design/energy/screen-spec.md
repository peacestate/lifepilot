# Energy Predictor — Screen Spec (v1)

**Feature:** Energy Predictor (build priority #2 — *the core differentiator*)
**Platform:** React Native (Android + iOS), ExecuTorch on-device inference
**Model:** On-device time-series model (`.pte`) → predicted daily energy from sleep + activity + phone usage
**Owner (design):** lifepilot-designer · **Builds against this:** lifepilot-mobile-developer
**Status:** Ready for handoff · **Date:** 2026-06-26

> Design north star (shared with Overwhelm Manager): **calm, not complex.** One thing on screen at a time. Generous whitespace, soft neutrals, the single sage accent. This feature reads **health and sleep data**, so the privacy promise — *this runs on your phone, nothing leaves it* — is not a footnote here, it is the headline. Reuses `mobile/src/theme/tokens.ts` verbatim. No new visual language.

---

## 0. Screen at a glance

Two surfaces:

- **`EnergyOnboardingFlow`** — a short, one-time (per-permission) flow: privacy promise → what we read → permission request → cold-start "learning" handoff.
- **`EnergyForecastScreen`** — the daily home for the feature. One scroll, one persistent layout that swaps its body between states:
  1. **Permission-needed** — feature not yet granted access (entry point to onboarding).
  2. **Learning / cold-start** — access granted, not enough days of data yet.
  3. **Forecast (primary)** — today's predicted energy curve + windows + drivers + nudge.
  4. **Error / stale** — model couldn't produce a forecast, or data is too old.

The forecast curve is the hero. Everything else (drivers, nudges, comparison) sits calmly below it, scannable, never crowding the curve.

---

## 1. Core screen — the energy forecast

### 1.0 Primary visualization decision

**Chosen: a smooth energy curve across the day (a single line across an x-axis of hours), with two highlighted windows (best-focus, rest) called out as labelled bands underneath.**

Three candidates were considered:

| Option | What it is | Verdict |
|---|---|---|
| **Single score** ("Energy 72/100") | One number for the day | **Rejected as primary.** Energy is not flat across a day; a single number hides the *when*, which is the actual value ("when should I do hard work?"). Too clinical, feels like a grade. |
| **Discrete bands** (morning/afternoon/evening = high/med/low blocks) | 3–4 chunky colored blocks | **Used as a fallback / low-data rendering.** Honest when the model is only confident at coarse resolution. But on its own it feels boxy and loses the gentle rise-and-fall that makes energy legible at a glance. |
| **Smooth curve across the day** ✅ | One soft line, peaks and dips, with named windows | **Chosen.** Matches the mental model of energy ebbing and flowing. Calm and organic (curves read softer than bars). Lets us point at "your peak is ~10am" and "dip ~3pm" naturally. Pairs with the bands as accent highlights rather than the whole chart. |

**Justification in one line:** the user's real question is *"when am I at my best, and when should I go easy?"* — a curve answers *when*; a score and bars do not. The curve is the calmest way to show change over time.

**Design guardrails for the curve (so it stays calm, not a dashboard):**
- One line only. No gridlines, no y-axis numbers, no data points/dots. The y-axis is *unlabelled* — energy is shown as relative shape, not a clinical metric. (We are predicting a soft signal; pretending to 2-decimal precision would be dishonest and stressful.)
- X-axis: light hour ticks at a few anchor times only (e.g. 6a, 12p, 6p, 10p) in `caption`/`textTertiary`. Optional faint "now" vertical marker.
- The line is `color.accent` (sage). The area *under* the line uses a very soft accent fill (sage at ~8–12% opacity) — gentle, no hard gradient.
- Peak and dip are marked with a single small dot + a short label ("Peak ~10am", "Dip ~3pm"), not numeric values.
- Highlighted **windows** (best-focus, rest) render as soft rounded bands sitting just under the curve baseline, tinted and labelled. Max two windows surfaced by default to avoid clutter.

### 1a. Forecast state (primary)

```
┌─────────────────────────────────────┐
│  Today's energy                      │  ← H1
│  Thu, Jun 26 · predicted on device   │  ← subtext + privacy reinforce
│                                      │
│   high ·                             │
│        ·    ╭──╮                     │
│        ·  ╭─╯  ╰─╮        ╭───╮       │  ← single sage curve, soft fill
│        · ╭╯      ╰──╮  ╭──╯   ╰╮      │     under it. no gridlines.
│   low  ·╯           ╰──╯       ╰──    │
│         6a    12p     6p     10p      │  ← few anchor ticks only
│              ▲peak ~10a   ▼dip ~3p    │  ← single dot + word labels
│                                      │
│   ┌───────────────┐ ┌──────────────┐ │
│   │ ☼ Best focus  │ │ ☾ Wind down  │ │  ← two window cards (bands)
│   │ 9:30–11:30 am │ │ after 8 pm   │ │
│   └───────────────┘ └──────────────┘ │
│                                      │
│   What's shaping today  ⌄            │  ← drivers (collapsible, §3)
│   ◐ Sleep   7h 10m, a bit short      │
│   ↗ Activity Light so far            │
│                                      │
│   ┌─────────────────────────────────┐│
│   │ ◔ Your energy usually dips      ││  ← one calm nudge (§4)
│   │   around 3pm. Plan lighter      ││
│   │   work then — save focus for    ││
│   │   the morning.                  ││
│   └─────────────────────────────────┘│
│                                      │
│   Today vs. your typical    ⌄        │  ← comparison (collapsible, §1c)
│                                      │
│   ⦿ Predicted on your phone from     │  ← privacy footnote
│      your data. Nothing is sent.     │
└─────────────────────────────────────┘
```

Order of importance top→bottom: **curve → windows → drivers → nudge → comparison → privacy**. The curve and two window cards are the only always-expanded elements; drivers and comparison are collapsed by default so the screen opens calm.

### 1b. Empty / cold-start state (not enough data yet)

Shown when access is granted but the model needs more days (see §6 open question on cold-start length — assume **~3–7 nights** until confirmed). This is *not* an error and must never feel like one. We show the scaffold of the curve as a soft, dashed "coming soon" shape so the user can picture what they'll get.

```
┌─────────────────────────────────────┐
│  Learning your rhythm                │  ← H1
│  We need a few days of sleep and     │  ← subtext, warm
│  activity to learn your pattern.     │
│                                      │
│        ·  ╭┄┄╮      ╭┄┄┄╮            │  ← dashed/ghost curve, textTertiary
│        ·┄┄╯   ╰┄┄┄┄┄╯    ╰┄┄         │     (illustrative, not real data)
│         6a    12p    6p    10p        │
│                                      │
│   ▓▓▓░░░░  2 of 5 nights so far      │  ← progress: nights collected
│                                      │
│   ┌─────────────────────────────────┐│
│   │ You're all set. Wear your        ││  ← reassurance card
│   │ device to sleep and keep moving  ││
│   │ — we'll have your first forecast ││
│   │ in about 3 more nights.          ││
│   └─────────────────────────────────┘│
│                                      │
│   ⦿ Everything's learned on your     │  ← privacy footnote
│      phone. Nothing is sent anywhere.│
└─────────────────────────────────────┘
```

Progress copy adapts: "{collected} of {needed} nights so far" + "~{remaining} more nights." If we cannot know `needed` precisely, fall back to "A few more nights and your first forecast appears here." (flag, §6).

### 1c. "Today vs. typical" comparison

A calm, collapsible section (collapsed by default in the forecast state). When expanded, it overlays a second, lighter "typical you" curve behind today's curve so the user sees *relative* difference, plus one plain-language summary line. No percentages shouted at the user.

```
┌─────────────────────────────────────┐
│  Today vs. your typical      ⌃       │  ← expanded
│                                      │
│        ·   ╭──╮ (today, sage)        │
│        · ╭╮╯  ╰─╮  ╭──╮               │
│        ·╱ ╲     ╰──╯  ╰─  (typical,  │  ← typical = textTertiary, thinner
│   low  ·            faint dashed)    │
│         6a   12p   6p   10p           │
│                                      │
│   ◔ A touch lower this morning than  │  ← one plain summary line
│     usual — likely the short sleep.  │
└─────────────────────────────────────┘
```

- Today = `color.accent` solid. Typical = `color.textTertiary`, thinner, dashed, no fill — clearly secondary.
- Summary line is generated from the comparison, links the difference to a driver when possible ("likely the short sleep"). Never alarmist; if today ≈ typical, say "About your usual rhythm today."
- Only available once enough days exist to have a "typical" baseline (may arrive later than the first forecast — see §6).

---

## 2. Onboarding / permissions flow

This is the most important flow in the app for the privacy promise, because the inputs are sleep and health. Goal: by the end, the user should be able to say *"my sleep and activity are read on my phone, used to predict my energy, and never sent anywhere."* Plain and warm, never legalistic.

### Flow summary
```
[1 Privacy promise] → [2 What we read & why] → [3 OS permission request]
        │                                            │
        │                                   granted ─┤→ [4 Learning / cold-start] → EnergyForecastScreen
        │                                   denied  ─┤→ [Denied recovery] → EnergyForecastScreen (Permission-needed state)
        └─ "Not now" ──────────────────────────────→ EnergyForecastScreen (Permission-needed state)
```

Three calm full-screen steps before the OS dialog, then a handoff. A slim progress dots row (3 dots) at top. Each step is a single idea. "Not now" is always available and never punished.

### 2a. Step 1 — Privacy promise (the headline)

```
┌─────────────────────────────────────┐
│  ● ○ ○                               │  ← step dots
│                                      │
│            ◗ (soft device+lock       │  ← single calm illustration/glyph
│               glyph, sage)           │
│                                      │
│  Your energy, predicted             │  ← H1
│  privately.                          │
│                                      │
│  LifePilot learns your daily energy  │  ← subtext, warm
│  from your sleep and activity — and  │
│  does all of it right here on your   │
│  phone.                              │
│                                      │
│  ✓ Nothing is uploaded               │  ← three plain checks
│  ✓ No account, no cloud              │
│  ✓ Works in airplane mode            │
│                                      │
│  ┌─────────────────────────────────┐ │
│  │          Continue               │ │  ← primary CTA
│  └─────────────────────────────────┘ │
│            Not now                   │  ← text button
└─────────────────────────────────────┘
```

### 2b. Step 2 — What we read & why (concrete, reassuring)

Make the data concrete so it isn't abstract — but frame each item with *why* and end on the privacy line again.

```
┌─────────────────────────────────────┐
│  ○ ● ○                               │
│                                      │
│  Here's what helps the              │  ← H1
│  prediction                          │
│                                      │
│  ┌─────────────────────────────────┐ │
│  │ ☾  Sleep                        │ │  ← row: glyph + label + why
│  │    How long and how well you    │ │
│  │    slept last night.            │ │
│  ├─────────────────────────────────┤ │
│  │ ↗  Activity                     │ │
│  │    Steps and movement through   │ │
│  │    your day.                    │ │
│  ├─────────────────────────────────┤ │
│  │ ◷  Phone usage                  │ │
│  │    Rough screen-time rhythm —   │ │
│  │    not what's on your screen.   │ │
│  └─────────────────────────────────┘ │
│                                      │
│  All of this stays on your phone and │  ← reinforce
│  is used only to draw your energy    │
│  curve. You can turn it off anytime  │
│  in Settings.                        │
│                                      │
│  ┌─────────────────────────────────┐ │
│  │          Continue               │ │
│  └─────────────────────────────────┘ │
│            Not now                   │
└─────────────────────────────────────┘
```

Note the phone-usage row explicitly disclaims content ("not what's on your screen") — this is the most sensitive-sounding input and the disclaimer defuses it. Confirm with CTO/AIML exactly what the usage signal is (§6).

### 2c. Step 3 — Permission request (pre-prompt, then OS dialog)

We show our own "soft ask" first, then trigger the native OS permission dialog (HealthKit on iOS / Health Connect on Android). The soft ask sets expectations so the scary-looking OS sheet isn't a surprise, and protects us from a one-shot denial.

```
┌─────────────────────────────────────┐
│  ○ ○ ●                               │
│                                      │
│            ☾↗ (sage glyph)           │
│                                      │
│  One tap to connect your            │  ← H1
│  health data                         │
│                                      │
│  Next, your phone will ask to share  │  ← subtext: pre-empt OS dialog
│  Sleep and Activity with LifePilot.  │
│  Allow both for the most accurate    │
│  forecast.                           │
│                                      │
│  This permission is granted to       │  ← reinforce locality
│  LifePilot on this device only.      │
│                                      │
│  ┌─────────────────────────────────┐ │
│  │   Connect Sleep & Activity      │ │  ← triggers OS dialog
│  └─────────────────────────────────┘ │
│            Not now                   │
└─────────────────────────────────────┘
```

On CTA: request **read** permission for sleep + activity/steps. We only ever request read scopes (never write). After the OS dialog resolves, branch to 2d (granted), 2e (denied/partial), or back to Permission-needed (dismissed).

### 2d. Granted → handoff to Learning

Brief success moment, then drop into the cold-start state (§1b). Keep it light, no big celebration.

```
┌─────────────────────────────────────┐
│            ✓ (soft sage check)       │
│                                      │
│  You're connected.                  │  ← H1
│  We'll start learning your rhythm    │
│  tonight. Your first forecast        │
│  appears in a few days.              │
│                                      │
│  ┌─────────────────────────────────┐ │
│  │            Got it               │ │
│  └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

### 2e. Denied / partial recovery

Never a dead end, never nagging. Explain plainly what the feature can't do yet and how to enable it later. If only one of sleep/activity was granted, say what's missing and that predictions will be rougher.

```
┌─────────────────────────────────────┐
│            ◌ (neutral glyph)         │
│                                      │
│  No problem.                        │  ← H1, accepting tone
│  Energy Predictor needs Sleep and    │
│  Activity to work. Nothing was       │
│  shared, and nothing left your       │
│  phone.                              │
│                                      │
│  You can connect anytime from this   │
│  screen or in Settings.              │
│                                      │
│  ┌─────────────────────────────────┐ │
│  │    Open Health settings         │ │  ← deep-link to OS settings
│  └─────────────────────────────────┘ │
│         Maybe later                  │
└─────────────────────────────────────┘
```

- "Open Health settings" deep-links to the app's permission page (OS dialogs only ask once; recovery must route to Settings).
- **Partial-grant copy variant:** "You shared Activity but not Sleep. We can still estimate, but forecasts get much better with sleep too — you can add it in Settings."

### 2f. Permission-needed state on the forecast screen

If the user reaches `EnergyForecastScreen` without permission (skipped onboarding, or revoked later), the screen body becomes a gentle re-entry, not an empty error.

```
┌─────────────────────────────────────┐
│  Today's energy                      │
│                                      │
│        ·  ╭┄┄╮   ╭┄┄┄╮               │  ← ghost curve (same as cold-start)
│        ·┄┄╯  ╰┄┄┄╯   ╰┄┄             │
│                                      │
│   Connect your sleep & activity to   │
│   see your energy forecast — all     │
│   predicted privately on your phone. │
│                                      │
│   ┌─────────────────────────────────┐│
│   │   Connect Sleep & Activity      ││  ← restarts onboarding at step 1/3
│   └─────────────────────────────────┘│
└─────────────────────────────────────┘
```

---

## 3. Inputs surfaced to the user

Show *what's driving today's prediction* so it feels explainable and trustworthy — but keep it warm and glanceable, never a clinical health dashboard.

**Placement:** a collapsible **"What's shaping today"** section under the window cards, collapsed-summary by default (one tap to expand detail). Two to three driver rows max.

```
What's shaping today  ⌃            ← expanded
┌─────────────────────────────────────┐
│ ☾ Sleep                             │
│   7h 10m last night · a bit short   │  ← value + plain qualifier
├─────────────────────────────────────┤
│ ↗ Activity                          │
│   Light so far · a short walk could │
│   lift your afternoon               │
├─────────────────────────────────────┤
│ ◷ Daily rhythm                      │
│   Late wind-down last night         │
└─────────────────────────────────────┘
```

**Rules to keep it non-clinical:**
- Lead with a **plain qualifier** ("a bit short", "solid", "light so far"), not raw numbers alone. Numbers are secondary, shown small in `textSecondary`.
- Never show health metrics we don't actually use in the prediction (no heart rate, no clinical sleep stages unless they truly feed the model). Only surface a driver if it materially shaped the forecast.
- Frame negatives gently and forward-looking ("a bit short", never "poor" or "bad"; "a short walk could lift your afternoon" instead of "you're too sedentary").
- Each driver maps to a `direction` (↑ helping / ↓ dragging / → neutral) shown only as a quiet glyph, no red/green alarm coloring — use `textSecondary` for all, accent only for a positive highlight.
- If a driver's data is missing (e.g. didn't wear device to sleep), show "No sleep data last night — today's forecast is rougher" rather than hiding silently.

**Whether to show numbers at all:** yes, but understated and always paired with a word. Wellness users want to *understand*, not be quizzed. The qualifier does the work; the number is supporting evidence for those who want it.

---

## 4. Nudges / insights

One calm, optional, actionable nudge tied to a predicted feature of the day (usually the dip). Calm = at most **one** nudge visible at a time, suggestion-framed, dismissible, never a notification-style nag inside the screen.

**Content rules:**
- Tie to something concrete in *today's* curve: the dip, the peak, or a driver. "Your energy usually dips around 3pm. Plan lighter work then — save focus for the morning."
- Phrase as a gentle suggestion the user can ignore: "you might…", "could…", "if you can…". Never imperative health-coach scolding.
- Pair an observation with one small action. Observation alone feels useless; two actions feels like homework.
- One per screen view. If multiple candidates exist, pick the highest-confidence / most actionable; rotate, don't stack.

**Examples (copy bank — final set to be tuned with content):**
- Dip: "Your energy usually dips around 3 pm. That's a good time for lighter, routine tasks."
- Peak: "You're likely sharpest from 9:30–11:30 this morning — a good window for your hardest task."
- Short sleep: "Last night ran short. Be kind to yourself today and protect an earlier wind-down tonight."
- Rest window: "Your body's winding down after 8 pm. Dimming screens now can help tomorrow's energy."

**Behavior:**
- Optional light dismiss (✕ in the card corner) → hides for the day; the slot can collapse or show nothing. No "are you sure".
- Never delivered as a push notification in v1 from this screen (push is a separate consent; flag for later). On-screen only.
- A nudge must be **honest about confidence** — if the model is low-confidence, soften to "you *might* notice a dip…" or suppress entirely. Don't manufacture insight from noise.

**Nudge card visual:** `color.surface` card, `radii.lg`, `1px color.border`, leading quiet glyph (`◔`), body text `color.textPrimary`, no accent fill (keeps it advisory, not a CTA). Spacing `space.6 (24)` above and below.

---

## 5. Layout, components, tokens, microcopy, accessibility

### 5a. Component hierarchy

```
EnergyForecastScreen (SafeAreaView, single ScrollView, maxContentWidth 480)
├─ Header (H1 "Today's energy" + date/privacy subtext)
├─ Body (state switch: permission-needed | learning | forecast | error)
│  ├─ EnergyCurve            (the hero chart — see 5b)         [forecast, learning(ghost), permission(ghost)]
│  ├─ WindowCards            (BestFocusCard + RestWindowCard)  [forecast]
│  ├─ DriversSection         (collapsible "What's shaping today" + DriverRow[]) [forecast]
│  ├─ NudgeCard              (one insight)                     [forecast]
│  ├─ ComparisonSection      (collapsible today-vs-typical)    [forecast, when baseline exists]
│  ├─ LearningProgress       (nights collected bar + reassurance card) [learning]
│  └─ ConnectPrompt          (ghost curve + Connect CTA)       [permission-needed]
└─ PrivacyFootnote           (on-device reinforcement)         [all states]

EnergyOnboardingFlow (separate stack, 3 steps + outcome screens)
├─ ProgressDots
├─ OnboardingStep (Promise | WhatWeRead | PermissionAsk)
└─ Outcome (Granted | Denied/Partial)
```

### 5b. EnergyCurve component

- A single SVG/`react-native-svg` smooth path (Catmull-Rom / monotone spline through the predicted points). One stroke, `color.accent`, width `2.5`. Soft area fill below: `color.accent` at 10% opacity (no gradient stops beyond a single soft fade to transparent at the baseline).
- **No** y-axis labels, **no** gridlines, **no** data dots except the single peak and dip markers (`6px` filled `color.accent` circles) with text labels in `captionStrong`/`textSecondary`.
- X-axis: 3–4 anchor ticks (`caption`, `textTertiary`). Optional "now" marker: a thin `1px` vertical `color.border` line + tiny "now" caption.
- Height ~`160–180`. Full content width minus screen padding. Respects reduced-motion: the draw-in animation (curve "grows" left→right over ~600ms on load) is replaced by a static render.
- **Window bands** render as rounded-rect tints sitting on the baseline within the curve's x-range: best-focus band = `color.accent` ~12% fill; rest/wind-down band = `color.surfaceAlt`. Labels live in the WindowCards below, not crammed on the chart.
- **Low-confidence / coarse fallback:** if the model only returns a few coarse values (see §6), render the discrete-bands variant instead of a spline — 3–4 soft blocks (morning/midday/afternoon/evening) tinted by relative level. Same calm palette. The component decides based on the output shape it receives.

### 5c. WindowCards (BestFocusCard, RestWindowCard)

- Two side-by-side cards (`flex-direction: row`, `space.3 (12)` gap). On narrow screens (<340dp) they stack vertically.
- Each: `color.surface`, `radii.lg`, `1px color.border`, padding `space.4 (16)`. Leading glyph (`☼` focus / `☾` rest) in `color.accent`. Title `captionStrong` `textSecondary`, time range `body`/`h2`-ish in `textPrimary`.
- Best-focus title: "Best focus". Rest title: "Wind down" / "Rest window". Times are ranges ("9:30–11:30 am", "after 8 pm").

### 5d. DriverRow

- Card-with-dividers (same pattern as Overwhelm StepList §2e): one `color.surface` card, `radii.lg`, divider rows `1px color.border`.
- Row: leading glyph (`☾`/`↗`/`◷`) `24` `color.textSecondary` · label `captionStrong` `textPrimary` · value+qualifier `subtext` `textSecondary` on second line.
- Row min height `56`, padding `space.3 (12)` vert / `space.4 (16)` horiz.
- Section header "What's shaping today" with a chevron (`⌄`/`⌃`) toggles expand/collapse. Collapsed shows just the header + a one-line summary ("Short sleep, light activity").

### 5e. Collapsible section pattern (drivers + comparison)

- Header row is a pressable: title `captionStrong` `textSecondary` + trailing chevron. `accessibilityRole="button"`, `accessibilityState={{expanded}}`.
- Expand/collapse animates height + chevron rotation 180ms ease-out; reduced-motion → instant.
- Default: drivers **collapsed-with-summary**, comparison **collapsed**. Keeps first paint calm.

### 5f. Design tokens used

All from `mobile/src/theme/tokens.ts` — **no new tokens invented.** Mapping:

| Element | Token |
|---|---|
| Screen bg | `color.background` `#F7F8F6` |
| Cards (windows, nudge, drivers) | `color.surface` `#FFFFFF`, `radii.lg`, `1px color.border` |
| Curve line, peak/dip dots, best-focus band, progress fill, CTA | `color.accent` `#6B9080` |
| Curve area fill | `color.accent` @ ~10% opacity |
| Typical curve, x-ticks, ghost/cold-start curve, number badges | `color.textTertiary` `#9AA29B` |
| Rest band, progress track, chip/collapsed bg | `color.surfaceAlt` `#EEF1ED` |
| Headings / primary values | `color.textPrimary` `#2C322E` |
| Subtext / qualifiers / captions | `color.textSecondary` `#5C645E` |
| CTA label / check glyph | `color.onAccent` `#FFFFFF` |
| Error/stale glyph | `color.error` `#A86B6B` (muted clay, never bright red) |
| Type roles | `type.h1` header, `type.h2` window times, `type.body` nudge/driver, `type.subtext` qualifiers, `type.caption`/`captionStrong` labels & ticks |
| Spacing | `space.5 (20)` screen padding, `space.6 (24)` between sections, `space.3 (12)` card gaps/row padding |
| Elevation | `e0` default; `e1` only on the active nudge card (optional, keep flat) |
| Layout | `layout.maxContentWidth 480`, `layout.minTouchTarget 44` |

### 5g. Microcopy bank

| Location | Copy |
|---|---|
| Forecast H1 | **Today's energy** |
| Forecast subtext | {Weekday}, {Mon DD} · predicted on device |
| Peak / dip labels | Peak ~10a · Dip ~3p |
| Best-focus card | **Best focus** · 9:30–11:30 am |
| Rest card | **Wind down** · after 8 pm |
| Drivers header | What's shaping today |
| Sleep driver | {7h 10m} last night · {a bit short} |
| Activity driver | {Light so far} · a short walk could lift your afternoon |
| Missing sleep | No sleep data last night — today's forecast is rougher |
| Comparison header | Today vs. your typical |
| Comparison (lower) | A touch lower this morning than usual — likely the short sleep. |
| Comparison (typical) | About your usual rhythm today. |
| Nudge (dip) | Your energy usually dips around {3 pm}. Plan lighter work then — save focus for the morning. |
| Privacy footnote | Predicted on your phone from your data. Nothing is sent anywhere. |
| Cold-start H1 | Learning your rhythm |
| Cold-start subtext | We need a few days of sleep and activity to learn your pattern. |
| Cold-start progress | {2} of {5} nights so far |
| Cold-start reassurance | You're all set. Wear your device to sleep and keep moving — we'll have your first forecast in about {3} more nights. |
| Onboarding 1 H1 | Your energy, predicted privately. |
| Onboarding 1 subtext | LifePilot learns your daily energy from your sleep and activity — and does all of it right here on your phone. |
| Onboarding 1 checks | Nothing is uploaded · No account, no cloud · Works in airplane mode |
| Onboarding 2 H1 | Here's what helps the prediction |
| Onboarding 2 footer | All of this stays on your phone and is used only to draw your energy curve. You can turn it off anytime in Settings. |
| Onboarding 3 H1 | One tap to connect your health data |
| Onboarding 3 subtext | Next, your phone will ask to share Sleep and Activity with LifePilot. Allow both for the most accurate forecast. |
| Connect CTA | Connect Sleep & Activity |
| Granted | You're connected. We'll start learning your rhythm tonight. |
| Denied H1 | No problem. |
| Denied body | Energy Predictor needs Sleep and Activity to work. Nothing was shared, and nothing left your phone. |
| Permission-needed prompt | Connect your sleep & activity to see your energy forecast — all predicted privately on your phone. |
| Error/stale | Couldn't update your forecast just now. Your data is safe on your phone — pull to refresh. |

Tone rules (inherited): never "server/upload/cloud/internet" except to reassure; never clinical ("poor", "deficient", "abnormal"); qualifiers stay gentle and forward-looking; all copy ≤ 2 short lines.

### 5h. Accessibility

- **Curve is not screen-reader-friendly on its own** — provide an `accessibilityLabel` text summary on the chart container: "Your predicted energy today: rising to a peak around 10 am, dipping around 3 pm, easing into the evening. Best focus 9:30 to 11:30 am." This is the single most important a11y addition vs. Overwhelm. The visual curve and the text summary must stay in sync (generate both from the same forecast object).
- Window cards, drivers, nudge: each a labelled element; collapsible headers expose `accessibilityState={{expanded}}`.
- Color is never the only signal: peak/dip carry text labels; drivers carry word qualifiers; the typical-vs-today curves differ in weight + dash + label, not just hue (helps color-vision deficiency — and the palette is monoching sage anyway).
- Contrast: same checks as Overwhelm §5e. `textSecondary` on `background` ~5.4:1 (pass). Curve sage `#6B9080` on `#F7F8F6` ~3.3:1 — fine for a `2.5px` line/UI element (non-text). Peak/dip *labels* use `textSecondary`, not accent, to stay AA at small size.
- Touch targets ≥ `44×44`: collapsible headers, window cards (if tappable), nudge dismiss, CTAs all meet it. Nudge ✕ gets hit-slop to 44.
- Respect Dynamic Type / `allowFontScaling`: curve height and card layout must tolerate ~130% text scale (cards wrap/stack; chart labels can hide at extreme scale, keeping the a11y summary as the source of truth).
- Reduced-motion: curve draw-in, collapse animations, and any band fades all degrade to static/instant.
- Live region: when a fresh forecast loads, announce politely "Your energy forecast for today is ready."

### 5i. Refresh / update behavior

- Pull-to-refresh on the scroll re-runs inference on latest data. Calm refresh control tinted `color.accent`.
- Forecast auto-updates at least once after the morning's sleep data lands (see §6 cadence). A small timestamp in the subtext ("updated 8:10 am") could be added — flag as optional to avoid clutter; default off.

---

## 6. Handoff notes + open questions

### For the mobile developer
- One screen, four body states driven by a state enum: `'permissionNeeded' | 'learning' | 'forecast' | 'error'`. Onboarding is a separate short stack reused on first run and from the permission-needed CTA.
- Build the **EnergyCurve** as a dumb presentational component that accepts a `forecast` object and renders either the spline (rich output) or discrete bands (coarse output) based on what's in it. Do not hardcode chart math to a fixed shape until the model contract (Q1) is locked.
- The chart's `accessibilityLabel` summary string should come from the same forecast object that draws the curve — keep them in lockstep so they can never disagree.
- Everything references `mobile/src/theme/tokens.ts`. No new hex/spacing. The only additions are *opacity* variants of `color.accent` for the area fill/bands — compute from the token, don't introduce a new token unless CTO prefers one (e.g. `color.accentFill`).
- **No network anywhere.** Sleep/activity come from HealthKit / Health Connect on-device; inference is local. The privacy copy is literal.
- Request **read-only** scopes for sleep + activity/steps. Handle partial grants (one of two). Route denial recovery to OS settings (deep link), since native permission dialogs fire once.
- Persist on-device only (MMKV/AsyncStorage) if we cache yesterday's forecast / nights-collected count — never a server.

### Open questions for CTO / AIML engineer
1. **Model output shape (blocks the chart):** What exactly does the time-series model return? A per-hour curve (e.g. `number[24]` 0–1), a sparse set of key points (peak time, dip time, a few levels), or just a handful of band levels (morning/afternoon/evening = high/med/low)? The spec supports both a smooth curve (preferred) and a discrete-bands fallback, but I need the real shape to finalize `EnergyCurve`. Requesting a stable contract, ideally something like `{ points: {t: number, level: number}[], peak?: {t}, dip?: {t}, windows?: {focus, rest}, confidence: number }`.
2. **Cold-start length (blocks copy + progress UI):** How many nights/days of data before the *first* forecast is trustworthy? The spec assumes ~3–7 and shows "{n} of {needed} nights." Need the real `needed` (and whether it's fixed or "until confidence > threshold"). If it's not a fixed count, I'll switch to the vaguer "a few more nights" copy.
3. **"Typical" baseline availability:** How many days before a *typical* curve exists for the today-vs-typical comparison? It may lag the first forecast — confirm so I can gate the comparison section correctly.
4. **Update cadence:** When does the forecast (re)compute? Once each morning after sleep syncs? Continuously as activity accrues through the day? On app open? This determines whether the curve is a static morning prediction or a living "rest of day" estimate, and whether to show an "updated at" timestamp.
5. **Confidence signal:** Does the model expose a confidence/uncertainty value? I want it to (a) soften or suppress low-confidence nudges, (b) choose curve vs. bands rendering, (c) possibly show a faint uncertainty band. If there's no confidence output, we lose those safeguards — please advise.
6. **Phone-usage input — what exactly:** Onboarding step 2 tells users we read "rough screen-time rhythm — not what's on your screen." Confirm the actual signal so the copy is truthful. If it's app categories or content, the copy and the privacy framing must change (and this likely needs explicit extra consent — CTO sign-off).
7. **Which drivers are real:** §3 surfaces sleep, activity, and a "daily rhythm/usage" driver. Confirm exactly which inputs materially feed the model so we never show a driver we don't actually use (honesty + trust). If heart rate or other HealthKit metrics are used, tell me so I can add/permission them.
8. **Health permissions inventory:** Exact HealthKit + Health Connect data types we request (sleep analysis, steps, active energy, …) so onboarding lists them accurately and we request the minimum necessary.
9. **Latency:** time-series inference is presumably faster than the LLM, but confirm p95 on mid/low Snapdragon so the load/refresh UX (and whether the curve draw-in covers it) is right.

### Needs sign-off
- **CTO:** confirm no-network architecture for this feature (Health data read locally, inference local, nothing leaves device); approve the read-only health scopes and the partial-grant handling; rule on the phone-usage signal (Q6) and whether it needs separate consent.
- **AIML:** the forecast output contract (Q1), cold-start length (Q2), typical-baseline timing (Q3), update cadence (Q4), and confidence output (Q5) — these five gate the chart, cold-start, comparison, and nudge logic.
- **Designer (me):** will produce Figma mockups of all forecast states + the onboarding flow from this spec next. This Markdown is the build-against source of truth in the meantime, and it reuses the Overwhelm token set unchanged.
```
