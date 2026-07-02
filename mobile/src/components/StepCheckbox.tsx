/**
 * StepCheckbox — 24×24 rounded square. Spec §2f.
 * Unchecked: 2px border. Checked: accent fill + white check, 120ms scale pop.
 * Hit slop expands the tappable area to ≥ 44×44 (also handled by the row).
 * Respects reduce-motion (no pop).
 */
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, Text } from 'react-native';

import { color, radii } from '../theme/tokens';

type Props = { checked: boolean };

export function StepCheckbox({ checked }: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => mounted && setReduceMotion(v));
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!checked || reduceMotion) return;
    Animated.sequence([
      Animated.timing(scale, { toValue: 1.08, duration: 60, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1, duration: 60, useNativeDriver: true }),
    ]).start();
  }, [checked, reduceMotion, scale]);

  return (
    <Animated.View
      style={[
        styles.box,
        checked ? styles.boxChecked : styles.boxUnchecked,
        { transform: [{ scale }] },
      ]}
      // Row owns the checkbox role; mark this decorative.
      importantForAccessibility="no"
    >
      {checked && (
        <Text style={styles.check} allowFontScaling={false}>
          ✓
        </Text>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  box: {
    width: 24,
    height: 24,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxUnchecked: {
    borderWidth: 2,
    borderColor: color.border,
    backgroundColor: 'transparent',
  },
  boxChecked: {
    borderWidth: 2,
    borderColor: color.accent,
    backgroundColor: color.accent,
  },
  check: {
    color: color.onAccent,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 18,
  },
});

export default StepCheckbox;
