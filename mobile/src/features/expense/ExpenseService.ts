/**
 * ExpenseService — deterministic receipt field extraction.
 *
 * 1:1 TypeScript port of ml/test/expense_eval.py (contract §2–§7). It is BOTH the
 * pre-model extractor AND the fallback the ExecuTorch models defer to on low confidence.
 * If you change a regex/coefficient here, change it in expense_eval.py (CI checks parity).
 *
 * NO React, NO network. Input = OcrResult (native on-device OCR), output = ExpenseFields.
 */

import { CODE_TO_SYMBOL, ISO_CODE_ALTERNATION, SYMBOL_TO_CODE, ZERO_DECIMAL_CODES } from './currencies';
import type { ExpenseFields, Field, LineItem, Money, OcrLine, OcrResult } from './types';

/* ── frozen config (== expense_eval.py) ────────────────────────────────────── */
export const EXPENSE = {
  REVIEW_THRESHOLD: 0.6,
  DEFAULT_CURRENCY: 'USD',
  DEFAULT_DATE_LOCALE: 'US' as 'US' | 'INTL',
  REFERENCE_YEAR: 2026,
  CATEGORIES: ['Food', 'Groceries', 'Transport', 'Health', 'Shopping', 'Utilities', 'Other'] as const,
};

const CURRENCY_MAP: Record<string, string> = {
  $: 'USD', 'US$': 'USD', USD: 'USD', '€': 'EUR', EUR: 'EUR', '£': 'GBP', GBP: 'GBP',
  '₹': 'INR', RS: 'INR', 'RS.': 'INR', INR: 'INR',
};
const CURRENCY_RE = /(US\$|RS\.?|USD|EUR|GBP|INR|[$€£₹])/i;
// Extended, world-wide currency markers (see ./currencies.ts). Multi-char symbols
// ("US$", "R$") must come before the single-char class so they win the alternation.
const SYMBOL_ALTERNATION = 'US\\$|CA\\$|NZ\\$|HK\\$|NT\\$|R\\$|A\\$|S\\$|[$€£₹¥₩₺₽₫₴₦₱฿₲₪₡₸₮₭֏₼₾৳₨]';
const EXT_SYMBOL_RE = new RegExp(`(${SYMBOL_ALTERNATION})`, 'i');
// ISO 4217 codes are only trusted when adjacent to a digit ("ALL 500", "500 ZAR"),
// since several codes double as English words (ALL, TOP, CUP, TRY, …).
const ISO_CODE_RE = new RegExp(`\\b(${ISO_CODE_ALTERNATION})\\b`, 'gi');
const MONEY_RE = /\d{1,3}(?:[.,]\d{3})*[.,]\d{2}(?!\d)|\d+[.,]\d{2}(?!\d)/g;
// Whole-number amounts (₹ 500, Rs 1,500, ¥800, KES 2,000, 500/-) count as money only
// with explicit context — a currency marker before, or the Indian "/-" suffix after —
// so bare quantities/phone digits stay excluded. Handles Indian grouping (1,50,000).
const MONEY_INT_RE = new RegExp(
  `(?:RS\\.?|${SYMBOL_ALTERNATION}|\\b(?:${ISO_CODE_ALTERNATION})\\b)\\s*(\\d{1,3}(?:,\\d{2,3})*|\\d+)(?![.,]?\\d)` +
  `|(\\d{1,3}(?:,\\d{2,3})*|\\d+)\\s*\\/-`,
  'gi',
);
// Bare integers (2+ digits) — trusted ONLY on a positively-labelled total line
// ("Net Amount 1500") after date substrings are removed.
const MONEY_INT_BARE_RE = /\b(\d{1,3}(?:,\d{2,3})+|\d{2,7})\b(?![.,]?\d)/g;
const INR_SLASH_RE = /\d\s*\/-/;
const POS_TOTAL_RE = /\b(GRAND\s*TOTAL|TOTAL\s+DUE|AMOUNT\s+DUE|BALANCE\s+DUE|NET\s+AMOUNT|NET\s+AMT|NET\s+PAYABLE|AMOUNT\s+PAYABLE|BILL\s+AMOUNT|AMOUNT\s+PAID|PAID\s+AMOUNT|TOTAL)\b/;
const SUBTOTAL_RE = /\bSUB\s*-?\s*TOTAL\b/;
const NEG_LABEL_RE = /\b(SUBTOTAL|TAX|VAT|GST|HST|CHANGE|CASH|TENDER|TENDERED|TIP|GRATUITY|CARD|VISA|MASTERCARD|MASTER|AMEX|DEBIT|CREDIT|AUTH|APPROVAL|ACCOUNT|POINTS|SAVINGS|DISCOUNT|ROUNDING|DEPOSIT)\b/;
const MONTHS: Record<string, number> = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
const DATE_NUM_RE = /\b(\d{1,4})[/.\-](\d{1,2})[/.\-](\d{1,4})\b/g;
const DATE_DMON_RE = /\b(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/g;
const DATE_MOND_RE = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/g;
const MERCH_SKIP_RE = /\b(RECEIPT|INVOICE|TEL|PHONE|FAX|WWW|HTTP|CASHIER|SERVER|ORDER\s*#|STORE\s*#|REG(?:ISTER)?\s*#?|TABLE|PUMP|STATION|TERMINAL|TRANS(?:ACTION)?\s*#|ST|STREET|AVE|AVENUE|RD|ROAD|BLVD|SUITE|STE|FLOOR|LANE|LN|DR|DRIVE)\b|\.COM/;

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  Groceries: ['market', 'mart', 'grocery', 'grocer', 'supermarket', 'whole foods', 'foods', 'safeway', 'kroger', 'aldi', 'costco', 'walmart', 'trader joe', 'sprouts', 'publix', 'produce', 'deli'],
  Food: ['restaurant', 'cafe', 'café', 'coffee', 'espresso', 'latte', 'bistro', 'grill', 'pizza', 'pizzeria', 'burger', 'kitchen', 'diner', 'bakery', 'croissant', 'sandwich', 'sushi', 'taco', 'pub', 'starbucks', 'mcdonald', 'salad', 'gratuity'],
  Transport: ['shell', 'chevron', 'exxon', 'mobil', 'texaco', 'petro', 'bp ', 'fuel', 'unleaded', 'diesel', 'gallon', 'gal', 'pump', 'uber', 'lyft', 'taxi', 'cab', 'transit', 'metro', 'parking', 'toll', 'airline', 'flight', 'fare', 'station'],
  Health: ['pharmacy', 'drugstore', 'drug', 'cvs', 'walgreens', 'rite aid', 'clinic', 'medical', 'dental', 'hospital', 'rx', 'prescription', 'vitamin', 'ibuprofen', 'wellness'],
  Shopping: ['clothing', 'apparel', 'electronics', 'best buy', 'target', 'boutique', 'outfitters', 'retail', 'department'],
  Utilities: ['electric', 'utility', 'internet', 'broadband', 'telecom', 'energy', 'power', 'water bill', 'gas bill'],
};

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const round2 = (x: number) => Math.round(x * 100) / 100;

function alphaRatio(s: string): number {
  const nonspace = [...s].filter((c) => !/\s/.test(c));
  if (!nonspace.length) return 0;
  return nonspace.filter((c) => /[a-zA-Z]/.test(c)).length / nonspace.length;
}

function parseAmount(numStr: string): number {
  let s = numStr.trim();
  if (s.includes(',') && s.includes('.')) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = /,\d{2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  }
  return parseFloat(s);
}
function detectCurrency(t: string): string | null {
  const m = CURRENCY_RE.exec(t);
  if (m) return CURRENCY_MAP[m[1].toUpperCase()] ?? CURRENCY_MAP[m[1]] ?? null;
  const sym = EXT_SYMBOL_RE.exec(t);
  if (sym) {
    const code = SYMBOL_TO_CODE[sym[1].toUpperCase()] ?? SYMBOL_TO_CODE[sym[1]];
    if (code) return code;
  }
  // ISO codes: only when a digit sits directly next to the code (skipping space/./:).
  for (const im of t.matchAll(ISO_CODE_RE)) {
    const start = im.index ?? 0;
    const before = t.slice(0, start).replace(/[\s.:]+$/, '');
    const after = t.slice(start + im[0].length).replace(/^[\s.:]+/, '');
    if (/\d$/.test(before) || /^\d/.test(after)) return im[1].toUpperCase();
  }
  if (INR_SLASH_RE.test(t)) return 'INR';
  return null;
}
function amountsIn(t: string): number[] {
  const out = (t.match(MONEY_RE) ?? []).map(parseAmount);
  for (const m of t.matchAll(MONEY_INT_RE)) out.push(parseAmount(m[1] ?? m[2]));
  return out;
}

/* ── §3 total ──────────────────────────────────────────────────────────────── */
export function extractTotal(lines: OcrLine[], receiptText: string): Field<Money> {
  type C = { amount: number; y: number; conf: number; positive: boolean; excluded: boolean; bare: boolean; currency: string | null; src: string };
  const cands: C[] = [];
  for (const ln of lines) {
    const U = ln.text.toUpperCase();
    const positive = POS_TOTAL_RE.test(U) && !SUBTOTAL_RE.test(U);
    const excluded = NEG_LABEL_RE.test(U) && !positive;
    let amts = amountsIn(ln.text);
    let bare = false;
    if (!amts.length && positive) {
      // Labelled total line with no decimal/currency-marked amount ("Net Amount 1500"):
      // trust bare integers, but strip date substrings first so "12/05/2026" can't leak in.
      const noDates = ln.text.replace(DATE_NUM_RE, ' ').replace(DATE_DMON_RE, ' ').replace(DATE_MOND_RE, ' ');
      amts = (noDates.match(MONEY_INT_BARE_RE) ?? []).map(parseAmount);
      bare = amts.length > 0;
    }
    if (!amts.length) continue;
    for (const a of amts) cands.push({ amount: a, y: ln.y, conf: ln.conf, positive, excluded, bare, currency: detectCurrency(ln.text), src: ln.text });
  }
  if (!cands.length) return { value: null, confidence: 0, source: 'no amount found' };
  const labelled = cands.filter((c) => c.positive);
  let pick: C; let structural: number;
  if (labelled.length) {
    pick = labelled.reduce((a, b) => (b.amount > a.amount || (b.amount === a.amount && b.y > a.y) ? b : a));
    structural = pick.bare ? 0.75 : 0.9;
  } else {
    const pool = cands.filter((c) => !c.excluded);
    pick = (pool.length ? pool : cands).reduce((a, b) => (b.amount > a.amount ? b : a));
    structural = 0.5;
  }
  const currency = pick.currency ?? detectCurrency(receiptText) ?? EXPENSE.DEFAULT_CURRENCY;
  const assumed = pick.currency == null && detectCurrency(receiptText) == null;
  const confidence = round2(structural * pick.conf * (assumed ? 0.9 : 1));
  return { value: { amount: round2(pick.amount), currency, currencyAssumed: assumed }, confidence, source: pick.src };
}

/* ── §4 date ───────────────────────────────────────────────────────────────── */
function validYmd(y: number, m: number, d: number): boolean {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return false;
  const dim = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return d <= dim && y >= 2000 && y <= EXPENSE.REFERENCE_YEAR + 1;
}
function disambiguate(a: number, b: number, c: number, locale: 'US' | 'INTL'): [string, boolean] | null {
  const year = c >= 1000 ? c : 2000 + c;
  let day: number, mon: number, amb: boolean;
  if (a > 12 && b <= 12) [day, mon, amb] = [a, b, false];
  else if (b > 12 && a <= 12) [mon, day, amb] = [a, b, false];
  else if (a <= 12 && b <= 12) { if (locale === 'US') [mon, day] = [a, b]; else [day, mon] = [a, b]; amb = true; }
  else return null;
  if (!validYmd(year, mon, day)) return null;
  return [`${year.toString().padStart(4, '0')}-${mon.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`, amb];
}
/** Month-first only makes sense for US receipts — any detected non-USD currency
 * (₹, €, £, ¥, KES, …) means day-first is the safer read for ambiguous dates. */
export function dateLocaleFor(receiptText: string): 'US' | 'INTL' {
  const cur = detectCurrency(receiptText);
  return cur && cur !== 'USD' ? 'INTL' : EXPENSE.DEFAULT_DATE_LOCALE;
}
export function extractDate(lines: OcrLine[], locale: 'US' | 'INTL' = EXPENSE.DEFAULT_DATE_LOCALE): Field<string> & { ambiguous: boolean } {
  const cands: Array<[string, boolean, OcrLine]> = [];
  for (const ln of lines) {
    const t = ln.text;
    for (const m of t.matchAll(DATE_NUM_RE)) {
      const g = m.slice(1, 4).map(Number);
      if (m[1].length === 4) { if (validYmd(g[0], g[1], g[2])) cands.push([`${g[0]}-${String(g[1]).padStart(2, '0')}-${String(g[2]).padStart(2, '0')}`, false, ln]); }
      else { const r = disambiguate(g[0], g[1], g[2], locale); if (r) cands.push([r[0], r[1], ln]); }
    }
    for (const m of t.matchAll(DATE_DMON_RE)) { const mon = MONTHS[m[2].slice(0, 3).toUpperCase()]; if (mon && validYmd(+m[3], mon, +m[1])) cands.push([`${m[3]}-${String(mon).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`, false, ln]); }
    for (const m of t.matchAll(DATE_MOND_RE)) { const mon = MONTHS[m[1].slice(0, 3).toUpperCase()]; if (mon && validYmd(+m[3], mon, +m[2])) cands.push([`${m[3]}-${String(mon).padStart(2, '0')}-${String(+m[2]).padStart(2, '0')}`, false, ln]); }
  }
  if (!cands.length) return { value: null, confidence: 0, source: 'no date found', ambiguous: false };
  cands.sort((x, y) => (x[1] === y[1] ? x[2].y - y[2].y : (x[1] ? 1 : 0) - (y[1] ? 1 : 0)));
  const [iso, amb, ln] = cands[0];
  return { value: iso, confidence: round2((amb ? 0.6 : 0.9) * ln.conf), source: ln.text, ambiguous: amb };
}

/* ── §5 merchant ───────────────────────────────────────────────────────────── */
function extractMerchant(lines: OcrLine[], height: number): Field<string> {
  const maxH = Math.max(1, ...lines.map((l) => l.h ?? 1));
  const scored: Array<[number, number, OcrLine]> = [];
  for (const ln of lines) {
    if (amountsIn(ln.text).length) continue;
    if (DATE_NUM_RE.test(ln.text) || DATE_DMON_RE.test(ln.text) || DATE_MOND_RE.test(ln.text)) { DATE_NUM_RE.lastIndex = DATE_DMON_RE.lastIndex = DATE_MOND_RE.lastIndex = 0; continue; }
    if (MERCH_SKIP_RE.test(ln.text.toUpperCase())) continue;
    const ar = alphaRatio(ln.text);
    if (ar < 0.3) continue;
    const relY = height ? ln.y / height : 0;
    const topness = 1 - clamp(relY, 0, 1);
    const score = 0.4 * topness + 0.25 * ((ln.h ?? 1) / maxH) + 0.2 * ln.conf + 0.15 * ar;
    scored.push([score, relY, ln]);
  }
  const top = scored.filter((s) => s[1] <= 0.35);
  const pool = top.length ? top : scored;
  if (!pool.length) return { value: null, confidence: 0, source: 'no header line' };
  const [score, , ln] = pool.reduce((a, b) => (b[0] > a[0] ? b : a));
  return { value: ln.text.trim(), confidence: round2(clamp(score, 0, 1) * (0.6 + 0.4 * ln.conf)), source: ln.text };
}

/* ── §6 category ───────────────────────────────────────────────────────────── */
function extractCategory(merchant: string | null, bodyTexts: string[]): Field<string> {
  const m = (merchant ?? '').toLowerCase();
  const body = bodyTexts.join(' ').toLowerCase();
  const scores: Record<string, number> = {};
  for (const c of EXPENSE.CATEGORIES) if (c !== 'Other') scores[c] = 0;
  for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS)) for (const kw of kws) { if (m.includes(kw)) scores[cat] += 3; if (body.includes(kw)) scores[cat] += 1; }
  const topCat = Object.keys(scores).reduce((a, b) => (scores[b] > scores[a] ? b : a));
  const top = scores[topCat];
  if (top === 0) return { value: 'Other', confidence: 0.4, source: 'no keyword match' };
  return { value: topCat, confidence: round2(clamp(0.55 + 0.08 * top, 0.55, 0.9)), source: `${topCat} score=${top}` };
}

