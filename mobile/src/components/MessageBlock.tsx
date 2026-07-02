/**
 * MessageBlock — shared layout for empty-result AND error states. Spec §1d.
 * Soft neutral glyph + calm copy + actions. Never alarming, never blames the
 * user, never implies a network problem.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { color, space, type } from '../theme/tokens';
import { PrimaryButton } from './PrimaryButton';
import { SecondaryButton } from './SecondaryButton';

type Props = {
  glyph: string; // soft neutral glyph (e.g. "◌")
  message: string;
  onRetry: () => void;
  onEdit: () => void;
  retryLabel: string;
  editLabel: string;
};

export function MessageBlock({
  glyph,
  message,
  onRetry,
  onEdit,
  retryLabel,
  editLabel,
}: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.glyph} accessibilityElementsHidden importantForAccessibility="no">
        {glyph}
      </Text>
      <Text style={styles.message} maxFontSizeMultiplier={1.6}>
        {message}
      </Text>
      <View style={styles.actions}>
        <View style={styles.retry}>
          <PrimaryButton label={retryLabel} onPress={onRetry} />
        </View>
        <SecondaryButton label={editLabel} onPress={onEdit} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingVertical: space[7],
    gap: space[5],
  },
  glyph: {
    fontSize: 40,
    color: color.textTertiary,
  },
  message: {
    ...type.subtext,
    color: color.textSecondary,
    textAlign: 'center',
    maxWidth: 320,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
  },
  retry: { minWidth: 160 },
});

export default MessageBlock;
