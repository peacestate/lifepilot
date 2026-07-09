/** Core OCR types — shared by mlkitOcr, liteparseService, and the expense pipeline. */

/** One line from native on-device OCR (Apple Vision / ML Kit), normalized.
 * x/w (horizontal position/width) are optional — present from ML Kit and LiteParse,
 * absent in older fixtures — and are what lets rowMerge stitch table columns and
 * split headers ("MAX" + "HEALTH") back into one logical row. */
export type OcrLine = { text: string; y: number; h?: number; conf: number; x?: number; w?: number };
export type OcrResult = { lines: OcrLine[]; width?: number; height?: number };
