/**
 * hydrationCalibration — on-device personalization layer for Hydration (mirrors
 * energyCalibration.ts's pattern/reasoning: the .pte is a frozen population-level model,
 * never retrained on-device — see that file for why real on-device backprop isn't
 * practical on this stack). The only per-user "learning" here is a deterministic EMA
 * bias computed from the user's own logged intake vs. what was predicted for them,
 * applied on top of the model/engine output. Nothing here is networked.
 *
 * Storage: reuses the existing personalHistory store (feature: 'hydration') rather than
 * a bespoke local-storage module — same 30-day on-device history Energy already uses.
 */
import { HYDRATION } from './HydrationEngine';
import { personalHistory } from '../../core/rag/personalHistory';

export type HydrationDayRecord = {
  targetMl: number;
  actualMl: number;
  difference: number; // actualMl - targetMl (negative = drank less than predicted)
  generatedAt: number;
};

export type Calibration = { bias: number; count: number };

export type WeeklyInsight = {
  daysHit: number;
  daysTotal: number;
  avgActualMl: number;
  avgTargetMl: number;
  bestDayLabel: string;
  worstDayLabel: string;
};

const BIAS_SMOOTHING = 0.2;      // EMA weight (CEO spec — steeper than Energy's 0.1 since
                                  // a day's total intake is a noisier, coarser signal than
                                  // an hourly check-in, so lean more on recent days).
const MIN_DAYS_FOR_BIAS = 3;     // "after user has 3+ days of history"
const DEFAULT_LOOKBACK_DAYS = 30;
const WEEKDAY_NAMES = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function weekdayOf(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

/**
 * Upsert today's target-vs-actual onto today's history entry. Call this every time the
 * target is (re)computed AND every time the user logs an intake, so `actualMl` always
 * reflects the running total for the day (personalHistory.saveToday overwrites today's
 * entry, it doesn't append).
 */
export async function saveDayRecord(targetMl: number, actualMl: number): Promise<void> {
  const record: HydrationDayRecord = {
    targetMl: Math.round(targetMl),
    actualMl: Math.round(actualMl),
    difference: Math.round(actualMl - targetMl),
    generatedAt: Date.now(),
  };
  await personalHistory.saveToday('hydration', record as unknown as Record<string, unknown>);
}

/**
 * EMA bias from up to `lookbackDays` of COMPLETED days (today is deliberately excluded —
 * its `actualMl` is still accumulating, so including it would make the bias swing
 * wildly toward "way behind" every morning and feed back into that same day's own
 * target). `count` = 0/1/2 means not enough signal yet (caller must not apply/claim
 * personalization below MIN_DAYS_FOR_BIAS).
 */
export async function computeCalibration(lookbackDays = DEFAULT_LOOKBACK_DAYS): Promise<Calibration> {
  const entries = await personalHistory.getRecent('hydration', lookbackDays + 1);
  const today = todayKey();
  const completed = entries.filter((e) => e.date !== today);
  // oldest → newest so the EMA weighs the most recent completed day most heavily
  const chronological = [...completed].reverse();

  let bias = 0;
  let count = 0;
  for (const e of chronological) {
    const rec = e.data as HydrationDayRecord;
    if (rec?.difference == null) continue;
    bias = BIAS_SMOOTHING * rec.difference + (1 - BIAS_SMOOTHING) * bias;
    count += 1;
  }
  return { bias, count };
}

/** Apply the bias to a raw target, clamped to the same safety range as the model/engine. */
export function applyCalibration(rawTargetMl: number, calibration: Calibration): number {
  if (calibration.count < MIN_DAYS_FOR_BIAS) return rawTargetMl;
  return clamp(Math.round(rawTargetMl + calibration.bias), HYDRATION.FLOOR, HYDRATION.CEILING);
}

/**
 * Last 7 COMPLETED days (today excluded, same reasoning as computeCalibration) → the
 * Monday weekly-insight card. Pure on-device arithmetic, no model involved. Returns
 * undefined below a 3-day minimum so the card doesn't overclaim on a tiny sample.
 */
export async function computeWeeklyInsight(): Promise<WeeklyInsight | undefined> {
  const entries = await personalHistory.getRecent('hydration', 8);
  const today = todayKey();
  const usable = entries
    .filter((e) => e.date !== today)
    .slice(0, 7)
    .filter((e) => {
      const rec = e.data as HydrationDayRecord;
      return rec?.actualMl != null && rec?.targetMl != null;
    });

  if (usable.length < 3) return undefined;

  const recOf = (e: (typeof usable)[number]) => e.data as HydrationDayRecord;
  const daysHit = usable.filter((e) => recOf(e).actualMl >= recOf(e).targetMl).length;
  const avgActualMl = Math.round(usable.reduce((s, e) => s + recOf(e).actualMl, 0) / usable.length);
  const avgTargetMl = Math.round(usable.reduce((s, e) => s + recOf(e).targetMl, 0) / usable.length);

  let best = usable[0];
  let worst = usable[0];
  for (const e of usable) {
    if (recOf(e).actualMl > recOf(best).actualMl) best = e;
    if (recOf(e).actualMl < recOf(worst).actualMl) worst = e;
  }

  return {
    daysHit,
    daysTotal: usable.length,
    avgActualMl,
    avgTargetMl,
    bestDayLabel: WEEKDAY_NAMES[weekdayOf(best.date)],
    worstDayLabel: WEEKDAY_NAMES[weekdayOf(worst.date)],
  };
}
