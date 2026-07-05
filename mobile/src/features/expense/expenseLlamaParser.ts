/**
 * expenseLlamaParser — the "intelligent parsing" pass (CEO spec item 1), feeding raw
 * OCR text through the SHARED Llama instance (core/llm/LlamaProvider) to catch what the
 * regex/small-model pipeline (ExpenseService/expenseExtraction) missed or got wrong.
 *
 * Runs AFTER the existing extractor and only REFINES fields it already flagged
 * `needsReview` — never overrides an already-confident field, so a bad or malformed LLM
 * response can't regress a receipt the deterministic pipeline already got right. This is
 * deliberately conservative: Llama is a second opinion on the hard cases, not a
 * replacement for a pipeline that's already tested and working.
 *
 * NO network — same shared on-device Llama instance Overwhelm Manager uses.
 */
import type { ExpenseFields } from './types';

export const EXPENSE_LLAMA_SYSTEM_PROMPT =
  'You are a receipt-parsing assistant. Given raw OCR text from a receipt, extract the ' +
  'merchant name, the date (YYYY-MM-DD), the total amount (a plain number), and a spending ' +
  'category from exactly this list: Food, Groceries, Transport, Health, Shopping, Utilities, ' +
  'Other. Respond with ONLY a JSON object of the form ' +
  '{"merchant": string|null, "date": string|null, "total": number|null, "category": string|null}. ' +
  'Use null for anything you cannot determine. No explanation, no markdown, JSON only.';

export function buildExpenseParsePrompt(ocrText: string): string {
  return `Receipt text:\n${ocrText}\n\nExtract the fields as JSON.`;
}

export type LlamaExpenseGuess = {
  merchant: string | null;
  date: string | null;
  total: number | null;
  category: string | null;
};

const EMPTY_GUESS: LlamaExpenseGuess = { merchant: null, date: null, total: null, category: null };
const CATEGORY_SET = new Set(['Food', 'Groceries', 'Transport', 'Health', 'Shopping', 'Utilities', 'Other']);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Defensively parse the model's JSON — a bad/partial/non-JSON response degrades to all-null, never throws. */
export function parseLlamaExpenseResponse(raw: string): LlamaExpenseGuess {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return EMPTY_GUESS;
    const parsed: unknown = JSON.parse(match[0]);
    if (typeof parsed !== 'object' || parsed === null) return EMPTY_GUESS;
    const p = parsed as Record<string, unknown>;
    return {
      merchant: typeof p.merchant === 'string' && p.merchant.trim() ? p.merchant.trim() : null,
      date: typeof p.date === 'string' && ISO_DATE_RE.test(p.date) ? p.date : null,
      total: typeof p.total === 'number' && Number.isFinite(p.total) && p.total >= 0 ? p.total : null,
      category: typeof p.category === 'string' && CATEGORY_SET.has(p.category) ? p.category : null,
    };
  } catch {
    return EMPTY_GUESS;
  }
}

/**
 * Merge the LLM's guess onto the existing (regex/model) fields — ONLY for fields already
 * flagged `needsReview`. Confidence 0.7 (below the 0.8+ a clean deterministic match gets,
 * above the 0.6 review threshold) marks these as "resolved, but by inference not certainty."
 */
export function refineWithLlamaGuess(fields: ExpenseFields, guess: LlamaExpenseGuess): ExpenseFields {
  const review = new Set(fields.reviewFields);
  let merchant = fields.merchant;
  let date = fields.date;
  let total = fields.total;
  let category = fields.category;

  if (review.has('merchant') && guess.merchant) {
    merchant = { value: guess.merchant, confidence: 0.7, source: 'llama' };
    review.delete('merchant');
  }
  if (review.has('date') && guess.date) {
    date = { value: guess.date, confidence: 0.7, source: 'llama' };
    review.delete('date');
  }
  if (review.has('total') && guess.total != null) {
    total = {
      value: {
        amount: guess.total,
        currency: fields.total.value?.currency ?? 'USD',
        currencyAssumed: fields.total.value?.currencyAssumed ?? true,
      },
      confidence: 0.7,
      source: 'llama',
    };
    review.delete('total');
  }
  if (review.has('category') && guess.category) {
    category = { value: guess.category, confidence: 0.7, source: 'llama' };
    review.delete('category');
  }

  const reviewFields = [...review] as ExpenseFields['reviewFields'];
  return { ...fields, merchant, date, total, category, reviewFields, needsReview: reviewFields.length > 0 };
}
