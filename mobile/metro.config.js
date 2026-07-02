// Metro config for Expo + Polygen WASM (iOS) + ExecuTorch assets.
//
// Polygen (by Callstack) AOT-compiles @llamaindex/liteparse-wasm from WASM → C → JSI
// TurboModule during `expo prebuild`. Requires wabt (`brew install wabt`) and
// @callstack/polygen-metro-config to be installed. Without these, the try-catch
// below falls through and Metro runs as usual (LiteParse falls back to regex on device).
//
// ExecuTorch: .pte files are in assetExts so Metro can resolve small tokenizer
// blobs. The ~1 GB Llama .pte is NOT bundled — it is pushed to device and loaded
// by file:// path via expo-file-system (see RUNBOOK.md).
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push('pte', 'bin', 'model');

// Also register .wasm as an asset so Metro doesn't choke on it before
// Polygen has a chance to compile it.
config.resolver.assetExts.push('wasm');

try {
  const { withPolygenConfig } = require('@callstack/polygen-metro-config');
  module.exports = withPolygenConfig(config);
} catch {
  // @callstack/polygen-metro-config not installed yet — run `npm install` + `expo prebuild`
  // to activate LiteParse WASM on iOS. Android falls back to regex extraction.
  module.exports = config;
}
