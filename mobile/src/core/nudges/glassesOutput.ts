/**
 * glassesOutput — the glasses subscribe to the nudge bus ONCE; this covers every feature.
 * Call attachGlassesOutput() once at app start. Any feature that publishes a nudge is now
 * spoken through the glasses (when connected) with no per-feature wiring. Output-only,
 * no capture, no network (Smart Glasses §5). Adding another output (notifications) is the
 * same shape — subscribe once, all features flow through it.
 */

import { nudgeCenter } from './NudgeCenter';
import { speakNudge } from '../../features/glasses/speakNudge';

let detach: (() => void) | null = null;

/** Wire the glasses speaker to the nudge bus. Idempotent. Returns a detach fn. */
export function attachGlassesOutput(): () => void {
  if (detach) return detach;
  const unsub = nudgeCenter.subscribe((n) => {
    // n.message is already a final, generic sentence (never sensitive — spoken aloud).
    void speakNudge(n.message);
  });
  detach = () => { unsub(); detach = null; };
  return detach;
}
