/**
 * expenseCategorizor — per-merchant category personalization (OCR expense spec, step 6).
 *
 * Tracks how the user *corrects* the category the parser/model suggested. Once the same
 * merchant has been corrected to the same category 3 times in a row, that mapping is
 * locked in: future scans of that merchant auto-assign the learned category, confidently
 * (no review flag), without re-asking.
 *
 * v1 in-memory, same seam as expenseStore — local-only, never networked.
 */

const LOCK_THRESHOLD = 3;

type PendingCorrection = { category: string; count: number };

let locked: Record<string, string> = {};
let pending: Record<string, PendingCorrection> = {};

function normalize(merchant: string): string {
  return merchant.trim().toLowerCase();
}

export const expenseCategorizor = {
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
      delete pending[key]; // user agreed — don't let stale corrections linger
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
  },

  /** All locked-in merchant -> category mappings, e.g. for a settings/debug view. */
  all(): Record<string, string> {
    return { ...locked };
  },

  reset(): void {
    locked = {};
    pending = {};
  },
};
