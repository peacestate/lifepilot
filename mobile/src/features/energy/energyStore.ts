/**
 * energyStore — local-only persistence for daily context flags like "worked on laptop today".
 * Persisted to disk via jsonFileStore. Today's flag resets at the local day boundary.
 */
import { createJsonFileStore } from '../../core/storage/jsonFileStore';

type Persisted = {
  todayKey: string;
  laptopWorkDay: boolean;
};

let todayKey = dayKey(Date.now());
let laptopWorkDay = false;

const disk = createJsonFileStore<Persisted>('lp_energy.json', (loaded) => {
  // Only restore the flag if it belongs to the current local day
  if (loaded.todayKey === todayKey) {
    laptopWorkDay = loaded.laptopWorkDay ?? false;
  } else {
    laptopWorkDay = false;
  }
});
void disk.ready();

const persist = () => disk.save({ todayKey, laptopWorkDay });

function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function rollDayIfNeeded(nowMs: number) {
  const k = dayKey(nowMs);
  if (k !== todayKey) {
    todayKey = k;
    laptopWorkDay = false;
    persist();
  }
}

export const energyStore = {
  /** Resolves once the daily context flags have loaded from disk. */
  ready(): Promise<void> {
    return disk.ready();
  },
  /** Awaits pending write-through (tests). */
  flush(): Promise<void> {
    return disk.flush();
  },
  /** Whether the user indicated they spent most of today working on laptop/desk. */
  isLaptopWorkDay(nowMs = Date.now()): boolean {
    rollDayIfNeeded(nowMs);
    return laptopWorkDay;
  },
  /** User toggles the laptop-work flag. */
  setLaptopWorkDay(value: boolean, nowMs = Date.now()) {
    rollDayIfNeeded(nowMs);
    laptopWorkDay = value;
    persist();
  },
};
