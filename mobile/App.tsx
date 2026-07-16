/**
 * LifePilot root — state-machine navigation (no navigation library needed for this
 * shallow screen graph). Screens: onboarding → home → [feature | settings].
 *
 * NudgeChecks mounts the hydration + energy hooks at the App level (always-alive) so
 * the scheduler can call checkNudge even when the feature screen is not open.
 *
 * PRIVACY: nothing here (or anywhere in src) touches the network except the two opt-in
 * sources (weatherSource — off by default, modelRegistry — model-update fetch).
 */
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { loadLocale, localized, type Locale } from './src/core/i18n/i18n';
import { LiteParseWebView } from './src/core/liteparse/LiteParseWebView';
import { LlamaProvider } from './src/core/llm/LlamaProvider';
import {
  areModelsReady,
  CORE_FEATURES,
  OVERWHELM_FEATURES,
} from './src/core/modelDownload/ModelDownloader';
import { attachGlassesOutput } from './src/core/nudges/glassesOutput';
import { attachNotificationOutput } from './src/core/nudges/notificationOutput';
import { nudgeScheduler } from './src/core/nudges/nudgeScheduler';
import { getFlag, setFlag } from './src/core/persistence';
import { healthSyncScheduler } from './src/features/energy/healthSyncScheduler';
import { useEnergyPredictor } from './src/features/energy/useEnergyPredictor';
import { useHydrationTracker } from './src/features/hydration/useHydrationTracker';
import { checkOverwhelmNudges } from './src/features/overwhelm/overwhelmReminder';
import type { FeatureKey } from './src/screens/HomeScreen';
import EnergyScreen from './src/screens/EnergyScreen';
import ExpenseScreen from './src/screens/ExpenseScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import HydrationScreen from './src/screens/HydrationScreen';
import { ModelSetupScreen } from './src/screens/ModelSetupScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { PastTasksScreen } from './src/screens/PastTasksScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import OverwhelmManagerScreen from './src/screens/OverwhelmScreen';
import { color, layout, space, type as typeToken } from './src/theme/tokens';

type Screen = 'loading' | 'onboarding' | 'setup' | 'home' | FeatureKey | 'settings' | 'overwhelmHistory';

const FEATURE_TITLES: Partial<Record<FeatureKey, string>> = {
  overwhelm: 'Overwhelm Manager',
  energy: 'Energy Planner',
  hydration: 'Hydration',
  expense: 'Expense Scanner',
};

const APP_COPY = localized(
  {
    overwhelmSetupIntro:
      'The Overwhelm Manager thinks with a full language model that lives on your phone. It needs a one-time download — everything after that works offline, even in airplane mode.',
  },
  {
    es: {
      overwhelmSetupIntro:
        'El Overwhelm Manager piensa con un modelo de lenguaje completo que vive en tu teléfono. Necesita una única descarga — después, todo funciona sin conexión, incluso en modo avión.',
    },
    fr: {
      overwhelmSetupIntro:
        'L’Overwhelm Manager réfléchit avec un vrai modèle de langage qui vit sur votre téléphone. Un seul téléchargement suffit — ensuite, tout fonctionne hors ligne, même en mode avion.',
    },
    de: {
      overwhelmSetupIntro:
        'Der Overwhelm Manager denkt mit einem vollwertigen Sprachmodell, das auf deinem Handy lebt. Einmal herunterladen genügt — danach funktioniert alles offline, sogar im Flugmodus.',
    },
    it: {
      overwhelmSetupIntro:
        'L’Overwhelm Manager ragiona con un modello linguistico completo che vive sul tuo telefono. Serve un solo download — poi tutto funziona offline, anche in modalità aereo.',
    },
    pt: {
      overwhelmSetupIntro:
        'O Overwhelm Manager pensa com um modelo de linguagem completo que vive no seu telefone. Precisa de um único download — depois disso, tudo funciona offline, até em modo avião.',
    },
    hi: {
      overwhelmSetupIntro:
        'Overwhelm Manager आपके फ़ोन पर रहने वाले एक पूरे भाषा मॉडल से सोचता है। इसे एक बार डाउनलोड करना होगा — उसके बाद सब कुछ ऑफ़लाइन चलता है, एयरप्लेन मोड में भी।',
    },
  },
);

