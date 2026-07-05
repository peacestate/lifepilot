/**
 * Stub for `react-native-gesture-handler` — this app never uses it.
 *
 * It's only imported by `react-native-audio-api`'s bundled `AudioControls`
 * UI component, which this app never renders (we only use `AudioRecorder` +
 * `AudioManager` from the package). Metro still needs the import to *resolve*,
 * but the real package's `Gesture`/`GestureDetector` (via
 * GestureDetector/useAnimatedGesture.ts) call into `react-native-worklets`'
 * native module AT MODULE LOAD TIME — before any component even renders —
 * and that call throws `TypeError: undefined is not a function` with the
 * worklets version this project pins (0.7.1, kept old specifically to avoid
 * a native symbol collision with reanimated, see stubs/react-native-reanimated.js).
 * That crash happened on app boot even though AudioControls is dead code —
 * confirmed via a symbolicated stack trace pointing at
 * GestureDetector/useAnimatedGesture.ts calling
 * NativeWorklets.native.ts's synchronizableGetDirty/cloneArrayBuffer.
 *
 * Stubbing resolves the import with plain JS (no native module, no
 * module-scope side effects), so nothing in this dead code path ever runs.
 * Only implements the exact chainable surface AudioControls.tsx calls
 * (Gesture.Pan/.Tap/.Race + the fluent methods used in its useMemo) —
 * verified against that file's actual usage, not guessed.
 */
function chainable() {
  const gesture = {};
  const methods = ['runOnJS', 'minDistance', 'maxDistance', 'onStart', 'onUpdate', 'onEnd', 'onFinalize'];
  for (const m of methods) {
    gesture[m] = () => gesture;
  }
  return gesture;
}

module.exports = {
  __esModule: true,
  Gesture: {
    Pan: chainable,
    Tap: chainable,
    Race: (...gestures) => gestures,
  },
  GestureDetector: ({ children }) => children ?? null,
};