/** Top level: OcrResult → ExpenseFields (contract §2/§8). */
export function extractFields(ocr: OcrResult): ExpenseFields {
  const lines = ocr.lines;
  const height = ocr.height ?? Math.max(1, ...lines.map((l) => l.y + (l.h ?? 0)));
  const receiptText = lines.map((l) => l.text).join('\n');

  const total = extractTotal(lines, receiptText);
  const date = extractDate(lines, dateLocaleFor(receiptText));
  const merchant = extractMerchant(lines, height);

  const items: LineItem[] = [];
  const bodyTexts: string[] = [];
  for (const ln of lines) {
    const amts = amountsIn(ln.text);
    const U = ln.text.toUpperCase();
    if (amts.length && !POS_TOTAL_RE.test(U) && !NEG_LABEL_RE.test(U)) {
      const desc = ln.text.replace(MONEY_RE, '').replace(MONEY_INT_RE, '').replace(/[\s.\-\t]+$/, '').trim();
      if (alphaRatio(ln.text) > 0.2) items.push({ description: desc, amount: round2(amts[amts.length - 1]) });
    }
    bodyTexts.push(ln.text);
  }
  const category = extractCategory(merchant.value, bodyTexts);

  const fields = { merchant, date, total, category, lineItems: items } as Omit<ExpenseFields, 'needsReview' | 'reviewFields'>;
  const review = (['merchant', 'date', 'total', 'category'] as const).filter(
    (k) => (fields as any)[k].value == null || (fields as any)[k].confidence < EXPENSE.REVIEW_THRESHOLD,
  );
  return { ...fields, needsReview: review.length > 0, reviewFields: review };
}

export const moneyLabel = (m: Money) => {
  const digits = ZERO_DECIMAL_CODES.has(m.currency) ? 0 : 2;
  const sym = CODE_TO_SYMBOL[m.currency];
  return sym ? `${sym}${m.amount.toFixed(digits)}` : `${m.currency} ${m.amount.toFixed(digits)}`;
};
