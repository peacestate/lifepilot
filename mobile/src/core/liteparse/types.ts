/**
 * LiteParse result types — mirrors @llamaindex/liteparse-wasm JSON output.
 * Used by liteparseService.ts and consumers (pdfSource, healthImportUtils).
 */

export type BBox = [x: number, y: number, width: number, height: number];

export type PageItem = {
  text: string;
  bbox: BBox;
  /** 'text' | 'table_cell' | 'heading' | 'caption' | 'figure' */
  type: string;
  /** Confidence 0..1 (present when OCR was used). */
  confidence?: number;
};

export type ParsedPage = {
  page: number;
  items: PageItem[];
  /** Full concatenated text for this page. */
  text: string;
  /** True if this page was OCR'd (scanned), false if text-layer. */
  wasOcr: boolean;
};

export type LiteParseResult = {
  /** Full document text — all pages joined. */
  text: string;
  pages: ParsedPage[];
  /** 'liteparse' | 'regex-fallback' — lets callers know which path ran. */
  engine: 'liteparse' | 'regex-fallback';
  /** Tables extracted as 2D string arrays, one per table found. */
  tables: string[][][];
  pageCount: number;
};
