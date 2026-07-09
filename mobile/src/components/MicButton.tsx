/**
 * MicButton — tap to speak a task instead of typing it (Overwhelm Manager only).
 * Four visual states: idle (plain circle), recording (accent-filled, pulsing
 * via opacity), transcribing (dimmed + PulseIndicator), unavailable (muted,
 * disabled — shown rather than hidden, so a real failure is honest instead of
 * silently invisible; see the caller's voiceUnavailableLine for why).
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { color, radii } from '../theme/tokens';
import type { VoiceInputState } from '../features/overwhelm/useVoiceInput';

type Props = {
  state: VoiceInputState;
  onPress: () => void;
};

export function MicButton({ state, onPress }: Props) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (state !== 'recording') {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.5, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [state, pulse]);

  const label =
    state === 'recording'
      ? 'Stop recording'
      : state === 'transcribing'
        ? 'Transcribing'
        : state === 'unavailable'
          ? 'Voice input unavailable on this device'
          : 'Speak your task';

  return (
    <Pressable
      onPress={onPress}
      disabled={state === 'transcribing' || state === 'unavailable'}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: state === 'transcribing' || state === 'unavailable' }}
      style={({ pressed }) => [
        styles.base,
        state === 'recording' && styles.recording,
        state === 'unavailable' && styles.unavailable,
        pressed && styles.pressed,
      ]}
    >
      <Animated.View style={{ opacity: state === 'transcribing' ? 0.4 : pulse }}>
        <View style={[styles.dot, state === 'recording' && styles.dotRecording]}>
          <Text style={[styles.glyph, state === 'unavailable' && styles.glyphUnavailable]}>●</Text>
        </View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surfaceAlt,
  },
  recording: { backgroundColor: color.accentMuted },
  unavailable: { backgroundColor: color.surfaceAlt, borderWidth: 1.5, borderColor: color.textTertiary },
  pressed: { opacity: 0.7 },
  dot: { alignItems: 'center', justifyContent: 'center' },
  dotRecording: {},
  glyph: { fontSize: 14, color: color.accent },
  glyphUnavailable: { color: color.textTertiary },
});

export default MicButton;
