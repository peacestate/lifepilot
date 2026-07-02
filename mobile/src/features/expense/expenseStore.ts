/**
 * expenseStore — local-only expense records (contract §3). v1 in-memory with a seam to
 * an encrypted on-device store (expo-secure-store key + encrypted SQLite/MMKV). Never
 * synced, never networked.
 */
import type { ExpenseRecord } from './types';

let records: ExpenseRecord[] = [];

export const expenseStore = {
  all(): ExpenseRecord[] {
    return [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  add(r: Omit<ExpenseRecord, 'id' | 'createdAt'>): ExpenseRecord {
    const rec: ExpenseRecord = { ...r, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date().toISOString() };
    records = [rec, ...records];
    return rec;
  },
  remove(id: string) {
    records = records.filter((r) => r.id !== id);
  },
  total(): number {
    return records.reduce((s, r) => s + r.amount, 0);
  },
};
