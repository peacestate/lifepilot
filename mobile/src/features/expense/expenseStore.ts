/**
 * expenseStore — local-only expense records (contract §3). v1 in-memory with a seam to
 * an encrypted on-device store (expo-secure-store key + encrypted SQLite/MMKV). Never
 * synced, never networked. Keeps a rolling 365-day window (step 4 of the OCR expense spec).
 */
import type { ExpenseRecord } from './types';

const RETENTION_DAYS = 365;

let records: ExpenseRecord[] = [];

function pruneOld(nowMs: number) {
  const cutoff = nowMs - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  records = records.filter((r) => new Date(r.createdAt).getTime() >= cutoff);
}

export const expenseStore = {
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
    return rec;
  },
  remove(id: string) {
    records = records.filter((r) => r.id !== id);
  },
  total(): number {
    return records.reduce((s, r) => s + r.amount, 0);
  },
};
