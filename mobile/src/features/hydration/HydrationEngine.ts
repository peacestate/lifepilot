/**
 * HydrationEngine — pure, deterministic reference implementation.
 *
 * This is a 1:1 TypeScript port of ml/test/hydration_eval.py (contract §1/§4/§5).
 * It serves three roles (contract §11):
 *   1. the OFFLINE FALLBACK when the ExecuTorch model isn't loaded,
 *   2. the producer of the named components the model was trained to approximate,
 *   3. the device-side SAFETY CLAMP + breakdown/status builder (shared by both paths).
 *
 * NO React, NO react-native-executorch, NO network. If you change a constant here,
 * change it in hydration_eval.py too (CI checks the two never drift).
 */

import type {
  BreakdownItem,
  Components,
  HydrationDayState,
  HydrationInputs,
  HydrationStatus,
  HydrationTarget,
  NudgeDecision,
} from './types';

/* ── FROZEN CONSTANTS — must equal hydration_eval.py §1 / contract §1 ───────── */
export const HYDRATION = {
  BASE_PER_KG: 33.0,
  T0: 20.0,
  K_HEAT: 25.0,
  HEAT_CAP: 1000.0,
  K_ACT: 12.0,
  ACT_CAP: 1500.0,
  STEP_BASE: 5000,
  MIN_PER_1K_STEPS: 10.0,
  FLOOR: 1500.0,
  CEILING: 4000.0,
  INTENSITY: { light: 0.6, moderate: 1.0, vigorous: 1.5 } as const,
  DEFAULT_TEMP_C: 20.0,
  DEFAULT_RH: 50.0,
  DEFAULT_SERVING_ML: 250.0,
  // nudge constants (§5.2)
  MIN_NUDGE_GAP_MIN: 45,
  JUST_DRANK_MIN: 20,
  POST_ACTIVITY_WINDOW_MIN: 90,
  HEAT_SPIKE_TEMP_C: 30,
  GENTLE_GAP_MIN: 120,
  ACT_CAP_PER_NUDGE: 750.0,
} as const;

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const round = (x: number) => Math.round(x);

/** mL ⇄ fl-oz helpers (UI only; engine is always mL). */
export const mlToOz = (ml: number) => ml / 29.5735;
export const ozToMl = (oz: number) => oz * 29.5735;

/* ── the deterministic physiology components (the fallback + training source) ─ */
export function engineComponents(inp: HydrationInputs): {
  components: Components;
  meta: { weatherMissing: boolean; loggedWorkout: boolean; effMin: number; temp: number; rh: number; aqi: number | undefined; mass: number; ageFactor: number };
} {
  const mass = clamp(inp.bodyMassKg, 30, 250);

  const age = inp.ageYears;
  const ageFactor = age == null ? 1.0 : age > 65 ? 0.9 : age >= 55 ? 0.95 : 1.0;
  const sexFactor = inp.sex === 'male' ? 1.0 : inp.sex === 'female' ? 0.95 : 0.975;

  const baseline = mass * HYDRATION.BASE_PER_KG * ageFactor * sexFactor;

  const weatherMissing = inp.temperatureC == null || inp.humidityPct == null;
  const temp = clamp(inp.temperatureC ?? HYDRATION.DEFAULT_TEMP_C, -30, 55);
  const rh = clamp(inp.humidityPct ?? HYDRATION.DEFAULT_RH, 0, 100);
  const humidityFactor =
    1.0 + 0.3 * clamp((rh - 60) / 40, 0, 1) + 0.1 * clamp((30 - rh) / 30, 0, 1);
  const heat = clamp(HYDRATION.K_HEAT * Math.max(0, temp - HYDRATION.T0) * humidityFactor, 0, HYDRATION.HEAT_CAP);

  let effMin = 0;
  let intensity = 1.0;
  const loggedWorkout = inp.activeMinutes != null && inp.activeMinutes > 0;
  if (inp.activeMinutes != null) {
    effMin = clamp(inp.activeMinutes, 0, 600);
    intensity = HYDRATION.INTENSITY[inp.workoutIntensity ?? 'moderate'] ?? 1.0;
  } else if (inp.steps != null) {
    const steps = clamp(inp.steps, 0, 100000);
    effMin = (Math.max(0, steps - HYDRATION.STEP_BASE) / 1000) * HYDRATION.MIN_PER_1K_STEPS;
    intensity = HYDRATION.INTENSITY.light;
  }
  const heatActivityFactor = clamp(1.0 + 0.02 * Math.max(0, temp - 25), 1.0, 1.3);
  const activity = clamp(effMin * HYDRATION.K_ACT * intensity * heatActivityFactor, 0, HYDRATION.ACT_CAP);

  const aqi = inp.aqi;
  const aqiTerm = aqi == null || aqi <= 100 ? 0 : aqi <= 150 ? 150 : 300;

  return {
    components: { baseline, heat, activity, aqi: aqiTerm },
    meta: { weatherMissing, loggedWorkout, effMin, temp, rh, aqi, mass, ageFactor },
  };
}

