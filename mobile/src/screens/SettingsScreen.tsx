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

import { getLocale, LANGUAGES, localized, setLocale, type Locale } from '../core/i18n/i18n';
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
    es: {
      title: 'Ajustes',
      sectionLanguage: 'Idioma',
      sectionNudges: 'Recordatorios',
      sectionPerFeature: 'Por función',
      sectionQuiet: 'Horas de silencio',
      sectionPrivacy: 'Privacidad',
      sectionAbout: 'Acerca de',
      nudgesEnabled: 'Recordatorios activados',
      nudgesEnabledSub: 'Avisos suaves de hidratación, energía y concentración',
      hydrationSub: 'Recordatorios para beber agua a buen ritmo',
      energySub: 'Avisos de concentración y descanso',
      overwhelmSub: 'Leer el siguiente paso en las gafas',
      quietFrom: 'Sin recordatorios de',
      quietHint: 'El editor de horas de silencio llega en v1.1.',
      weatherLabel: 'Clima en vivo (opcional)',
      weatherSub:
        'Mejora la precisión de tu meta de hidratación. Solo se envía tu ubicación aproximada — ningún dato personal.',
      aboutText:
        'LifePilot v0.1.0\nToda la IA funciona en tu dispositivo vía ExecuTorch.\nSin cuentas. Sin servidores. Sin recopilación de datos.',
      languageHint: 'Los pasos generados por la IA también siguen este idioma.',
    },
    fr: {
      title: 'Réglages',
      sectionLanguage: 'Langue',
      sectionNudges: 'Rappels',
      sectionPerFeature: 'Par fonctionnalité',
      sectionQuiet: 'Heures calmes',
      sectionPrivacy: 'Confidentialité',
      sectionAbout: 'À propos',
      nudgesEnabled: 'Rappels activés',
      nudgesEnabledSub: 'Rappels discrets pour l’hydratation, l’énergie et la concentration',
      hydrationSub: 'Rappels pour boire régulièrement',
      energySub: 'Alertes de concentration et de repos',
      overwhelmSub: 'Lecture de la prochaine étape sur les lunettes',
      quietFrom: 'Aucun rappel de',
      quietHint: 'L’éditeur d’heures calmes arrive en v1.1.',
      weatherLabel: 'Météo en direct (facultatif)',
      weatherSub:
        'Améliore la précision de votre objectif d’hydratation. Seule votre position approximative est envoyée — aucune donnée personnelle.',
      aboutText:
        'LifePilot v0.1.0\nToute l’IA fonctionne sur votre appareil via ExecuTorch.\nPas de compte. Pas de serveur. Aucune collecte de données.',
      languageHint: 'Les étapes générées par l’IA suivent aussi cette langue.',
    },
    de: {
      title: 'Einstellungen',
      sectionLanguage: 'Sprache',
      sectionNudges: 'Erinnerungen',
      sectionPerFeature: 'Pro Funktion',
      sectionQuiet: 'Ruhezeiten',
      sectionPrivacy: 'Datenschutz',
      sectionAbout: 'Über die App',
      nudgesEnabled: 'Erinnerungen aktiv',
      nudgesEnabledSub: 'Sanfte Erinnerungen an Wasser, Energie und Fokus',
      hydrationSub: 'Erinnerungen ans Trinken',
      energySub: 'Hinweise zu Fokus- und Ruhephasen',
      overwhelmSub: 'Nächsten Schritt über die Brille vorlesen',
      quietFrom: 'Keine Erinnerungen von',
      quietHint: 'Der Ruhezeiten-Editor kommt in v1.1.',
      weatherLabel: 'Live-Wetter (optional)',
      weatherSub:
        'Macht dein Trinkziel genauer. Nur dein ungefährer Standort wird abgerufen — keine persönlichen Daten.',
      aboutText:
        'LifePilot v0.1.0\nDie gesamte KI läuft über ExecuTorch auf deinem Gerät.\nKeine Konten. Keine Server. Keine Datensammlung.',
      languageHint: 'Auch die KI-Schritte folgen dieser Sprache.',
    },
    it: {
      title: 'Impostazioni',
      sectionLanguage: 'Lingua',
      sectionNudges: 'Promemoria',
      sectionPerFeature: 'Per funzione',
      sectionQuiet: 'Ore di silenzio',
      sectionPrivacy: 'Privacy',
      sectionAbout: 'Informazioni',
      nudgesEnabled: 'Promemoria attivi',
      nudgesEnabledSub: 'Promemoria leggeri per acqua, energia e concentrazione',
      hydrationSub: 'Promemoria per bere con regolarità',
      energySub: 'Avvisi su concentrazione e riposo',
      overwhelmSub: 'Lettura del prossimo passo sugli occhiali',
      quietFrom: 'Nessun promemoria da',
      quietHint: 'L’editor delle ore di silenzio arriva nella v1.1.',
      weatherLabel: 'Meteo in tempo reale (facoltativo)',
      weatherSub:
        'Rende più preciso il tuo obiettivo di idratazione. Viene inviata solo la tua posizione approssimativa — nessun dato personale.',
      aboutText:
        'LifePilot v0.1.0\nTutta l’IA funziona sul tuo dispositivo via ExecuTorch.\nNessun account. Nessun server. Nessuna raccolta dati.',
      languageHint: 'Anche i passi generati dall’IA seguono questa lingua.',
    },
    pt: {
      title: 'Configurações',
      sectionLanguage: 'Idioma',
      sectionNudges: 'Lembretes',
      sectionPerFeature: 'Por recurso',
      sectionQuiet: 'Horas de silêncio',
      sectionPrivacy: 'Privacidade',
      sectionAbout: 'Sobre',
      nudgesEnabled: 'Lembretes ativados',
      nudgesEnabledSub: 'Lembretes suaves de hidratação, energia e foco',
      hydrationSub: 'Lembretes para beber água no ritmo certo',
      energySub: 'Avisos de foco e descanso',
      overwhelmSub: 'Ler o próximo passo nos óculos',
      quietFrom: 'Sem lembretes de',
      quietHint: 'O editor de horas de silêncio chega na v1.1.',
      weatherLabel: 'Clima ao vivo (opcional)',
      weatherSub:
        'Melhora a precisão da sua meta de hidratação. Só a sua localização aproximada é enviada — nenhum dado pessoal.',
      aboutText:
        'LifePilot v0.1.0\nToda a IA roda no seu aparelho via ExecuTorch.\nSem contas. Sem servidores. Sem coleta de dados.',
      languageHint: 'Os passos gerados pela IA também seguem este idioma.',
    },
    hi: {
      title: 'सेटिंग्स',
      sectionLanguage: 'भाषा',
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
            <LanguageDropdown onChange={chooseLocale} />
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

/**
 * Dropdown over all supported app languages (LANGUAGES = what Llama 3.2 can generate
 * in). Collapsed it shows the current language; tapping expands the full list in
 * place inside the section card — no Modal or picker dependency, per the pinned-tree
 * rule. Options show the native name first (what a speaker scans for) with the
 * English name as a secondary hint.
 */
function LanguageDropdown({ onChange }: { onChange: (l: Locale) => void }) {
  const [open, setOpen] = useState(false);
  const active = getLocale();
  const activeMeta = LANGUAGES.find((l) => l.code === active) ?? LANGUAGES[0];

  const pick = (l: Locale) => {
    setOpen(false);
    onChange(l);
  };

  return (
    <View>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Language: ${activeMeta.englishName}`}
        style={({ pressed }) => [langStyles.trigger, pressed && { opacity: 0.7 }]}
      >
        <Text style={langStyles.triggerLabel} maxFontSizeMultiplier={1.4}>
          {activeMeta.nativeName}
        </Text>
        <Text style={langStyles.chevron}>{open ? '▴' : '▾'}</Text>
      </Pressable>
      {open &&
        LANGUAGES.map((l) => {
          const selected = l.code === active;
          return (
            <Pressable
              key={l.code}
              onPress={() => pick(l.code)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={l.englishName}
              style={({ pressed }) => [
                langStyles.option,
                selected && langStyles.optionActive,
                pressed && { opacity: 0.7 },
              ]}
            >
              <View style={langStyles.optionText}>
                <Text
                  style={[langStyles.optionNative, selected && langStyles.optionNativeActive]}
                  maxFontSizeMultiplier={1.4}
                >
                  {l.nativeName}
                </Text>
                {l.englishName !== l.nativeName && (
                  <Text style={langStyles.optionEnglish} maxFontSizeMultiplier={1.4}>
                    {l.englishName}
                  </Text>
                )}
              </View>
              {selected && <Text style={langStyles.check}>✓</Text>}
            </Pressable>
          );
        })}
    </View>
  );
}

const langStyles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space[4],
    paddingVertical: space[4],
    minHeight: layout.minTouchTarget,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  triggerLabel: { ...type.body, color: color.textPrimary, fontWeight: '600' as const },
  chevron: { ...type.body, color: color.accent },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    minHeight: layout.minTouchTarget,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  optionActive: { backgroundColor: color.surfaceAlt },
  optionText: { flex: 1 },
  optionNative: { ...type.body, color: color.textSecondary },
  optionNativeActive: { color: color.textPrimary, fontWeight: '600' as const },
  optionEnglish: { ...type.caption, color: color.textTertiary, marginTop: 1 },
  check: { ...type.body, color: color.accent, fontWeight: '600' as const },
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
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space[4], paddingVertical: space[4] },
  infoLabel: { ...type.body, color: color.textPrimary },
  infoValue: { ...type.body, color: color.textSecondary },
  infoHint: { ...type.caption, color: color.textTertiary, paddingHorizontal: space[4], paddingBottom: space[3] },
  aboutText: { ...type.caption, color: color.textSecondary, paddingHorizontal: space[4], paddingVertical: space[4], lineHeight: 20 },
});

export default SettingsScreen;
