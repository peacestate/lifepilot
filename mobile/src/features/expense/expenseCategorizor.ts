/**
 * expenseCategorizor — per-merchant category personalization (OCR expense spec, step 6).
 *
 * Tracks how the user *corrects* the category the parser/model suggested. Once the same
 * merchant has been corrected to the same category 3 times in a row, that mapping is
 * locked in: future scans of that merchant auto-assign the learned category, confidently
 * (no review flag), without re-asking.
 *
 * Persisted like expenseStore: on-device JSON file via core/storage/jsonFileStore
 * (sandboxed documentDirectory) — local-only, never networked. Loads once at import;
 * every learning update writes through, so what the user taught survives restarts.
 */
import { createJsonFileStore } from '../../core/storage/jsonFileStore';

const LOCK_THRESHOLD = 3;

type PendingCorrection = { category: string; count: number };

let locked: Record<string, string> = {};
let pending: Record<string, PendingCorrection> = {};

// In-memory (newer) learning wins over the loaded copy on the rare pre-load race.
const disk = createJsonFileStore<{ locked: Record<string, string>; pending: Record<string, PendingCorrection> }>(
  'lp_expense_categories.json',
  (loaded) => {
    locked = { ...(loaded.locked ?? {}), ...locked };
    pending = { ...(loaded.pending ?? {}), ...pending };
  },
);
void disk.ready();

const persist = () => disk.save({ locked, pending });

function normalize(merchant: string): string {
  return merchant.trim().toLowerCase();
}

export const expenseCategorizor = {
  /** Resolves once the learned mappings have loaded from disk. */
  ready(): Promise<void> {
    return disk.ready();
  },
  /** Awaits pending write-through (tests). */
  flush(): Promise<void> {
    return disk.flush();
  },
  /** Learned category for this merchant, or null if none is locked in yet. */
  suggest(merchant: string | null | undefined): string | null {
    if (!merchant) return null;
    return locked[normalize(merchant)] ?? null;
  },

  /**
   * Call on save with the category the parser/model originally suggested (before any
   * user edit) and the category the user actually confirmed. No-ops when they match —
   * only a real correction counts toward the lock.
   */
  recordCorrection(merchant: string | null | undefined, suggestedCategory: string | null, confirmedCategory: string): void {
    if (!merchant || !confirmedCategory) return;
    const key = normalize(merchant);
    if (locked[key] === confirmedCategory) return; // already learned, nothing new
    if (suggestedCategory === confirmedCategory) {
      if (key in pending) {
        delete pending[key]; // user agreed — don't let stale corrections linger
        persist();
      }
      return;
    }

    const prior = pending[key];
    if (prior && prior.category === confirmedCategory) {
      const count = prior.count + 1;
      if (count >= LOCK_THRESHOLD) {
        locked[key] = confirmedCategory;
        delete pending[key];
      } else {
        pending[key] = { category: confirmedCategory, count };
      }
    } else {
      pending[key] = { category: confirmedCategory, count: 1 };
    }
    persist();
  },

  /** All locked-in merchant -> category mappings, e.g. for a settings/debug view. */
  all(): Record<string, string> {
    return { ...locked };
  },

  reset(): void {
    locked = {};
    pending = {};
    persist();
  },
};
