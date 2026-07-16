/**
 * SettingsScreen — cross-cutting settings only: nudges, per-feature toggles, quiet
 * hours, weather mode, and About. The Hydration profile (body mass, wake/sleep, units)
 * lives with its feature now — set on first open of the Hydration screen and editable
 * there via "Edit profile" — so Settings no longer skews hydration-heavy.
 *
 * Compact horizontal layout: label left, control right. The header/back button uses the
 * same safe-area top inset as FeatureShell so it doesn't crowd the status bar.
 */
import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getLocale, localized, setLocale, type Locale } from '../core/i18n/i18n';
import { nudgeCenter } from '../core/nudges/NudgeCenter';
import type { NudgeFeature, NudgeSettings } from '../core/nudges/NudgeCenter';
import { hydrationStore } from '../features/hydration/hydrationStore';
import { color, layout, radii, space, type } from '../theme/tokens';

type Props = {
  onBack: () => void;
  /** Notifies App.tsx so it can re-key the screen tree into the new language. */
  onLocaleChange?: (l: Locale) => void;
};

const SETTINGS_COPY = localized(
  {
    title: 'Settings',
    sectionLanguage: 'Language',
    sectionNudges: 'Nudges',
    sectionPerFeature: 'Per feature',
    sectionQuiet: 'Quiet hours',
    sectionPrivacy: 'Privacy',
    sectionAbout: 'About',
    nudgesEnabled: 'Nudges enabled',
    nudgesEnabledSub: 'Quiet reminders for hydration, energy, and focus',
    hydrationSub: 'Water-pace reminders',
    energySub: 'Focus and wind-down window alerts',
    overwhelmSub: 'Next-step read-aloud to glasses',
    quietFrom: 'No nudges from',
    quietHint: 'Configurable quiet-hour editor coming in v1.1.',
    weatherLabel: 'Live weather (opt-in)',
    weatherSub:
      'Improves hydration target accuracy. Only your coarse location is fetched — no personal data sent.',
    aboutText:
      'LifePilot v0.1.0\nAll AI features run fully on-device via ExecuTorch.\nNo accounts. No servers. No data collection.',
    languageHint: 'AI step breakdowns follow this language too.',
  },
  {
    title: 'सेटिंग्स',
    sectionLanguage: 'भाषा / Language',
    sectionNudges: 'रिमाइंडर',
    sectionPerFeature: 'हर फ़ीचर के लिए',
    sectionQuiet: 'शांत घंटे',
    sectionPrivacy: 'प्राइवेसी',
    sectionAbout: 'ऐप के बारे में',
    nudgesEnabled: 'रिमाइंडर चालू',
    nudgesEnabledSub: 'पानी, ऊर्जा और फ़ोकस के लिए हल्के रिमाइंडर',
    hydrationSub: 'पानी पीते रहने की याद',
    energySub: 'फ़ोकस और आराम के समय की सूचना',
    overwhelmSub: 'अगला क़दम चश्मे पर सुनाना',
    quietFrom: 'इस दौरान कोई रिमाइंडर नहीं',
    quietHint: 'शांत घंटों की सेटिंग v1.1 में आ रही है।',
    weatherLabel: 'लाइव मौसम (आपकी मर्ज़ी से)',
    weatherSub:
      'पानी के लक्ष्य को और सटीक बनाता है। सिर्फ़ आपका मोटा-मोटा इलाक़ा भेजा जाता है — कोई निजी जानकारी नहीं।',
    aboutText:
      'LifePilot v0.1.0\nसारे AI फ़ीचर ExecuTorch के ज़रिए पूरी तरह आपके फ़ोन पर चलते हैं।\nन अकाउंट, न सर्वर, न कोई डेटा-संग्रह।',
    languageHint: 'AI के बनाए क़दम भी इसी भाषा में आएँगे।',
  },
);

