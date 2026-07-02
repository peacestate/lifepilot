/**
 * hydrationStore — local-only persistence for intake log + profile (contract §6/§10).
 *
 * v1 is in-memory with a clear seam to back it with an ENCRYPTED on-device store
 * (expo-secure-store for keys + encrypted SQLite/MMKV for the log). NEVER synced,
 * NEVER networked. Today's log resets at the local day boundary.
 */

import type { HydrationProfile, IntakeEntry } from './types';

const DEFAULT_PROFILE: HydrationProfile = {
  bodyMassKg: 70,
  units: 'ml',
  wakeHour: 7,
  bedHour: 23,
  weatherMode: 'offline', // privacy by default (contract §12)
};

let profile: HydrationProfile = { ...DEFAULT_PROFILE };
let today: IntakeEntry[] = [];
let todayKey = dayKey(Date.now());

function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function rollDayIfNeeded(nowMs: number) {
  const k = dayKey(nowMs);
  if (k !== todayKey) {
    todayKey = k;
    today = [];
  }
}

export const hydrationStore = {
  getProfile(): HydrationProfile {
    return profile;
  },
  setProfile(patch: Partial<HydrationProfile>) {
    profile = { ...profile, ...patch };
    // TODO(native): persist to encrypted store.
    return profile;
  },

  getToday(nowMs = Date.now()): IntakeEntry[] {
    rollDayIfNeeded(nowMs);
    return today;
  },
  loggedMl(nowMs = Date.now()): number {
    rollDayIfNeeded(nowMs);
    return today.reduce((s, e) => s + e.ml, 0);
  },
  addIntake(ml: number, nowMs = Date.now()): IntakeEntry {
    rollDayIfNeeded(nowMs);
    const entry: IntakeEntry = { id: `${nowMs}-${Math.random().toString(36).slice(2, 7)}`, ml, at: nowMs };
    today = [...today, entry];
    return entry;
  },
  removeIntake(id: string) {
    today = today.filter((e) => e.id !== id);
  },
  lastDrinkAt(): number | undefined {
    return today.length ? today[today.length - 1].at : undefined;
  },
};