/**
 * Build the HydrationTarget from the 4 components — SHARED by the model path and the
 * engine fallback, so clamp/breakdown/status/sum-to-target logic lives in one place.
 */
export function buildTarget(
  components: Components,
  inp: HydrationInputs,
  meta: ReturnType<typeof engineComponents>['meta'],
  basis: 'model' | 'engine',
): HydrationTarget {
  const { baseline, heat, activity, aqi: aqiTerm } = components;
  const notes = ['Estimate for healthy adults — not medical advice.'];
  let confDrops = 0;
  if (inp.ageYears == null && inp.sex == null) confDrops += 1;
  if (meta.weatherMissing) {
    notes.push('Weather unavailable — assumed mild conditions.');
    confDrops += 1;
  }
  if (meta.aqi != null && meta.aqi > 100) {
    notes.push('Air quality is poor — consider moving activity indoors (hydration helps comfort only).');
  }

  const raw = baseline + heat + activity + aqiTerm;
  const target = clamp(raw, HYDRATION.FLOOR, HYDRATION.CEILING);
  const safetyClamp = target - raw;
  const clamped = Math.abs(safetyClamp) > 1e-9;

  const breakdown: BreakdownItem[] = [
    { key: 'baseline', label: 'Baseline', amountMl: round(baseline), confidence: 'high',
      why: `${round(meta.mass)} kg body weight (~33 mL/kg)` },
    { key: 'heat', label: 'Heat', amountMl: round(heat),
      confidence: meta.weatherMissing ? 'low' : 'high',
      why: heat > 0 ? `${round(meta.temp)}°C, ${round(meta.rh)}% humidity` : 'mild temperature — no extra needed' },
    { key: 'activity', label: 'Activity', amountMl: round(activity),
      confidence: meta.loggedWorkout ? 'high' : 'medium',
      why: activity > 0 ? `${Math.trunc(meta.effMin)} active min replacing sweat` : 'no activity logged yet' },
    { key: 'airQuality', label: 'Air quality', amountMl: round(aqiTerm), confidence: 'low',
      why: aqiTerm > 0 ? `AQI ${Math.trunc(meta.aqi ?? 0)} — small comfort bump` : 'air quality fine' },
  ];
  if (clamped) {
    breakdown.push({ key: 'safetyClamp', label: 'Safety cap', amountMl: round(safetyClamp),
      confidence: 'high',
      why: safetyClamp > 0 ? 'raised to a healthy minimum' : "capped for safety — pace it, don't chug" });
  }

  let status: HydrationStatus;
  if (clamped && target >= HYDRATION.CEILING - 1e-9) status = 'high';
  else if (target >= 3500) status = 'high';
  else if (target > baseline * 1.15) status = 'elevated';
  else status = 'normal';

  const confidence = (['high', 'medium', 'low'] as const)[Math.min(confDrops, 2)];

  // fold integer-rounding residue so the breakdown sums EXACTLY to the target (§4)
  const targetR = round(target);
  const diff = targetR - breakdown.reduce((s, b) => s + b.amountMl, 0);
  if (diff !== 0) {
    const sink = breakdown.find((b) => b.key === 'safetyClamp') ?? breakdown[0];
    sink.amountMl += diff;
  }

  return {
    targetMl: targetR,
    baselineMl: round(baseline),
    status,
    breakdown,
    servingMl: round(HYDRATION.DEFAULT_SERVING_ML),
    confidence,
    clamped,
    notes,
    basis,
  };
}

