/**
 * powerAwareness — battery-state gate for AUTOMATIC (non-user-initiated) inference.
 *
 * Scope, deliberately narrow: this does NOT throttle anything the user explicitly asked
 * for (tapping "break this down", logging a drink, etc.) — blocking an explicit request
 * because of battery would just be confusing. It only gates proactive calls the app makes
 * on its own: the Overwhelm LLM warm-up (useOverwhelmManager) and the initial Energy /
 * Hydration model inference at mount (both already have a heuristic/engine fallback path
 * for when the .pte isn't available — low battery reuses that same fallback).
 *
 * PRIVACY: expo-battery reads local hardware state only. No network involved.
 */
import * as Battery from 'expo-battery';

/** Below this level (and not charging) automatic inference is skipped. */
const LOW_BATTERY_THRESHOLD = 0.15;

export type PowerState = {
  batteryLevel: number; // 0..1, -1 if unknown (e.g. simulator)
  isCharging: boolean;
  lowPowerMode: boolean;
};

async function getPowerState(): Promise<PowerState> {
  const [level, state, lowPowerMode] = await Promise.all([
    Battery.getBatteryLevelAsync().catch(() => -1),
    Battery.getBatteryStateAsync().catch(() => Battery.BatteryState.UNKNOWN),
    Battery.isLowPowerModeEnabledAsync().catch(() => false),
  ]);
  return {
    batteryLevel: level,
    isCharging:
      state === Battery.BatteryState.CHARGING || state === Battery.BatteryState.FULL,
    lowPowerMode,
  };
}

/**
 * Should an AUTOMATIC (not user-initiated) model call be skipped right now?
 * True when battery is low and not charging, or the OS's own low-power mode is on —
 * either signal means the user (or the OS) already wants to conserve power.
 */
export async function isPowerConstrained(): Promise<boolean> {
  const { batteryLevel, isCharging, lowPowerMode } = await getPowerState();
  if (lowPowerMode) return true;
  if (batteryLevel < 0) return false; // unknown (simulator/unsupported) — don't block
  return batteryLevel < LOW_BATTERY_THRESHOLD && !isCharging;
}
