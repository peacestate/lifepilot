/**
 * hydrationStore — local-only persistence for intake log + profile (contract §6/§10),
 * backed by an on-device JSON file (core/storage/jsonFileStore — sandboxed
 * documentDirectory, same substrate as personalHistory). NEVER synced, NEVER
 * networked. Today's log resets at the local day boundary; the profile (body mass,
 * wake/bed hours, weather mode) survives restarts.
 *
 * Sync API over in-memory state; the disk copy loads once via `ready()` (kicked off
 * at import) and every mutation writes through. useHydrationTracker re-reads after
 * `await hydrationStore.ready()` so the UI reflects the loaded state.
 */
import { createJsonFileStore } from '../../core/storage/jsonFileStore';
import type { HydrationProfile, IntakeEntry } from './types';

const DEFAULT_PROFILE: HydrationProfile = {
  bodyMassKg: 70,
  units: 'ml',
  wakeHour: 7,
  bedHour: 23,
  weatherMode: 'offline', // privacy by default (contract §12)
  profileComplete: false, // first open of Hydration prompts the profile modal
};

let profile: HydrationProfile = { ...DEFAULT_PROFILE };
let today: IntakeEntry[] = [];
let todayKey = dayKey(Date.now());

type Persisted = { profile: HydrationProfile; todayKey: string; today: IntakeEntry[] };

const disk = createJsonFileStore<Persisted>('lp_hydration.json', (loaded) => {
  profile = { ...DEFAULT_PROFILE, ...(loaded.profile ?? {}) };
  // Only restore the intake log if it belongs to the current local day; merge-by-id
  // so a drink logged before the load resolved isn't lost.
  if (loaded.todayKey === todayKey && Array.isArray(loaded.today)) {
    const have = new Set(today.map((e) => e.id));
    today = [...loaded.today.filter((e) => !have.has(e.id)), ...today].sort((a, b) => a.at - b.at);
  }
});
void disk.ready();

const persist = () => disk.save({ profile, todayKey, today });

function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function rollDayIfNeeded(nowMs: number) {
  const k = dayKey(nowMs);
  if (k !== todayKey) {
    todayKey = k;
    today = [];
    persist();
  }
}

export const hydrationStore = {
  /** Resolves once profile + today's log have loaded from disk (call before first render). */
  ready(): Promise<void> {
    return disk.ready();
  },
  /** Awaits pending write-through (tests). */
  flush(): Promise<void> {
    return disk.flush();
  },
  getProfile(): HydrationProfile {
    return profile;
  },
  setProfile(patch: Partial<HydrationProfile>) {
    profile = { ...profile, ...patch };
    persist();
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
    persist();
    return entry;
  },
  removeIntake(id: string) {
    today = today.filter((e) => e.id !== id);
    persist();
  },
  lastDrinkAt(): number | undefined {
    return today.length ? today[today.length - 1].at : undefined;
  },
};
