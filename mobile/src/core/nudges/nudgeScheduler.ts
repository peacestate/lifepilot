/**
 * nudgeScheduler — a simple callback registry + setInterval.
 *
 * Each feature registers a `checkNudge` callback (e.g. from its hook). The scheduler
 * fires every `intervalMs` and calls all registered checks. The NudgeCenter applies
 * quiet-hours / de-bounce centrally, so each check can be called freely.
 *
 * PRIVACY: pure in-process scheduling — no network, no push tokens.
 */

type CheckFn = () => void;

const registry = new Map<string, CheckFn>();
let timer: ReturnType<typeof setInterval> | null = null;

function tick() {
  registry.forEach((fn) => {
    try { fn(); } catch { /* isolate one feature's failure from others */ }
  });
}

export const nudgeScheduler = {
  /** Register a nudge check. Returns an unregister fn (safe to call multiple times). */
  register(key: string, fn: CheckFn): () => void {
    registry.set(key, fn);
    return () => registry.delete(key);
  },

  /** Start the scheduler (idempotent). Fires immediately, then every intervalMs. */
  start(intervalMs = 60_000): void {
    if (timer != null) return;
    tick();
    timer = setInterval(tick, intervalMs);
  },

  stop(): void {
    if (timer != null) { clearInterval(timer); timer = null; }
  },
};
