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
import { getLocale, localized } from '../core/i18n/i18n';
import { color, layout, radii, space, type } from '../theme/tokens';

type Props = { onDone: () => void };

type Step = { glyph: string; title: string; body: string; cta: string };

const STEPS_EN: Step[] = [
  {
    glyph: '◉',
    title: 'For when starting is the hardest part',
    body: 'A task that feels too big to begin. A day that got away from you.\nTell LifePilot what’s overwhelming you and it breaks it into small, doable steps — and quietly watches your energy, water, and spending too.',
    cta: 'Get started',
  },
  {
    glyph: '◎',
    title: 'What overwhelms you is nobody’s business',
    body: 'The AI itself lives on your phone, so nothing you type or track ever leaves it.\nNo account, no cloud, no one reading over your shoulder — not even us. Everything works in airplane mode.',
    cta: 'Got it',
  },
  {
    glyph: '◐',
    title: 'A quiet tap on the shoulder',
    body: 'Out of sight slips out of mind — that’s not a flaw, it’s how busy brains work.\nLifePilot can gently resurface the next step, a sip of water, or your best focus window. Never pushy, and you can change it any time in Settings.',
    cta: 'Turn on nudges',
  },
];

const STEPS_HI: Step[] = [
  {
    glyph: '◉',
    title: 'जब शुरुआत ही सबसे मुश्किल हो',
    body: 'कोई काम इतना बड़ा लगे कि शुरू ही न हो पाए। कोई दिन हाथ से निकल जाए।\nLifePilot को बताइए क्या भारी लग रहा है — वह उसे छोटे, आसान क़दमों में बाँट देगा। साथ ही आपकी ऊर्जा, पानी और ख़र्च पर भी चुपचाप नज़र रखेगा।',
    cta: 'शुरू करें',
  },
  {
    glyph: '◎',
    title: 'जो आपको भारी लगता है, वह सिर्फ़ आपका है',
    body: 'AI ख़ुद आपके फ़ोन पर रहता है, इसलिए आपका लिखा या ट्रैक किया कुछ भी फ़ोन से बाहर नहीं जाता।\nन कोई अकाउंट, न कोई क्लाउड, न कोई झाँकने वाला — हम भी नहीं। सब कुछ एयरप्लेन मोड में भी चलता है।',
    cta: 'ठीक है',
  },
  {
    glyph: '◐',
    title: 'कंधे पर एक हल्की-सी थपकी',
    body: 'जो नज़र से हटा, वह दिमाग़ से भी हट जाता है — यह कोई कमी नहीं, व्यस्त दिमाग़ों का तरीक़ा है।\nLifePilot अगला क़दम, पानी का घूँट या आपका बेहतरीन फ़ोकस समय धीरे-से याद दिला सकता है। कभी ज़बरदस्ती नहीं — Settings में कभी भी बदल सकते हैं।',
    cta: 'रिमाइंडर चालू करें',
  },
];

const ONBOARDING_COPY = localized(
  { skip: 'Skip for now', footnote: '◉ Everything runs on-device — always.' },
  { skip: 'अभी नहीं', footnote: '◉ सब कुछ आपके फ़ोन पर चलता है — हमेशा।' },
);

export function OnboardingScreen({ onDone }: Props) {
  const [step, setStep] = useState(0);
  const STEPS = getLocale() === 'hi' ? STEPS_HI : STEPS_EN;

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
              <SecondaryButton label={ONBOARDING_COPY.skip} onPress={skip} />
            </View>
          )}
        </View>

        {/* privacy reassurance */}
        <Text style={styles.footnote} maxFontSizeMultiplier={1.4}>
          {ONBOARDING_COPY.footnote}
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
