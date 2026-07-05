/**
 * overwhelmMemory — on-device task memory for the Overwhelm Manager.
 *
 * v2 (2026-07-06): real semantic search via on-device text embeddings
 * (overwhelmEmbeddings.ts — react-native-executorch's built-in TextEmbeddingsModule,
 * NOT @react-native-rag/executorch, see that file's header for why). "Clean my room" and
 * "Tidy my bedroom" now correctly recognize each other as similar, cosine-similarity ranked
 * (embeddings are pre-normalized, so cosine == dot product).
 *
 * Falls back to the old keyword-overlap scoring if the embedding model isn't provisioned
 * yet (first run before the model is pushed, or the native module fails to load) — same
 * "never block on the model" spirit as every other on-device feature here.
 *
 * PRIVACY: pure on-device. No data ever leaves the app sandbox.
 */
import * as FileSystem from 'expo-file-system';

import { dot, embed } from './overwhelmEmbeddings';

const MEMORY_PATH = `${FileSystem.documentDirectory}overwhelm_memory.json`;
const MAX_ENTRIES = 100;

export type MemoryEntry = {
  date: string;             // YYYY-MM-DD (local)
  taskText: string;
  embedding: number[] | null; // null if the embedding model wasn't available when saved
  steps: string[];           // cleaned step texts (no bullets)
  completedSteps: number;
  totalSteps: number;
  category: string;          // one of the 7 fixed buckets (see OverwhelmService categorize)
  savedAt: number;           // epoch ms
  /** epoch ms of the last completedSteps change — drives the "abandoned halfway" nudge. */
  updatedAt: number;
  /** step text -> its saved sub-step breakdown, when the user tapped "break it down further". */
  subBreakdowns?: Record<string, string[]>;
};

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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

/** Bag-of-words overlap score — fallback only, used when no embedding is available on either side. */
function overlapScore(a: string, b: string): number {
  const words = (s: string) => new Set(s.toLowerCase().split(/\W+/).filter((w) => w.length >= 4));
  const qa = words(a);
  const qb = words(b);
  let hits = 0;
  qa.forEach((w) => { if (qb.has(w)) hits++; });
  return hits / Math.max(1, Math.min(qa.size, qb.size));
}

export const overwhelmMemory = {
  /**
   * Save a completed task + its generated steps + auto-detected category. Called right
   * after a successful run (completedSteps starts at 0 — nothing's been checked off yet;
   * see updateProgress for persisting checkbox state as the user works through it).
   */
  async save(task: string, steps: string[], category: string): Promise<void> {
    const entries = await load();
    const deduped = entries.filter((e) => e.taskText.trim().toLowerCase() !== task.trim().toLowerCase());
    const embedding = await embed(task);
    const now = Date.now();
    deduped.unshift({
      date: todayKey(),
      taskText: task,
      embedding,
      steps,
      completedSteps: 0,
      totalSteps: steps.length,
      category,
      savedAt: now,
      updatedAt: now,
    });
    await persist(deduped.slice(0, MAX_ENTRIES));
  },

  /**
   * Update how many steps are checked off for a saved task (the most recent entry with
   * this exact task text — a task is saved once per run, so this is unambiguous in
   * practice). No-op if the task was never saved (e.g. fewer than 3 steps parsed).
   */
  async updateProgress(task: string, completedSteps: number, totalSteps: number): Promise<void> {
    const entries = await load();
    const idx = entries.findIndex((e) => e.taskText.trim().toLowerCase() === task.trim().toLowerCase());
    if (idx < 0) return;
    entries[idx] = { ...entries[idx], completedSteps, totalSteps, updatedAt: Date.now() };
    await persist(entries);
  },

  /** Attach a sub-step breakdown for one of a saved task's steps ("break it down further"). */
  async saveSubSteps(parentTask: string, stepText: string, subs: string[]): Promise<void> {
    const entries = await load();
    const idx = entries.findIndex((e) => e.taskText.trim().toLowerCase() === parentTask.trim().toLowerCase());
    if (idx < 0) return;
    entries[idx] = {
      ...entries[idx],
      subBreakdowns: { ...(entries[idx].subBreakdowns ?? {}), [stepText]: subs },
    };
    await persist(entries);
  },

  /** All saved entries, most recent first — for the Past Tasks browse screen + weekly insight. */
  async list(): Promise<MemoryEntry[]> {
    return load();
  },

  /**
   * Retrieve the top-K most similar past tasks. Ranks by embedding cosine similarity when
   * both the query and a given entry have one; entries saved before the embedding model
   * was provisioned (embedding: null) fall back to keyword overlap so old memories don't
   * just vanish from retrieval after the upgrade.
   */
  async retrieve(task: string, topK = 3): Promise<MemoryEntry[]> {
    const entries = await load();
    if (!entries.length) return [];

    const queryEmbedding = await embed(task);

    const scored = entries
      .map((e) => {
        const score = queryEmbedding && e.embedding
          ? dot(queryEmbedding, e.embedding)
          : overlapScore(task, e.taskText);
        return { e, score };
      })
      .filter(({ score }) => score > (queryEmbedding ? 0.3 : 0)); // 0.3 ~ a loose semantic-similarity floor for MiniLM cosine scores
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map(({ e }) => e);
  },

  async count(): Promise<number> {
    const entries = await load();
    return entries.length;
  },
};
