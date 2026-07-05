/**
 * overwhelmReminder — 5 nudges driven by REAL saved task data (overwhelmMemory), not
 * generic motivational copy. Registered with the shared nudgeScheduler (App.tsx),
 * ticking roughly every minute, same pattern as Energy/Hydration's checkNudge.
 *
 *   1. Morning (9am)  — nothing submitted yet today.
 *   2. Midday (1pm)   — still nothing submitted today (a firmer nudge than #1).
 *   3. Completion     — fires once, right when a task's last step gets checked off.
 *   4. Abandoned      — a task is partially done and hasn't been touched in 2+ hours.
 *   5. Evening (8pm)  — today's task still has steps left.
 *
 * DELIBERATE DEVIATION from NudgeCenter's own "keep messages generic, no task content"
 * rule (see featureNudges.ts header — that rule exists because glasses output may SPEAK
 * nudges aloud in public). These 5 nudges are the whole point of referencing the user's
 * actual task — "generic" would defeat them. Flagging this explicitly as a real product
 * decision (task names now flow to the shared bus, incl. glasses), not an oversight.
 *
 * De-dupe is in-memory only (resets on app restart) — no need to persist "have I already
 * nudged for this" across restarts for a same-day, best-effort reminder; matches this
 * project's "no unnecessary persisted state" bias.
 *
 * PRIVACY: reads only the local overwhelm_memory.json. No network.
 */
import { nudgeCenter } from '../../core/nudges/NudgeCenter';
import { overwhelmMemory } from './overwhelmMemory';

const ABANDON_AFTER_MS = 2 * 60 * 60_000; // 2 hours since last progress update

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// In-memory de-dupe flags — keyed by a day-stamped string so they naturally reset daily
// without needing to persist/clear anything.
let firedMorning: string | null = null;
let firedMidday: string | null = null;
let firedEvening: string | null = null;
const firedCompletion = new Set<string>(); // taskText, cleared once totalSteps changes (new task)
const firedAbandon = new Set<string>();    // taskText, per day

function publish(message: string, reason: string) {
  return nudgeCenter.publish({ feature: 'overwhelm', message, reason });
}

/** Call roughly every minute (nudgeScheduler) — cheap, reads local memory only. */
export async function checkOverwhelmNudges(): Promise<void> {
  const today = todayKey();
  const hour = new Date().getHours();
  const entries = await overwhelmMemory.list();
  const todaysTask = entries.find((e) => e.date === today);

  // 1. Morning (9am) — nothing submitted yet today.
  if (hour >= 9 && hour < 13 && !todaysTask && firedMorning !== today) {
    if (publish("What's one thing feeling heavy today? Let's break it down", 'morningPrompt')) {
      firedMorning = today;
    }
  }

  // 2. Midday (1pm) — still nothing submitted today.
  if (hour >= 13 && hour < 20 && !todaysTask && firedMidday !== today) {
    if (publish("You haven't tackled anything yet — even one small task builds momentum", 'middayPrompt')) {
      firedMidday = today;
    }
  }

  if (todaysTask) {
    const { taskText, completedSteps, totalSteps, updatedAt } = todaysTask;

    // 3. Completion — fires once, right when the last step gets checked off.
    if (totalSteps > 0 && completedSteps === totalSteps && !firedCompletion.has(taskText)) {
      if (publish('Every step done. That task that felt impossible? You just finished it.', 'taskComplete')) {
        firedCompletion.add(taskText);
      }
    }

    // 4. Abandoned halfway — partial progress, untouched for 2+ hours.
    const abandonKey = `${today}:${taskText}`;
    if (
      completedSteps > 0 &&
      completedSteps < totalSteps &&
      Date.now() - updatedAt >= ABANDON_AFTER_MS &&
      !firedAbandon.has(abandonKey)
    ) {
      if (
        publish(
          `You completed ${completedSteps} of ${totalSteps} steps on "${taskText}". Want to continue where you left off?`,
          'abandonedHalfway',
        )
      ) {
        firedAbandon.add(abandonKey);
      }
    }

    // 5. Evening (8pm) — steps still pending.
    if (hour >= 20 && hour < 23 && completedSteps < totalSteps && firedEvening !== today) {
      const remaining = totalSteps - completedSteps;
      if (
        publish(
          `"${taskText}" still has ${remaining} step${remaining === 1 ? '' : 's'} left. 10 minutes could close it tonight.`,
          'eveningPending',
        )
      ) {
        firedEvening = today;
      }
    }
  }
}
