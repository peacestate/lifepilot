/**
 * useExpenseScanner — scan → OCR → extract → review → save, all on-device.
 *
 * Extraction: extractFieldsSmart runs the two trained ExecuTorch models (line-tagger,
 * category) and falls back field-by-field to the deterministic parser (ExpenseService)
 * wherever the model isn't confident or isn't available yet — same ExpenseFields shape
 * either way (contract §11). expenseCategorizor then layers in anything the user has
 * personally taught it for this merchant (step 6 of the OCR expense spec). NO network.
 */
import { useCallback, useEffect, useState } from 'react';

import type { ManualExpenseEntry } from '../../components/ManualExpenseEntryForm';
import { useSharedLlm } from '../../core/llm/LlamaProvider';
import type { LlamaContextValue } from '../../core/llm/LlamaProvider';
import { expenseCategorizor } from './expenseCategorizor';
import { extractFieldsSmart } from './expenseExtraction';
import {
  buildExpenseParsePrompt,
  EXPENSE_LLAMA_SYSTEM_PROMPT,
  parseLlamaExpenseResponse,
  refineWithLlamaGuess,
} from './expenseLlamaParser';
import { afterPurchaseNudge, periodicNudge, type Nudge } from './expenseReminder';
import { expenseStore } from './expenseStore';
import { recognizeReceipt, recognizeFromOcrResult } from './ocrSource';
import { pickDocument } from './pdfSource';
import type { ExpenseFields, ExpenseRecord, OcrResult } from './types';

export type ScanState = 'idle' | 'reading' | 'review' | 'saved' | 'error';

export type UseExpenseScanner = {
  state: ScanState;
  fields?: ExpenseFields;
  records: ExpenseRecord[];
  nudge: Nudge | null;
  /** Scan from camera (imageUri) or use the sample stub if no URI given. */
  scan: (imageUri?: string) => Promise<void>;
  /** Open the system doc picker and scan a PDF or image file from storage. */
  scanFromFile: () => Promise<void>;
  save: (edited: Partial<{ merchant: string; dateISO: string | null; amount: number; currency: string; category: string }>) => void;
  /** Manual-entry fallback — same record shape, marked manualEntry: true. */
  saveManual: (entry: ManualExpenseEntry) => void;
  dismissNudge: () => void;
  reset: () => void;
};

/** Apply any learned merchant->category mapping on top of the parser/model output. */
function applyCategorizor(fields: ExpenseFields): ExpenseFields {
  const learned = expenseCategorizor.suggest(fields.merchant.value);
  if (!learned || learned === fields.category.value) return fields;
  return {
    ...fields,
    category: { value: learned, confidence: 1, source: 'categorizor:learned' },
    reviewFields: fields.reviewFields.filter((k) => k !== 'category'),
    needsReview: fields.reviewFields.filter((k) => k !== 'category').length > 0,
  };
}

/**
 * Second-opinion pass through the shared Llama instance — only when the deterministic
 * pipeline already flagged something for review. If the model is still cold-starting
 * (it loads app-wide from launch), wait it out briefly rather than silently skipping
 * the smartest step of the pipeline; a receipt that parsed cleanly never waits at all.
 * Best-effort: any failure here just returns the original fields unchanged, so a scan
 * never fails BECAUSE of this step.
 */
const LLAMA_READY_WAIT_MS = 12_000;

async function maybeRefineWithLlama(
  fields: ExpenseFields,
  ocr: OcrResult,
  llm: LlamaContextValue,
): Promise<ExpenseFields> {
  if (!fields.needsReview) return fields;
  if (!llm.isReady && !(await llm.waitUntilReady(LLAMA_READY_WAIT_MS))) return fields;
  try {
    const ocrText = ocr.lines.map((l) => l.text).join('\n');
    await llm.generate([
      { role: 'system', content: EXPENSE_LLAMA_SYSTEM_PROMPT },
      { role: 'user', content: buildExpenseParsePrompt(ocrText) },
    ]);
    const guess = parseLlamaExpenseResponse(llm.getResponse());
    return refineWithLlamaGuess(fields, guess);
  } catch {
    return fields;
  }
}