/** Pure fallback: inputs → target via the deterministic formula (no model). */
export function computeTarget(inp: HydrationInputs): HydrationTarget {
  const { components, meta } = engineComponents(inp);
  return buildTarget(components, inp, meta, 'engine');
}

/* ── §5 nudge logic (ported 1:1) ───────────────────────────────────────────── */
function roundToServing(ml: number, serving: number) {
  if (serving <= 0) return round(ml);
  return Math.round(ml / serving) * serving;
}

/**
 * How far behind (or ahead of, if negative) today's pace the user is right now, in mL —
 * shared by decideNudge below AND lifeEngine.ts's cross-feature insight, so the "what
 * counts as behind" math lives in exactly one place.
 */
export function paceDeficitMl(targetMl: number, loggedMl: number, wakeHour: number, bedHour: number, nowHour: number): number {
  const bedCutoff = bedHour - 1;
  const span = Math.max(1, bedCutoff - wakeHour);
  const frac = clamp((nowHour - wakeHour) / span, 0, 1);
  return targetMl * frac - loggedMl;
}

export function decideNudge(
  state: HydrationDayState,
  nowMs: number,
  nowHour: number,
): NudgeDecision {
  const { targetMl: target, wakeHour: wake = 7, bedHour: bed = 23 } = state;
  const logged = state.loggedMl ?? 0;
  const serving = state.servingMl ?? HYDRATION.DEFAULT_SERVING_ML;
  const bedCutoff = bed - 1;

  const out = (should: boolean, reason: NudgeDecision['reason'], ml: number, message: string, nxt: number): NudgeDecision => ({
    shouldNudge: should, reason,
    suggestedMl: ml ? roundToServing(ml, serving) : 0,
    message, nextCheckMinutes: nxt,
  });

  if (nowHour < wake || nowHour >= bed || (state.dndUntil && nowMs < state.dndUntil)) {
    const minsToWake = (((wake - nowHour) % 24) + 24) % 24 * 60;
    return out(false, 'none', 0, 'Quiet hours — no nudges.', Math.max(30, minsToWake));
  }
  if (state.lastNudgeAt && nowMs - state.lastNudgeAt < HYDRATION.MIN_NUDGE_GAP_MIN * 60000) {
    return out(false, 'none', 0, 'Recently nudged.',
      HYDRATION.MIN_NUDGE_GAP_MIN - Math.trunc((nowMs - state.lastNudgeAt) / 60000));
  }
  if (state.lastDrinkAt && nowMs - state.lastDrinkAt < HYDRATION.JUST_DRANK_MIN * 60000) {
    return out(false, 'none', 0, 'Just had a drink.', HYDRATION.JUST_DRANK_MIN);
  }

  const owed = state.recentActivityMl ?? 0;
  if (state.recentActivityEndedAt &&
      nowMs - state.recentActivityEndedAt < HYDRATION.POST_ACTIVITY_WINDOW_MIN * 60000 && owed > 0) {
    return out(true, 'postActivity', Math.min(owed, HYDRATION.ACT_CAP_PER_NUDGE),
      'Nice workout — replace what you sweated.', 30);
  }

  const hot = (state.currentTempC ?? 0) >= HYDRATION.HEAT_SPIKE_TEMP_C;
  const threshold = hot ? 0.5 * serving : serving;
  const nextCheck = hot ? 45 : 90;

  const span = Math.max(1, bedCutoff - wake);
  const frac = clamp((nowHour - wake) / span, 0, 1);
  const deficit = target * frac - logged;

  if (deficit >= threshold) {
    const msg = hot ? "Hot out — sip more, you're a bit behind." : "You're a bit behind on water — have a glass.";
    return out(true, 'behindPace', deficit, msg, nextCheck);
  }
  if (state.lastDrinkAt && nowMs - state.lastDrinkAt >= HYDRATION.GENTLE_GAP_MIN * 60000 && frac < 1.0) {
    return out(true, 'gentlePacing', serving, "It's been a while — quick sip?", nextCheck);
  }
  return out(false, 'none', 0, 'On track.', 60);
}
