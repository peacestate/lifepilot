/**
 * overwhelmInsights — the Monday "last week" summary card. Pure on-device arithmetic
 * over overwhelmMemory entries — no model, no LLM call, just aggregation.
 *
 * NO React, NO network — pure functions (same isolation style as OverwhelmService.ts),
 * so this is unit-testable without mounting anything.
 */
import type { MemoryEntry } from './overwhelmMemory';

export type WeeklyInsight = {
  tasksBrokenDown: number;
  mostProductiveDay: string | null; // weekday name with the most completed steps, or null if no data
  topCategory: string | null;
  avgSteps: number;                 // rounded to 1 decimal
  completionPct: number;            // 0..100, rounded
};

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The 7 calendar days immediately before `now` (i.e. "last week" as of a Monday check-in). */
function lastWeekRange(now: Date): Set<string> {
  const days = new Set<string>();
  for (let i = 1; i <= 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    days.add(dateKey(d));
  }
  return days;
}

/** Only show the card on Mondays (the spec's own cadence — a weekly ritual, not a live-updating widget). */
export function shouldShowWeeklyCard(now = new Date()): boolean {
  return now.getDay() === 1;
}

export function computeWeeklyInsight(entries: readonly MemoryEntry[], now = new Date()): WeeklyInsight | null {
  const window = lastWeekRange(now);
  const lastWeek = entries.filter((e) => window.has(e.date));
  if (!lastWeek.length) return null;

  const stepsByDay = new Map<string, number>(); // date -> completedSteps that day
  const categoryCounts: Record<string, number> = {};
  let totalSteps = 0;
  let totalCompleted = 0;

  for (const e of lastWeek) {
    stepsByDay.set(e.date, (stepsByDay.get(e.date) ?? 0) + e.completedSteps);
    categoryCounts[e.category] = (categoryCounts[e.category] ?? 0) + 1;
    totalSteps += e.totalSteps;
    totalCompleted += e.completedSteps;
  }

  let mostProductiveDay: string | null = null;
  let bestCount = 0;
  for (const [date, count] of stepsByDay) {
    if (count > bestCount) {
      bestCount = count;
      mostProductiveDay = WEEKDAY_NAMES[new Date(`${date}T00:00:00`).getDay()];
    }
  }

  let topCategory: string | null = null;
  let bestCatCount = 0;
  for (const [cat, count] of Object.entries(categoryCounts)) {
    if (count > bestCatCount) {
      bestCatCount = count;
      topCategory = cat;
    }
  }

  return {
    tasksBrokenDown: lastWeek.length,
    mostProductiveDay,
    topCategory,
    avgSteps: Math.round((totalSteps / lastWeek.length) * 10) / 10,
    completionPct: totalSteps > 0 ? Math.round((totalCompleted / totalSteps) * 100) : 0,
  };
}