export function SettingsScreen({ onBack, onLocaleChange }: Props) {
  const insets = useSafeAreaInsets();
  const [nudge, setNudge] = useState<NudgeSettings>(() => nudgeCenter.getSettings());
  const [weatherLive, setWeatherLive] = useState(
    () => hydrationStore.getProfile().weatherMode === 'live',
  );

  const patchNudge = useCallback((patch: Partial<NudgeSettings>) => {
    nudgeCenter.configure(patch);
    setNudge({ ...nudgeCenter.getSettings() });
  }, []);

  const toggleFeature = (f: NudgeFeature) => {
    patchNudge({ perFeature: { ...nudge.perFeature, [f]: !nudge.perFeature[f] } });
  };

  const toggleWeather = (val: boolean) => {
    hydrationStore.setProfile({ weatherMode: val ? 'live' : 'offline' });
    setWeatherLive(val);
  };

  const chooseLocale = (l: Locale) => {
    if (l === getLocale()) return;
    setLocale(l);
    onLocaleChange?.(l);
  };

  return (
    <View style={styles.root}>
      {/* Header: "‹ Settings" as one vertically-centered row (matches FeatureShell's
          "‹ Hydration"), padded below the status bar so it doesn't crowd the clock. */}
      <View style={[styles.header, { paddingTop: insets.top + space[5] }]}>
        <Pressable
          onPress={onBack}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={({ pressed }) => [styles.backRow, pressed && styles.backPressed]}
        >
          <Text style={styles.backChevron}>‹</Text>
          <Text style={styles.headerTitle} accessibilityRole="header" maxFontSizeMultiplier={1.4}>
            {SETTINGS_COPY.title}
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          {/* Language */}
          <Section title={SETTINGS_COPY.sectionLanguage}>
            <View style={styles.langRow}>
              <LangChoice label="English" active={getLocale() === 'en'} onPress={() => chooseLocale('en')} />
              <LangChoice label="हिन्दी" active={getLocale() === 'hi'} onPress={() => chooseLocale('hi')} />
            </View>
            <Text style={styles.infoHint} maxFontSizeMultiplier={1.4}>
              {SETTINGS_COPY.languageHint}
            </Text>
          </Section>

          {/* Nudges section */}
          <Section title={SETTINGS_COPY.sectionNudges}>
            <Row
              label={SETTINGS_COPY.nudgesEnabled}
              sub={SETTINGS_COPY.nudgesEnabledSub}
              value={nudge.enabled}
              onToggle={(v) => patchNudge({ enabled: v })}
            />
          </Section>

          <Section title={SETTINGS_COPY.sectionPerFeature}>
            <Row
              label="Hydration"
              sub={SETTINGS_COPY.hydrationSub}
              value={nudge.perFeature.hydration}
              onToggle={() => toggleFeature('hydration')}
              disabled={!nudge.enabled}
            />
            <Row
              label="Energy"
              sub={SETTINGS_COPY.energySub}
              value={nudge.perFeature.energy}
              onToggle={() => toggleFeature('energy')}
              disabled={!nudge.enabled}
            />
            <Row
              label="Overwhelm"
              sub={SETTINGS_COPY.overwhelmSub}
              value={nudge.perFeature.overwhelm}
              onToggle={() => toggleFeature('overwhelm')}
              disabled={!nudge.enabled}
            />
          </Section>

          <Section title={SETTINGS_COPY.sectionQuiet}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel} maxFontSizeMultiplier={1.4}>{SETTINGS_COPY.quietFrom}</Text>
              <Text style={styles.infoValue} maxFontSizeMultiplier={1.4}>
                {nudge.quietFromHour}:00 – {nudge.quietToHour}:00
              </Text>
            </View>
            <Text style={styles.infoHint} maxFontSizeMultiplier={1.4}>
              {SETTINGS_COPY.quietHint}
            </Text>
          </Section>

          {/* Privacy section */}
          <Section title={SETTINGS_COPY.sectionPrivacy}>
            <Row
              label={SETTINGS_COPY.weatherLabel}
              sub={SETTINGS_COPY.weatherSub}
              value={weatherLive}
              onToggle={toggleWeather}
            />
          </Section>

          {/* About */}
          <Section title={SETTINGS_COPY.sectionAbout}>
            <Text style={styles.aboutText} maxFontSizeMultiplier={1.4}>
              {SETTINGS_COPY.aboutText}
            </Text>
          </Section>

          {/* Attribution — required by the Llama 3.2 Community License (the Overwhelm
              Manager runs Meta's Llama 3.2 1B on-device). "Built with Llama" + the
              copyright notice keep the app commercially compliant. */}
          <Section title="Credits">
            <Text style={styles.aboutText} maxFontSizeMultiplier={1.4}>
              Built with Llama.{'\n'}
              The Overwhelm Manager runs Meta's Llama 3.2 1B, licensed under the Llama 3.2
              Community License, Copyright © Meta Platforms, Inc. All Rights Reserved.
            </Text>
          </Section>
        </View>
      </ScrollView>
    </View>
  );
}

