/**
 * LiteParseWebView — headless 1×1 invisible WebView that runs
 * @llamaindex/liteparse-wasm in a real browser engine.
 *
 * Mount this once at App root (like NudgeChecks). It initialises the WASM
 * on first render and stays alive for the app's lifetime.
 *
 * iOS  → WebKit (Safari engine) — full WebAssembly support
 * Android → Chromium WebView — full WebAssembly support
 *
 * The WASM binary is bundled offline in liteparseWebBundle.ts (no network).
 */
import React, { useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { LITEPARSE_WEB_HTML } from './liteparseWebBundle';
import { handleWebViewMessage, registerWebView } from './liteparseWebBridge';

type WebViewModule = {
  WebView: React.ComponentType<{
    ref: React.Ref<{ postMessage: (msg: string) => void }>;
    source: { html: string };
    onMessage: (e: { nativeEvent: { data: string } }) => void;
    style: object;
    scrollEnabled: boolean;
    javaScriptEnabled: boolean;
    originWhitelist: string[];
  }>;
};

let _webviewMod: WebViewModule | null = null;
function getWebViewMod(): WebViewModule | null {
  if (_webviewMod) return _webviewMod;
  try {
    _webviewMod = require('react-native-webview');
    return _webviewMod;
  } catch {
    return null;
  }
}

export function LiteParseWebView() {
  const mod = getWebViewMod();
  const ref = useRef<{ postMessage: (msg: string) => void }>(null);

  React.useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerWebView(ref as any);
  }, []);

  if (!mod) return null;

  const { WebView } = mod;

  return (
    <View style={styles.hidden} pointerEvents="none">
      <WebView
        ref={ref}
        source={{ html: LITEPARSE_WEB_HTML }}
        onMessage={(e) => handleWebViewMessage(e.nativeEvent.data)}
        style={styles.webview}
        scrollEnabled={false}
        javaScriptEnabled
        originWhitelist={['*']}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    pointerEvents: 'none',
  },
  webview: { width: 1, height: 1 },
});
