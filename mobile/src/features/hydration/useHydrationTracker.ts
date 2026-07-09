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

import { applyCalibration, computeCalibration, computeWeeklyInsight, saveDayRecord } from './hydrationCalibration';
import { getCoarseLocation } from './coarseLocation';
import { buildTarget, decideNudge, engineComponents } from './HydrationEngine';
import { predictComponents } from './hydrationModel';
import { decideReminder } from './hydrationReminder';
import type { ReminderDecision, ReminderKind } from './hydrationReminder';
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
import type { WeeklyInsight } from './hydrationCalibration';

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
  /** Today's scheduled check-in (morning/midday/evening/completion), if any and not dismissed. */
  reminder?: ReminderDecision;
  dismissReminder: () => void;
  /** Monday-only weekly summary card; undefined until 3+ completed days are logged. */
  weeklyInsight?: WeeklyInsight;
};

export function useHydrationTracker(
  activity?: { activeMinutes?: number; workoutIntensity?: HydrationInputs['workoutIntensity']; steps?: number },
): UseHydrationTracker {
  const [profile, setProfile] = useState<HydrationProfile>(() => hydrationStore.getProfile());
  const [conditions, setConditions] = useState<WeatherConditions | undefined>(undefined);
  const [target, setTarget] = useState<HydrationTarget | undefined>(undefined);
  const [intake, setIntake] = useState<IntakeEntry[]>(() => hydrationStore.getToday());
  const [loading, setLoading] = useState(true);
  const [weeklyInsight, setWeeklyInsight] = useState<WeeklyInsight | undefined>(undefined);
  const [dismissed, setDismissed] = useState<{ kind: ReminderKind; day: string } | undefined>(undefined);

  const loggedMl = useMemo(() => intake.reduce((s, e) => s + e.ml, 0), [intake]);

  const recompute = useCallback(async (p: HydrationProfile) => {
    setLoading(true);
    // 1) conditions (offline default; live only if opted in). getCoarseLocation is passed
    // ONLY in live mode, so offline never triggers a location-permission prompt.
    const cond = await getConditions(
      p.weatherMode,
      p,
      p.weatherMode === 'live' ? getCoarseLocation : undefined,
    );
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
    const raw = modelComp
      ? buildTarget(modelComp, inputs, meta, 'model')
      : buildTarget(engineComp, inputs, meta, 'engine');

    // 4) personalization: adjust the frozen model/engine target with the user's own EMA
    // bias from logged history (hydrationCalibration). No-op below 3 days of history.
    const calibration = await computeCalibration();
    const personalizedMl = applyCalibration(raw.targetMl, calibration);
    const t: HydrationTarget =
      personalizedMl === raw.targetMl
        ? raw
        : {
            ...raw,
            targetMl: personalizedMl,
            // keep the breakdown summing exactly to targetMl (contract §4) by adding the
            // bias as its own line item, rather than silently overriding the total.
            breakdown: [
              ...raw.breakdown,
              {
                key: 'personalBias',
                label: 'Your pattern',
                amountMl: personalizedMl - raw.targetMl,
                confidence: 'medium',
                why:
                  personalizedMl < raw.targetMl
                    ? "you've been drinking less than predicted lately"
                    : "you've been drinking more than predicted lately",
              },
            ],
            personalization: { rawTargetMl: raw.targetMl, bias: calibration.bias },
          };
    setTarget(t);

    void saveDayRecord(t.targetMl, hydrationStore.loggedMl());
    setWeeklyInsight(await computeWeeklyInsight());
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity?.activeMinutes, activity?.workoutIntensity, activity?.steps]);

  useEffect(() => {
    let alive = true;
    // Wait for the persisted profile + today's log to load from disk, THEN compute —
    // otherwise the first target would use the default profile (70 kg) and the ring
    // would show 0 ml even though the user logged drinks earlier today.
    void hydrationStore.ready().then(() => {
      if (!alive) return;
      const p = hydrationStore.getProfile();
      setProfile({ ...p });
      setIntake([...hydrationStore.getToday()]);
      void recompute(p);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recompute]);

  const addIntake = useCallback((ml?: number) => {
    const amount = ml ?? target?.servingMl ?? 250;
    hydrationStore.addIntake(amount);
    setIntake([...hydrationStore.getToday()]);
    if (target) void saveDayRecord(target.targetMl, hydrationStore.loggedMl());
  }, [target]);

  const removeIntake = useCallback((id: string) => {
    hydrationStore.removeIntake(id);
    setIntake([...hydrationStore.getToday()]);
    if (target) void saveDayRecord(target.targetMl, hydrationStore.loggedMl());
  }, [target]);

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

  // Step 5's scheduled check-ins (real numbers, in-app only — see hydrationReminder.ts's
  // header for why these never go through the glasses-safe NudgeCenter bus). Re-evaluated
  // whenever the target/log changes and on a 5-minute tick so purely time-based
  // transitions (e.g. crossing 8am with the screen already open) still surface.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 5 * 60_000);
    return () => clearInterval(id);
  }, []);

  const todayKey = (ms: number) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  };

  const rawReminder = target
    ? decideReminder(target.targetMl, loggedMl, nowTick, (conditions?.temperatureC ?? 0) >= 28, profile.units)
    : undefined;
  const day = todayKey(nowTick);
  const reminder = rawReminder && dismissed?.kind === rawReminder.kind && dismissed.day === day ? undefined : rawReminder;

  const dismissReminder = useCallback(() => {
    if (rawReminder) setDismissed({ kind: rawReminder.kind, day });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawReminder, day]);

  return {
    loading, profile, conditions, target, loggedMl, intake, progress,
    addIntake, removeIntake, updateProfile, checkNudge, refresh: () => recompute(profile),
    reminder, dismissReminder, weeklyInsight,
  };
}
