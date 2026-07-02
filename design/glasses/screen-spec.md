# Smart Glasses — Experience Spec (feature #5)

Status: **v1 = audio-only (no Meta program needed); capture = later/gated.**

**Scope decision:** v1 ships **spoken nudges only** — the phone speaks calm reminders through the
glasses over **standard Bluetooth audio**, using **on-device (offline) text-to-speech**. This needs
**no Meta SDK, no approval, and exposes nothing** (sound out only; nothing captured, nothing
uploaded). The hands-free **capture** moments (voice input, receipt camera, button) require Meta's
gated toolkit and are **deferred to a later phase** — documented below but not in v1. This spec
designs the experience; `docs/glasses-architecture.md` owns the SDK + privacy reality.

Premise: **hands-free wellness on Meta smart glasses.** The phone stays the brain (all
on-device models run there); the glasses are a calm **I/O surface** — a speaker for spoken
nudges, a mic for quick voice capture, a camera for hands-free receipt snaps. Nothing about the
experience should feel like "a screen on your face"; it's ambient and occasional.

> Privacy framing is the headline, not a footnote — see §5. If glasses use can't be done without
> routing personal data through Meta, the calm answer is to **not** ship that path.

## 1. What it feels like

### v1 — Spoken nudges (output only, ships now)
The phone's existing engines decide a nudge; the glasses *speak* it, briefly and rarely, via
standard Bluetooth + offline TTS:
- Hydration: "A good time for some water." (ties to the on-device hydration engine)
- Energy: "Your focus window is starting — good time for the hard thing."
- Overwhelm (on request, when triggered from the phone): read the next micro-step aloud.
Quiet hours + the same non-nagging cadence as the phone nudges. Always silenceable.
Nudges are **generic by design** (never read sensitive content aloud — open-ear speakers can be
overheard). This is the entire v1; it needs no Meta program.

### Phase 2 — Hands-free capture (LATER, requires Meta's gated toolkit)
*Deferred — documented so the design is ready if/when Meta access lands. Not in v1.*
- **Voice capture:** button-hold → *"I'm overwhelmed by the move."* → phone runs Overwhelm
  on-device → glasses read back the first step.
- **Receipt snap:** glasses camera → photo **to the phone** → native OCR + on-device extraction.
Both need the gated SDK and raise the Meta-cloud question (§5) — hence Phase 2, not v1.

## 2. Phone companion screens (where the actual UI lives)
The glasses have no rich UI, so the design work is the **companion screens** on the phone:
- **Pair & connect** — calm onboarding: what the glasses can do, and the explicit privacy
  contract (§5). Connect flow, connected/disconnected state, reconnect.
- **Nudge settings for glasses** — which features may speak (Hydration / Energy / Overwhelm),
  voice on/off, quiet hours (shared with phone settings), volume/length.
- **Activity review** — anything captured via glasses (a voice task, a receipt) appears in the
  normal phone feature screen for review/edit — same review UX as OCR Expense / Overwhelm.

## 3. Interaction principles
- **Rare and brief.** A spoken nudge is one sentence. Never a stream.
- **Phone-confirmed.** Anything captured hands-free is reviewable on the phone before it counts
  (no silent saves).
- **Glance-free.** The experience works with the glasses' audio + button only; no display reliance.
- **Graceful absence.** If glasses aren't connected, every feature works exactly as today on the
  phone. Glasses are additive, never required.

## 4. Reuse
No new visual language and **no new model** — glasses reuse the existing on-device models
(Overwhelm/Energy/Hydration/OCR) and the calm sage companion-screen tokens.

## 5. The privacy contract

### v1 (audio-only) — exposes nothing
- The glasses are used **as a Bluetooth speaker only.** LifePilot **plays** spoken nudges; it
  **captures nothing** — no mic, no camera, no recording.
- Nudge speech is synthesized with **on-device (offline) TTS**, so the text never goes to any
  cloud (not Meta's, not ours). Pin an offline voice; never a network voice.
- Nothing is uploaded; nothing leaves the phone. The only Meta involvement is the user's one-time
  device **pairing** in Meta's app — outside LifePilot, carrying none of our data.
- Real-world note: open-ear speakers can be lightly overheard nearby → nudges stay **generic**,
  never sensitive content. This is ambient, not a data leak.

### Phase 2 (capture) — only if it can stay honest
If hands-free capture is ever added via Meta's toolkit: audio/photos go **to the phone** and are
processed by the same on-device models — never a wellness server. ⚠️ If any capability forces data
through **Meta's** app/cloud, the onboarding says so plainly, it's **explicit opt-in**, default
OFF, and we **omit** it rather than quietly expose the user.

## 6. Open questions (for CTO / Meta program)
- Which capabilities are even available to third parties (audio out? button events? camera
  capture? raw vs Meta-mediated)? — blocks 1/2/3 above.
- Does any path force data through Meta's cloud? If yes, which, and can we avoid it?
- Latency of "speak a nudge" and "capture → phone" round-trips.
- Pairing model (direct BLE vs through Meta's app).
