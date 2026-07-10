/**
 * energyCalibration — on-device personalization layer for the Energy Predictor
 * (model contract §5: docs/energy-predictor-model-contract.md).
 *
 * WHY NOT ON-DEVICE TRAINING: researched against the pinned stack (ExecuTorch v0.6.0 /
 * react-native-executorch 0.4.10) before writing this file.
 *   - ExecuTorch's own training extension (extension/training) exists at v0.6.0 but its
 *     docs describe it as "experimental and under heavy active development... may not
 *     work out of the box or at all". It's C++/CMake-oriented, has no native weight
 *     serialization mechanism, and backend/delegate integration is "still a work in
 *     progress". No mobile/React Native surface at all.
 *   - react-native-executorch (the library this app actually calls — see energyModel.ts)
 *     exposes only an inference API (loadModule/forward-style calls). No gradient,
 *     optimizer, or checkpoint APIs are exposed at the pinned version.
 *   => Real on-device backprop is not practically supported on this stack today. Forcing
 *      it would mean either (a) shipping something unstable/unsupported, or (b) exporting
 *      user data off-device for server-side fine-tuning — a hard no under the privacy
 *      golden rule. So: the honest alternative is a deterministic, on-device, closed-form
 *      calibration layer — plain arithmetic over the user's own history, computed in TS,
 *      applied on top of the frozen base .pte's output. No user data ever leaves the
 *      device; nothing here is networked.
 *
 * This module owns:
 *   1. Persisting today's model input/output alongside the day's real observed features
 *      (via personalHistory) — the "real data collection" the base model itself doesn't
 *      get to train on, but which THIS layer (and any future manual GPU retrain using
 *      only aggregated/anonymized summaries, never raw personalHistory) can use.
 *   2. A light "how's your energy right now?" check-in (contract §5.1) and the EMA
 *      level-bias derived from check-ins vs. what the model predicted for that hour.
 *
 * Phase 2 (contract §5.2, per-hour residual vector) is intentionally NOT implemented yet
 * — noted as future work in the contract; level-bias alone gets most of the benefit with
 * a much simpler, more auditable state (a single float).
 */
import { personalHistory } from '../../core/rag/personalHistory';

export type EnergyCheckIn = { hour: number; actual: number; at: number };

/** The 3-field manual fallback (sleep time, wake time, rough steps) — see manualDayEntry.ts. */
export type ManualDayFeatures = {
  sleepDurationH: number;
  sleepMidpointH: number;
  wakeTimeH: number;
  stepsK: number;
};

export type EnergyDayRecord = {
  dayFeatures?: Record<string, unknown>;
  predictedCurve?: number[];
  basis?: 'model' | 'heuristic';
  generatedAt?: number;
  checkIns?: EnergyCheckIn[];
  /** Present when this day's features came from the manual-entry fallback, not Health Connect. */
  manualEntry?: ManualDayFeatures;
  /** UI context only (step 7/8) — never a model input; see healthFeatureBuilder.ts's header. */
  restingHeartRate?: number;
};

export type Calibration = { bias: number; count: number };

const BIAS_ALPHA = 0.1;          // EMA weight — matches contract §5.1's α≈0.1
const DEFAULT_LOOKBACK_DAYS = 30; // personalHistory keeps up to 90 days; 30 is plenty for an EMA

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Merge-save today's model input/output onto the day's `energy` history entry, keeping
 * any check-ins already recorded today (personalHistory.saveToday upserts the WHOLE data
 * object per day, so we read-merge-write rather than clobbering `checkIns`).
 */
export async function saveDayRecord(partial: Omit<EnergyDayRecord, 'checkIns'>): Promise<void> {
  const today = await personalHistory.getDay('energy', todayKey());
  const existing = (today?.data as EnergyDayRecord | undefined) ?? {};
  await personalHistory.saveToday('energy', { ...existing, ...partial });
}

/** Record a 1-tap "how's your energy right now?" check-in (0..100) for today. Local only. */
export async function recordCheckIn(actual: number, hour = new Date().getHours()): Promise<void> {
  const today = await personalHistory.getDay('energy', todayKey());
  const existing = (today?.data as EnergyDayRecord | undefined) ?? {};
  const checkIns = [
    ...(existing.checkIns ?? []),
    { hour, actual: Math.max(0, Math.min(100, Math.round(actual))), at: Date.now() },
  ];
  await personalHistory.saveToday('energy', { ...existing, checkIns });
}

/**
 * Compute a single EMA level-bias from up to `lookbackDays` of check-ins vs. what the
 * model predicted for that same hour on that same day. `count` = 0 means no signal yet
 * (personalized stays false; caller should not apply/claim personalization).
 */
export async function computeCalibration(lookbackDays = DEFAULT_LOOKBACK_DAYS): Promise<Calibration> {
  const entries = await personalHistory.getRecent('energy', lookbackDays);
  let bias = 0;
  let count = 0;
  // personalHistory.getRecent returns newest-first; walk oldest→newest so the EMA
  // actually weighs the most recent check-ins most heavily.
  const chronological = [...entries].reverse();
  for (const e of chronological) {
    const rec = e.data as EnergyDayRecord;
    if (!rec.predictedCurve || !rec.checkIns?.length) continue;
    for (const ci of rec.checkIns) {
      const predicted = rec.predictedCurve[ci.hour];
      if (predicted == null) continue;
      const gap = ci.actual - predicted;
      bias = bias + BIAS_ALPHA * (gap - bias); // standard EMA of the residual
      count += 1;
    }
  }
  return { bias, count };
}

