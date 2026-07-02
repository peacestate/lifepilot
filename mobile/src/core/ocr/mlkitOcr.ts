/**
 * mlkitOcr — on-device text recognition wrapper.
 *
 * Uses react-native-mlkit-ocr which routes to:
 *   iOS     → Apple Vision (VNRecognizeTextRequest) — built-in, no download
 *   Android → Google ML Kit Text Recognition — first-use downloads a ~1 MB model
 *
 * Both paths are 100% on-device. No bytes leave the device.
 *
 * Exports two surfaces:
 *   recognizeFromUri(uri)    → OcrResult   — for the expense scanner receipt flow
 *   recognizeTextFromBytes(bytes) → string — for the LiteParse scanned-page OCR callback
 */
import * as FileSystem from 'expo-file-system';

import type { OcrResult, OcrLine } from './types';

// ── Dynamic import guard ────────────────────────────────────────────────────
// react-native-mlkit-ocr is a native module — it will throw during unit tests
// or if the native build hasn't run. Dynamic guard prevents import-time crashes.

type MlkitOcrModule = {
  default: {
    detectFromUri(uri: string): Promise<MlkitBlock[]>;
  };
};

type MlkitBlock = {
  text: string;
  bounding: { top: number; left: number; bottom: number; right: number };
  lines: MlkitLine[];
};

type MlkitLine = {
  text: string;
  bounding: { top: number; left: number; bottom: number; right: number };
};

let _mlkit: MlkitOcrModule['default'] | null = null;
let _mlkitAttempted = false;

async function getMlkit(): Promise<MlkitOcrModule['default'] | null> {
  if (_mlkitAttempted) return _mlkit;
  _mlkitAttempted = true;
  try {
    const mod: MlkitOcrModule = await import(
      // @ts-expect-error — optional peer dep; not present until `npm install` + prebuild
      'react-native-mlkit-ocr'
    );
    _mlkit = mod.default;
    return _mlkit;
  } catch {
    return null;
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Recognize text from an image URI.
 * Returns a structured OcrResult suitable for the expense field-extraction pipeline.
 * Falls back to an empty result if ML Kit is unavailable (before native build).
 */
export async function recognizeFromUri(uri: string): Promise<OcrResult> {
  const mlkit = await getMlkit();
  if (!mlkit) return { lines: [] };

  try {
    const blocks = await mlkit.detectFromUri(uri);
    return blocksToOcrResult(blocks);
  } catch {
    return { lines: [] };
  }
}

/**
 * Recognize text from raw image bytes (Uint8Array).
 * Writes to a temp file, runs OCR, cleans up. Returns plain text string.
 * Used as the OCR callback in liteparseService for scanned PDF pages.
 */
export async function recognizeTextFromBytes(bytes: Uint8Array): Promise<string> {
  const tempUri = `${FileSystem.cacheDirectory}lp_ocr_${Date.now()}.jpg`;
  try {
    await FileSystem.writeAsStringAsync(tempUri, uint8ArrayToBase64(bytes), {
      encoding: FileSystem.EncodingType.Base64,
    });
    const result = await recognizeFromUri(tempUri);
    return result.lines.map((l) => l.text).join('\n');
  } finally {
    FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => {});
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function blocksToOcrResult(blocks: MlkitBlock[]): OcrResult {
  const lines: OcrLine[] = [];

  for (const block of blocks) {
    for (const line of block.lines) {
      if (!line.text.trim()) continue;
      const h = line.bounding.bottom - line.bounding.top;
      lines.push({
        text: line.text.trim(),
        y: line.bounding.top,
        h: h > 0 ? h : undefined,
        conf: 0.9, // ML Kit doesn't expose per-line confidence; 0.9 reflects typical accuracy
      });
    }
  }

  // Sort top-to-bottom to match reading order
  lines.sort((a, b) => a.y - b.y);

  const totalHeight = lines.length > 0
    ? Math.max(...lines.map((l) => l.y + (l.h ?? 12)))
    : 0;

  return { lines, height: totalHeight };
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
