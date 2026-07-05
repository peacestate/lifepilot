/**
 * Stub for `react-native-reanimated` — this app never uses reanimated.
 *
 * It's only imported by `react-native-audio-api`'s bundled `AudioControls`
 * UI component, which this app never renders (we only use `AudioRecorder` +
 * `AudioManager` from the package). Metro still needs every import reachable
 * through the package's barrel export to *resolve*, even code that's never
 * called — and the real `react-native-reanimated` package generates its own
 * native "worklets" codegen (`NativeWorkletsModuleSpecJSI`) that collides
 * with the standalone `react-native-worklets` package `react-native-audio-api`
 * itself needs, causing a duplicate-symbol native build failure. This stub
 * resolves the import with plain JS (no native module), so there is exactly
 * one `NativeWorkletsModuleSpecJSI` definition in the whole build.
 *
 * Only exports the three bindings AudioControls.tsx actually references
 * (`Animated.View`, `useAnimatedRef`, `useSharedValue`) — verified against
 * the file's real imports, not guessed. If react-native-audio-api's
 * AudioControls changes its reanimated usage in a future version, this stub
 * will need updating (or the version pin below should be re-verified).
 */
const { View } = require('react-native');

module.exports = {
  __esModule: true,
  default: { View },
  useAnimatedRef: () => ({ current: null }),
  useSharedValue: (initial) => ({ value: initial }),
};
