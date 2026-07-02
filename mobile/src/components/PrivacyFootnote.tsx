/**
 * PrivacyFootnote — pinned-low reassurance. Spec §2h / §4.
 * Caption, secondary color, leading device/lock glyph, centered.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { color, space, type } from '../theme/tokens';

type Props = { text: string };

export function PrivacyFootnote({ text }: Props) {
  return (
    <View style={styles.wrap} accessible accessibilityRole="text">
      <Text style={styles.text} maxFontSizeMultiplier={1.6}>
        {/* device glyph — decorative */}
        {'◉'} {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: space[6],
    alignItems: 'center',
  },
  text: {
    ...type.caption,
    color: color.textSecondary,
    textAlign: 'center',
  },
});

export default PrivacyFootnote;