/** Apply the level-bias to a curve, clamped to [0,100]. No-op (returns curve unchanged) if no signal yet. */
export function applyCalibration(curve: number[], calibration: Calibration): number[] {
  if (!calibration.count) return curve;
  return curve.map((v) => Math.max(0, Math.min(100, Math.round(v + calibration.bias))));
}

/* ── Monday weekly health insight (contract step 8) — pure on-device arithmetic ─────────
 * over already-stored day records, no model involved. */

export type WeeklyHealthInsight = {
  avgSleepH?: number;
  avgSteps?: number;
  restingHRTrend?: 'improving' | 'worsening' | 'steady';
  restingHRDeltaBpm?: number;
  bestEnergyDayLabel?: string;
  worstEnergyDayLabel?: string;
  /** e.g. 23 → "energy is 23% higher on days you sleep 7+ hours". Undefined if either
   * bucket (7h+ vs under 7h) has no days this week to compare. */
  sleepEnergyUpliftPct?: number;
};

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SLEEP_TARGET_H = 7.5;
const GOOD_SLEEP_THRESHOLD_H = 7;

function weekdayOf(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

/** A day's average energy — from real check-ins if logged, else the predicted curve's
 * own average. Exported so lifeEngine.ts can join this against other features' history
 * without duplicating the same small piece of logic. */
export function dayEnergyAvg(rec: EnergyDayRecord): number | undefined {
  if (rec.checkIns?.length) return rec.checkIns.reduce((s, c) => s + c.actual, 0) / rec.checkIns.length;
  if (rec.predictedCurve?.length) return rec.predictedCurve.reduce((a, b) => a + b, 0) / rec.predictedCurve.length;
  return undefined;
}

function avg(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Last 7 COMPLETED days (today excluded — its data is still accumulating). Undefined
 * below a 3-day minimum so the card doesn't overclaim on a tiny sample. */
export async function computeWeeklyHealthInsight(): Promise<WeeklyHealthInsight | undefined> {
  const entries = await personalHistory.getRecent('energy', 15); // headroom for the prior-week HR comparison
  const today = todayKey();
  const completed = entries.filter((e) => e.date !== today);
  const lastWeek = completed.slice(0, 7);
  if (lastWeek.length < 3) return undefined;

  const sleepHs: number[] = [];
  const stepsAll: number[] = [];
  const energyByDay: Array<{ date: string; energy: number }> = [];
  const sleep7pEnergy: number[] = [];
  const sleepUnder7Energy: number[] = [];

  for (const e of lastWeek) {
    const rec = e.data as EnergyDayRecord;
    const feat = rec.dayFeatures as Record<string, unknown> | undefined;
    const sleepH = typeof feat?.sleepDurationH === 'number' ? feat.sleepDurationH : undefined;
    const stepsK = typeof feat?.stepsK === 'number' ? feat.stepsK : undefined;
    if (sleepH != null) sleepHs.push(sleepH);
    if (stepsK != null) stepsAll.push(stepsK * 1000);

    const energy = dayEnergyAvg(rec);
    if (energy != null) {
      energyByDay.push({ date: e.date, energy });
      if (sleepH != null) (sleepH >= GOOD_SLEEP_THRESHOLD_H ? sleep7pEnergy : sleepUnder7Energy).push(energy);
    }
  }

  if (!sleepHs.length && !stepsAll.length && !energyByDay.length) return undefined;

  let bestEnergyDayLabel: string | undefined;
  let worstEnergyDayLabel: string | undefined;
  if (energyByDay.length) {
    const best = energyByDay.reduce((a, b) => (b.energy > a.energy ? b : a));
    const worst = energyByDay.reduce((a, b) => (b.energy < a.energy ? b : a));
    bestEnergyDayLabel = WEEKDAY_NAMES[weekdayOf(best.date)];
    worstEnergyDayLabel = WEEKDAY_NAMES[weekdayOf(worst.date)];
  }

  let sleepEnergyUpliftPct: number | undefined;
  if (sleep7pEnergy.length && sleepUnder7Energy.length) {
    const withGoodSleep = avg(sleep7pEnergy);
    const withoutGoodSleep = avg(sleepUnder7Energy);
    if (withoutGoodSleep > 0) {
      sleepEnergyUpliftPct = Math.round(((withGoodSleep - withoutGoodSleep) / withoutGoodSleep) * 100);
    }
  }

  // Resting HR trend: this week's avg vs the PRIOR 7 completed days (days 8-14 back).
  const priorWeek = completed.slice(7, 14);
  const thisWeekHR = lastWeek.map((e) => (e.data as EnergyDayRecord).restingHeartRate).filter((x): x is number => x != null);
  const priorWeekHR = priorWeek.map((e) => (e.data as EnergyDayRecord).restingHeartRate).filter((x): x is number => x != null);
  let restingHRTrend: WeeklyHealthInsight['restingHRTrend'];
  let restingHRDeltaBpm: number | undefined;
  if (thisWeekHR.length && priorWeekHR.length) {
    const delta = Math.round(avg(thisWeekHR) - avg(priorWeekHR));
    restingHRDeltaBpm = delta;
    restingHRTrend = delta <= -1 ? 'improving' : delta >= 1 ? 'worsening' : 'steady';
  }

  return {
    avgSleepH: sleepHs.length ? Number(avg(sleepHs).toFixed(1)) : undefined,
    avgSteps: stepsAll.length ? Math.round(avg(stepsAll)) : undefined,
    restingHRTrend,
    restingHRDeltaBpm,
    bestEnergyDayLabel,
    worstEnergyDayLabel,
    sleepEnergyUpliftPct,
  };
}

export const ENERGY_SLEEP_TARGET_H = SLEEP_TARGET_H;