export function useExpenseScanner(): UseExpenseScanner {
  const llm = useSharedLlm();
  const [state, setState] = useState<ScanState>('idle');
  const [fields, setFields] = useState<ExpenseFields | undefined>(undefined);
  const [records, setRecords] = useState<ExpenseRecord[]>(() => expenseStore.all());
  const [nudge, setNudge] = useState<Nudge | null>(null);

  // On mount: wait for the on-disk stores to load (records + learned categories), then
  // refresh the list and surface a weekly-summary / category-spike / month-end /
  // savings-streak nudge if one applies right now (step 8) — the after-purchase nudge
  // (below) takes priority whenever a save just happened, so only set it if nothing is.
  useEffect(() => {
    let alive = true;
    void Promise.all([expenseStore.ready(), expenseCategorizor.ready()]).then(() => {
      if (!alive) return;
      setRecords(expenseStore.all());
      setNudge((current) => current ?? periodicNudge(expenseStore.all()));
    });
    return () => { alive = false; };
  }, []);

  const scan = useCallback(async (imageUri?: string) => {
    setState('reading');
    try {
      const ocr = await recognizeReceipt(imageUri);
      const f = await maybeRefineWithLlama(await extractFieldsSmart(ocr), ocr, llm);
      setFields(applyCategorizor(f));
      setState('review');
    } catch {
      setState('error');
    }
  }, [llm]);

  const save = useCallback((edited: Parameters<UseExpenseScanner['save']>[0]) => {
    if (!fields) return;
    const confirmedCategory = edited.category ?? fields.category.value ?? 'Other';
    const merchant = edited.merchant ?? fields.merchant.value ?? 'Unknown';
    expenseCategorizor.recordCorrection(merchant, fields.category.value, confirmedCategory);

    const saved = expenseStore.add({
      merchant,
      dateISO: edited.dateISO ?? fields.date.value,
      amount: edited.amount ?? fields.total.value?.amount ?? 0,
      currency: edited.currency ?? fields.total.value?.currency ?? 'USD',
      category: confirmedCategory,
      lineItems: fields.lineItems,
      manualEntry: false,
    });
    const all = expenseStore.all();
    setRecords(all);
    setNudge(afterPurchaseNudge(all, saved));
    setState('saved');
  }, [fields]);

  const saveManual = useCallback((entry: ManualExpenseEntry) => {
    expenseCategorizor.recordCorrection(entry.merchant, null, entry.category);
    const saved = expenseStore.add({
      merchant: entry.merchant,
      dateISO: entry.dateISO,
      amount: entry.amount,
      currency: entry.currency,
      category: entry.category,
      manualEntry: true,
    });
    const all = expenseStore.all();
    setRecords(all);
    setNudge(afterPurchaseNudge(all, saved));
    setState('saved');
  }, []);

  const scanFromFile = useCallback(async () => {
    setState('reading');
    try {
      const picked = await pickDocument();
      if (picked.kind === 'cancelled') { setState('idle'); return; }
      if (picked.kind === 'error') { setState('error'); return; }
      const ocr = picked.kind === 'image'
        ? await recognizeReceipt(picked.uri)
        : await recognizeFromOcrResult(picked.ocrResult);
      const f = await maybeRefineWithLlama(await extractFieldsSmart(ocr), ocr, llm);
      setFields(applyCategorizor(f));
      setState('review');
    } catch {
      setState('error');
    }
  }, [llm]);

  const dismissNudge = useCallback(() => setNudge(null), []);

  const reset = useCallback(() => {
    setFields(undefined);
    setState('idle');
  }, []);

  return { state, fields, records, nudge, scan, scanFromFile, save, saveManual, dismissNudge, reset };
}
