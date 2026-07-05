/**
 * expenseReminder — smart spending nudges (OCR expense spec, step 8). Pure functions over
 * local records only, same "no hidden timer state" spirit as hydrationReminder — the
 * caller (useExpenseScanner / ExpenseScreen) decides when to re-evaluate and dedup per day.
 */
import { buildMonthlySummary, monthTotal, savingsStreak, weekTotal } from './expenseInsights';
import type { ExpenseRecord } from './types';

export type NudgeKind = 'bigPurchase' | 'weeklySummary' | 'categorySpike' | 'monthEnd' | 'savingsStreak';
export type Nudge = { kind: NudgeKind; message: string };

const fmt = (n: number) => `$${Math.abs(n).toFixed(2)}`;

/** Fires right after a save if it's the biggest single expense in the trailing 7 days. */
export function afterPurchaseNudge(records: ExpenseRecord[], justSaved: ExpenseRecord): Nudge | null {
  if (justSaved.amount <= 0) return null;
  const weekAgo = new Date(justSaved.createdAt).getTime() - 7 * 24 * 60 * 60 * 1000;
  const otherThisWeek = records.filter(
    (r) => r.id !== justSaved.id && new Date(r.createdAt).getTime() >= weekAgo,
  );
  const maxOther = otherThisWeek.reduce((m, r) => Math.max(m, r.amount), 0);
  if (justSaved.amount <= maxOther) return null;
  return {
    kind: 'bigPurchase',
    message: `You just logged ${fmt(justSaved.amount)} at ${justSaved.merchant} — that's your biggest single expense this week.`,
  };
}

/** Sunday-evening weekly recap: this week's total vs last week's. Caller gates on day/hour + once-per-day dedup. */
export function weeklySummaryNudge(records: ExpenseRecord[], nowMs: number = Date.now()): Nudge | null {
  const thisWeek = weekTotal(records, nowMs, 0);
  if (thisWeek <= 0) return null;
  const lastWeek = weekTotal(records, nowMs, 1);
  const diff = thisWeek - lastWeek;
  const trend = diff > 0 ? ` — ${fmt(diff)} more than last week.` : diff < 0 ? ` — ${fmt(diff)} less than last week.` : '.';
  return { kind: 'weeklySummary', message: `You spent ${fmt(thisWeek)} this week${trend}` };
}

/** Highest category spike this month, if any exceeds the threshold in buildMonthlySummary. */
export function categorySpikeNudge(records: ExpenseRecord[], nowMs: number = Date.now()): Nudge | null {
  const summary = buildMonthlySummary(records, nowMs);
  const top = summary.categorySpikes[0];
  if (!top) return null;
  return {
    kind: 'categorySpike',
    message: `Your ${top.category} spending is ${top.pctIncrease}% higher than usual this month — want to see the breakdown?`,
  };
}

/** Last 5 days of the month: how much of the usual budget is left. */
export function monthEndNudge(records: ExpenseRecord[], nowMs: number = Date.now()): Nudge | null {
  const daysInMonth = new Date(new Date(nowMs).getFullYear(), new Date(nowMs).getMonth() + 1, 0).getDate();
  const daysLeft = daysInMonth - new Date(nowMs).getDate();
  if (daysLeft > 5) return null;
  const summary = buildMonthlySummary(records, nowMs);
  if (summary.usualMonthlyAverage <= 0) return null;
  const remaining = Math.max(0, summary.usualMonthlyAverage - summary.totalThisMonth);
  return {
    kind: 'monthEnd',
    message: `You have ${daysLeft} day${daysLeft === 1 ? '' : 's'} left this month and ${fmt(remaining)} of your usual budget remaining.`,
  };
}

/** Positive reinforcement when last month was a real decrease vs the month before it. */
export function savingsStreakNudge(records: ExpenseRecord[], nowMs: number = Date.now()): Nudge | null {
  const streak = savingsStreak(records, nowMs);
  if (streak <= 0) return null;
  const lastMonth = monthTotal(records, nowMs, 1);
  const twoMonthsAgo = monthTotal(records, nowMs, 2);
  const saved = twoMonthsAgo - lastMonth; // positive because savingsStreak() already confirmed lastMonth < twoMonthsAgo
  return {
    kind: 'savingsStreak',
    message: `Great month — you spent ${fmt(saved)} less than the month before. Saving streak: ${streak} month${streak === 1 ? '' : 's'}.`,
  };
}

/** One nudge to show on screen load, in priority order (most actionable first). */
export function periodicNudge(records: ExpenseRecord[], nowMs: number = Date.now()): Nudge | null {
  const isSundayEvening = new Date(nowMs).getDay() === 0 && new Date(nowMs).getHours() >= 18;
  if (isSundayEvening) {
    const weekly = weeklySummaryNudge(records, nowMs);
    if (weekly) return weekly;
  }
  return (
    categorySpikeNudge(records, nowMs) ??
    monthEndNudge(records, nowMs) ??
    savingsStreakNudge(records, nowMs)
  );
}