/**
 * Wraps a feature screen with a back button in a reserved header row above it.
 *
 * Previously the back pill was absolutely positioned OVER the feature screen,
 * on the assumption each screen's own SafeAreaView top-inset would clear it —
 * it didn't: RN's built-in SafeAreaView is a no-op on Android, and even on iOS
 * the pill's real footprint (insets.top + its own ~50px height) was taller
 * than any screen's fixed paddingTop, so the title always overlapped the
 * pill. Rendering the header in normal flow (not absolute) makes its height
 * self-reserving regardless of platform or content.
 */
function FeatureShell({ title, onBack, children }: { title: string; onBack: () => void; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={shellStyles.root}>
      {/* space[5] (was space[2]): owner found the back pill sat too close to the
          status bar on-device (2026-07-08) — give the header more breathing room. */}
      <View style={[shellStyles.header, { paddingTop: insets.top + space[5] }]}>
        <Pressable
          onPress={onBack}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={`Back to home — ${title}`}
          style={({ pressed }) => [shellStyles.backBtn, pressed && shellStyles.backBtnPressed]}
        >
          <Text style={shellStyles.backChevron}>‹</Text>
          <Text style={shellStyles.backLabel} maxFontSizeMultiplier={1.2}>{title}</Text>
        </Pressable>
      </View>
      <View style={shellStyles.body}>{children}</View>
    </View>
  );
}

/**
 * Headless component: keeps hydration + energy hooks alive for the scheduler
 * so nudge checks run even when those feature screens are not mounted.
 */
