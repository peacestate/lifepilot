/**
 * manualDayEntry — the 3-input fallback ("what time did you sleep? what time did you wake
 * up? how many steps roughly today?"). Converts those 3 answers into the same DayFeatures
 * shape Health Connect would produce, stored in the same per-day personalHistory bucket
 * energyCalibration.ts already owns — so the model can't tell (and doesn't need to know)
 * whether a given day's data came from Health Connect or manual entry.
 *
 * Shown when Health Connect has no data for the window, or when the user opts to log
 * manually even though Health Connect is working (e.g. to patch a day it missed).
 *
 * PRIVACY: local personalHistory store only. Never networked.
 */
import { personalHistory } from '../../core/rag/personalHistory';
import type { EnergyDayRecord, ManualDayFeatures } from './energyCalibration';

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** hh:mm (24h) → hour-of-day as a float, e.g. "23:30" → 23.5, "07:15" → 7.25. */
export function timeStringToHour(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h % 24) + (m ?? 0) / 60;
}

/** Build the manual DayFeatures from the 3 raw answers. sleepTime/wakeTime are 0..23.99 local hours. */
export function buildManualEntry(sleepTimeH: number, wakeTimeH: number, steps: number): ManualDayFeatures {
  // sleep usually crosses midnight (e.g. 23:00 → 07:00); if wake < sleep, it's the next day.
  const durationH = wakeTimeH >= sleepTimeH ? wakeTimeH - sleepTimeH : 24 - sleepTimeH + wakeTimeH;
  const midpointRaw = sleepTimeH + durationH / 2;
  return {
    sleepDurationH: Math.max(0, Math.min(16, durationH)),
    sleepMidpointH: midpointRaw % 24,
    wakeTimeH,
    stepsK: Math.max(0, steps) / 1000,
  };
}

/** Save today's manual entry, merging with whatever else (check-ins, predicted curve) is already stored today. */
export async function saveManualEntry(entry: ManualDayFeatures): Promise<void> {
  const today = await personalHistory.getDay('energy', todayKey());
  const existing = (today?.data as EnergyDayRecord | undefined) ?? {};
  await personalHistory.saveToday('energy', { ...existing, manualEntry: entry });
}

/** Recent days (newest first) that have a manual entry, for merging into the model's 7-day window. */
export async function getRecentManualEntries(
  lookbackDays = 7,
): Promise<Array<{ date: string; entry: ManualDayFeatures }>> {
  const entries = await personalHistory.getRecent('energy', lookbackDays);
  const out: Array<{ date: string; entry: ManualDayFeatures }> = [];
  for (const e of entries) {
    const rec = e.data as EnergyDayRecord;
    if (rec.manualEntry) out.push({ date: e.date, entry: rec.manualEntry });
  }
  return out;
}
