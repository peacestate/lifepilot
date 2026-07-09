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

import { LiteParseWebView } from './src/core/liteparse/LiteParseWebView';
import { LlamaProvider } from './src/core/llm/LlamaProvider';
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
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { PastTasksScreen } from './src/screens/PastTasksScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import OverwhelmManagerScreen from './src/screens/OverwhelmScreen';
import { color, layout, space, type as typeToken } from './src/theme/tokens';

type Screen = 'loading' | 'onboarding' | 'home' | FeatureKey | 'settings' | 'overwhelmHistory';

const FEATURE_TITLES: Partial<Record<FeatureKey, string>> = {
  overwhelm: 'Overwhelm Manager',
  energy: 'Energy Planner',
  hydration: 'Hydration',
  expense: 'Expense Scanner',
};

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

  // Determine start screen from persisted flag.
  useEffect(() => {
    getFlag('onboardingDone').then((done) => {
      setScreen(done ? 'home' : 'onboarding');
    });
  }, []);

  const finishOnboarding = useCallback(() => {
    void setFlag('onboardingDone');
    setScreen('home');
  }, []);

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
      if (screen !== 'home' && screen !== 'onboarding' && screen !== 'loading') {
        goHome();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [screen, goHome]);

  if (screen === 'loading') return null;

  return (
    <SafeAreaProvider>
      <LlamaProvider>
        <View style={styles.root}>
          <StatusBar style="dark" />
          <NudgeChecks />
          <LiteParseWebView />

          {screen === 'onboarding' && <OnboardingScreen onDone={finishOnboarding} />}
          {screen === 'home' && <HomeScreen onNavigate={navigate} />}
          {(screen === 'overwhelm' || screen === 'energy' || screen === 'hydration' || screen === 'expense') && (
            <FeatureShell title={FEATURE_TITLES[screen] ?? screen} onBack={goHome}>
              {screen === 'overwhelm' && (
                <OverwhelmManagerScreen onOpenHistory={() => setScreen('overwhelmHistory')} />
              )}
              {screen === 'energy' && <EnergyScreen />}
              {screen === 'hydration' && <HydrationScreen />}
              {screen === 'expense' && <ExpenseScreen />}
            </FeatureShell>
          )}
          {screen === 'settings' && <SettingsScreen onBack={goHome} />}
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
