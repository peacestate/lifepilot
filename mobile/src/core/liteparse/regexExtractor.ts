/**
 * Pure-JS PDF text-layer extraction via BT/ET operator parsing.
 * Works for software-generated PDFs only (no scanned pages).
 * Used as the fallback when LiteParse WASM is not available.
 */
export function extractPdfTextLayer(base64: string): string {
  try {
    const bytes = atob(base64);
    const lines: string[] = [];
    const blockRe = /BT[\s\S]*?ET/g;
    let blockMatch: RegExpExecArray | null;
    while ((blockMatch = blockRe.exec(bytes)) !== null) {
      const tjRe = /\(([^)]+)\)\s*T[jJ]|<([0-9A-Fa-f]+)>\s*T[jJ]/g;
      let tjMatch: RegExpExecArray | null;
      while ((tjMatch = tjRe.exec(blockMatch[0])) !== null) {
        const literal = tjMatch[1];
        const hex = tjMatch[2];
        if (literal) {
          const clean = literal.replace(/\\n/g, ' ').replace(/\\\\/g, '\\').trim();
          if (clean) lines.push(clean);
        } else if (hex) {
          let decoded = '';
          for (let i = 0; i < hex.length; i += 2) {
            decoded += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
          }
          const clean = decoded.replace(/\s+/g, ' ').trim();
          if (clean) lines.push(clean);
        }
      }
    }
    return lines.join('\n');
  } catch {
    return '';
  }
}
