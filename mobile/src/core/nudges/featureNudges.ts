/**
 * featureNudges — one tiny helper per feature so publishing a nudge is a one-liner.
 * Each feature maps its own decision → a generic spoken sentence → nudgeCenter.publish.
 * This is the "all models, one bus" glue: features call these; outputs (glasses,
 * notifications) never need to know which feature it came from.
 *
 * Messages are deliberately GENERIC (may be spoken aloud — Smart Glasses §5): no amounts,
 * no task content, nothing sensitive.
 */

import { nudgeCenter } from './NudgeCenter';
import type { NudgeDecision } from '../../features/hydration/types';
import type { EnergyForecast } from '../../features/energy/types';

/** Hydration → from HydrationEngine.decideNudge. */
export function nudgeFromHydration(d: NudgeDecision): boolean {
  if (!d.shouldNudge) return false;
  const message =
    d.reason === 'postActivity' ? 'Nice work — a good moment for some water.'
    : d.reason === 'behindPace' ? 'A good time for some water.'
    : 'Quick sip?';
  return nudgeCenter.publish({ feature: 'hydration', message, reason: d.reason });
}

/** Energy → speak once when a focus or wind-down window is starting at `nowHour`. */
export function nudgeFromEnergy(forecast: EnergyForecast, nowHour: number): boolean {
  const win = forecast.windows.find((w) => w.startHour === nowHour);
  if (!win) return false;
  const message = win.kind === 'focus'
    ? 'Your focus window is starting — good time for the hard thing.'
    : 'Winding-down time — ease off when you can.';
  return nudgeCenter.publish({ feature: 'energy', message, reason: `${win.kind}Window` });
}

/** Overwhelm → read the next step aloud (triggered from the phone, kept generic). */
export function nudgeOverwhelmStep(stepText: string): boolean {
  // The step text comes from the user's own task; speaking it is opt-in/triggered, not a
  // background push. Caller decides whether it's appropriate to voice.
  return nudgeCenter.publish({ feature: 'overwhelm', message: stepText, reason: 'readStep' });
}
