/**
 * liteparseWebBridge — message-passing layer between liteparseService and
 * the hidden LiteParseWebView component.
 *
 * How it works:
 *   1. liteparseService calls parse(base64) → returns a Promise
 *   2. bridge sends { type:'parse', id, base64 } to the hidden WebView
 *   3. WebView runs LiteParse WASM in its browser engine (full WASM support)
 *   4. WebView sends back { type:'result', id, result } via onMessage
 *   5. bridge resolves the Promise with the result JSON string
 */
import type React from 'react';

type WebViewRef = {
  postMessage: (msg: string) => void;
};

type PendingRequest = {
  resolve: (json: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

let _webviewRef: React.RefObject<WebViewRef> | null = null;
let _ready = false;
const _pending = new Map<string, PendingRequest>();
const _queue: string[] = [];

let _idCounter = 0;
function nextId(): string {
  return `lp_${++_idCounter}_${Date.now()}`;
}

/** Called by LiteParseWebView to register the WebView ref. */
export function registerWebView(ref: React.RefObject<WebViewRef>): void {
  _webviewRef = ref;
}

/** Called by LiteParseWebView's onMessage handler. */
export function handleWebViewMessage(data: string): void {
  try {
    const msg = JSON.parse(data) as { type: string; id?: string; result?: string; message?: string };

    if (msg.type === 'ready') {
      _ready = true;
      // Flush queued messages
      for (const raw of _queue) {
        _webviewRef?.current?.postMessage(raw);
      }
      _queue.length = 0;
      return;
    }

    if (msg.type === 'result' && msg.id) {
      const pending = _pending.get(msg.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      _pending.delete(msg.id);
      if (msg.message) {
        pending.reject(new Error(msg.message));
      } else {
        pending.resolve(msg.result ?? '{}');
      }
    }
  } catch {
    // malformed message — ignore
  }
}

/**
 * Parse a PDF base64 string via the hidden WebView.
 * Rejects after 30s timeout (large scanned PDFs may take a few seconds).
 */
export function parse(base64: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const id = nextId();

    const timer = setTimeout(() => {
      _pending.delete(id);
      reject(new Error('LiteParseWebBridge: parse timeout'));
    }, 30_000);

    _pending.set(id, { resolve, reject, timer });

    const msg = JSON.stringify({ type: 'parse', id, base64 });

    if (!_ready || !_webviewRef?.current) {
      _queue.push(msg);
    } else {
      _webviewRef.current.postMessage(msg);
    }
  });
}

export function isReady(): boolean {
  return _ready;
}
