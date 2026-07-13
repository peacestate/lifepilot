/**
 * LiteParse service — table-aware PDF parsing via @llamaindex/liteparse-wasm.
 *
 * On iOS (with Polygen AOT compilation):
 *   @llamaindex/liteparse-wasm is compiled WASM → C → JSI TurboModule by
 *   Polygen at `expo prebuild`. No JIT, App Store safe.
 *
 * On Android (WebView bridge):
 *   WASM runs inside a hidden WebView (Chromium engine — full WASM support).
 *   LiteParseWebView must be mounted at App root. No native compilation needed.
 *   Run `node scripts/bundle-liteparse.js` to regenerate liteparseWebBundle.ts
 *   after updating the liteparse-wasm package.
 *
 * Fallback (neither available):
 *   regex BT/ET extractor — works for software-generated PDFs only.
 *
 * To activate LiteParse on iOS:
 *   1. Install wabt: `brew install wabt`
 *   2. `npm install`
 *   3. `expo prebuild` — Polygen compiles WASM → native TurboModule
 *   4. Build + run on device
 *
 * OCR callback:
 *   Pass an `ocrCallback` for scanned PDFs. The callback receives raw image bytes
 *   for each scanned page and must return the OCR text string. Wire native ML Kit
 *   here once the VisionCamera / ML Kit native module is set up.
 */
import { Platform } from 'react-native';

import type { LiteParseResult, ParsedPage, PageItem } from './types';
import { extractPdfTextLayer } from './regexExtractor';
import * as webBridge from './liteparseWebBridge';

export type OcrCallback = (imageBytes: Uint8Array) => Promise<string>;

export type ParseOptions = {
  /** Provide an ML Kit OCR callback to handle scanned / image-only pages. */
  ocrCallback?: OcrCallback;
};

// ── WASM module shape (mirrors @llamaindex/liteparse-wasm public API) ─────────

type LiteParseInstance = {
  parse: (bytes: Uint8Array, options?: { ocrCallback?: OcrCallback }) => Promise<string>;
};

type WasmModule = {
  default: () => Promise<void>;
  LiteParse: new (opts: { ocrEnabled: boolean; outputFormat: 'json' }) => LiteParseInstance;
};

// ── Singleton init ─────────────────────────────────────────────────────────────

let _wasm: WasmModule | null = null;
let _initAttempted = false;