function NudgeChecks() {
  const hydration = useHydrationTracker();
  const energy = useEnergyPredictor();

  // stable refs so register/unregister doesn't thrash on every re-render
  const hydCheckRef = useRef(hydration.checkNudge);
  const engCheckRef = useRef(energy.checkNudge);
  const engRefreshRef = useRef(energy.refresh);
  hydCheckRef.current = hydration.checkNudge;
  engCheckRef.current = energy.checkNudge;
  engRefreshRef.current = energy.refresh;

  useEffect(() => {
    const u1 = nudgeScheduler.register('hydration', () => hydCheckRef.current());
    const u2 = nudgeScheduler.register('energy', () => engCheckRef.current());
    const u3 = nudgeScheduler.register('overwhelm', () => void checkOverwhelmNudges());
    return () => { u1(); u2(); u3(); };
  }, []);

  useEffect(() => {
    healthSyncScheduler.register(() => engRefreshRef.current());
    healthSyncScheduler.start();
    return () => healthSyncScheduler.stop();
  }, []);

  return null;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading');
  // Whether the Overwhelm bundle (Llama + embeddings + Whisper, ~1.5 GB) is on disk.
  // Core models are a few hundred KB and gate first-run setup; the big bundle is
  // fetched lazily the first time the Overwhelm Manager is opened, so someone who
  // only wants the Hydration Tracker never downloads the Llama.
  const [llamaEnabled, setLlamaEnabled] = useState(false);
  // Current UI language. Changing it re-keys the screen tree (below LlamaProvider,
  // so the loaded model survives the switch) and every screen re-reads its COPY.
  const [locale, setAppLocale] = useState<Locale>('en');

  // Wire nudge outputs + start scheduler once on mount.
  useEffect(() => {
    const detachGlasses = attachGlassesOutput();
    void attachNotificationOutput();
    nudgeScheduler.start();
    return () => {
      detachGlasses();
      nudgeScheduler.stop();
    };
  }, []);

  // Determine start screen from persisted flag + whether the models are on disk.
  // A device provisioned over adb (RUNBOOK.md) already has them and skips setup.
  useEffect(() => {
    Promise.all([
      getFlag('onboardingDone'),
      areModelsReady(CORE_FEATURES),
      areModelsReady(OVERWHELM_FEATURES),
      loadLocale(), // must resolve before first render of localized copy
    ]).then(([done, coreReady, overwhelmReady, savedLocale]) => {
      setAppLocale(savedLocale);
      setLlamaEnabled(overwhelmReady);
      if (!done) return setScreen('onboarding');
      setScreen(coreReady ? 'home' : 'setup');
    });
  }, []);

  const finishOnboarding = useCallback(() => {
    void setFlag('onboardingDone');
    // Re-check rather than trusting the mount-time result: onboarding asks for
    // permissions and can sit open for a while.
    areModelsReady(CORE_FEATURES).then((ready) => setScreen(ready ? 'home' : 'setup'));
  }, []);

  const finishSetup = useCallback(() => setScreen('home'), []);

  const navigate = useCallback((s: FeatureKey | 'settings') => setScreen(s), []);
  const goHome = useCallback(() => setScreen('home'), []);

  // Screen is a flat JS state machine, not a real navigator — there is no back
  // stack for the OS to pop. Without this, Android's hardware/gesture back
  // button falls through to the default "finish the activity" behavior on
  // EVERY screen (not just home), exiting the whole app instead of returning
  // to LifePilot's own home screen. Mirrors each screen's own in-app back
  // button target exactly (overwhelmHistory → overwhelm, everything else →
  // home); only on 'home'/'onboarding'/'loading' do we let the default
  // (exit app) behavior happen.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen === 'overwhelmHistory') {
        setScreen('overwhelm');
        return true;
      }
      if (screen !== 'home' && screen !== 'onboarding' && screen !== 'loading' && screen !== 'setup') {
        goHome();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [screen, goHome]);

  if (screen === 'loading') return null;

  // Onboarding and setup render OUTSIDE LlamaProvider on purpose. The provider
  // starts provisioning the moment it mounts, so mounting it before the model
  // files exist would fail — and useLLM's error is sticky per instance, poisoning
  // the state the setup screen is trying to fix. Keeping it unmounted means it
  // gets a clean first load once the weights are actually on disk.
  if (screen === 'onboarding' || screen === 'setup') {
    return (
      <SafeAreaProvider>
        <View style={styles.root}>
          <StatusBar style="dark" />
          {screen === 'onboarding' ? (
            <OnboardingScreen onDone={finishOnboarding} />
          ) : (
            <ModelSetupScreen onDone={finishSetup} />
          )}
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <LlamaProvider enabled={llamaEnabled}>
        {/* key={locale}: a language switch re-mounts every screen so localized COPY
            getters re-read in the new language — but LlamaProvider sits ABOVE the key,
            so the loaded 1.2 GB model instance survives the switch untouched. */}
        <View style={styles.root} key={locale}>
          <StatusBar style="dark" />
          <NudgeChecks />
          <LiteParseWebView />

          {screen === 'home' && <HomeScreen onNavigate={navigate} />}
          {(screen === 'overwhelm' || screen === 'energy' || screen === 'hydration' || screen === 'expense') && (
            <FeatureShell title={FEATURE_TITLES[screen] ?? screen} onBack={goHome}>
              {screen === 'overwhelm' && !llamaEnabled && (
                // Lazy Overwhelm-bundle download, first open only. Safe to render inside
                // LlamaProvider because enabled=false means it hasn't provisioned yet —
                // flipping it on after onDone gives useLLM its normal clean first load.
                <ModelSetupScreen
                  features={OVERWHELM_FEATURES}
                  intro={APP_COPY.overwhelmSetupIntro}
                  onDone={() => setLlamaEnabled(true)}
                />
              )}
              {screen === 'overwhelm' && llamaEnabled && (
                <OverwhelmManagerScreen onOpenHistory={() => setScreen('overwhelmHistory')} />
              )}
              {screen === 'energy' && <EnergyScreen />}
              {screen === 'hydration' && <HydrationScreen />}
              {screen === 'expense' && <ExpenseScreen />}
            </FeatureShell>
          )}
          {screen === 'settings' && <SettingsScreen onBack={goHome} onLocaleChange={setAppLocale} />}
          {screen === 'overwhelmHistory' && <PastTasksScreen onBack={() => setScreen('overwhelm')} />}
        </View>
      </LlamaProvider>
    </SafeAreaProvider>
  );
}

const shellStyles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: layout.screenPaddingH,
    paddingBottom: space[2],
    backgroundColor: color.background,
  },
  body: { flex: 1 },
  backBtn: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    marginHorizontal: -space[3],
    borderRadius: 20,
    minHeight: layout.minTouchTarget,
  },
  backBtnPressed: { opacity: 0.6, backgroundColor: color.surfaceAlt },
  backChevron: { fontSize: 22, color: color.accent },
  backLabel: { ...typeToken.body, color: color.accent, fontWeight: '600' as const },
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.background },
});
