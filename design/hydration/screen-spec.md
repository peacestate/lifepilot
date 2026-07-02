# Hydration Tracker — Screen Spec (v1)

**Feature:** Hydration Tracker (build priority #3 — *the quick win*)
**Platform:** React Native (Android + iOS). On-device recommendation engine; weather + AQI feeds are the only network calls, and they carry **no user data** (coarse location → impersonal environment data).
**Engine:** On-device hydration model → personalized daily water target + real-time nudge timing, computed from weather + AQI + the user's activity.
**Owner (design):** lifepilot-designer · **Builds against this:** lifepilot-mobile-developer
**Status:** Ready for handoff · **Date:** 2026-06-26

> Design north star (shared with Overwhelm Manager + Energy Predictor): **calm, not complex.** One thing on screen at a time, generous whitespace, the single sage accent. Reuses `mobile/src/theme/tokens.ts` **verbatim** — same sage palette, type scale, spacing, radii, warm second-person voice. No new visual language.
>
> Privacy nuance unique to this feature: it is the **first feature that touches the network at all.** So the privacy story shifts from "nothing leaves your phone, full stop" to a precise, honest line: *your personal data and the recommendation stay on your phone; only impersonal weather and air-quality data come in.* Every surface must keep that distinction clean and reassuring.

---

## 0. Screen at a glance

Two surfaces:

- **`HydrationOnboardingFlow`** — a short one-time flow: the privacy promise (with the network nuance) → why we ask for coarse location → OS permission requests (location + notifications) → handoff. Reuses the Energy onboarding pattern (3 calm steps + outcome screens, progress dots).
- **`HydrationScreen`** — the daily home. One scroll, one persistent layout that swaps its body between states:
  1. **Empty / start-of-day** — target set, nothing logged yet.
  2. **Mid-day progress** — partway to target.
  3. **Goal-met** — target reached.
  4. **Over-target** — logged beyond target (calm, never scolding).
  5. **Generic-target fallback** — no location permission → a sane default target, no environmental adjustment.

The **progress ring** is the hero. Logging controls sit directly beneath it. The "why today's target" line sits just under the ring as a single warm sentence (expandable). Nudges live in notifications and as an inline "next sip" hint.

---

## 1. Core screen — today's hydration

### 1.0 Primary visualization decision

**Chosen: a single soft progress RING** (circular, the day's water filling it), with the numeric target + "logged so far" inside it.

Three candidates considered:

| Option | What it is | Verdict |
|---|---|---|
| **Horizontal bar** | A thin track that fills left→right | **Rejected as primary.** Reads as a "task/loading" UI, utilitarian. Hard to make a bar feel like a calm focal point; it wants to be a small secondary element. Kept as the inline shape inside notifications only. |
| **Vertical "fill" (water filling a vessel/screen)** | A wave/liquid rising up a bottle or the whole card | **Strong runner-up; used as an optional motif, not the structure.** Literal and delightful, but a rising-liquid animation easily tips into "playful/busy," fights the calm brief, and is fiddly to keep accessible. We borrow only a *gentle* idea: the ring's fill can have a soft single-color sweep, no sloshing wave. |
| **Progress ring** ✅ | A circular arc filling clockwise, number centered | **Chosen.** A ring is the calmest way to show "how full is your day": it's a single closed shape, centers one number, and never reads as a system progress bar. It tolerates over-target gracefully (a second, lighter arc lap) and scales from a glance to a focal hero. Matches the curve's organic feel from Energy — rounded, soft, not boxy. |

**Justification in one line:** the user's question is *"am I on track for today?"* — a ring answers it in one glance with one number, and stays calm where a bar feels like a chore-tracker and a sloshing vessel feels busy.

**Design guardrails for the ring (so it stays calm):**
- **One arc**, `color.accent` (sage), rounded line caps, stroke width ~`14`. Track is `color.surfaceAlt`. Diameter ~`200`.
- Center stack: big **logged amount** (`type.h1`-scale or larger display) + small "of {target}" beneath in `textSecondary` + an even smaller unit hint. No decimals.
- **No** tick marks, no percentage shouted, no gridlines. The arc *is* the percentage.
- Fill animates on each log: arc grows over ~400ms ease-out; a single soft sage pulse at the ring edge on add (reduced-motion → instant). No liquid/wave animation.
- **Goal-met:** the ring completes; a quiet check or soft accent glow appears at the top of the ring; center swaps to a gentle "Goal met" with the amount below. No confetti.
- **Over-target:** the arc starts a **second, lighter lap** (sage at ~40% opacity over the full sage first lap) so going over reads as "a little extra, lovely" — never an error, never red.

### 1a. Empty / start-of-day state

Target is known (engine ran, or generic fallback). Nothing logged. The ring is empty but inviting; the "why" line explains today's number; logging buttons are the clear next action.

```
┌─────────────────────────────────────┐
│  Today's water                       │  ← H1
│  Thu, Jun 26 · figured on your phone │  ← subtext + privacy reinforce
│                                      │
│              ╭───────╮               │
│            ╱           ╲             │  ← ring, empty (track only)
│           │      0      │            │     center: logged amount
│           │   of 2.4 L  │            │     "of {target}"
│            ╲           ╱             │
│              ╰───────╯               │
│                                      │
│   ☀ Hot and hazy today — aim a       │  ← "why today's target" line (§2)
│     little higher.   Why? ⌄          │     tap "Why?" to expand
│                                      │
│   Add a drink                        │  ← logging label
│   ┌────────┐ ┌────────┐ ┌────────┐  │
│   │  ◠ Glass│ │ ◖ Bottle│ │  + Custom│ │  ← one-tap add buttons
│   │  250 mL │ │  500 mL │ │   …     │ │
│   └────────┘ └────────┘ └────────┘  │
│                                      │
│   ⦿ Your intake and target stay on   │  ← privacy footnote (network nuance)
│      your phone. Only weather & air  │
│      quality come from the network.  │
└─────────────────────────────────────┘
```

### 1b. Mid-day progress state

Most-seen state. Ring partially filled; center shows progress; a quiet "next sip" hint (from the nudge engine) may appear under the ring; a small undo affordance after a log.

```
┌─────────────────────────────────────┐
│  Today's water                       │
│  Thu, Jun 26 · figured on your phone │
│                                      │
│              ╭━━━━───╮               │
│            ╱━          ╲             │  ← ring ~55% filled (sage arc)
│           ┃     1.3 L    │            │     center: logged amount
│           ┃   of 2.4 L   │            │
│            ╲           ╱             │
│              ╰───────╯               │
│         ◔ A good pace — next sip     │  ← gentle inline nudge hint
│           around 2:30                │
│                                      │
│   Add a drink              Undo ↶    │  ← undo last add (5s window)
│   ┌────────┐ ┌────────┐ ┌────────┐  │
│   │  ◠ Glass│ │ ◖ Bottle│ │  + Custom│ │
│   │  250 mL │ │  500 mL │ │   …     │ │
│   └────────┘ └────────┘ └────────┘  │
│                                      │
│   Today's drinks                ⌄    │  ← collapsible intake log (§1f)
│                                      │
│   ⦿ Your intake and target stay on   │
│      your phone. Only weather & air  │
│      quality come from the network.  │
└─────────────────────────────────────┘
```

### 1c. Goal-met state

The ring completes. Calm acknowledgement, not a fireworks moment. Logging stays available (you can keep drinking) — this flows naturally into over-target.

```
┌─────────────────────────────────────┐
│  Today's water                       │
│  Thu, Jun 26 · figured on your phone │
│                                      │
│              ╭━━━━━━━╮  ✓            │  ← ring complete + soft check at top
│            ╱━━━━━━━━━━╲              │
│           ┃  Goal met   │            │  ← center swaps to "Goal met"
│           ┃    2.4 L     │            │     amount beneath
│            ╲━━━━━━━━━━╱              │
│              ╰━━━━━━━╯               │
│        Nicely done — you stayed      │  ← warm one-liner
│        ahead of the heat today.      │
│                                      │
│   Add a drink                        │  ← still available
│   ┌────────┐ ┌────────┐ ┌────────┐  │
│   │  ◠ Glass│ │ ◖ Bottle│ │  + Custom│ │
│   └────────┘ └────────┘ └────────┘  │
│                                      │
│   Today's drinks                ⌄    │
│   ⦿ …privacy footnote…               │
└─────────────────────────────────────┘
```

### 1d. Over-target state

Logged beyond target. The ring shows a second, lighter lap. Tone is gentle and affirming — never "too much," never a warning. (Genuine over-hydration is a medical edge case far beyond normal logging; v1 does not alarm — see §6 open question on an upper safety note.)

```
┌─────────────────────────────────────┐
│  Today's water                       │
│  Thu, Jun 26 · figured on your phone │
│                                      │
│              ╭━━━━━━━╮               │
│            ╱━─ ─ ─ ─ ─╲             │  ← full sage lap + faint 2nd lap
│           ┃   2.7 L     │            │     (sage @ 40% over the top)
│           ┃  of 2.4 L    │            │
│            ╲━─ ─ ─ ─ ─╱             │
│              ╰━━━━━━━╯               │
│        A little extra today — your   │  ← affirming, not corrective
│        body will thank you.          │
│                                      │
│   Add a drink                        │
│   ┌────────┐ ┌────────┐ ┌────────┐  │
│   └────────┘ └────────┘ └────────┘  │
│   Today's drinks                ⌄    │
│   ⦿ …privacy footnote…               │
└─────────────────────────────────────┘
```

### 1e. Generic-target fallback state (no location)

Location denied/unavailable → no weather/AQI adjustment. We still give a sane default target (engine's baseline from profile/activity if available, else a standard default) and we're **honest** that it isn't tailored to today's conditions, with a one-tap path to enable location.

```
┌─────────────────────────────────────┐
│  Today's water                       │
│  Thu, Jun 26 · figured on your phone │
│                                      │
│              ╭───────╮               │
│           │      0      │            │  ← same ring, generic target
│           │   of 2.0 L  │            │
│              ╰───────╯               │
│                                      │
│   A general daily goal. Turn on      │  ← honest, non-pushy
│   coarse location and we'll fine-    │
│   tune it for today's heat & air.    │
│   Turn on location →                 │  ← inline enable affordance
│                                      │
│   Add a drink                        │
│   ┌────────┐ ┌────────┐ ┌────────┐  │
│   │  ◠ Glass│ │ ◖ Bottle│ │  + Custom│ │
│   └────────┘ └────────┘ └────────┘  │
│                                      │
│   ⦿ Everything stays on your phone.  │  ← simpler footnote (no network used)
│      No location, no weather lookups.│
└─────────────────────────────────────┘
```

Note: in fallback, **no network call happens at all** (no location → no weather/AQI fetch), so the footnote simplifies to the pure on-device promise. This is a nice reinforcement: declining location makes the app *more* private, not less — frame it that way, never as punishment.

### 1f. "Today's drinks" — intake log (collapsible)

Collapsed by default to keep first paint calm. Expanded: a simple list of what was logged, each removable. Reuses the **card-with-dividers** pattern (Overwhelm StepList §2e / Energy DriverRow).

```
Today's drinks                    ⌃   ← expanded
┌─────────────────────────────────────┐
│ ◠ Glass        250 mL    8:10 am  ✕ │  ← amount · time · remove
├─────────────────────────────────────┤
│ ◖ Bottle       500 mL   10:45 am  ✕ │
├─────────────────────────────────────┤
│ ◠ Glass        250 mL    1:20 pm  ✕ │
└─────────────────────────────────────┘
```

- Each row removable (✕, hit-slop 44). Removing re-animates the ring down.
- Times in `textSecondary`. Amounts in `textPrimary`. Leading drink glyph in `accent`.
- Empty (start-of-day): the section is hidden entirely until the first log.

### 1g. Custom-amount sheet

Tapping **+ Custom** opens a small bottom sheet: a numeric stepper / quick chips (e.g. 100, 150, 330, 750 mL) + a free entry, with the active unit (mL or oz, see §6). Confirm adds to the ring. Calm, single accent CTA "Add". Cancel dismisses. Last-used custom amount is remembered (on-device) for faster repeat.

---

## 2. "Why today's target" — transparency

The adjustment is the feature's intelligence; surfacing it builds trust. But it must feel **helpful, not clinical or alarming.** One warm sentence by default; tap to expand the breakdown.

### 2a. Collapsed line (always visible under the ring)

A single second-person sentence that names the dominant condition(s) and the gentle implication:

- Hot + hazy: **"Hot and hazy today — aim a little higher."**
- Hot only: **"It's a warm one — your target's nudged up a bit."**
- Poor air: **"Air quality's low today — extra water helps. Target's up slightly."**
- High activity: **"You've been on the move — added a little to today's goal."**
- Mild / nothing notable: **"Mild day — a steady, normal goal."**
- Lowered (cool/still): **"Cool and calm today — a gentle goal is plenty."**

Rules:
- Lead with the **plain-language condition**, end with the **gentle implication**. Never lead with a number or a percentage.
- Words like "a little," "a bit," "slightly" keep adjustments feeling soft, not dramatic.
- **Never alarmist about AQI.** Say "air quality's low — extra water helps," not "hazardous air" / "pollution warning." We are a hydration app, not an air-quality alarm. If AQI is genuinely severe, keep the hydration framing and let the OS / dedicated apps own warnings (flag, §6).

### 2b. Expanded "Why?" breakdown

Tapping **Why? ⌄** expands a calm card showing the 2–4 factors that moved today's number, each as a quiet row with direction (↑ raises / ↓ lowers / → neutral) — same non-alarm styling as Energy drivers (`textSecondary` glyphs, accent only for a positive highlight, **no red/green**).

```
Why today's target              ⌃
┌─────────────────────────────────────┐
│  Your base goal      2.0 L          │  ← starting point
├─────────────────────────────────────┤
│ ☀ Heat           28°C   ↑ a little  │  ← factor · reading · effect (words)
├─────────────────────────────────────┤
│ ◍ Humidity       High   ↑ a little  │
├─────────────────────────────────────┤
│ ◌ Air quality    AQI 142 ↑ slightly │  ← plain "AQI 142", no scary label
├─────────────────────────────────────┤
│ ↗ Activity       Active  ↑ a bit    │
├─────────────────────────────────────┤
│  Today's goal        2.4 L          │  ← result, emphasized
└─────────────────────────────────────┘
   Weather & air quality for your area,
   fetched without sending your location
   anywhere it can be tied to you.        ← privacy nuance, expanded
```

Rules:
- Show **base → factors → result** so the math feels transparent and fair, not a black box.
- Effects are **words first** ("a little," "slightly"), with the raw reading (28°C, AQI 142) as quiet supporting detail in `textSecondary`. Confirm exact per-factor numbers with AIML (§6) — the UI shows whatever the engine returns, but the *framing* is words-led.
- Only show factors that **materially moved** the number (mirrors Energy's "only surface real drivers" honesty rule). If only heat mattered, show only heat.
- The footnote here carries the **network nuance** in plain language: weather/AQI come from the network, your location isn't sent anywhere it can be tied to you. (Exact privacy mechanics — how coarse, how the lookup avoids identifying the user — need CTO confirmation, §6.)

---

## 3. Real-time nudges

Calm, well-timed reminders to drink — tied to conditions and activity, never nagging. **v1 = local notifications** (no push server; consistent with the on-device promise). Plus a quiet inline "next sip ~2:30" hint on-screen (§1b).

### 3a. What a nudge is (and isn't)

- **Is:** an occasional, gentle, skippable suggestion that fits the day's conditions ("Warm afternoon — a glass of water now would feel good.").
- **Isn't:** a fixed hourly alarm, a streak-guilt ping, or a red-badge nag. We never shame a missed target.

### 3b. Nudge content (copy bank)

Suggestion-framed, second person, one observation + one tiny action. Tone identical to Energy nudges.

| Trigger | Notification copy |
|---|---|
| Behind pace, warm day | "Warm one today — a glass of water now keeps you ahead." |
| Behind pace, normal | "A good moment for some water. You're a little behind today's goal." |
| Long gap since last drink | "It's been a couple of hours — time for a sip?" |
| Post-activity (activity spike detected) | "Nice movement just now — top up with some water." |
| Low air quality | "Air's a bit hazy today. Staying hydrated helps — maybe a glass now?" |
| Approaching goal, late afternoon | "Almost there — one more glass and you've hit today's goal." |
| Goal met (optional, once) | "You've hit today's water goal. Lovely." |

Rules:
- One actionable idea per nudge. Never stack multiple asks.
- Never imperative-scold ("You MUST drink"). Always "maybe," "a good moment," "time for a sip?".
- Tappable nudge opens `HydrationScreen` ready to log (ideally a notification action **"Log a glass"** that logs 250 mL without opening the app — confirm OS support, §6).

### 3c. Timing logic (UX view)

The engine owns the precise schedule (cadence is an open question, §6); from the UX side the rules are:

- **Condition-weighted spacing, not a fixed clock.** Hotter / more active / behind-pace → nudges a little closer together; cool/still/ahead-of-pace → fewer, further apart. The user should sense the app is responding to *today*, not pinging on a timer.
- **Daily cap.** A hard ceiling on nudges/day (propose **default 4–5**, user-adjustable: "Gentle / Standard / Off") so it never feels like nagging. CTO/AIML to confirm sensible cadence (§6).
- **Pace-aware.** If the user is already ahead of pace, suppress "drink now" nudges. Don't tell someone doing well to do more.
- **Respect logging.** A manual log resets the "long gap" timer; never nudge right after the user just logged.
- **Spread across waking hours**, weighted toward when conditions/activity warrant, not bunched.

### 3d. Quiet hours

- **Default quiet window: 9:00 pm → 8:00 am** (no nudges). User-adjustable in settings.
- Late-evening hydration nudges are counter-productive (sleep) and feel naggy — suppress. A goal-met confirmation may still arrive earlier in the evening but not during quiet hours.
- Quiet hours are absolute: even a "behind pace" day does not nudge at 11 pm.

### 3e. Snooze / dismiss / control

- **Dismiss:** standard notification swipe — no penalty, no re-fire that day for the same trigger.
- **Snooze:** notification action **"Later"** → re-offer in ~60–90 min (within caps & quiet hours). Optional in v1; confirm OS action support (§6).
- **In-app control (Settings):** nudge frequency **Gentle / Standard / Off**, quiet-hours range, and a master toggle. Off = zero notifications, feature still works as a manual tracker.
- Changing frequency takes effect immediately and never requires re-onboarding.

---

## 4. Permissions / onboarding

Goal: the user understands by the end that **"my water log and target live on my phone; the app looks up my area's weather and air quality, and my location is coarse, only used for environment, and never tracked."** Reuses `HydrationOnboardingFlow` styled exactly like Energy onboarding (3 steps + outcomes, progress dots, "Not now" always available).

This feature needs **two** OS permissions, both optional:
- **Location** (coarse) — for weather + AQI. Without it → generic target (§1e).
- **Notifications** — for nudges. Without it → in-app tracking + inline "next sip" hint still work.

### Flow summary
```
[1 Privacy promise + network nuance] → [2 Why coarse location] → [3 Location ask (OS)] → [4 Notifications ask (OS)] → [Handoff to HydrationScreen]
        │                                                              │ denied → generic-target fallback (§1e), still continue
        └─ "Not now" at any step → HydrationScreen (manual + generic target, no nudges)
```

### 4a. Step 1 — Privacy promise (with the honest network nuance)

```
┌─────────────────────────────────────┐
│  ● ○ ○                               │
│            ◗ (sage drop+lock glyph)   │
│                                      │
│  Hydration that fits                │  ← H1
│  your day — privately.               │
│                                      │
│  LifePilot tailors your water goal   │  ← subtext, warm + honest
│  to the weather, the air, and how    │
│  active you are.                     │
│                                      │
│  ✓ Your log & goal stay on your phone│  ← three plain checks
│  ✓ Only weather & air quality come   │
│    from the internet                 │
│  ✓ Your location is coarse & never   │
│    tracked                           │
│                                      │
│  ┌─────────────────────────────────┐ │
│  │          Continue               │ │
│  └─────────────────────────────────┘ │
│            Not now                   │
└─────────────────────────────────────┘
```

This is the one screen where we **proactively name the network**, because honesty is the differentiator. We don't bury it — we make "only impersonal weather/air comes in, your data stays" a selling point.

### 4b. Step 2 — Why coarse location (defuse the scariest ask)

```
┌─────────────────────────────────────┐
│  ○ ● ○                               │
│            ☀◌ (sage glyph)            │
│                                      │
│  Why we ask for location            │  ← H1
│                                      │
│  To know today's heat, humidity, and │  ← subtext
│  air quality, we look up conditions  │
│  for your rough area — about the     │
│  size of a city, not your address.   │
│                                      │
│  ┌─────────────────────────────────┐ │
│  │ ◍ Coarse only                   │ │  ← reassurance rows
│  │   We never use precise GPS.     │ │
│  ├─────────────────────────────────┤ │
│  │ ⦿ Environment, not you          │ │
│  │   Used only to fetch weather &  │ │
│  │   air quality — never to track  │ │
│  │   where you go.                 │ │
│  ├─────────────────────────────────┤ │
│  │ ✕ Skippable                     │ │
│  │   No location? You'll get a     │ │
│  │   solid general goal instead.   │ │
│  └─────────────────────────────────┘ │
│  ┌─────────────────────────────────┐ │
│  │          Continue               │ │
│  └─────────────────────────────────┘ │
│            Not now                   │
└─────────────────────────────────────┘
```

We request **coarse / approximate** location only (Android `ACCESS_COARSE_LOCATION`; iOS reduced-accuracy / `kCLLocationAccuracyReduced`). Confirm the exact mechanism and how the weather/AQI lookup avoids tying location to the user with CTO (§6) — the copy must stay truthful to whatever the implementation actually does.

### 4c. Step 3 — Location OS ask (soft pre-prompt → native dialog)

```
┌─────────────────────────────────────┐
│  ○ ○ ●                               │
│            ☀ (sage glyph)             │
│                                      │
│  Ready to tailor your goal          │  ← H1
│                                      │
│  Next, your phone will ask to share  │  ← pre-empt OS dialog
│  your location. Choosing "approximate│
│  / while using" is all we need.      │
│                                      │
│  ┌─────────────────────────────────┐ │
│  │   Use my approximate location   │ │  ← triggers OS dialog (coarse)
│  └─────────────────────────────────┘ │
│         Skip — use a general goal    │  ← explicit skip → fallback
└─────────────────────────────────────┘
```

### 4d. Step 4 — Notifications ask

```
┌─────────────────────────────────────┐
│            ◔ (sage glyph)             │
│                                      │
│  Gentle nudges to drink?            │  ← H1
│                                      │
│  We'll send a calm reminder now and  │  ← subtext, set expectations
│  then — never spammy, and quiet at   │
│  night. You can change this anytime. │
│                                      │
│  ┌─────────────────────────────────┐ │
│  │       Turn on reminders         │ │  ← triggers OS notif dialog
│  └─────────────────────────────────┘ │
│         Not now                      │  ← in-app tracking still works
└─────────────────────────────────────┘
```

### 4e. Outcomes & partial grants

| Grant state | Result |
|---|---|
| Location ✓ + Notifications ✓ | Full experience: tailored target + nudges. |
| Location ✓ + Notifications ✗ | Tailored target; **no** push nudges. Inline "next sip" hint still shows. Soft re-offer for notifications later (non-nagging). |
| Location ✗ + Notifications ✓ | **Generic target** (§1e); nudges become generic ("time for a sip?") since there's no condition data — or suppress condition-based nudges and keep only gap-based ones. Confirm with AIML (§6). |
| Location ✗ + Notifications ✗ | Pure manual tracker: ring + logging, generic target, no nudges. Fully on-device, zero network. Frame positively. |

- **Denied recovery:** OS dialogs fire once. Recovery routes to **Settings deep-link** ("Open app settings"). Never a dead end, never repeated prompting.
- **Generic-target fallback copy** lives on the main screen (§1e), not as an error — it's a valid, respected choice.
- Inline "Turn on location →" (§1e) restarts the location ask (or deep-links to Settings if already denied once).

---

## 5. Layout, components, tokens, microcopy, accessibility

### 5a. Component hierarchy

```
HydrationScreen (SafeAreaView, single ScrollView, maxContentWidth 480)
├─ Header (H1 "Today's water" + date/privacy subtext)
├─ Body (state switch: empty | progress | goalMet | overTarget | genericFallback)
│  ├─ HydrationRing        (the hero — see 5b)                 [all states]
│  ├─ NextSipHint          (inline nudge hint)                 [progress]
│  ├─ WhyTargetLine        (collapsed sentence + "Why?")       [all except generic]
│  │  └─ WhyTargetBreakdown(expanded base→factors→result)      [expanded]
│  ├─ GenericFallbackNote  (honest note + "Turn on location")  [genericFallback]
│  ├─ AddDrinkRow          (GlassBtn + BottleBtn + CustomBtn)  [all states]
│  ├─ UndoChip             (undo last add, ~5s)                [after a log]
│  ├─ IntakeLogSection     (collapsible "Today's drinks" + DrinkRow[]) [≥1 log]
│  └─ PrivacyFootnote      (network-nuance variant / on-device variant)
└─ CustomAmountSheet       (bottom sheet, quick chips + entry) [on +Custom]

HydrationOnboardingFlow (separate stack, 4 steps + outcomes)
├─ ProgressDots
├─ OnboardingStep (Promise | WhyLocation | LocationAsk | NotifAsk)
└─ Outcome (partial-grant recovery / Settings deep-link)
```

### 5b. HydrationRing component

- `react-native-svg` circular progress: a track circle (`color.surfaceAlt`) + a foreground arc (`color.accent`), rounded line caps, stroke ~`14`, diameter ~`200`. Arc sweeps clockwise from 12 o'clock.
- **Center stack:** logged amount (display, `type.h1` 26 or scaled up via a `display` size — flag if a larger size token is wanted, §6) `color.textPrimary`; "of {target}" `type.subtext` `color.textSecondary`; unit hint `type.caption` `color.textTertiary`.
- **Over-target:** render a second arc (sage @ ~40% opacity) for the overflow portion, starting again from 12 o'clock over the completed first lap.
- **Goal-met:** completed arc + a small check glyph at 12 o'clock in `color.accent`; center label swaps to "Goal met".
- Fill animates 400ms ease-out on log/unlog; reduced-motion → instant set. No liquid/wave.
- The ring is decorative to a screen reader on its own → provide a text `accessibilityLabel` (see 5h), generated from the same state that draws it.

### 5c. AddDrinkRow + drink buttons

- Three equal buttons in a row (`space.3 (12)` gap), stack on very narrow screens.
- Each: `color.surface`, `radii.lg`, `1px color.border`, padding `space.4 (16)`, min height ≥ 64 (comfortable one-tap target, well over 44). Leading drink glyph `color.accent`; label `type.captionStrong` `textPrimary`; amount `type.caption` `textSecondary`.
- **Glass** = preset (default 250 mL), **Bottle** = preset (default 500 mL) — presets editable in Settings (§6 units). **Custom** opens the sheet.
- Pressed: brief `color.surfaceAlt` tint; light haptic on add (`selectionAsync`), respects OS haptic/reduce settings. One-tap = instant optimistic ring update + UndoChip.

### 5d. WhyTargetLine + WhyTargetBreakdown

- Collapsed: leading condition glyph (`☀`/`◌`/`↗`) `color.accent` or `textSecondary` + warm sentence `type.subtext` `textPrimary`, trailing "Why? ⌄" pressable (`captionStrong` `color.accent`).
- Expanded breakdown: card-with-dividers (Overwhelm StepList pattern). Header "Why today's target" + chevron. First row "Your base goal {amount}", factor rows (glyph · reading `textSecondary` · word-effect `textSecondary`), final emphasized "Today's goal {amount}" `textPrimary`. Footnote carries the network-nuance privacy line.
- `accessibilityRole="button"`, `accessibilityState={{expanded}}` on the header; expand animates height + chevron 180ms (reduced-motion → instant).

### 5e. IntakeLogSection + DrinkRow

- Card-with-dividers. Header "Today's drinks" + chevron, collapsed by default. Hidden entirely at zero logs.
- DrinkRow: leading glyph `accent` · amount `body` `textPrimary` · time `subtext` `textSecondary` · trailing ✕ remove (hit-slop 44). Removing re-animates the ring.

### 5f. NextSipHint & UndoChip

- **NextSipHint:** quiet line under the ring — `◔` glyph + `type.caption` `textSecondary`. Only shown when the engine has a meaningful next-sip estimate and the user is behind/at pace. Never shown if it'd read as nagging.
- **UndoChip:** appears ~5s after a log — `color.surfaceAlt` chip, "Undo ↶" `captionStrong` `color.accent`, hit-slop 44. Auto-dismiss.

### 5g. Design tokens used

All from `mobile/src/theme/tokens.ts` — **no new tokens invented.** Only additions are *opacity variants* of `color.accent` (over-target second lap ~40%, any soft fill), computed from the token, not new tokens — unless CTO prefers naming them (e.g. `color.accentFillSoft`).

| Element | Token |
|---|---|
| Screen bg | `color.background` `#F7F8F6` |
| Cards (drink buttons, breakdown, intake log) | `color.surface` `#FFFFFF`, `radii.lg`, `1px color.border` |
| Ring arc, goal check, drink glyphs, CTAs, "Why?"/links | `color.accent` `#6B9080` |
| Ring over-target second lap | `color.accent` @ ~40% opacity |
| Ring track, progress track, chip/collapsed bg, pressed tint | `color.surfaceAlt` `#EEF1ED` |
| Hairlines, button borders, dividers | `color.border` `#E1E5DF` |
| Headings, logged amount, primary values | `color.textPrimary` `#2C322E` |
| Subtext, "of {target}", times, qualifiers, factor readings | `color.textSecondary` `#5C645E` |
| Unit hints, disabled, number detail | `color.textTertiary` `#9AA29B` |
| CTA label / check glyph | `color.onAccent` `#FFFFFF` |
| Error/stale glyph (rare; never for over-target) | `color.error` `#A86B6B` |
| Type roles | `type.h1` header + ring amount · `type.h2` reserved · `type.body`/`subtext` lines · `type.caption`/`captionStrong` labels |
| Spacing | `space.5 (20)` screen padding · `space.6 (24)` between sections · `space.3 (12)` card gaps/row padding · `space.4 (16)` inside cards |
| Elevation | `e0` default; `e1` optional on the active custom-amount sheet only — keep flat |
| Layout | `layout.maxContentWidth 480`, `layout.minTouchTarget 44` |

### 5h. Accessibility

- **Ring is not screen-reader-legible on its own** → the ring container carries an `accessibilityLabel` summary generated from the same state that draws it, e.g.: *"You've logged 1.3 of 2.4 litres today, about 55 percent. A good pace."* Over-target: *"You've logged 2.7 litres, past today's 2.4 litre goal."* Visual ring + label must always agree.
- **Color is never the only signal:** progress is also the centered number + label; goal-met carries the word "Goal met" + check glyph; over-target carries the words "A little extra"; factor effects use words ("a little," "slightly") not red/green. The whole palette is monochrome sage anyway — safe for color-vision deficiency.
- **Every factor/driver row** is a labelled element; collapsible headers expose `accessibilityState={{expanded}}`.
- **Touch targets ≥ 44×44:** drink buttons ≥ 64 tall, ✕ removes + "Why?" + UndoChip get hit-slop to 44.
- **Contrast (WCAG AA), same checks as siblings:** `textPrimary` on `background` ~11:1 (pass); `textSecondary` on `background` ~5.4:1 (pass); sage `#6B9080` on `#F7F8F6` ~3.3:1 — fine for the `14px` ring arc and UI glyphs (non-text/large), but **do not** set small body text in pure accent; use `textSecondary`/`textPrimary`. If small accent text appears (e.g. "Why?"), darken to `accentPressed` `#5A7C6E` to stay AA — flag for QA (same note as Overwhelm §5e).
- **Dynamic Type / `allowFontScaling`:** layout tolerates ~130% scale — ring center text can shrink/wrap, drink buttons stack, the a11y label remains the source of truth at extreme scale.
- **Reduced-motion:** ring fill, over-target lap, collapse animations all degrade to instant.
- **Notifications a11y:** nudge copy is plain language and self-contained (readable by screen readers from the shade); the "Log a glass" action has a clear label.
- **Live region:** on a fresh target compute, announce politely "Today's water goal is ready: {target}."

### 5i. Refresh / update behavior

- Pull-to-refresh re-fetches weather/AQI and recomputes today's target (calm refresh control tinted `color.accent`). If the target changes mid-day, animate the ring's "of {target}" gently and, if meaningful, update the WhyTargetLine — never jarringly reset progress.
- Target may also recompute on app open / on a significant activity change (cadence is an open question, §6). If conditions worsen (hotter / worse air) and the target rises, surface it softly in the WhyTargetLine, not as an alert.

---

## 6. Handoff notes + open questions

### For the mobile developer

- One screen, five body states from a single enum: `'empty' | 'progress' | 'goalMet' | 'overTarget' | 'genericFallback'` (derived from `loggedMl`, `targetMl`, `hasLocation`). Onboarding is a separate 4-step stack reused on first run and from the inline "Turn on location" affordance.
- Build **HydrationRing** as a dumb presentational component taking `{ loggedMl, targetMl, state }` and rendering arc + center + over-target lap. Keep the `accessibilityLabel` summary generated from the same props so visual and SR never disagree (same discipline as the Energy curve).
- **Persistence is required here** (unlike Overwhelm): today's intake log + target must survive app restart/backgrounding — **on-device only** (MMKV/AsyncStorage), never a network call. Roll the log over at local midnight (new day = empty state); keep history on-device if we later add trends (out of scope v1).
- **Network is limited to weather + AQI fetches keyed off coarse location, carrying no user data.** No user intake/target/profile ever leaves the device. This is the one feature that calls out; keep that boundary clean and isolated (a single environment-fetch module), so it's auditable and the privacy copy stays literally true.
- Request **coarse / approximate** location only and **read-only**. Handle all four grant combinations (§4e). Route denial recovery to OS Settings deep-link (dialogs fire once).
- Nudges via **local notifications** in v1 (no push server). Implement quiet hours + daily cap + frequency setting on-device. If "Log a glass" / "Later" notification actions aren't supported the same on both OSes, degrade to tap-opens-app (confirm, below).
- Everything references `mobile/src/theme/tokens.ts`. No new hex/spacing. Opacity variants of `color.accent` computed inline (or named with CTO's blessing).

### Open questions for CTO / AIML engineer

1. **How is the target number computed (blocks the ring + "why" copy)?** What's the formula / model that turns base goal + heat + humidity + AQI + activity into a target in mL? I need: (a) the **base/default goal** source (fixed default? from a profile — weight/age/sex? do we even collect that?), (b) which inputs materially move it and by how much, and (c) a stable output contract, ideally `{ baseMl, targetMl, factors: [{ kind, reading, direction, deltaMl? }], confidence? }`. The "why" breakdown (§2b) renders directly from `factors`.
2. **Units — mL or oz (blocks all amount UI)?** Default unit and is it user-switchable (metric/imperial)? Affects ring center, drink presets, custom sheet, and notification copy. Spec is written in mL; need the real default + whether to localize by region.
3. **Drink presets:** confirm default glass (250 mL) and bottle (500 mL) sizes, and whether users can edit them. Also the "quick chips" set for the custom sheet.
4. **Nudge cadence (blocks §3 timing):** what's a sensible default nudges/day cap and minimum spacing? Does the engine emit explicit nudge *events/times*, or does the app schedule from the target + pace + conditions? I've proposed cap 4–5/day, quiet hours 9pm–8am, Gentle/Standard/Off — confirm or correct. Also: does the engine expose a **"next sip" time** for the inline hint (§5f)?
5. **What conditions drive the adjustment, and what's "low air quality"?** Confirm the exact env inputs (temp, humidity, AQI, UV? wind?) and the AQI thresholds that nudge the target / trigger the "air's hazy" copy. Critically: **how alarmist may we be about AQI?** I've kept it strictly hydration-framed and non-alarming (§2a) — confirm we should *not* surface AQI health warnings (that's a different app's job), or if legal/safety wants a stronger note at severe AQI.
6. **Location coarseness + privacy mechanics (CTO):** exactly how coarse is the location we request (city-level? rounded coordinates?), and **how does the weather/AQI lookup avoid tying location to the user** (rounded coords, no account, third-party API privacy)? The onboarding + "why" copy makes specific promises ("about the size of a city," "never sent anywhere it can be tied to you") that must be literally true. Which weather/AQI provider, and does its ToS/telemetry respect the promise?
7. **Notification actions:** can we ship **"Log a glass"** (logs 250 mL without opening) and **"Later"** (snooze) as notification actions on both iOS and Android in RN? If not uniformly, I'll spec a graceful degrade to tap-opens-app.
8. **Target recompute cadence:** when does the target update — once each morning, on app open, on pull-to-refresh, on significant activity change, or continuously? Determines whether the ring's denominator is stable for the day or can shift, and how I animate a mid-day change (§5i).
9. **Activity source:** does "activity" come from the same HealthKit/Health Connect read used by Energy Predictor (steps/active energy), or a lighter signal? If it's the same, can we share one permission and one read pipeline? Confirm so onboarding lists permissions accurately and we request the minimum.
10. **Over-hydration safety:** v1 treats over-target as gentle/affirming and never alarms. Is there any upper bound where we should add a soft, non-clinical note (not a medical warning)? Defaulting to "no alarm" unless safety/legal says otherwise.
11. **Display size token:** the ring's center amount may want to be larger than `type.h1` (26). OK to add a `type.display` (~34–40) to the token set, or keep within existing scale? Minor design-side call, flagging.

### Needs sign-off

- **CTO:** confirm the **network boundary** — only weather/AQI fetches keyed off coarse location leave the device; no user intake/target/profile ever does (Q6). Approve the coarse-location + notifications permission model and partial-grant handling. Approve the weather/AQI provider against the privacy promise. Rule on AQI alarm framing (Q5) and over-hydration note (Q10).
- **AIML:** the **target-computation contract** (Q1), units default (Q2), which conditions drive adjustment + AQI thresholds (Q5), nudge cadence / next-sip output (Q4), and target recompute cadence (Q8) — these gate the ring, the "why" breakdown, and all nudge logic.
- **Designer (me):** will produce Figma mockups of all five states + the 4-step onboarding from this spec next. This Markdown is the build-against source of truth in the meantime, and it reuses the Overwhelm/Energy token set unchanged — same sage palette, type scale, spacing, radii, and warm second-person voice.