async function tryInitWasm(): Promise<boolean> {
  if (_initAttempted) return _wasm !== null;
  _initAttempted = true;
  try {
    // Dynamic import keeps bundler from erroring when package isn't installed.
    // Polygen intercepts this on iOS and routes to the AOT-compiled TurboModule.
    const mod = await import('@llamaindex/liteparse-wasm');
    // Double cast: the package's generated types don't structurally overlap WasmModule.
    await (mod as unknown as WasmModule).default(); // init WASM runtime (no-op with Polygen native)
    _wasm = mod as unknown as WasmModule;
    return true;
  } catch {
    return false;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Parse a PDF from base64 string.
 * Returns a LiteParseResult with engine='liteparse' on iOS (Polygen active)
 * or engine='regex-fallback' on Android / before prebuild.
 */
export async function parsePdf(base64: string, options: ParseOptions = {}): Promise<LiteParseResult> {
  // Android: route through hidden WebView (Chromium — full WASM support)
  if (Platform.OS === 'android') {
    return androidWebViewParse(base64);
  }
  // iOS: Polygen AOT path
  const available = await tryInitWasm();
  if (!available) return regexFallback(base64);
  try {
    return await runLiteParse(base64, options);
  } catch {
    return regexFallback(base64);
  }
}

async function androidWebViewParse(base64: string): Promise<LiteParseResult> {
  try {
    const rawJson = await webBridge.parse(base64);
    const raw: RawLiteParseOutput = JSON.parse(rawJson);
    return buildResult(raw);
  } catch {
    return regexFallback(base64);
  }
}

/**
 * True once the WASM module has initialised successfully.
 * Useful to display an "Enhanced parsing active" badge in the UI.
 * Returns false before the first parsePdf() call.
 */
export function isLiteParseAvailable(): boolean {
  if (Platform.OS === 'android') return webBridge.isReady();
  return _wasm !== null;
}

// ── LiteParse path ─────────────────────────────────────────────────────────────

async function runLiteParse(base64: string, options: ParseOptions): Promise<LiteParseResult> {
  const { LiteParse } = _wasm!;

  const bytes = base64ToUint8Array(base64);
  const ocrEnabled = !!options.ocrCallback;
  const parser = new LiteParse({ ocrEnabled, outputFormat: 'json' });

  const rawJson = await parser.parse(bytes, options.ocrCallback ? { ocrCallback: options.ocrCallback } : undefined);
  const raw: RawLiteParseOutput = JSON.parse(rawJson);

  return buildResult(raw);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ── Raw output types (LiteParse JSON schema) ───────────────────────────────────

type RawItem = {
  text: string;
  bbox?: { x: number; y: number; width: number; height: number };
  element_type?: string;
  row_index?: number;
  col_index?: number;
  confidence?: number;
  was_ocr?: boolean;
};

type RawPage = {
  page_number?: number;
  items?: RawItem[];
};

type RawLiteParseOutput = {
  pages?: RawPage[];
};

// ── Result builder ─────────────────────────────────────────────────────────────

function buildResult(raw: RawLiteParseOutput): LiteParseResult {
  const rawPages = raw.pages ?? [];

  const pages: ParsedPage[] = rawPages.map((p) => {
    const items: PageItem[] = (p.items ?? []).map((item) => ({
      text: item.text ?? '',
      bbox: [
        item.bbox?.x ?? 0,
        item.bbox?.y ?? 0,
        item.bbox?.width ?? 0,
        item.bbox?.height ?? 0,
      ],
      type: item.element_type ?? 'text',
      confidence: item.confidence,
    }));

    const pageText = items.map((i) => i.text).join(' ').trim();
    const wasOcr = (p.items ?? []).some((i) => i.was_ocr === true);

    return {
      page: p.page_number ?? 1,
      items,
      text: pageText,
      wasOcr,
    };
  });

  const tables = extractTables(rawPages);
  const text = pages.map((p) => p.text).join('\n').trim();

  return {
    text,
    pages,
    tables,
    pageCount: pages.length,
    engine: 'liteparse',
  };
}

/**
 * Reconstruct 2D table grids from items with element_type='TableCell'
 * and row_index / col_index coordinates.
 */
function extractTables(rawPages: RawPage[]): string[][][] {
  const tables: string[][][] = [];

  for (const page of rawPages) {
    const cells = (page.items ?? []).filter((i) => i.element_type === 'TableCell');
    if (!cells.length) continue;

    const maxRow = Math.max(...cells.map((c) => c.row_index ?? 0));
    const maxCol = Math.max(...cells.map((c) => c.col_index ?? 0));

    const grid: string[][] = Array.from({ length: maxRow + 1 }, () =>
      Array.from({ length: maxCol + 1 }, () => '')
    );

    for (const cell of cells) {
      const r = cell.row_index ?? 0;
      const c = cell.col_index ?? 0;
      if (r <= maxRow && c <= maxCol) {
        grid[r][c] = (cell.text ?? '').trim();
      }
    }

    // Only include non-trivial tables (more than 1 row, more than 1 col)
    if (maxRow >= 1 && maxCol >= 1) {
      tables.push(grid);
    }
  }

  return tables;
}

// ── Regex fallback ─────────────────────────────────────────────────────────────

function regexFallback(base64: string): LiteParseResult {
  const text = extractPdfTextLayer(base64);
  const rawLines = text.split('\n').filter(Boolean);

  const page: ParsedPage = {
    page: 1,
    items: rawLines.map((t, i) => ({
      text: t,
      bbox: [0, i * 14, 400, 12],
      type: 'text',
    })),
    text,
    wasOcr: false,
  };

  return {
    text,
    pages: text ? [page] : [],
    tables: [],
    pageCount: text ? 1 : 0,
    engine: 'regex-fallback',
  };
}
