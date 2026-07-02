/**
 * StepProgress — "{done} of {total} done" + thin animated bar. Spec §2d.
 * Hidden until ≥ 1 step exists. Announces progress politely to screen readers.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

import { color, radii, space, type } from '../theme/tokens';

type Props = {
  done: number;
  total: number;
};

export function StepProgress({ done, total }: Props) {
  const widthAnim = useRef(new Animated.Value(0)).current;
  const ratio = total > 0 ? done / total : 0;

  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: ratio,
      duration: 200,
      useNativeDriver: false, // animating width
    }).start();
  }, [ratio, widthAnim]);

  if (total === 0) return null;

  return (
    <View style={styles.wrap}>
      <Text
        style={styles.label}
        accessibilityLiveRegion="polite"
        accessibilityLabel={`${done} of ${total} steps done`}
        maxFontSizeMultiplier={1.6}
      >
        {done} of {total} done
      </Text>
      <View style={styles.track}>
        <Animated.View
          style={[
            styles.fill,
            {
              width: widthAnim.interpolate({
                inputRange: [0, 1],
                outputRange: ['0%', '100%'],
              }),
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: space[4] },
  label: {
    ...type.caption,
    color: color.textSecondary,
    marginBottom: space[2],
  },
  track: {
    height: 6,
    borderRadius: radii.pill,
    backgroundColor: color.surfaceAlt,
    overflow: 'hidden',
  },
  fill: {
    height: 6,
    borderRadius: radii.pill,
    backgroundColor: color.accent,
  },
});

export default StepProgress;
