/**
 * HydrationRing — the calm progress ring (design spec §1, primary visualization).
 * Sage arc fills toward the daily goal; center shows progress text. A soft second
 * lap appears past 100% (never red, never scolding). Uses react-native-svg.
 *
 * a11y: the ring is decorative; the screen provides a text progress label, so the
 * visual and the screen-reader summary never disagree.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { color, type } from '../theme/tokens';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

type Props = {
  /** 0..1 (may exceed 1 for over-target). */
  progress: number;
  centerTop: string;     // e.g. "1.2 L"
  centerSub: string;     // e.g. "of 2.5 L"
  size?: number;
  stroke?: number;
};

export function HydrationRing({ progress, centerTop, centerSub, size = 220, stroke = 16 }: Props) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, progress));
  const over = progress > 1;

  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: clamped, duration: 600, useNativeDriver: false }).start();
  }, [clamped, anim]);

  const dashoffset = anim.interpolate({ inputRange: [0, 1], outputRange: [c, 0] });

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        {/* track */}
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={color.surfaceAlt} strokeWidth={stroke} fill="none" />
        {/* over-target faint second lap */}
        {over && (
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={color.accentMuted} strokeWidth={stroke} fill="none" opacity={0.5} />
        )}
        {/* progress arc */}
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color.accent}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={dashoffset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={styles.center} pointerEvents="none">
        <Text style={styles.centerTop} maxFontSizeMultiplier={1.4}>{centerTop}</Text>
        <Text style={styles.centerSub} maxFontSizeMultiplier={1.4}>{centerSub}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  centerTop: { ...type.h1, color: color.textPrimary },
  centerSub: { ...type.subtext, color: color.textSecondary, marginTop: 2 },
});

export default HydrationRing;
