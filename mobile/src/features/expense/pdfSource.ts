/**
 * pdfSource — document picker + PDF parsing for the Expense Scanner.
 *
 * Images → native camera-path OCR (fast, zero-copy).
 * PDFs   → liteparseService:
 *   iOS  (Polygen active): @llamaindex/liteparse-wasm — table-aware, multi-column,
 *                          spatial layout; passes scanned pages to ML Kit OCR callback.
 *   Android / fallback:   regex BT/ET extractor — software-generated PDFs only.
 *
 * PRIVACY: expo-document-picker copies to app cache only; never uploaded.
 */
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';

import { parsePdf } from '../../core/liteparse/liteparseService';
import type { OcrResult, OcrLine } from './types';

export type PickResult =
  | { kind: 'image'; uri: string }
  | { kind: 'pdf'; ocrResult: OcrResult }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string };

/**
 * Open the system document picker (images + PDFs).
 * Returns an image URI for the camera OCR path, or an OcrResult for the PDF path.
 */
export async function pickDocument(): Promise<PickResult> {
  try {
    const picked = await DocumentPicker.getDocumentAsync({
      type: ['image/*', 'application/pdf'],
      copyToCacheDirectory: true,
    });

    if (picked.canceled || !picked.assets?.length) return { kind: 'cancelled' };

    const asset = picked.assets[0];
    const mime = asset.mimeType ?? '';

    if (mime.startsWith('image/')) {
      return { kind: 'image', uri: asset.uri };
    }

    const b64 = await FileSystem.readAsStringAsync(asset.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const result = await parsePdf(b64);
    return { kind: 'pdf', ocrResult: liteparseToOcrResult(result, asset.name) };
  } catch (e) {
    return {
      kind: 'error',
      message: e instanceof Error ? e.message : 'Could not read document.',
    };
  }
}

/**
 * Map a LiteParseResult to the OcrResult shape the ExpenseService already uses.
 * Flattens table cells and normal text lines into a single ordered list so
 * the field-extraction pipeline works unchanged.
 */
function liteparseToOcrResult(
  result: import('../../core/liteparse/types').LiteParseResult,
  sourceName?: string | null
): OcrResult {
  if (!result.text.trim()) {
    const engineNote = result.engine === 'liteparse'
      ? 'LiteParse found no text — this PDF may be fully scanned. Enable ML Kit OCR callback.'
      : 'No text layer found. LiteParse (iOS) or ML Kit OCR required for scanned receipts.';
    return {
      lines: [{
        text: sourceName ? `"${sourceName}": ${engineNote}` : engineNote,
        y: 0,
        conf: 0.1,
      }],
    };
  }

  const lines: OcrLine[] = [];
  let y = 0;

  for (const page of result.pages) {
    for (const item of page.items) {
      if (!item.text.trim()) continue;
      lines.push({
        text: item.text,
        y: item.bbox[1] + (page.page - 1) * 1000, // stack pages vertically
        h: item.bbox[3] || 12,
        // LiteParse has higher confidence than regex; scanned pages get lower conf
        conf: page.wasOcr ? 0.7 : 0.88,
      });
      y += 14;
    }
  }

  // Deduplicate consecutive identical lines (some PDFs render text twice)
  const deduped = lines.filter((l, i) => i === 0 || l.text !== lines[i - 1].text);

  return { lines: deduped };
}

// Re-export for tests and other consumers that import textToOcrResult from here
export { liteparseToOcrResult as textToOcrResult };
