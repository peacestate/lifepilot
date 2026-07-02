/**
 * personalHistory — on-device daily summary store for Energy and Hydration.
 *
 * Extends what native health APIs provide (7-day window) with app-tracked history
 * going back up to 90 days. Persisted via expo-file-system. Never networked.
 *
 * Upgrade path: swap file JSON for SQLite + vector embeddings via react-native-rag
 * when @react-native-rag/op-sqlite is installed (after npm install + expo prebuild).
 *
 * PRIVACY: all data stays on-device. The file path is inside the app's sandboxed
 * documentDirectory — inaccessible to other apps.
 */
import * as FileSystem from 'expo-file-system';

const HISTORY_PATH = `${FileSystem.documentDirectory}lp_history.json`;
const MAX_DAYS = 90;

export type HistoryFeature = 'energy' | 'hydration';

export type HistoryEntry = {
  date: string;            // YYYY-MM-DD (local)
  feature: HistoryFeature;
  data: Record<string, unknown>;
  createdAt: number;       // epoch ms
};

type Store = HistoryEntry[];

async function load(): Promise<Store> {
  try {
    const raw = await FileSystem.readAsStringAsync(HISTORY_PATH);
    return JSON.parse(raw) as Store;
  } catch {
    return [];
  }
}

async function persist(store: Store): Promise<void> {
  await FileSystem.writeAsStringAsync(HISTORY_PATH, JSON.stringify(store));
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const personalHistory = {
  /** Upsert today's summary for a feature. Call once per day after computing. */
  async saveToday(feature: HistoryFeature, data: Record<string, unknown>): Promise<void> {
    const store = await load();
    const date = todayKey();
    const idx = store.findIndex((e) => e.feature === feature && e.date === date);
    const entry: HistoryEntry = { date, feature, data, createdAt: Date.now() };
    if (idx >= 0) store[idx] = entry;
    else store.unshift(entry);
    // keep only MAX_DAYS per feature
    const trimmed = store.filter((e) => e.feature === feature).slice(0, MAX_DAYS);
    const others = store.filter((e) => e.feature !== feature);
    await persist([...trimmed, ...others]);
  },

  /** Get the last N days for a feature, newest first. */
  async getRecent(feature: HistoryFeature, days = 30): Promise<HistoryEntry[]> {
    const store = await load();
    return store
      .filter((e) => e.feature === feature)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, days);
  },

  /** Get a single day's entry, or undefined if not tracked yet. */
  async getDay(feature: HistoryFeature, date: string): Promise<HistoryEntry | undefined> {
    const store = await load();
    return store.find((e) => e.feature === feature && e.date === date);
  },

  /** How many days of history exist for a feature. */
  async countDays(feature: HistoryFeature): Promise<number> {
    const store = await load();
    return store.filter((e) => e.feature === feature).length;
  },
};
