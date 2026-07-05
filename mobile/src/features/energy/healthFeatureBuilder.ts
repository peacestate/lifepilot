/**
 * healthFeatureBuilder — maps cleaned real data (Health Connect + manual entry + usage
 * access) onto the Energy Predictor's ACTUAL 12-feature contract.
 *
 * IMPORTANT — this deliberately does NOT use the feature list from the original product
 * spec (heart_rate_resting, days_since_install, consecutive_good_sleep_days,
 * previous_energy_checkin, etc.). The already-trained/exported `.pte` was built on a
 * different, fixed 12-feature-by-7-day contract (mobile/src/models/energy/manifest.json,
 * mirrored in types.ts's DayFeatures). Feeding it a differently-shaped/differently-meant
 * vector would silently produce garbage predictions or a tensor-shape crash — retraining
 * on the new feature set was explicitly ruled out for this deadline (owner decision).
 * Heart rate and check-in history are still real and useful — they're surfaced as UI
 * context (transparency panel / weekly insight) instead of model inputs.
 *
 * Pure functions, no I/O — callers (healthSource.ts) do all the fetching.
 */
import type { CleanedDay } from './healthDataCleaner';
import { deriveActivityFromSteps } from './healthConnectSource';
import type { ManualDayFeatures } from './energyCalibration';
import type { DayFeatures } from './types';
import manifest from '../../models/energy/manifest.json';

const MEAN = manifest.scaler.mean;

/** Screen-time day, from usageAccessSource.ts — absent entirely if permission isn't granted. */
export type UsageDay = {
  date: string;
  screenTimeH: number;
  phonePickups: number;
  lateNightScreenMin: number;
};

function dowOf(dateKey: string): number {
  return new Date(`${dateKey}T00:00:00`).getDay();
}

/** The 3 usage-access fields, from a real reading if present, else the model's population mean. */
function usageFeatures(usage?: UsageDay) {
  return {
    screenTimeH: usage?.screenTimeH ?? MEAN[7],
    phonePickups: usage?.phonePickups ?? MEAN[8],
    lateNightScreenMin: usage?.lateNightScreenMin ?? MEAN[9],
  };
}

/** Build one day's 12 features from a cleaned Health Connect day (see healthDataCleaner.ts). */
export function buildFromHealthConnect(day: CleanedDay, usage?: UsageDay): DayFeatures {
  const activity = day.stepsK != null
    ? deriveActivityFromSteps(day.stepsK)
    : { activeMinutes: MEAN[5], movementIntensity: MEAN[6] };

  return {
    sleepDurationH: day.sleepDurationH ?? MEAN[0],
    sleepQuality: day.sleepQuality ?? MEAN[1],
    sleepMidpointH: day.sleepMidpointH ?? MEAN[2],
    wakeTimeH: day.wakeTimeH ?? MEAN[3],
    stepsK: day.stepsK ?? MEAN[4],
    activeMinutes: activity.activeMinutes,
    movementIntensity: activity.movementIntensity,
    ...usageFeatures(usage),
    dow: dowOf(day.date),
  };
}

/** Build one day's 12 features from the 3-input manual-entry fallback. */
export function buildFromManualEntry(date: string, entry: ManualDayFeatures, usage?: UsageDay): DayFeatures {
  const activity = deriveActivityFromSteps(entry.stepsK);
  return {
    sleepDurationH: entry.sleepDurationH,
    sleepQuality: MEAN[1], // manual entry doesn't ask sleep quality (CEO spec: 3 inputs only)
    sleepMidpointH: entry.sleepMidpointH,
    wakeTimeH: entry.wakeTimeH,
    stepsK: entry.stepsK,
    activeMinutes: activity.activeMinutes,
    movementIntensity: activity.movementIntensity,
    ...usageFeatures(usage),
    dow: dowOf(date),
  };
}

/** Level 4 fallback (graceful degradation) — every field at the model's population mean. */
export function populationBaselineDay(): DayFeatures {
  return {
    sleepDurationH: MEAN[0],
    sleepQuality: MEAN[1],
    sleepMidpointH: MEAN[2],
    wakeTimeH: MEAN[3],
    stepsK: MEAN[4],
    activeMinutes: MEAN[5],
    movementIntensity: MEAN[6],
    ...usageFeatures(undefined),
    dow: new Date().getDay(),
  };
}
