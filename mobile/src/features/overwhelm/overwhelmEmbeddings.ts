/**
 * overwhelmEmbeddings — on-device text embeddings for overwhelmMemory.ts's semantic
 * search ("Clean my room" / "Tidy my bedroom" should match).
 *
 * Uses react-native-executorch's BUILT-IN `TextEmbeddingsModule` (already present in the
 * pinned 0.4.10 runtime) — deliberately NOT the separate `@react-native-rag/executorch`
 * package, which requires `react-native-executorch@^0.9.0` and would break this project's
 * hard version pin (0.4.10 → HF v0.4.0 → ExecuTorch v0.6.0, no forward compat — every other
 * model in this app, including the just-verified 20/20 Overwhelm eval, depends on that exact
 * pin). No new native dependency, no new EAS build risk.
 *
 * Model: software-mansion/react-native-executorch-multi-qa-MiniLM-L6-cos-v1 @ v0.4.0 (same
 * HF-revision convention as Llama/Whisper in this project) — 384-dim, L2-normalized output,
 * so cosine similarity is just a dot product (manifest.json).
 *
 * Isolated + defensive like energyModel.ts/expenseModel.ts: any failure (not yet
 * provisioned, native module unavailable) returns null, never throws — callers fall back
 * to keyword overlap, never block on this.
 *
 * PRIVACY: zero networking. Loaded from local file:// paths only.
 */
import * as FileSystem from 'expo-file-system';

import manifest from '../../models/embeddings/manifest.json';

export const EMBEDDING_DIM = manifest.dim;

export class EmbeddingModelNotProvisioned extends Error {
  constructor(detail: string) {
    super(`Embedding model not provisioned: ${detail}`);
    this.name = 'EmbeddingModelNotProvisioned';
  }
}

function getModelDir(): string {
  const base = FileSystem.documentDirectory;
  if (!base) throw new EmbeddingModelNotProvisioned('FileSystem.documentDirectory unavailable.');
  return `${base}models/embeddings`;
}

async function exists(uri: string): Promise<FileSystem.FileInfo> {
  return FileSystem.getInfoAsync(uri, { size: true });
}

async function provision(): Promise<{ modelSource: string; tokenizerSource: string }> {
  const dir = getModelDir();
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {
    /* already exists */
  });
  const modelUri = `${dir}/${manifest.files.model}`;
  const tokenizerUri = `${dir}/${manifest.files.tokenizer}`;
  const [model, tok] = await Promise.all([exists(modelUri), exists(tokenizerUri)]);
  if (!model.exists || !tok.exists) {
    throw new EmbeddingModelNotProvisioned(
      `files missing in ${dir}. Place them on the device per mobile/RUNBOOK.md.`,
    );
  }
  const expected = manifest.bytes.model;
  if (expected && model.size && model.size !== expected) {
    throw new EmbeddingModelNotProvisioned(`model size ${model.size} != manifest ${expected} — re-copy the file.`);
  }
  return { modelSource: modelUri, tokenizerSource: tokenizerUri };
}

/**
 * HARD-DISABLED (confirmed on-device 2026-07-08). `TextEmbeddingsModule.load()` shares
 * one native runtime with Llama on the pinned 0.4.10 stack, and its tokenizer path hits
 * the same broken `HuggingFaceTokenizer.initHybrid` JNI gap as Whisper (upstream #507).
 * The load half-initializes, wedges the shared runtime, and every subsequent Llama
 * generate() then hangs (watchdog timeout, 0 tokens) or SIGSEGVs the process. Because
 * memory.retrieve() short-circuits on empty memory BEFORE calling embed(), this only
 * fired once at least one plan had been saved — exactly the observed "only the very
 * first generation after install works" failure. Reproduced across three fixes that did
 * NOT resolve it (serialization-chain release, watchdog salvage, prompt shrink); the
 * fail matrix was: no-memory → works, any-memory → hang/crash.
 *
 * So on this runtime pin, semantic embeddings are OFF: embed() returns null without
 * ever touching the native module, and overwhelmMemory falls back to its keyword-overlap
 * scoring (overlapScore) — the retrieval path stays functional, just lexical instead of
 * semantic. Re-enable only after the runtime pin moves past the initHybrid fix
 * (react-native-executorch >= 0.7.0) AND an on-device two-generation test passes with
 * populated memory.
 */
async function getModule(): Promise<{ forward: (text: string) => Promise<number[]> } | null> {
  return null;
}

/** Embed a string into a 384-dim, L2-normalized vector, or null if unavailable. */
export async function embed(text: string): Promise<number[] | null> {
  const mod = await getModule();
  if (!mod) return null;
  try {
    const vec = await mod.forward(text);
    return vec ?? null;
  } catch {
    return null;
  }
}

/** Dot product of two equal-length vectors — cosine similarity since both are pre-normalized. */
export function dot(a: readonly number[], b: readonly number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
