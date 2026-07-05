/**
 * healthSyncScheduler — periodic re-sync for Energy Predictor (step 5 of the health
 * pipeline spec): "the prediction should update throughout the day as new data comes in."
 *
 * Mirrors core/nudges/nudgeScheduler.ts's proven "callback registry + setInterval" shape,
 * at the cadences this feature actually needs: every 2 hours (new steps/heart-rate may
 * have landed in Health Connect), and once at each local midnight (yesterday's data is
 * now complete — refreshing then is how "the previous day" gets finalized into history;
 * mechanically it's the same refresh call, just triggered for a different reason).
 *
 * "On app open" and "after a check-in" are NOT this module's job — those already happen
 * synchronously in useEnergyPredictor (its mount effect, and recordCheckIn calling run()
 * directly) since they're immediate user-driven triggers, not background timers.
 *
 * PRIVACY: pure in-process timers — no network, no OS-level background job. Like
 * nudgeScheduler, this only runs while the app process is alive; it does not wake the app
 * from a killed state (that would need a native background-task API, out of scope here).
 */

type SyncFn = () => void | Promise<void>;

const TWO_HOURS_MS = 2 * 60 * 60_000;

let refreshFn: SyncFn | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let midnightTimer: ReturnType<typeof setTimeout> | null = null;

function msUntilNextLocalMidnight(): number {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5); // +5s past midnight, avoids boundary races
  return next.getTime() - now.getTime();
}

function scheduleMidnight() {
  midnightTimer = setTimeout(() => {
    void refreshFn?.();
    scheduleMidnight(); // reschedule for the following midnight
  }, msUntilNextLocalMidnight());
}

export const healthSyncScheduler = {
  /** Register the recompute callback (e.g. useEnergyPredictor's `refresh`). */
  register(fn: SyncFn): void {
    refreshFn = fn;
  },

  /** Start both timers (idempotent). Doesn't fire immediately — the hook's own mount
   * effect already does the "on app open" fetch; this is only the recurring cadence. */
  start(): void {
    if (tickTimer == null) {
      tickTimer = setInterval(() => { void refreshFn?.(); }, TWO_HOURS_MS);
    }
    if (midnightTimer == null) scheduleMidnight();
  },

  stop(): void {
    if (tickTimer != null) { clearInterval(tickTimer); tickTimer = null; }
    if (midnightTimer != null) { clearTimeout(midnightTimer); midnightTimer = null; }
  },
};
