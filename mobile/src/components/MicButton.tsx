/**
 * MicButton — tap to speak a task instead of typing it (Overwhelm Manager only).
 * Three visual states: idle (plain circle), recording (accent-filled, pulsing
 * via opacity), transcribing (dimmed + PulseIndicator). Hidden entirely when
 * voice input isn't ready (model still provisioning/loading).
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

  if (state === 'unavailable') return null;

  const label =
    state === 'recording'
      ? 'Stop recording'
      : state === 'transcribing'
        ? 'Transcribing'
        : 'Speak your task';

  return (
    <Pressable
      onPress={onPress}
      disabled={state === 'transcribing'}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.base,
        state === 'recording' && styles.recording,
        pressed && styles.pressed,
      ]}
    >
      <Animated.View style={{ opacity: state === 'transcribing' ? 0.4 : pulse }}>
        <View style={[styles.dot, state === 'recording' && styles.dotRecording]}>
          <Text style={styles.glyph}>●</Text>
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
  pressed: { opacity: 0.7 },
  dot: { alignItems: 'center', justifyContent: 'center' },
  dotRecording: {},
  glyph: { fontSize: 14, color: color.accent },
});

export default MicButton;
