/**
 * useExpenseScanner — scan → OCR → extract → review → save, all on-device.
 *
 * Extraction uses the deterministic parser (ExpenseService) — the ExecuTorch line/category
 * models layer in later via the same ExpenseFields shape (contract §11). NO network.
 */
import { useCallback, useState } from 'react';

import { extractFields } from './ExpenseService';
import { expenseStore } from './expenseStore';
import { recognizeReceipt, recognizeFromOcrResult } from './ocrSource';
import { pickDocument } from './pdfSource';
import type { ExpenseFields, ExpenseRecord } from './types';

export type ScanState = 'idle' | 'reading' | 'review' | 'saved' | 'error';

export type UseExpenseScanner = {
  state: ScanState;
  fields?: ExpenseFields;
  records: ExpenseRecord[];
  /** Scan from camera (imageUri) or use the sample stub if no URI given. */
  scan: (imageUri?: string) => Promise<void>;
  /** Open the system doc picker and scan a PDF or image file from storage. */
  scanFromFile: () => Promise<void>;
  save: (edited: Partial<{ merchant: string; dateISO: string | null; amount: number; currency: string; category: string }>) => void;
  reset: () => void;
};

export function useExpenseScanner(): UseExpenseScanner {
  const [state, setState] = useState<ScanState>('idle');
  const [fields, setFields] = useState<ExpenseFields | undefined>(undefined);
  const [records, setRecords] = useState<ExpenseRecord[]>(() => expenseStore.all());

  const scan = useCallback(async (imageUri?: string) => {
    setState('reading');
    try {
      const ocr = await recognizeReceipt(imageUri);
      const f = extractFields(ocr);
      setFields(f);
      setState('review');
    } catch {
      setState('error');
    }
  }, []);

  const save = useCallback((edited: Parameters<UseExpenseScanner['save']>[0]) => {
    if (!fields) return;
    expenseStore.add({
      merchant: edited.merchant ?? fields.merchant.value ?? 'Unknown',
      dateISO: edited.dateISO ?? fields.date.value,
      amount: edited.amount ?? fields.total.value?.amount ?? 0,
      currency: edited.currency ?? fields.total.value?.currency ?? 'USD',
      category: edited.category ?? fields.category.value ?? 'Other',
      lineItems: fields.lineItems,
    });
    setRecords(expenseStore.all());
    setState('saved');
  }, [fields]);

  const scanFromFile = useCallback(async () => {
    setState('reading');
    try {
      const picked = await pickDocument();
      if (picked.kind === 'cancelled') { setState('idle'); return; }
      if (picked.kind === 'error') { setState('error'); return; }
      const ocr = picked.kind === 'image'
        ? await recognizeReceipt(picked.uri)
        : await recognizeFromOcrResult(picked.ocrResult);
      setFields(extractFields(ocr));
      setState('review');
    } catch {
      setState('error');
    }
  }, []);

  const reset = useCallback(() => {
    setFields(undefined);
    setState('idle');
  }, []);

  return { state, fields, records, scan, scanFromFile, save, reset };
}
