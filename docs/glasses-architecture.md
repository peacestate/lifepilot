# Smart Glasses — Architecture & Reality (CTO)

Feature #5. Hands-free wellness on Meta smart glasses. This doc is deliberately blunt about
what's **possible**, what's **gated**, and where it **collides with the privacy rule** — because
for a privacy-absolute app, Meta's glasses are the hardest fit of all five features.

> ⚠️ The specifics below are from general knowledge of Meta's glasses program and **must be
> verified against Meta's current developer terms** before any build. Treat versions/capabilities
> as "confirm before committing," not settled fact.

## 1. The SDK reality (why this is "later" and gated)
- **The glasses are not an open compute platform.** Ray-Ban / Meta smart glasses do not run
  arbitrary third-party apps on the glasses chip, and there is **no path to run ExecuTorch on the
  glasses.** They are a tethered I/O device (camera, mics, open-ear speakers, a button), paired to
  the phone via Meta's own app.
- **Third-party access is gated.** Meta introduced a **Wearables Device Access Toolkit** to let
  phone apps access glasses capabilities (e.g. capture, audio) — but it is **program-gated**
  (approval/allowlist), phone-app-mediated, and limited in scope. We cannot assume open access to
  the camera/mic/speaker; **availability of each capability is an open question** (design §6).
- **Implication:** LifePilot's intelligence stays **100% on the phone** (the models we already
  built). The glasses can only ever be a **dumb-ish peripheral**: deliver a spoken nudge, send a
  captured photo/audio clip to the phone, emit a button event. That's the ceiling.

## 2. Architecture: phone is the brain, glasses are I/O
```
 Glasses (Meta)                Phone (LifePilot — the brain)
 ─────────────                 ─────────────────────────────
 button press  ───────────▶    intent (voice capture / receipt snap)
 mic audio     ───────────▶    (audio) → on-device Overwhelm / STT on phone
 camera photo  ───────────▶    (image) → on-device native OCR + extraction (feature #4)
 speaker       ◀───────────    spoken nudge text  ← on-device Hydration/Energy engines
```
- A `glasses/` feature module on the phone owns the **peripheral bridge** (pairing, button
  events, capture in, audio out) and routes to the **existing** feature engines. **No new model.**
- Everything the glasses send is processed by the **same on-device models** — the glasses add no
  inference, only I/O.
- **Graceful absence:** if no glasses, every feature works exactly as today. Glasses are strictly
  additive (a `GlassesBridge` that's simply absent when unpaired).

## 3. The privacy collision (the real issue) and how we contain it
This is the one feature that can **break the "no exposure by any means" rule**, because the
glasses hardware/ecosystem is Meta's:
- **Risk:** capture (photo/audio) and even wake-word/voice may be routed through **Meta's app and
  potentially Meta's cloud** as part of how the device works. That is data leaving the user's
  control — the exact thing we forbid elsewhere.
- **Containment rules (hard):**
  1. **On-phone processing only.** Any glasses capture must land on the phone and be processed by
     our on-device models. We do **not** add a LifePilot server path for glasses data.
  2. **Prefer capabilities that don't transit Meta's cloud.** Use direct/local paths (BLE button
     events, local audio out, on-device-delivered image) where the toolkit allows.
  3. **If a capability forces data through Meta:** it becomes **explicit, separate opt-in** with
     plain-language disclosure ("this uses Meta's glasses, which may process the photo on Meta's
     systems"), and we **default it OFF**. If we can't disclose it honestly, we **omit it.**
  4. **No silent capture.** Everything captured is surfaced on the phone for review before it
     counts (matches OCR Expense / Overwhelm review UX).
- **Net stance:** the *default* glasses experience is the subset that keeps data on the phone.
  Anything that can't meet that bar is opt-in-or-omitted, never quiet. See
  [[privacy-absolute-executorch-everywhere]].

## 4. Integration approach (when we build)
- `mobile/src/features/glasses/`: `GlassesBridge.ts` (pairing + capability discovery, behind the
  gated SDK), `useGlasses.ts` (connection state, button intents), and thin adapters that call the
  existing `overwhelm` / `expense` / `hydration` / `energy` hooks. No `.pte`, no registry entry.
- ESLint network-ban still applies to `features/glasses/**`; the SDK's own networking (Meta's) is
  outside our `src` but must be disclosed per §3.
- Behind a feature flag + the registry's channel system, this can ship to a **beta** cohort first
  (consistent with releasing features incrementally, like model releases).

## 5. Dependencies & blocking items
1. **Meta program access** — apply to / confirm the Wearables Device Access Toolkit terms and
   which capabilities (button, audio out, camera, mic) are actually granted. **Blocks everything.**
2. **App maturity** — README is right: build this after the phone features are solid (they now are,
   structurally). Glasses are an enhancement layer on top.
3. **Privacy/legal review** of §3 — what, if anything, transits Meta, and the exact disclosure.
4. **No new ML work** — reuse the four on-device models.

## 6. Decision: v1 is audio-only (no Meta program), capture is Phase 2

**v1 — spoken nudges over standard Bluetooth. No Meta SDK, no approval, no exposure.**
- The glasses pair to the phone as a **standard Bluetooth audio sink** (A2DP) — the same way they
  play music/calls. LifePilot just **plays audio** to the system's selected output; we do not
  "access the glasses," so **no Wearables Toolkit / Meta approval is required.**
- Nudge speech uses **on-device (offline) TTS** (e.g. `expo-speech` / native TTS pinned to an
  **offline** voice). The nudge text **must not** be sent to a network TTS voice — verify the
  selected voice is on-device. This keeps the text on the phone.
- **Exposes nothing:** output-only, nothing captured, nothing uploaded. The single Meta touch is
  the user's one-time **device pairing** in Meta's app (outside LifePilot, no LifePilot data).
- **Verify on a real device:** audio-focus behavior for short notification-style clips, and that
  the offline voice is actually used. We cannot *force* audio specifically to the glasses — it
  follows the OS's active output, which is correct/expected.
- `features/glasses/` for v1 is tiny: a `speakNudge(text)` helper (offline TTS) wired to the
  existing engines' nudge decisions. **No `.pte`, no registry entry, no native Meta module.**

**Phase 2 — hands-free capture (voice/camera/button). Gated; deferred.**
- Requires Meta's **Wearables Device Access Toolkit** (program approval) and re-opens the
  Meta-cloud data-path question (§3). Build only after access is granted AND the data path is
  confirmed local; otherwise omit per the containment rules.

**Net:** the phone is the brain; v1 makes the glasses a calm speaker for nudges with zero new
exposure and zero Meta dependency. Capture waits for Meta — and only if it can stay honest.
