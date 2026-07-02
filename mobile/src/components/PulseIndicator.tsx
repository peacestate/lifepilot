/**
 * PulseIndicator — three dots fading in sequence (~1.4s loop). Spec §1b / §5g.
 * Calm, NOT a network spinner. Respects reduce-motion: static dimmed dots.
 */
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';

import { color } from '../theme/tokens';

const DOTS = [0, 1, 2];
const LOOP_MS = 1400;

export function PulseIndicator() {
  const [reduceMotion, setReduceMotion] = useState(false);
  const anims = useRef(DOTS.map(() => new Animated.Value(0.3))).current;

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => mounted && setReduceMotion(v));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) return;
    const loops = anims.map((a, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay((i * LOOP_MS) / 3),
          Animated.timing(a, {
            toValue: 1,
            duration: LOOP_MS / 3,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(a, {
            toValue: 0.3,
            duration: LOOP_MS / 3,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [reduceMotion, anims]);

  return (
    <View
      style={styles.row}
      accessibilityRole="progressbar"
      accessibilityLabel="Thinking on your device"
    >
      {DOTS.map((d) => (
        <Animated.View
          key={d}
          style={[styles.dot, { opacity: reduceMotion ? 0.5 : anims[d] }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: color.accent,
  },
});

export default PulseIndicator;
