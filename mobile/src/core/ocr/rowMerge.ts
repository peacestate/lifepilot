/**
 * rowMerge — stitch OCR fragments that share a horizontal band back into one row.
 *
 * WHY: ML Kit (and LiteParse on multi-column PDFs) returns table-style receipts as
 * SEPARATE lines per column — "Total" and "1500.00" arrive as two fragments, and a
 * split header arrives as "MAX" + "HEALTH". The expense parser assumes a label and
 * its value share one line, so without this step table bills lose their totals and
 * merchants get truncated to a single fragment.
 *
 * Two fragments belong to the same row when their vertical extents overlap by at
 * least half of the smaller fragment's height. Fragments in a row are ordered by x
 * (left→right; falls back to input order when x is missing) and joined with spaces.
 * Merged row: y/h span the union, conf is the minimum (a row is only as trustworthy
 * as its weakest fragment), x/w span the union.
 *
 * Pure function, no I/O — safe for unit tests and the PDF path alike.
 */
import type { OcrLine, OcrResult } from './types';

const DEFAULT_H = 12;

function overlapsRow(row: OcrLine[], ln: OcrLine): boolean {
  const lnTop = ln.y;
  const lnBot = ln.y + (ln.h ?? DEFAULT_H);
  return row.some((r) => {
    const rTop = r.y;
    const rBot = r.y + (r.h ?? DEFAULT_H);
    const overlap = Math.min(lnBot, rBot) - Math.max(lnTop, rTop);
    const minH = Math.min(lnBot - lnTop, rBot - rTop);
    return overlap >= 0.5 * Math.max(1, minH);
  });
}

function mergeRow(row: OcrLine[]): OcrLine {
  if (row.length === 1) return row[0];
  const anyX = row.some((l) => l.x != null);
  const ordered = anyX ? [...row].sort((a, b) => (a.x ?? 0) - (b.x ?? 0)) : row;
  const top = Math.min(...row.map((l) => l.y));
  const bot = Math.max(...row.map((l) => l.y + (l.h ?? DEFAULT_H)));
  const merged: OcrLine = {
    text: ordered.map((l) => l.text).join(' '),
    y: top,
    h: bot - top,
    conf: Math.min(...row.map((l) => l.conf)),
  };
  if (anyX) {
    merged.x = Math.min(...row.map((l) => l.x ?? 0));
    const right = Math.max(...row.map((l) => (l.x ?? 0) + (l.w ?? 0)));
    if (right > (merged.x ?? 0)) merged.w = right - (merged.x ?? 0);
  }
  return merged;
}

/** Group same-band fragments into single rows. Order-preserving (top→bottom). */
export function mergeOcrRows(result: OcrResult): OcrResult {
  if (result.lines.length < 2) return result;
  const sorted = [...result.lines].sort((a, b) => a.y - b.y);
  const rows: OcrLine[][] = [];
  for (const ln of sorted) {
    const current = rows[rows.length - 1];
    if (current && overlapsRow(current, ln)) current.push(ln);
    else rows.push([ln]);
  }
  return { ...result, lines: rows.map(mergeRow) };
}
