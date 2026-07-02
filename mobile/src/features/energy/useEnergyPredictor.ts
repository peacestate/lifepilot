/**
 * useEnergyPredictor — feature hook. Reads the local health window, runs the ExecuTorch
 * model (falling back to the heuristic curve pre-export), and derives the forecast.
 * Keeps the screen dumb. No network.
 */
import { useCallback, useEffect, useState } from 'react';

import { buildInputTensor, deriveForecast, heuristicCurve } from './EnergyForecast';
import { predictCurve } from './energyModel';
import { getHealthWindow } from './healthSource';
import type { EnergyForecast } from './types';
import { nudgeFromEnergy } from '../../core/nudges/featureNudges';
import { isPowerConstrained } from '../../core/power/powerAwareness';

export type UseEnergyPredictor = {
  loading: boolean;
  forecast?: EnergyForecast;
  /** Publish an energy nudge to the shared bus if a window starts now (→ glasses + notifications). */
  checkNudge: () => void;
  refresh: () => Promise<void>;
};

export function useEnergyPredictor(): UseEnergyPredictor {
  const [loading, setLoading] = useState(true);
  const [forecast, setForecast] = useState<EnergyForecast | undefined>(undefined);

  const run = useCallback(async () => {
    setLoading(true);
    const { days, daysCollected } = await getHealthWindow();
    const input = buildInputTensor(days);

    // This forecast runs automatically on mount, not from a user tap — so on a low,
    // unplugged battery it reuses the existing heuristic path (already built for when
    // the .pte isn't loaded) instead of paying for a model inference the user didn't
    // ask for right now (power-aware inference).
    const modelCurve = (await isPowerConstrained()) ? null : await predictCurve(input);
    const curve = modelCurve ?? heuristicCurve(days[days.length - 1]);
    const basis = modelCurve ? 'model' : 'heuristic';

    setForecast(deriveForecast(curve, daysCollected, basis));
    setLoading(false);
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  const checkNudge = useCallback(() => {
    if (forecast) nudgeFromEnergy(forecast, new Date().getHours());
  }, [forecast]);

  return { loading, forecast, checkNudge, refresh: run };
}
