/** Core OCR types — shared by mlkitOcr, liteparseService, and the expense pipeline. */

/** One line from native on-device OCR (Apple Vision / ML Kit), normalized. */
export type OcrLine = { text: string; y: number; h?: number; conf: number };
export type OcrResult = { lines: OcrLine[]; width?: number; height?: number };
