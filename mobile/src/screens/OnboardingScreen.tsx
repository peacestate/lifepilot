/**
 * OnboardingScreen — 3 steps shown once on first launch.
 *   0  Welcome   — app name + tagline
 *   1  Privacy   — on-device AI explanation
 *   2  Nudges    — notification permission request (skippable)
 *
 * On completion (or skip at step 2) calls props.onDone().
 */
import * as Notifications from 'expo-notifications';
import React, { useState } from 'react';
import {
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { PrimaryButton } from '../components/PrimaryButton';
import { SecondaryButton } from '../components/SecondaryButton';
import { color, layout, radii, space, type } from '../theme/tokens';

type Props = { onDone: () => void };

const STEPS = [
  {
    glyph: '◉',
    title: 'LifePilot',
    body: 'A calm co-pilot for overwhelm, energy, hydration, and spending.\nAll on your phone — no accounts, no servers.',
    cta: 'Get started',
  },
  {
    glyph: '◎',
    title: 'Your data stays on your phone',
    body: 'Every AI feature runs directly on your device using on-device models.\nNothing you type or track ever leaves your phone.',
    cta: 'Got it',
  },
  {
    glyph: '◐',
    title: 'Stay gently reminded',
    body: 'LifePilot can send quiet nudges — a drink reminder, focus window alert, or next step.\nYou can change this any time in Settings.',
    cta: 'Turn on nudges',
  },
] as const;

export function OnboardingScreen({ onDone }: Props) {
  const [step, setStep] = useState(0);

  const advance = async () => {
    if (step === STEPS.length - 1) {
      // request notification permission before finishing
      try { await Notifications.requestPermissionsAsync(); } catch { /* skip if unavailable */ }
      onDone();
      return;
    }
    setStep((s) => s + 1);
  };

  const skip = () => onDone();

  const { glyph, title, body, cta } = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        {/* progress dots */}
        <View style={styles.dots} accessibilityLabel={`Step ${step + 1} of ${STEPS.length}`}>
          {STEPS.map((_, i) => (
            <View key={i} style={[styles.dot, i === step && styles.dotActive]} />
          ))}
        </View>

        {/* body */}
        <View style={styles.body}>
          <Text style={styles.glyph} aria-hidden>{glyph}</Text>
          <Text style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={1.6}>
            {title}
          </Text>
          <Text style={styles.bodyText} maxFontSizeMultiplier={1.6}>{body}</Text>
        </View>

        {/* actions */}
        <View style={styles.actions}>
          <PrimaryButton label={cta} onPress={advance} />
          {isLast && (
            <View style={styles.skipRow}>
              <SecondaryButton label="Skip for now" onPress={skip} />
            </View>
          )}
        </View>

        {/* privacy reassurance */}
        <Text style={styles.footnote} maxFontSizeMultiplier={1.4}>
          ◉ Everything runs on-device — always.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.background },
  content: {
    flex: 1,
    paddingHorizontal: layout.screenPaddingH,
    paddingTop: space[7],
    paddingBottom: space[6],
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
    width: '100%',
  },
  dots: { flexDirection: 'row', gap: space[2], marginBottom: space[8] },
  dot: {
    width: 6,
    height: 6,
    borderRadius: radii.pill,
    backgroundColor: color.surfaceAlt,
  },
  dotActive: { backgroundColor: color.accent, width: 18 },
  body: { flex: 1, justifyContent: 'center' },
  glyph: { fontSize: 48, color: color.accent, marginBottom: space[5] },
  title: {
    ...type.h1,
    color: color.textPrimary,
    marginBottom: space[4],
  },
  bodyText: {
    ...type.subtext,
    color: color.textSecondary,
    lineHeight: 24,
  },
  actions: { gap: space[3] },
  skipRow: { alignItems: 'center' },
  footnote: {
    ...type.caption,
    color: color.textTertiary,
    textAlign: 'center',
    marginTop: space[5],
  },
});

export default OnboardingScreen;
