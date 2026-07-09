/**
 * expenseStore — local-only expense records (contract §3), persisted to an on-device
 * JSON file (core/storage/jsonFileStore — sandboxed documentDirectory, same substrate
 * as personalHistory). Never synced, never networked. Keeps a rolling 365-day window
 * (step 4 of the OCR expense spec).
 *
 * Sync read/write API over in-memory state; the disk copy loads once via `ready()`
 * (kicked off at import) and every mutation writes through. Callers that render
 * records should re-read after `await expenseStore.ready()` (useExpenseScanner does).
 */
import { createJsonFileStore } from '../../core/storage/jsonFileStore';
import type { ExpenseRecord } from './types';

const RETENTION_DAYS = 365;

let records: ExpenseRecord[] = [];

// Merge-by-id so a mutation racing the initial load can't be lost: whatever was
// added in memory before the disk read resolved survives alongside the loaded rows.
const disk = createJsonFileStore<{ records: ExpenseRecord[] }>('lp_expenses.json', (loaded) => {
  const have = new Set(records.map((r) => r.id));
  records = [...records, ...(loaded.records ?? []).filter((r) => !have.has(r.id))];
  pruneOld(Date.now());
});
void disk.ready();

const persist = () => disk.save({ records });

function pruneOld(nowMs: number) {
  const cutoff = nowMs - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  records = records.filter((r) => new Date(r.createdAt).getTime() >= cutoff);
}

export const expenseStore = {
  /** Resolves once the on-disk records have been merged in (call before first render). */
  ready(): Promise<void> {
    return disk.ready();
  },
  /** Awaits pending write-through (tests). */
  flush(): Promise<void> {
    return disk.flush();
  },
  all(): ExpenseRecord[] {
    return [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  add(r: Omit<ExpenseRecord, 'id' | 'createdAt' | 'manualEntry'> & { manualEntry?: boolean }): ExpenseRecord {
    const now = Date.now();
    const rec: ExpenseRecord = {
      ...r,
      manualEntry: r.manualEntry ?? false,
      id: `${now}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date(now).toISOString(),
    };
    records = [rec, ...records];
    pruneOld(now);
    persist();
    return rec;
  },
  remove(id: string) {
    records = records.filter((r) => r.id !== id);
    persist();
  },
  total(): number {
    return records.reduce((s, r) => s + r.amount, 0);
  },
};