function LangChoice({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      style={({ pressed }) => [
        langStyles.chip,
        active && langStyles.chipActive,
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={[langStyles.chipLabel, active && langStyles.chipLabelActive]} maxFontSizeMultiplier={1.4}>
        {label}
      </Text>
    </Pressable>
  );
}

const langStyles = StyleSheet.create({
  chip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: space[3],
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
    minHeight: layout.minTouchTarget,
    justifyContent: 'center',
  },
  chipActive: { borderColor: color.accent, backgroundColor: color.surfaceAlt },
  chipLabel: { ...type.body, color: color.textSecondary },
  chipLabelActive: { color: color.textPrimary, fontWeight: '600' as const },
});

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={sectionStyles.wrap}>
      <Text style={sectionStyles.title} maxFontSizeMultiplier={1.2}>{title}</Text>
      <View style={sectionStyles.card}>{children}</View>
    </View>
  );
}

const sectionStyles = StyleSheet.create({
  wrap: { marginBottom: space[6] },
  title: { ...type.captionStrong, color: color.textSecondary, marginBottom: space[2], textTransform: 'uppercase', letterSpacing: 0.6 },
  card: { backgroundColor: color.surface, borderRadius: radii.md, borderWidth: 1, borderColor: color.border, overflow: 'hidden' },
});

function Row({
  label, sub, value, onToggle, disabled,
}: {
  label: string;
  sub?: string;
  value: boolean;
  onToggle: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={rowStyles.row}>
      <View style={rowStyles.text}>
        <Text style={[rowStyles.label, disabled && rowStyles.dimmed]} maxFontSizeMultiplier={1.4}>
          {label}
        </Text>
        {sub && (
          <Text style={[rowStyles.sub, disabled && rowStyles.dimmed]} maxFontSizeMultiplier={1.4}>
          {sub}
          </Text>
        )}
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        disabled={disabled}
        trackColor={{ false: color.surfaceAlt, true: color.accent }}
        thumbColor={color.surface}
        accessibilityLabel={label}
      />
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space[4],
    paddingVertical: space[4],
    borderBottomWidth: 1,
    borderBottomColor: color.border,
    gap: space[4],
    minHeight: layout.minTouchTarget,
  },
  text: { flex: 1 },
  label: { ...type.body, color: color.textPrimary },
  sub: { ...type.caption, color: color.textSecondary, marginTop: 2 },
  dimmed: { color: color.textTertiary },
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.background },
  header: {
    paddingHorizontal: layout.screenPaddingH,
    paddingBottom: space[4],
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space[1],
    minHeight: layout.minTouchTarget,
    paddingRight: space[3],
  },
  backPressed: { opacity: 0.5 },
  // fontSize 26 optically pairs the chevron with the h2 title; padding off + the row's
  // alignItems:center keep "‹" and "Settings" on the same line.
  backChevron: { fontSize: 26, color: color.accent, includeFontPadding: false },
  // translateY nudges "Settings" down onto the chevron's center axis — the tight text
  // box (includeFontPadding off) otherwise rides ~2px high because of the "g" descender.
  headerTitle: { ...type.h2, color: color.textPrimary, includeFontPadding: false, transform: [{ translateY: 2 }] },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: layout.screenPaddingH,
    paddingTop: space[4],
    paddingBottom: space[6],
  },
  content: {
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
  },
  langRow: { flexDirection: 'row', gap: space[3], padding: space[4] },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space[4], paddingVertical: space[4] },
  infoLabel: { ...type.body, color: color.textPrimary },
  infoValue: { ...type.body, color: color.textSecondary },
  infoHint: { ...type.caption, color: color.textTertiary, paddingHorizontal: space[4], paddingBottom: space[3] },
  aboutText: { ...type.caption, color: color.textSecondary, paddingHorizontal: space[4], paddingVertical: space[4], lineHeight: 20 },
});

export default SettingsScreen;
