/**
 * healthConnectSource — real Android Health Connect reads (sleep, steps, heart rate).
 *
 * Scope (CEO decision, 2026-07-06): Android/Health Connect only — iOS HealthKit is
 * explicitly out of scope for this round (every test device this project uses is
 * Android; HealthKit needs a real iPhone + paid Apple dev account we don't have in
 * the loop). On iOS this module always reports unavailable, no native call attempted.
 *
 * Only 3 record types are requested (READ_SLEEP_SESSION / READ_STEPS / READ_HEART_RATE)
 * per the CEO's explicit scope. The Energy model's fixed 12-feature contract
 * (mobile/src/models/energy/manifest.json) also wants activeMinutes/movementIntensity/
 * screenTimeH/phonePickups/lateNightScreenMin — none of which Health Connect covers with
 * just these 3 permissions:
 *   - activeMinutes/movementIntensity are DERIVED from real step count below (a documented
 *     proxy, not a separate sensor — see deriveActivityFromSteps).
 *   - screenTimeH/phonePickups/lateNightScreenMin have no Health Connect equivalent at all
 *     (would need Android's separate UsageStatsManager permission, out of THIS round's
 *     scope) and are left for the caller to default to the model's population mean —
 *     honestly a stub still, just a narrower and clearly-documented one than before.
 *
 * Heart rate is read and returned (restingHeartRate/morningHeartRate, via the cleaner) for
 * the transparency UI / weekly insight card, but is NOT fed into the model — the pinned
 * .pte's input contract has no heart-rate slot; wiring one in would mean retraining and
 * changing the manifest contract, out of scope for this round.
 *
 * Isolated like energyModel.ts: any failure (module not linked, HC app not installed,
 * permission denied) returns a clean "unavailable" result, never throws into the caller.
 *
 * Raw records go through healthDataCleaner.ts before becoming HCDay — multi-session
 * nights get merged, naps excluded, sensor-error outliers capped/discarded (non-negotiable
 * per product spec — see that file's header). This module's own job is now just the
 * permission dance + raw fetch; cleaning/aggregation lives in the cleaner.
 *
 * PRIVACY: local Health Connect API only. Nothing is ever uploaded.
 */
import { Platform } from 'react-native';
import type {
  HeartRateRecord as HCHeartRateRecord,
  SleepSessionRecord as HCSleepSessionRecord,
  StepsRecord as HCStepsRecord,
} from 'react-native-health-connect';

import { cleanHealthConnectDays } from './healthDataCleaner';
import type { CleanedDay } from './healthDataCleaner';

export type HCDay = CleanedDay;

export type HCResult = {
  /** Health Connect app + SDK present on this device. */
  available: boolean;
  /** All 3 read permissions granted (after prompting, if this was the first run). */
  permitted: boolean;
  days: HCDay[];
};

const RECORD_TYPES = ['SleepSession', 'Steps', 'HeartRate'] as const;

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export async function readHealthConnectWindow(days = 7): Promise<HCResult> {
  const unavailable: HCResult = { available: false, permitted: false, days: [] };
  if (Platform.OS !== 'android') return unavailable;

  let hc: typeof import('react-native-health-connect');
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, import/no-unresolved
    hc = require('react-native-health-connect');
  } catch {
    return unavailable; // native module not linked (e.g. pre-prebuild) → treat as unavailable
  }

  try {
    const status = await hc.getSdkStatus();
    if (status !== hc.SdkAvailabilityStatus.SDK_AVAILABLE) return unavailable; // HC app missing/needs update
    await hc.initialize();

    const granted = await hc.getGrantedPermissions();
    const isGranted = (rt: (typeof RECORD_TYPES)[number]) =>
      granted.some((g) => 'recordType' in g && g.recordType === rt && g.accessType === 'read');
    const missing = RECORD_TYPES.filter((rt) => !isGranted(rt));

    if (missing.length > 0) {
      // First-launch (or previously-denied) prompt — Health Connect's own system dialog.
      const result = await hc.requestPermission(
        missing.map((rt) => ({ accessType: 'read' as const, recordType: rt })),
      );
      const stillMissing = missing.filter(
        (rt) => !result.some((g) => 'recordType' in g && g.recordType === rt),
      );
      if (stillMissing.length === RECORD_TYPES.length) {
        return { available: true, permitted: false, days: [] }; // user denied everything
      }
    }

    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - (days + 1)); // pad 1 extra day to catch overnight sleep sessions
    const timeRangeFilter = { operator: 'between' as const, startTime: start.toISOString(), endTime: end.toISOString() };

    const [sleepRes, stepsRes, hrRes] = await Promise.all([
      hc.readRecords('SleepSession', { timeRangeFilter }).catch(() => ({ records: [] as HCSleepSessionRecord[] })),
      hc.readRecords('Steps', { timeRangeFilter }).catch(() => ({ records: [] as HCStepsRecord[] })),
      hc.readRecords('HeartRate', { timeRangeFilter }).catch(() => ({ records: [] as HCHeartRateRecord[] })),
    ]);

    // Cleaning (merge multi-session nights, drop naps, cap/discard sensor outliers, smooth
    // step spikes) happens in healthDataCleaner.ts, on the raw records — see that file for
    // why it must run BEFORE aggregation, not after.
    const cleaned = cleanHealthConnectDays(sleepRes.records, stepsRes.records, hrRes.records, days);
    const result = cleaned.filter((d) => d.sleepDurationH != null || d.stepsK != null);

    return { available: true, permitted: true, days: result };
  } catch {
    return { available: true, permitted: false, days: [] };
  }
}

/**
 * activeMinutes/movementIntensity have no direct Health Connect source in this round's scope
 * (see file header) — derive a documented proxy from real step count rather than defaulting
 * to a population mean, since steps IS real per-user data we already have.
 * ~100 steps/min brisk walking is the reference pace; movementIntensity is steps-per-day
 * normalized against a ~12k "very active" day, clamped to [0,1].
 */
export function deriveActivityFromSteps(stepsK: number): { activeMinutes: number; movementIntensity: number } {
  const steps = stepsK * 1000;
  return {
    activeMinutes: Math.round(steps / 100),
    movementIntensity: clamp01(steps / 12_000),
  };
}
