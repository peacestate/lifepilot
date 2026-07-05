/**
 * expenseInsights — monthly/weekly spending math, entirely local (OCR expense spec, step 7).
 * Pure functions over ExpenseRecord[]; no AI, no network — just arithmetic over what's
 * already stored on-device.
 */
import type { ExpenseRecord } from './types';

export type CategoryBreakdown = { category: string; amount: number; pct: number };
export type CategorySpike = { category: string; pctIncrease: number };

export type MonthlySummary = {
  monthLabel: string;
  totalThisMonth: number;
  byCategory: CategoryBreakdown[];
  topCategory: string | null;
  totalLastMonth: number;
  deltaVsLastMonth: number;
  deltaPct: number | null;
  categorySpikes: CategorySpike[];
  projectedTotal: number;
  usualMonthlyAverage: number;
};

const SPIKE_THRESHOLD_PCT = 30;
const LOOKBACK_MONTHS = 3;

const round2 = (x: number) => Math.round(x * 100) / 100;

function recordDate(r: ExpenseRecord): Date {
  return new Date(r.dateISO ?? r.createdAt);
}

function monthStart(nowMs: number, monthsAgo: number): Date {
  const d = new Date(nowMs);
  return new Date(d.getFullYear(), d.getMonth() - monthsAgo, 1);
}

function inMonth(r: ExpenseRecord, start: Date): boolean {
  const d = recordDate(r);
  return d.getFullYear() === start.getFullYear() && d.getMonth() === start.getMonth();
}

function totalInMonth(records: ExpenseRecord[], start: Date): number {
  return records.filter((r) => inMonth(r, start)).reduce((s, r) => s + r.amount, 0);
}

/** This month's total, category breakdown, trend vs last month, spikes, and a projection. */
export function buildMonthlySummary(records: ExpenseRecord[], nowMs: number = Date.now()): MonthlySummary {
  const thisMonthStart = monthStart(nowMs, 0);
  const thisMonthRecords = records.filter((r) => inMonth(r, thisMonthStart));

  const totalThisMonth = round2(thisMonthRecords.reduce((s, r) => s + r.amount, 0));
  const totalLastMonth = round2(totalInMonth(records, monthStart(nowMs, 1)));

  const byCategoryMap: Record<string, number> = {};
  for (const r of thisMonthRecords) byCategoryMap[r.category] = (byCategoryMap[r.category] ?? 0) + r.amount;
  const byCategory: CategoryBreakdown[] = Object.entries(byCategoryMap)
    .map(([category, amount]) => ({
      category,
      amount: round2(amount),
      pct: totalThisMonth > 0 ? Math.round((amount / totalThisMonth) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
  const topCategory = byCategory[0]?.category ?? null;

  const deltaVsLastMonth = round2(totalThisMonth - totalLastMonth);
  const deltaPct = totalLastMonth > 0 ? Math.round((deltaVsLastMonth / totalLastMonth) * 100) : null;

  const dayOfMonth = new Date(nowMs).getDate();
  const daysInThisMonth = new Date(thisMonthStart.getFullYear(), thisMonthStart.getMonth() + 1, 0).getDate();
  const elapsedFrac = dayOfMonth / daysInThisMonth;

  const categorySpikes: CategorySpike[] = [];
  for (const category of Object.keys(byCategoryMap)) {
    const thisAmt = byCategoryMap[category];
    const priorAmounts: number[] = [];
    for (let m = 1; m <= LOOKBACK_MONTHS; m++) {
      const start = monthStart(nowMs, m);
      priorAmounts.push(
        records.filter((r) => inMonth(r, start) && r.category === category).reduce((s, r) => s + r.amount, 0),
      );
    }
    const avgPrior = priorAmounts.reduce((a, b) => a + b, 0) / priorAmounts.length;
    if (avgPrior <= 0) continue;
    const proratedAvg = avgPrior * elapsedFrac; // compare at the same point-in-month
    if (proratedAvg <= 0) continue;
    const pctIncrease = ((thisAmt - proratedAvg) / proratedAvg) * 100;
    if (pctIncrease >= SPIKE_THRESHOLD_PCT) categorySpikes.push({ category, pctIncrease: Math.round(pctIncrease) });
  }
  categorySpikes.sort((a, b) => b.pctIncrease - a.pctIncrease);

  const projectedTotal = round2(dayOfMonth > 0 ? (totalThisMonth / dayOfMonth) * daysInThisMonth : 0);

  const priorTotals: number[] = [];
  for (let m = 1; m <= LOOKBACK_MONTHS; m++) priorTotals.push(totalInMonth(records, monthStart(nowMs, m)));
  const usualMonthlyAverage = round2(priorTotals.reduce((a, b) => a + b, 0) / priorTotals.length);

  return {
    monthLabel: thisMonthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    totalThisMonth,
    byCategory,
    topCategory,
    totalLastMonth,
    deltaVsLastMonth,
    deltaPct,
    categorySpikes,
    projectedTotal,
    usualMonthlyAverage,
  };
}

/** Total spent in a given calendar month, `monthsAgo` months back from nowMs (0 = current month). */
export function monthTotal(records: ExpenseRecord[], nowMs: number, monthsAgo: number): number {
  return round2(totalInMonth(records, monthStart(nowMs, monthsAgo)));
}

/** Total spent in the trailing 7 days ending at nowMs. */
export function weekTotal(records: ExpenseRecord[], nowMs: number, weeksAgo = 0): number {
  const end = nowMs - weeksAgo * 7 * 24 * 60 * 60 * 1000;
  const start = end - 7 * 24 * 60 * 60 * 1000;
  return round2(
    records
      .filter((r) => {
        const t = recordDate(r).getTime();
        return t > start && t <= end;
      })
      .reduce((s, r) => s + r.amount, 0),
  );
}

/**
 * How many consecutive prior full calendar months each spent less than the one before it
 * (a "saving streak"), counted backwards from last month. 0 if last month wasn't a decrease.
 */
export function savingsStreak(records: ExpenseRecord[], nowMs: number = Date.now()): number {
  let streak = 0;
  for (let m = 1; ; m++) {
    const current = totalInMonth(records, monthStart(nowMs, m));
    const previous = totalInMonth(records, monthStart(nowMs, m + 1));
    if (previous > 0 && current < previous) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}
