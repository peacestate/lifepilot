/**
 * rowMerge tests — table columns and split headers must come back as one row,
 * while genuinely separate lines stay separate.
 */
import { mergeOcrRows } from './rowMerge';
import type { OcrResult } from './types';

describe('mergeOcrRows', () => {
  it('joins a table label column and amount column into one line, ordered by x', () => {
    const ocr: OcrResult = {
      height: 200,
      lines: [
        { text: '1500.00', y: 100, h: 12, x: 240, w: 60, conf: 0.9 },
        { text: 'Net Amount', y: 101, h: 12, x: 20, w: 90, conf: 0.9 },
      ],
    };
    const merged = mergeOcrRows(ocr);
    expect(merged.lines).toHaveLength(1);
    expect(merged.lines[0].text).toBe('Net Amount 1500.00');
  });

  it('re-joins a split header ("MAX" + "HEALTH HOSPITAL")', () => {
    const ocr: OcrResult = {
      height: 200,
      lines: [
        { text: 'MAX', y: 10, h: 20, x: 30, w: 50, conf: 0.9 },
        { text: 'HEALTH HOSPITAL', y: 12, h: 18, x: 90, w: 160, conf: 0.9 },
      ],
    };
    expect(mergeOcrRows(ocr).lines[0].text).toBe('MAX HEALTH HOSPITAL');
  });

  it('keeps vertically separate lines apart', () => {
    const ocr: OcrResult = {
      height: 200,
      lines: [
        { text: 'Consultation 500.00', y: 40, h: 12, x: 20, conf: 0.9 },
        { text: 'Pharmacy 250.00', y: 60, h: 12, x: 20, conf: 0.9 },
      ],
    };
    expect(mergeOcrRows(ocr).lines.map((l) => l.text)).toEqual([
      'Consultation 500.00',
      'Pharmacy 250.00',
    ]);
  });

  it('merged row keeps the weakest confidence and the union geometry', () => {
    const ocr: OcrResult = {
      lines: [
        { text: 'Total', y: 100, h: 12, x: 20, w: 40, conf: 0.95 },
        { text: '750', y: 102, h: 12, x: 200, w: 30, conf: 0.7 },
      ],
    };
    const [row] = mergeOcrRows(ocr).lines;
    expect(row.conf).toBe(0.7);
    expect(row.y).toBe(100);
    expect(row.x).toBe(20);
    expect(row.w).toBe(210); // 200 + 30 - 20
  });

  it('works without x (falls back to input order) and on single lines', () => {
    const ocr: OcrResult = {
      lines: [
        { text: 'TOTAL', y: 100, h: 12, conf: 0.9 },
        { text: '8.09', y: 100, h: 12, conf: 0.9 },
      ],
    };
    expect(mergeOcrRows(ocr).lines[0].text).toBe('TOTAL 8.09');
    expect(mergeOcrRows({ lines: [{ text: 'one', y: 0, conf: 1 }] }).lines).toHaveLength(1);
  });
});
