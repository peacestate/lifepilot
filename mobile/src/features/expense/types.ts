/**
 * OCR Expense — shared types. Authority: docs/expense-model-contract.md (§1 OcrResult, §8).
 */

// OcrLine / OcrResult live in core so mlkitOcr (core) can import them without a
// core→feature dependency. Re-export here so existing expense imports stay unchanged.
export type { OcrLine, OcrResult } from '../../core/ocr/types';

export type Money = { amount: number; currency: string; currencyAssumed: boolean };
export type Field<T> = { value: T | null; confidence: number; source?: string };
export type LineItem = { description: string; amount: number };

export type ExpenseCategory =
  | 'Food' | 'Groceries' | 'Transport' | 'Health' | 'Shopping' | 'Utilities' | 'Other';

export type ExpenseFields = {
  merchant: Field<string>;
  date: Field<string> & { ambiguous?: boolean };  // ISO YYYY-MM-DD
  total: Field<Money>;
  category: Field<string>;
  lineItems: LineItem[];
  needsReview: boolean;
  reviewFields: Array<'merchant' | 'date' | 'total' | 'category'>;
};

/** A saved expense (local-only, never synced). */
export type ExpenseRecord = {
  id: string;
  createdAt: string;          // ISO
  merchant: string;
  dateISO: string | null;
  amount: number;
  currency: string;
  category: string;
  lineItems?: LineItem[];
  imageUri?: string;          // local file:// only, optional
  manualEntry: boolean;       // true if hand-entered (no scan/OCR involved)
};
