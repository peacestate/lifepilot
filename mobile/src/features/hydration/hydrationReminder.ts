/**
 * hydrationReminder — scheduled, content-specific check-ins (CEO spec step 5): morning /
 * midday / evening / completion. Distinct from HydrationEngine.decideNudge, which is a
 * continuous pace-based nudge whose messages are deliberately GENERIC (no amounts) because
 * they're published through NudgeCenter and may be spoken aloud via the Smart Glasses
 * output. These reminders carry real numbers ("2.1L", "600ml left"), so they render
 * in-app only (HydrationScreen) — never through the nudge bus.
 *
 * Pure function of the day's state; no hidden timer/dedup state here. The caller
 * (useHydrationTracker) decides how often to re-evaluate and the screen tracks
 * per-kind dismissal for the day.
 */
import { mlToOz } from './HydrationEngine';

export type ReminderKind = 'morning' | 'middayBehind' | 'eveningBehind' | 'completion';

export type ReminderDecision = { kind: ReminderKind; message: string };

const MORNING_HOUR = 8;
const MIDDAY_HOUR = 13;
const EVENING_HOUR = 19;
const MIDDAY_THRESHOLD = 0.4;
const EVENING_THRESHOLD = 0.7;

function fmtMl(ml: number, units: 'ml' | 'oz'): string {
  if (units === 'oz') return `${Math.round(mlToOz(ml))} oz`;
  return ml >= 1000 ? `${(ml / 1000).toFixed(ml % 1000 === 0 ? 0 : 1)}L` : `${Math.round(ml)}ml`;
}

/**
 * Which single reminder (if any) applies right now, in priority order: hitting the
 * target always wins, then the two "you're behind" checkpoints, then the morning
 * heads-up. Returns undefined outside 8am–bedtime or when none of the conditions hold.
 */
export function decideReminder(
  targetMl: number,
  loggedMl: number,
  nowMs: number,
  hot: boolean,
  units: 'ml' | 'oz' = 'ml',
): ReminderDecision | undefined {
  if (targetMl <= 0) return undefined;
  const hour = new Date(nowMs).getHours();
  const frac = loggedMl / targetMl;

  if (frac >= 1) {
    return { kind: 'completion', message: 'Target reached! Consistent hydration boosts energy by up to 20%.' };
  }
  if (hour >= EVENING_HOUR && frac < EVENING_THRESHOLD) {
    const left = Math.max(0, targetMl - loggedMl);
    return { kind: 'eveningBehind', message: `Only ${fmtMl(left, units)} left for today — you've got this.` };
  }
  if (hour >= MIDDAY_HOUR && frac < MIDDAY_THRESHOLD) {
    return { kind: 'middayBehind', message: "You're behind — drink a glass now." };
  }
  if (hour >= MORNING_HOUR) {
    const context = hot ? 'slightly warm outside, stay ahead of it' : 'stay ahead of it today';
    return { kind: 'morning', message: `Your target today is ${fmtMl(targetMl, units)} — ${context}.` };
  }
  return undefined;
}
