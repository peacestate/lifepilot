/**
 * expenseExtraction — the layer manifest.json always described but nothing called
 * until now: "fallback: deterministic parser ml/test/expense_eval.py (used when model
 * confidence < 0.6)". Runs the two trained ExecuTorch models (line-tagger, category)
 * and overrides the deterministic parser's merchant/date/total/category fields only
 * where the model is confident (>= EXPENSE.REVIEW_THRESHOLD) — never for lineItems,
 * which stays deterministic (the models tag ITEM lines but don't parse item values,
 * and the deterministic pass already scans every line correctly for these).
 *
 * The line-tagger predicts which OCR LINE plays which role (MERCHANT/DATE/TOTAL/ITEM/
 * OTHER) — it does not parse the actual value out of that line. So for date/total we
 * still reuse ExpenseService's own value-parsing regexes (extractDate/extractTotal),
 * just scoped to the single line the model identified, instead of scored across all
 * lines. For merchant, the model-tagged line's text is used directly (that heuristic
 * exists only to CHOOSE a line among many; the model already chose one).
 *
 * Falls back to the pure deterministic result untouched if either model is
 * unavailable (not yet provisioned, or the .pte fails to load) — same
 * "never block on the model" spirit as every other on-device feature here.
 *
 * PRIVACY: zero networking (both models + the featurizer are pure/local).
 */
import { dateLocaleFor, EXPENSE, extractDate, extractFields, extractTotal } from './ExpenseService';
import { argmaxLabel, buildCategoryInput, buildLineTaggerInput } from './expenseFeaturizer';
import { CATEGORY_LABELS, LINE_LABELS, runCategoryModel, runLineTagger } from './expenseModel';
import type { ExpenseFields, OcrResult } from './types';

const THRESHOLD = EXPENSE.REVIEW_THRESHOLD;

/** Best-confidence line (if any) the line-tagger assigned to `role`, above THRESHOLD. */
function bestLineFor(
  role: string,
  tags: Array<{ label: string; confidence: number; lineIndex: number }>,
): { lineIndex: number; confidence: number } | null {
  const candidates = tags.filter((t) => t.label === role && t.confidence >= THRESHOLD);
  if (!candidates.length) return null;
  const best = candidates.reduce((a, b) => (b.confidence > a.confidence ? b : a));
  return { lineIndex: best.lineIndex, confidence: best.confidence };
}

export async function extractFieldsSmart(ocr: OcrResult): Promise<ExpenseFields> {
  const deterministic = extractFields(ocr);
  const lines = ocr.lines;
  if (!lines.length) return deterministic;

  // Tag every line; if the model isn't available the first call returns null and every
  // subsequent one will too (cached module promise) — bail out to the deterministic
  // result immediately rather than doing 1..N pointless calls.
  const firstLogits = await runLineTagger(buildLineTaggerInput(lines, 0));
  if (!firstLogits) return deterministic;

  const tags = [
    { ...argmaxLabel(firstLogits, LINE_LABELS), lineIndex: 0 },
    ...(await Promise.all(
      lines.slice(1).map(async (_, i) => {
        const logits = await runLineTagger(buildLineTaggerInput(lines, i + 1));
        return logits ? { ...argmaxLabel(logits, LINE_LABELS), lineIndex: i + 1 } : null;
      }),
    )),
  ].filter((t): t is { label: string; confidence: number; lineIndex: number } => t != null);

  const result: ExpenseFields = { ...deterministic };

  const merchantHit = bestLineFor('MERCHANT', tags);
  if (merchantHit) {
    const text = lines[merchantHit.lineIndex].text.trim();
    result.merchant = { value: text, confidence: merchantHit.confidence, source: `model:line_tagger[${merchantHit.lineIndex}]` };
  }

  const dateHit = bestLineFor('DATE', tags);
  if (dateHit) {
    const parsed = extractDate([lines[dateHit.lineIndex]], dateLocaleFor(lines.map((l) => l.text).join('\n')));
    if (parsed.value != null) {
      result.date = {
        value: parsed.value,
        confidence: Math.round(parsed.confidence * dateHit.confidence * 100) / 100,
        source: `model:line_tagger[${dateHit.lineIndex}]`,
        ambiguous: parsed.ambiguous,
      };
    }
  }

  const totalHit = bestLineFor('TOTAL', tags);
  if (totalHit) {
    const line = lines[totalHit.lineIndex];
    const parsed = extractTotal([line], line.text);
    if (parsed.value != null) {
      result.total = {
        value: parsed.value,
        confidence: Math.round(parsed.confidence * totalHit.confidence * 100) / 100,
        source: `model:line_tagger[${totalHit.lineIndex}]`,
      };
    }
  }

  const categoryInput = buildCategoryInput(lines);
  const categoryLogits = await runCategoryModel(categoryInput);
  if (categoryLogits) {
    const cat = argmaxLabel(categoryLogits, CATEGORY_LABELS);
    if (cat.confidence >= THRESHOLD) {
      result.category = { value: cat.label, confidence: cat.confidence, source: 'model:category' };
    }
  }

  const review = (['merchant', 'date', 'total', 'category'] as const).filter(
    (k) => result[k].value == null || result[k].confidence < THRESHOLD,
  );
  result.needsReview = review.length > 0;
  result.reviewFields = review;

  return result;
}
