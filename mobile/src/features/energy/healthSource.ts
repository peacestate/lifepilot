/**
 * healthSource — provides the recent sleep/activity/usage window for the model.
 *
 * v1 is a LOCAL stub with a clear seam to HealthKit (iOS) / Health Connect (Android)
 * via react-native-health / react-native-health-connect (CTO doc). Health data is
 * read on-device and NEVER uploaded — this module imports zero networking.
 *
 * Returns the last N days of DayFeatures + how many real days we have (cold-start).
 */

import type { DayFeatures } from './types';

export type HealthWindow = { days: DayFeatures[]; daysCollected: number };

/**
 * TODO(native): replace with real HealthKit / Health Connect reads (sleep duration,
 * sleep timing, steps, active minutes; phone usage via UsageStatsManager on Android —
 * iOS has no usage API, mask those fields). All local; no network.
 *
 * For now: a plausible recent window so the screen renders end-to-end pre-integration.
 */
export async function getHealthWindow(): Promise<HealthWindow> {
  const today = new Date();
  const days: DayFeatures[] = [];
  for (let i = 6; i >= 0; i--) {
    const dow = (today.getDay() - i + 7) % 7;
    const weekend = dow === 0 || dow === 6;
    days.push({
      sleepDurationH: weekend ? 7.8 : 6.9,
      sleepQuality: 0.82,
      sleepMidpointH: weekend ? 4.8 : 3.9,
      wakeTimeH: weekend ? 8.2 : 7.0,
      stepsK: weekend ? 9 : 7,
      activeMinutes: weekend ? 45 : 30,
      movementIntensity: 0.3,
      screenTimeH: 4.5,
      phonePickups: 60,
      lateNightScreenMin: 25,
      dow,
    });
  }
  // daysCollected: how many of the 7 are REAL (stub says all 7; real impl counts).
  return { days, daysCollected: 7 };
}
