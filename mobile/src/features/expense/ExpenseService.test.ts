/**
 * ExpenseService tests — focused on the Indian/world-receipt upgrades:
 * whole-number amounts (₹500, 500/-, Rs 1,500), hospital-bill total labels
 * (Net Amount / Bill Amount / Amount Paid), all-ISO-4217 currency detection,
 * "/-" ⇒ INR, per-receipt date locale, and moneyLabel symbols.
 *
 * Mirror rule: every behavior asserted here must hold identically in
 * ml/test/expense_eval.py (contract §2) — fixtures there cover the same cases.
 */
import { dateLocaleFor, extractDate, extractFields, extractTotal, moneyLabel } from './ExpenseService';
import type { OcrLine } from './types';

const line = (text: string, y = 0, conf = 0.95, h = 12): OcrLine => ({ text, y, h, conf });

describe('extractTotal — whole-number amounts', () => {
  it('reads a currency-prefixed integer (₹ 500)', () => {
    const t = extractTotal([line('TOTAL ₹ 500')], 'TOTAL ₹ 500');
    expect(t.value).toMatchObject({ amount: 500, currency: 'INR' });
  });

  it('reads the Indian "/-" suffix and infers INR', () => {
    const t = extractTotal([line('Net Amount 750/-')], 'Net Amount 750/-');
    expect(t.value).toMatchObject({ amount: 750, currency: 'INR', currencyAssumed: false });
  });

  it('does not double-count "₹ 500/-"', () => {
    const lines = [line('Consultation ₹ 500/-', 0), line('TOTAL ₹ 500/-', 20)];
    const t = extractTotal(lines, lines.map((l) => l.text).join('\n'));
    expect(t.value?.amount).toBe(500);
  });

  it('handles Indian digit grouping (₹ 1,50,000)', () => {
    const t = extractTotal([line('BILL AMOUNT ₹ 1,50,000')], 'BILL AMOUNT ₹ 1,50,000');
    expect(t.value?.amount).toBe(150000);
  });

  it('trusts a bare integer only on a labelled total line, with dates stripped', () => {
    const t = extractTotal([line('Net Amount 1500 05/07/2026')], 'Net Amount 1500 05/07/2026');
    expect(t.value?.amount).toBe(1500);
    // bare-integer labelled totals carry the reduced 0.75 structural weight
    expect(t.confidence).toBeCloseTo(0.75 * 0.95 * 0.9, 2);
  });

  it('ignores bare integers on unlabelled lines (quantities, phone numbers)', () => {
    const t = extractTotal([line('Qty 2 Reg 12345')], 'Qty 2 Reg 12345');
    expect(t.value).toBeNull();
  });

  it('still parses classic decimal totals (regression)', () => {
    const t = extractTotal([line('TOTAL 8.09')], 'TOTAL 8.09');
    expect(t.value).toMatchObject({ amount: 8.09, currency: 'USD', currencyAssumed: true });
  });
});

describe('extractTotal — hospital/Indian total labels', () => {
  it.each(['Net Amount', 'Net Payable', 'Amount Payable', 'Bill Amount', 'Amount Paid', 'Paid Amount'])(
    'treats "%s" as a total label',
    (label) => {
      const lines = [line('Room Rent 5000.00', 0), line(`${label} 6200.00`, 20)];
      const t = extractTotal(lines, lines.map((l) => l.text).join('\n'));
      expect(t.value?.amount).toBe(6200);
      expect(t.confidence).toBeGreaterThanOrEqual(0.6);
    },
  );
});

describe('world currency detection', () => {
  it('detects distinctive symbols (¥, ₩, ฿)', () => {
    expect(extractTotal([line('TOTAL ¥800')], 'TOTAL ¥800').value?.currency).toBe('JPY');
    expect(extractTotal([line('TOTAL ₩5000')], 'TOTAL ₩5000').value?.currency).toBe('KRW');
    expect(extractTotal([line('TOTAL ฿120.50')], 'TOTAL ฿120.50').value?.currency).toBe('THB');
  });

  it('detects ISO codes only when digit-adjacent', () => {
    expect(extractTotal([line('TOTAL KES 2,000')], 'TOTAL KES 2,000').value?.currency).toBe('KES');
    // "ALL" as an English word must NOT read as Albanian lek (and no int context ⇒ no amount)
    expect(extractTotal([line('ALL ITEMS 500')], 'ALL ITEMS 500').value).toBeNull();
  });
});

describe('date locale', () => {
  const amb = [line('05/07/2026')];
  it('is day-first for a non-USD receipt', () => {
    expect(extractDate(amb, 'INTL').value).toBe('2026-07-05');
    expect(dateLocaleFor('Net Amount ₹ 750/-')).toBe('INTL');
    expect(dateLocaleFor('TOTAL €9,50')).toBe('INTL');
  });
  it('stays month-first for USD/unknown receipts', () => {
    expect(extractDate(amb, 'US').value).toBe('2026-05-07');
    expect(dateLocaleFor('TOTAL 8.09')).toBe('US');
  });
});

describe('extractFields — Indian hospital bill end-to-end', () => {
  const ocr = {
    height: 220,
    lines: [
      line('MAX HEALTH HOSPITAL', 10, 0.94, 18),
      line('Patient: A. Kumar', 40, 0.9, 10),
      line('05/07/2026', 58, 0.91, 10),
      line('Consultation 500/-', 90, 0.92, 11),
      line('Pharmacy 250/-', 106, 0.92, 11),
      line('Net Amount ₹ 750/-', 140, 0.93, 12),
    ],
  };
  const f = extractFields(ocr);

  it('finds the merchant, total, INR currency, day-first date, and Health category', () => {
    expect(f.merchant.value).toContain('MAX HEALTH');
    expect(f.total.value).toMatchObject({ amount: 750, currency: 'INR' });
    expect(f.date.value).toBe('2026-07-05');
    expect(f.category.value).toBe('Health');
  });

  it('extracts the line items with clean descriptions', () => {
    expect(f.lineItems).toEqual([
      { description: 'Consultation', amount: 500 },
      { description: 'Pharmacy', amount: 250 },
    ]);
  });

  it('still flags the ambiguous numeric date for review (honest uncertainty)', () => {
    expect(f.date.ambiguous).toBe(true);
    expect(f.reviewFields).toContain('date');
  });
});

describe('moneyLabel', () => {
  it('uses symbols where they exist and zero decimals for zero-decimal currencies', () => {
    expect(moneyLabel({ amount: 750, currency: 'INR', currencyAssumed: false })).toBe('₹750.00');
    expect(moneyLabel({ amount: 800, currency: 'JPY', currencyAssumed: false })).toBe('¥800');
    expect(moneyLabel({ amount: 45, currency: 'AED', currencyAssumed: false })).toBe('AED 45.00');
  });
});
