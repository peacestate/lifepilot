/**
 * expenseFeaturizer — exact TS port of the featurizer in
 * ml/export/export_expense_extractor.py (manifest.json's own note: "PORT TO TS
 * EXACTLY — pad with single spaces, FNV-1a over utf-8 bytes"). Any drift here changes
 * what the two trained .pte models actually see vs. what they were trained on.
 *
 * NO React, NO network, NO model loading — pure functions, unit-testable, mirroring
 * OverwhelmService.ts / EnergyForecast.ts's "pure business logic" isolation pattern.
 *
 * has_amount / has_date / alpha_ratio intentionally use DIFFERENT (simpler) regexes
 * than ExpenseService.ts's own deterministic parser — these must match the EXACT
 * regexes the Python training script used (MONEY_RE / DATE_RE / Python's `str.isalpha()`),
 * not ExpenseService's more elaborate parsing regexes, or the features would silently
 * diverge from what the models were trained on.
 */
import type { OcrLine } from './types';

export const HASH_DIM = 256;
export const NGRAM = 3;
export const LAYOUT_DIM = 6;

// Exact match to the Python training script's simpler regexes (NOT ExpenseService's).
const TRAIN_MONEY_RE = /\d+[.,]\d{2}(?!\d)/;
const TRAIN_DATE_RE = /\b\d{1,4}[/.\-]\d{1,2}[/.\-]\d{1,4}\b|\b[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}\b/;
// Unicode letter class — closer to Python's str.isalpha() (any-script) than [a-zA-Z].
const UNICODE_LETTER_RE = /\p{L}/u;

/** FNV-1a 32-bit over UTF-8 bytes — matches the Python `fnv1a()` exactly. */
function fnv1a(bytes: number[]): number {
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function utf8Bytes(s: string): number[] {
  return Array.from(new TextEncoder().encode(s));
}

/**
 * Hashed character-trigram bag-of-words, L2-normalized. Matches Python's `hashbow()`:
 * collapse whitespace, lowercase, trim, pad with a single space on each side, hash every
 * n-gram of the padded string (not the UTF-8 bytes — the SUBSTRING is hashed as UTF-8
 * bytes per character-window, matching `pad[i:i+n]` in Python operating on `str`).
 */
export function hashBow(text: string, dim: number = HASH_DIM, n: number = NGRAM): Float32Array {
  const t = (text ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  const v = new Float32Array(dim);
  const pad = ` ${t} `;
  const chars = Array.from(pad); // code-point aware, matches Python str indexing better than UTF-16 .length
  for (let i = 0; i <= chars.length - n; i++) {
    const gram = chars.slice(i, i + n).join('');
    const idx = fnv1a(utf8Bytes(gram)) % dim;
    v[idx] += 1.0;
  }
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < dim; i++) v[i] /= norm;
  return v;
}

/**
 * The 6 layout features for one OCR line. `yRel`/`hRel`/`conf` come from the REAL line
 * position/height/OCR-confidence at inference time — the training script used a
 * label-dependent proxy for hRel (1.0 for the true MERCHANT line, 0.5 otherwise) since it
 * only had synthetic text, not real bounding boxes; at real inference we don't know the
 * label yet, so we use the line's actual OCR box height relative to the tallest line on
 * the receipt instead (the same real signal ExpenseService.ts's own merchant heuristic
 * already relies on) — a more faithful stand-in for "is this a prominent header line"
 * than a label leak would have been anyway.
 */
export function layoutFeatures(text: string, yRel: number, hRel: number, conf: number): Float32Array {
  const hasAmount = TRAIN_MONEY_RE.test(text) ? 1 : 0;
  const hasDate = TRAIN_DATE_RE.test(text) ? 1 : 0;
  const stripped = text.replace(/ /g, '');
  const letters = Array.from(stripped).filter((c) => UNICODE_LETTER_RE.test(c)).length;
  const alphaRatio = stripped.length ? letters / stripped.length : 0;
  return new Float32Array([yRel, hRel, conf, hasAmount, hasDate, alphaRatio]);
}

/** Build the 262-dim line-tagger input for one OCR line among `lines` at index `i`. */
export function buildLineTaggerInput(lines: readonly OcrLine[], i: number): Float32Array {
  const line = lines[i];
  const maxH = Math.max(1, ...lines.map((l) => l.h ?? 1));
  const yRel = lines.length > 1 ? i / (lines.length - 1) : 0;
  const hRel = (line.h ?? 1) / maxH;
  const text = hashBow(line.text);
  const layout = layoutFeatures(line.text, yRel, hRel, line.conf);
  const out = new Float32Array(HASH_DIM + LAYOUT_DIM);
  out.set(text, 0);
  out.set(layout, HASH_DIM);
  return out;
}

/** Build the 256-dim category input — hashBow of ALL line texts joined with single spaces. */
export function buildCategoryInput(lines: readonly OcrLine[]): Float32Array {
  const body = lines.map((l) => l.text).join(' ');
  return hashBow(body);
}

/** Softmax over raw logits (the models export logits, not probabilities — manifest note "softmax on device"). */
export function softmax(logits: ArrayLike<number>): number[] {
  const arr = Array.from(logits);
  const max = Math.max(...arr);
  const exps = arr.map((x) => Math.exp(x - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((x) => x / sum);
}

/** argmax + its softmax probability, e.g. for turning line-tagger/category logits into a label. */
export function argmaxLabel(logits: ArrayLike<number>, labels: readonly string[]): { label: string; confidence: number } {
  const probs = softmax(logits);
  let best = 0;
  for (let i = 1; i < probs.length; i++) if (probs[i] > probs[best]) best = i;
  return { label: labels[best], confidence: probs[best] };
}
