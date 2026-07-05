/**
 * useEnergyPredictor — feature hook. Reads the local health window, runs the ExecuTorch
 * model (falling back to the heuristic curve pre-export), and derives the forecast.
 * Keeps the screen dumb. No network.
 */
import { useCallback, useEffect, useState } from 'react';

import { buildInputTensor, deriveForecast, heuristicCurve } from './EnergyForecast';
import {
  applyCalibration,
  computeCalibration,
  computeWeeklyHealthInsight,
  recordCheckIn as recordCheckInEntry,
  saveDayRecord,
} from './energyCalibration';
import type { WeeklyHealthInsight } from './energyCalibration';
import { buildManualEntry, saveManualEntry } from './manualDayEntry';
import { predictCurve } from './energyModel';
import { getHealthWindow, populationBaselineWindow } from './healthSource';
import type { DataSourceSummary } from './healthSource';
import type { EnergyForecast } from './types';
import { nudgeFromEnergy } from '../../core/nudges/featureNudges';
import { isPowerConstrained } from '../../core/power/powerAwareness';

export type UseEnergyPredictor = {
  loading: boolean;
  forecast?: EnergyForecast;
  /** True when Health Connect + manual entry both have zero data — show the fallback form. */
  needsManualEntry: boolean;
  /** Publish an energy nudge to the shared bus if a window starts now (→ glasses + notifications). */
  checkNudge: () => void;
  refresh: () => Promise<void>;
  /** Record a 1-tap "how's your energy right now?" check-in (0..100). Feeds §5 calibration. */
  recordCheckIn: (actual: number) => Promise<void>;
  /** The 3-input fallback: sleep time, wake time, rough steps (both hours as 0..23.99 local). */
  submitManualEntry: (sleepTimeH: number, wakeTimeH: number, steps: number) => Promise<void>;
  /** Level 4 of the degradation chain — user declines the manual-entry form. Still shows a
   * real forecast (generic, population-baseline) instead of a dead-end error screen. */
  skipManualEntry: () => Promise<void>;
  /** What actually fed today's forecast — step 7's transparency panel. */
  dataSources?: DataSourceSummary;
  /** Monday-only weekly summary; undefined until 3+ completed days exist. */
  weeklyInsight?: WeeklyHealthInsight;
};

export function useEnergyPredictor(): UseEnergyPredictor {
  const [loading, setLoading] = useState(true);
  const [forecast, setForecast] = useState<EnergyForecast | undefined>(undefined);
  const [needsManualEntry, setNeedsManualEntry] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [dataSources, setDataSources] = useState<DataSourceSummary | undefined>(undefined);
  const [weeklyInsight, setWeeklyInsight] = useState<WeeklyHealthInsight | undefined>(undefined);

  // Accepts an explicit override so skipManualEntry can force the population-baseline path
  // on its OWN first call — setSkipped(true) doesn't take effect until the next render, so
  // reading the `skipped` state alone here would still see the stale (false) value on that
  // immediate call.
  const run = useCallback(async (forceSkipped?: boolean) => {
    setLoading(true);
    if (forceSkipped ?? skipped) {
      const { days, daysCollected, sources } = populationBaselineWindow();
      const input = buildInputTensor(days);
      const modelCurve = (await isPowerConstrained()) ? null : await predictCurve(input);
      const rawCurve = modelCurve ?? heuristicCurve(days[days.length - 1]);
      setForecast(deriveForecast(rawCurve, daysCollected, modelCurve ? 'model' : 'heuristic', false));
      setDataSources(sources);
      setNeedsManualEntry(false);
      setLoading(false);
      return;
    }
    const { days, daysCollected, needsManualEntry: needsManual, sources } = await getHealthWindow();
    setNeedsManualEntry(needsManual);
    setDataSources(sources);
    if (needsManual) {
      setLoading(false);
      return;
    }
    const input = buildInputTensor(days);

    // This forecast runs automatically on mount, not from a user tap — so on a low,
    // unplugged battery it reuses the existing heuristic path (already built for when
    // the .pte isn't loaded) instead of paying for a model inference the user didn't
    // ask for right now (power-aware inference).
    const modelCurve = (await isPowerConstrained()) ? null : await predictCurve(input);
    const rawCurve = modelCurve ?? heuristicCurve(days[days.length - 1]);
    const basis = modelCurve ? 'model' : 'heuristic';

    // §5 personalization: the .pte is a frozen population-level model (never retrained
    // on-device — see docs/energy-predictor-model-contract.md §5 for why). The only
    // per-user "learning" is this deterministic bias, computed from the user's own
    // logged check-ins vs. what was predicted for them at that hour.
    const calibration = await computeCalibration();
    const curve = applyCalibration(rawCurve, calibration);

    await saveDayRecord({
      dayFeatures: days[days.length - 1] as unknown as Record<string, unknown>,
      predictedCurve: curve,
      basis,
      generatedAt: Date.now(),
      restingHeartRate: sources.restingHeartRate,
    });

    setForecast(deriveForecast(curve, daysCollected, basis, calibration.count > 0));
    setWeeklyInsight(await computeWeeklyHealthInsight());
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skipped]);

  useEffect(() => {
    void run();
  }, [run]);

  const checkNudge = useCallback(() => {
    if (forecast) nudgeFromEnergy(forecast, new Date().getHours());
  }, [forecast]);

  const recordCheckIn = useCallback(async (actual: number) => {
    await recordCheckInEntry(actual);
    await run(); // recalculate immediately so the visible forecast reflects the new bias
  }, [run]);

  const submitManualEntry = useCallback(
    async (sleepTimeH: number, wakeTimeH: number, steps: number) => {
      await saveManualEntry(buildManualEntry(sleepTimeH, wakeTimeH, steps));
      await run(); // re-derive the forecast now that today has real data
    },
    [run],
  );

  const skipManualEntry = useCallback(async () => {
    setSkipped(true);
    await run(true);
  }, [run]);

  return {
    loading, forecast, needsManualEntry, checkNudge, refresh: () => run(),
    recordCheckIn, submitManualEntry, skipManualEntry, dataSources, weeklyInsight,
  };
}
