/**
 * useHydrationTracker — the feature hook. Keeps the screen dumb.
 *
 *  - resolves today's conditions (offline default / opt-in live weather)
 *  - computes the target via the ExecuTorch model, falling back to the deterministic
 *    engine if the .pte isn't loaded (so the app always works)
 *  - tracks intake log + progress (local-only store)
 *  - exposes a calm 'why today' breakdown and a quick-add API
 *
 * PRIVACY: the only module under here that can touch the network is weatherSource (and
 * only in opt-in 'live' mode). Everything else is on-device.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { buildTarget, decideNudge, engineComponents } from './HydrationEngine';
import { predictComponents } from './hydrationModel';
import { hydrationStore } from './hydrationStore';
import { getConditions } from './weatherSource';
import { nudgeFromHydration } from '../../core/nudges/featureNudges';
import { isPowerConstrained } from '../../core/power/powerAwareness';
import type {
  HydrationInputs,
  HydrationProfile,
  HydrationTarget,
  IntakeEntry,
  WeatherConditions,
} from './types';

export type UseHydrationTracker = {
  loading: boolean;
  profile: HydrationProfile;
  conditions?: WeatherConditions;
  target?: HydrationTarget;
  loggedMl: number;
  intake: IntakeEntry[];
  /** 0..1 progress toward today's target. */
  progress: number;
  /** Log a drink (defaults to one serving). */
  addIntake: (ml?: number) => void;
  removeIntake: (id: string) => void;
  /** Change settings (units, weather mode, body params…) and recompute. */
  updateProfile: (patch: Partial<HydrationProfile>) => void;
  /** Evaluate the nudge rule and publish to the shared bus (→ glasses, etc.). */
  checkNudge: () => void;
  refresh: () => Promise<void>;
};

export function useHydrationTracker(
  activity?: { activeMinutes?: number; workoutIntensity?: HydrationInputs['workoutIntensity']; steps?: number },
): UseHydrationTracker {
  const [profile, setProfile] = useState<HydrationProfile>(() => hydrationStore.getProfile());
  const [conditions, setConditions] = useState<WeatherConditions | undefined>(undefined);
  const [target, setTarget] = useState<HydrationTarget | undefined>(undefined);
  const [intake, setIntake] = useState<IntakeEntry[]>(() => hydrationStore.getToday());
  const [loading, setLoading] = useState(true);

  const loggedMl = useMemo(() => intake.reduce((s, e) => s + e.ml, 0), [intake]);

  const recompute = useCallback(async (p: HydrationProfile) => {
    setLoading(true);
    // 1) conditions (offline default; live only if opted in — getCoarseLocation wired later)
    const cond = await getConditions(p.weatherMode, p);
    setConditions(cond);

    // 2) assemble inputs
    const inputs: HydrationInputs = {
      bodyMassKg: p.bodyMassKg,
      sex: p.sex,
      ageYears: p.ageYears,
      temperatureC: cond?.temperatureC,
      humidityPct: cond?.humidityPct,
      aqi: cond?.aqi,
      activeMinutes: activity?.activeMinutes,
      workoutIntensity: activity?.workoutIntensity,
      steps: activity?.steps,
    };

    // 3) model first, engine fallback — both feed the same buildTarget. This recompute
    // runs automatically (on mount / profile change), not from a direct user tap, so a
    // low unplugged battery skips the model call and reuses the engine path instead
    // (power-aware inference) — same fallback already used when the .pte isn't loaded.
    const { components: engineComp, meta } = engineComponents(inputs);
    const modelComp = (await isPowerConstrained()) ? null : await predictComponents(inputs);
    const t = modelComp
      ? buildTarget(modelComp, inputs, meta, 'model')
      : buildTarget(engineComp, inputs, meta, 'engine');
    setTarget(t);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity?.activeMinutes, activity?.workoutIntensity, activity?.steps]);

  useEffect(() => {
    void recompute(profile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recompute]);

  const addIntake = useCallback((ml?: number) => {
    const amount = ml ?? target?.servingMl ?? 250;
    hydrationStore.addIntake(amount);
    setIntake([...hydrationStore.getToday()]);
  }, [target?.servingMl]);

  const removeIntake = useCallback((id: string) => {
    hydrationStore.removeIntake(id);
    setIntake([...hydrationStore.getToday()]);
  }, []);

  const updateProfile = useCallback((patch: Partial<HydrationProfile>) => {
    const p = hydrationStore.setProfile(patch);
    setProfile({ ...p });
    void recompute(p);
  }, [recompute]);

  const progress = target ? Math.min(1, loggedMl / target.targetMl) : 0;

  // Publish a hydration nudge to the shared bus → reaches the glasses (and any other
  // output) with no per-output wiring. A background scheduler calls this on a cadence;
  // the bus applies quiet-hours + global de-bounce centrally (NudgeCenter).
  const checkNudge = useCallback(() => {
    if (!target) return;
    const now = Date.now();
    nudgeFromHydration(
      decideNudge(
        {
          targetMl: target.targetMl,
          loggedMl,
          wakeHour: profile.wakeHour,
          bedHour: profile.bedHour,
          servingMl: target.servingMl,
          currentTempC: conditions?.temperatureC,
          lastDrinkAt: hydrationStore.lastDrinkAt(),
        },
        now,
        new Date(now).getHours(),
      ),
    );
  }, [target, loggedMl, profile.wakeHour, profile.bedHour, conditions?.temperatureC]);

  return {
    loading, profile, conditions, target, loggedMl, intake, progress,
    addIntake, removeIntake, updateProfile, checkNudge, refresh: () => recompute(profile),
  };
}
