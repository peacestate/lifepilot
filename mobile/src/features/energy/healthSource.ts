/**
 * healthSource — provides the recent sleep/activity/usage window for the model, via a
 * graceful 4-level degradation chain (every level still produces a usable window — the
 * caller decides what to show, this module never returns "nothing"):
 *   1. Full Health Connect data (cleaned by healthDataCleaner.ts) — best predictions.
 *   2. Partial Health Connect + manual entries filling any date HC didn't cover.
 *   3. Neither has anything at all → `needsManualEntry: true`, screen shows the form.
 *   4. User explicitly skips that form → `usePopulationBaseline()`, a real (if generic)
 *      forecast instead of a dead-end error screen.
 *
 * Feature mapping (raw Health Connect / manual entry → the model's 12-feature contract)
 * lives in healthFeatureBuilder.ts, not here — this module's job is just sourcing +
 * merging days, in priority order (HC over manual, never overwritten).
 *
 * screenTimeH/phonePickups/lateNightScreenMin: PERMANENTLY at the model's population mean
 * (manifest.scaler.mean) by design, not a stub-to-be-finished — see
 * [[energy-predictor-health-connect-scope]]. Not collecting phone-usage data is a deliberate
 * privacy choice, not a missing feature.
 *
 * iOS: Health Connect is Android-only (CEO scope decision) — always falls straight to the
 * manual-entry path there today.
 *
 * PRIVACY: health data is read on-device and NEVER uploaded — this module (and everything
 * it calls) imports zero networking.
 */

import { buildFromHealthConnect, buildFromManualEntry, populationBaselineDay } from './healthFeatureBuilder';
import { readHealthConnectWindow } from './healthConnectSource';
import { getRecentManualEntries } from './manualDayEntry';
import type { DayFeatures } from './types';
import manifest from '../../models/energy/manifest.json';

const WINDOW_DAYS = manifest.window_days; // 7

/** One field's provenance, for the transparency UI (step 7) — a checkmark vs. a warning. */
export type FieldStatus = 'measured' | 'estimated' | 'missing';

/** What actually fed the most recent day's forecast — "Based on: ✅ Sleep... ⚠️ ..." */
export type DataSourceSummary = {
  sleepHours?: number;
  sleepStatus: FieldStatus;
  steps?: number;
  stepsStatus: FieldStatus;
  restingHeartRate?: number;
  heartRateStatus: FieldStatus;
};

export type HealthWindow = {
  days: DayFeatures[];
  daysCollected: number;
  /** True when neither Health Connect nor any manual entry has ANY data for the window —
   * the screen should show the manual-entry form (or let the user skip it — see
   * usePopulationBaseline) instead of a forecast built on nothing real. */
  needsManualEntry: boolean;
  /** Provenance of the most recent day used, for the transparency panel. */
  sources: DataSourceSummary;
};

const MISSING_SOURCES: DataSourceSummary = {
  sleepStatus: 'missing', stepsStatus: 'missing', heartRateStatus: 'missing',
};

export async function getHealthWindow(): Promise<HealthWindow> {
  const [hc, manual] = await Promise.all([
    readHealthConnectWindow(WINDOW_DAYS),
    getRecentManualEntries(WINDOW_DAYS),
  ]);

  const merged = new Map<string, DayFeatures>();
  const hcByDate = new Map(hc.days.map((d) => [d.date, d]));

  for (const d of hc.days) {
    merged.set(d.date, buildFromHealthConnect(d));
  }

  // Manual entries fill any date Health Connect didn't cover — never overwrite a real HC day.
  const manualDates = new Set<string>();
  for (const { date, entry } of manual) {
    if (merged.has(date)) continue;
    merged.set(date, buildFromManualEntry(date, entry));
    manualDates.add(date);
  }

  const sortedDates = [...merged.keys()].sort();
  const days = sortedDates.map((d) => merged.get(d)!);
  const daysCollected = days.length;

  if (daysCollected === 0) {
    return { days: [populationBaselineDay()], daysCollected: 0, needsManualEntry: true, sources: MISSING_SOURCES };
  }

  const lastDate = sortedDates[sortedDates.length - 1];
  const hcDay = hcByDate.get(lastDate);
  const sources: DataSourceSummary = hcDay
    ? {
        sleepHours: hcDay.sleepDurationH,
        sleepStatus: hcDay.sleepSource === 'measured' ? 'measured' : hcDay.sleepSource === 'rollingAverage' ? 'estimated' : 'missing',
        steps: hcDay.stepsK != null ? Math.round(hcDay.stepsK * 1000) : undefined,
        stepsStatus: hcDay.stepsSource === 'measured' ? 'measured' : hcDay.stepsSource === 'threeDayAverage' ? 'estimated' : 'missing',
        restingHeartRate: hcDay.restingHeartRate,
        heartRateStatus: hcDay.restingHeartRate != null ? 'measured' : 'missing',
      }
    : manualDates.has(lastDate)
    ? {
        sleepHours: days[days.length - 1].sleepDurationH,
        sleepStatus: 'measured',
        steps: Math.round(days[days.length - 1].stepsK * 1000),
        stepsStatus: 'measured',
        heartRateStatus: 'missing', // manual entry never asks for heart rate
      }
    : MISSING_SOURCES;

  return { days, daysCollected, needsManualEntry: false, sources };
}

/**
 * Level 4 — the user was shown the manual-entry form (needsManualEntry: true) and chose to
 * skip it rather than type 3 numbers. Rather than a dead-end error screen, hand back a
 * single population-baseline day so EnergyScreen can still render a real (generic, clearly
 * labeled) forecast. daysCollected stays 0 so the UI keeps showing "calibrating"/heuristic
 * framing — this is intentionally NOT presented as a personalized prediction.
 */
export function populationBaselineWindow(): HealthWindow {
  return { days: [populationBaselineDay()], daysCollected: 0, needsManualEntry: false, sources: MISSING_SOURCES };
}
