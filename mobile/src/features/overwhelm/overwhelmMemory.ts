/**
 * overwhelmMemory — on-device task memory for the Overwhelm Manager.
 *
 * v1: keyword-overlap similarity + expo-file-system persistence.
 * Upgrade path (v2): swap retrieve() for vector cosine search via:
 *   @react-native-rag/executorch (embeddings) + @react-native-rag/op-sqlite (vector store)
 *   npm install react-native-rag @react-native-rag/executorch @react-native-rag/op-sqlite
 *   → then: expo prebuild && expo run:android/ios
 *
 * PRIVACY: pure on-device. No data ever leaves the app sandbox.
 */
import * as FileSystem from 'expo-file-system';

const MEMORY_PATH = `${FileSystem.documentDirectory}overwhelm_memory.json`;
const MAX_ENTRIES = 60;

export type MemoryEntry = {
  task: string;
  steps: string[];   // cleaned step texts (no bullets)
  topic: string;     // short model-assigned category, e.g. "Cleaning"
  savedAt: number;   // epoch ms
};

async function load(): Promise<MemoryEntry[]> {
  try {
    const raw = await FileSystem.readAsStringAsync(MEMORY_PATH);
    return JSON.parse(raw) as MemoryEntry[];
  } catch {
    return [];
  }
}

async function persist(entries: MemoryEntry[]): Promise<void> {
  await FileSystem.writeAsStringAsync(MEMORY_PATH, JSON.stringify(entries));
}

/** Bag-of-words overlap score. Short words (<4 chars) skipped as stop words. */
function overlapScore(a: string, b: string): number {
  const words = (s: string) =>
    new Set(s.toLowerCase().split(/\W+/).filter((w) => w.length >= 4));
  const qa = words(a);
  const qb = words(b);
  let hits = 0;
  qa.forEach((w) => { if (qb.has(w)) hits++; });
  return hits / Math.max(1, Math.min(qa.size, qb.size));
}

export const overwhelmMemory = {
  /**
   * Save a completed task + its generated steps.
   * Called after a successful run so the next similar task benefits immediately.
   */
  async save(task: string, steps: string[], topic: string): Promise<void> {
    const entries = await load();
    // Remove duplicate of the exact same task if it exists
    const deduped = entries.filter(
      (e) => e.task.trim().toLowerCase() !== task.trim().toLowerCase(),
    );
    deduped.unshift({ task, steps, topic, savedAt: Date.now() });
    await persist(deduped.slice(0, MAX_ENTRIES));
  },

  /** All saved entries, most recent first — for the Past Tasks browse screen. */
  async list(): Promise<MemoryEntry[]> {
    return load();
  },

  /**
   * Retrieve the top-K most similar past tasks.
   * v1: keyword overlap.
   * v2 TODO: replace with vector cosine similarity via @react-native-rag/executorch.
   */
  async retrieve(task: string, topK = 3): Promise<MemoryEntry[]> {
    const entries = await load();
    if (!entries.length) return [];
    const scored = entries
      .map((e) => ({ e, score: overlapScore(task, e.task) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map(({ e }) => e);
  },

  async count(): Promise<number> {
    const entries = await load();
    return entries.length;
  },
};
