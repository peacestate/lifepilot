/**
 * OverwhelmManagerScreen — one screen, four body states. Spec §0–§5.
 *   input · loading · results(+streaming) · error/empty
 *
 * Wiring: this screen is "dumb" — all model work lives in useOverwhelmManager.
 * Checkbox `done` (which specific ids are checked) is still screen-owned/local, but the
 * COUNT (completedSteps/totalSteps) is now mirrored into overwhelmMemory via
 * mgr.updateProgress() (2026-07-06) so nudges + the weekly insight card have real data.
 * NO network anywhere (the privacy promise is literal).
 *
 * Streaming (contract §5): in the 'generating' phase the step list fills in as
 * the model produces "- ..." lines, with a real Stop button (hook.stop →
 * useLLM.interrupt). We do NOT wait for a sub-2s full result.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MessageBlock } from '../components/MessageBlock';
import { MicButton } from '../components/MicButton';
import { OverwhelmInput } from '../components/OverwhelmInput';
import { PrimaryButton } from '../components/PrimaryButton';
import { PrivacyFootnote } from '../components/PrivacyFootnote';
import { PulseIndicator } from '../components/PulseIndicator';
import { SecondaryButton } from '../components/SecondaryButton';
import { StepList } from '../components/StepList';
import { StepProgress } from '../components/StepProgress';
import { TaskSummary } from '../components/TaskSummary';
import { WeeklyInsightCard } from '../components/WeeklyInsightCard';
import { computeWeeklyInsight, shouldShowWeeklyCard, type WeeklyInsight } from '../features/overwhelm/overwhelmInsights';
import { overwhelmMemory } from '../features/overwhelm/overwhelmMemory';
import { useOverwhelmManager } from '../features/overwhelm/useOverwhelmManager';
import { useVoiceInput } from '../features/overwhelm/useVoiceInput';
import { color, layout, space, type } from '../theme/tokens';
import { COPY } from './overwhelmCopy';

type Phase = 'input' | 'submitted';

type Props = { onOpenHistory?: () => void };

export function OverwhelmManagerScreen({ onOpenHistory }: Props = {}) {
  const mgr = useOverwhelmManager();
  const [phase, setPhase] = useState<Phase>('input');
  const [text, setText] = useState('');
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());

  // Merge screen-owned checkbox state onto the hook's streamed steps.
  const steps = useMemo(
    () => mgr.steps.map((s) => ({ ...s, done: checkedIds.has(s.id) })),
    [mgr.steps, checkedIds],
  );

  // Same merge for sub-steps inside each per-step breakdown.
  const breakdowns = useMemo(() => {
    const out: typeof mgr.breakdowns = {};
    for (const [id, bd] of Object.entries(mgr.breakdowns)) {
      out[id] = {
        ...bd,
        steps: bd.steps.map((s) => ({ ...s, done: checkedIds.has(s.id) })),
      };
    }
    return out;
  }, [mgr.breakdowns, checkedIds]);
  const doneCount = steps.filter((s) => s.done).length;
  const allDone = steps.length > 0 && doneCount === steps.length;

  // Mirror checkbox progress into memory (Step 2: completedSteps/totalSteps) so nudges
  // and the weekly insight card have real data. Only once results actually exist.
  useEffect(() => {
    if (steps.length > 0) mgr.updateProgress(doneCount, steps.length);
  }, [doneCount, steps.length, mgr]);

  const modelLoading = mgr.state === 'loading';

  // ── handlers ────────────────────────────────────────────────────────────
  const onSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    Keyboard.dismiss();
    setCheckedIds(new Set());
    setPhase('submitted');
    void mgr.run(trimmed);
  };

  const onStartOver = () => {
    setPhase('input');
    setText('');
    setCheckedIds(new Set());
  };

  const onEdit = () => setPhase('input'); // keep text for re-edit

  const onTryAgain = () => {
    setCheckedIds(new Set());
    setPhase('submitted');
    void mgr.retry();
  };

  const onToggle = (id: string) =>
    setCheckedIds((prev) => {
      const next = new Set(prev);
      // TODO(native-setup): light selection haptic on check (spec §5b) once a
      // haptics module is installed — purely local, no network.
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // ── body selection ────────────────────────────────────────────────────────
  const body = (() => {
    // Hard model/runtime failure takes precedence (spec §1d, error variant).
    if (mgr.state === 'error') {
      return (
        <>
          <TaskSummary text={mgr.lastInput || text} variant="chip" />
          <MessageBlock
            glyph="◌"
            message={COPY.error}
            onRetry={onTryAgain}
            onEdit={onEdit}
            retryLabel={COPY.retryButton}
            editLabel={COPY.editButton}
          />
        </>
      );
    }

    if (phase === 'input') {
      return (
        <InputBody
          text={text}
          setText={setText}
          onSubmit={onSubmit}
          modelLoading={modelLoading}
          onOpenHistory={onOpenHistory}
        />
      );
    }

    // phase === 'submitted'
    if (mgr.state === 'generating' || (mgr.state === 'ready' && mgr.resultKind === null)) {
      // Streaming / thinking: steps fill in progressively, with a real Stop.
      return (
        <StreamingBody
          task={mgr.lastInput}
          steps={steps}
          doneCount={doneCount}
          onToggle={onToggle}
          onStop={mgr.stop}
        />
      );
    }

    if (mgr.state === 'ready' && mgr.resultKind === 'empty-result') {
      return (
        <>
          <TaskSummary text={mgr.lastInput} variant="chip" />
          <MessageBlock
            glyph="◌"
            message={COPY.emptyResult}
            onRetry={onTryAgain}
            onEdit={onEdit}
            retryLabel={COPY.retryButton}
            editLabel={COPY.editButton}
          />
        </>
      );
    }

    // results
    return (
      <ResultsBody
        task={mgr.lastInput}
        steps={steps}
        breakdowns={breakdowns}
        doneCount={doneCount}
        allDone={allDone}
        onToggle={onToggle}
        onBreakDown={mgr.breakDown}
        onStartOver={onStartOver}
        onTryAgain={onTryAgain}
      />
    );
  })();

  const showFootnote = phase === 'input' || mgr.state === 'generating';

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.content}>
            {body}
            {showFootnote && <PrivacyFootnote text={COPY.privacyFootnote} />}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Input state (spec §1a) ──────────────────────────────────────────────────
function InputBody({
  text,
  setText,
  onSubmit,
  modelLoading,
  onOpenHistory,
}: {
  text: string;
  setText: (t: string) => void;
  onSubmit: () => void;
  modelLoading: boolean;
  onOpenHistory?: () => void;
}) {
  const canSubmit = text.trim().length > 0 && !modelLoading;
  const voice = useVoiceInput();
  const [weeklyInsight, setWeeklyInsight] = useState<WeeklyInsight | null>(null);

  useEffect(() => {
    if (!shouldShowWeeklyCard()) return;
    overwhelmMemory.list().then((entries) => setWeeklyInsight(computeWeeklyInsight(entries)));
  }, []);

  const onMicPress = async () => {
    if (voice.state === 'recording') {
      const transcript = await voice.stopRecording();
      if (transcript) {
        setText(text.trim() ? `${text.trim()} ${transcript}` : transcript);
      }
      return;
    }
    if (voice.state === 'idle') {
      void voice.startRecording();
    }
  };

  return (
    <View>
      <View style={styles.headerRow}>
        <Text style={styles.h1} accessibilityRole="header" maxFontSizeMultiplier={1.6}>
          {COPY.promptH1}
        </Text>
        {onOpenHistory && (
          <Pressable onPress={onOpenHistory} hitSlop={12} accessibilityRole="button">
            <Text style={styles.historyLink} maxFontSizeMultiplier={1.4}>
              Past Tasks
            </Text>
          </Pressable>
        )}
      </View>
      <Text style={styles.subtext} maxFontSizeMultiplier={1.6}>
        {COPY.subtext}
      </Text>

      {weeklyInsight && (
        <View style={styles.weeklyGap}>
          <WeeklyInsightCard insight={weeklyInsight} />
        </View>
      )}

      <View style={styles.inputGap}>
        <OverwhelmInput
          value={text}
          onChangeText={setText}
          placeholder={COPY.placeholder}
        />
        <View style={styles.micRow}>
          <MicButton state={voice.state} onPress={onMicPress} />
        </View>
        {voice.error && (
          <Text style={styles.voiceErrorLine} maxFontSizeMultiplier={1.6}>
            {voice.error.message}
          </Text>
        )}
      </View>

      <View style={styles.ctaGap}>
        <PrimaryButton label={COPY.submitCta} onPress={onSubmit} disabled={!canSubmit} />
      </View>

      {modelLoading && (
        <Text
          style={styles.prepLine}
          accessibilityLiveRegion="polite"
          maxFontSizeMultiplier={1.6}
        >
          {COPY.preparingTitle}
        </Text>
      )}
    </View>
  );
}

// ── Generating / streaming state (spec §1b + contract §5 streaming) ─────────
function StreamingBody({
  task,
  steps,
  doneCount,
  onToggle,
  onStop,
}: {
  task: string;
  steps: ReturnType<typeof useOverwhelmManager>['steps'];
  doneCount: number;
  onToggle: (id: string) => void;
  onStop: () => void;
}) {
  return (
    <View style={styles.gap5}>
      <TaskSummary text={task} variant="chip" />

      {steps.length > 0 && <StepProgress done={doneCount} total={steps.length} />}
      {steps.length > 0 && <StepList steps={steps} onToggle={onToggle} />}

      <View style={styles.thinking} accessibilityLiveRegion="polite">
        <PulseIndicator />
        <Text style={styles.thinkingText} maxFontSizeMultiplier={1.6}>
          {COPY.loadingTitle}
        </Text>
      </View>

      <View style={styles.stopRow}>
        <SecondaryButton label={COPY.stopButton} onPress={onStop} />
      </View>
    </View>
  );
}

// ── Results state (spec §1c) ────────────────────────────────────────────────
function ResultsBody({
  task,
  steps,
  breakdowns,
  doneCount,
  allDone,
  onToggle,
  onBreakDown,
  onStartOver,
  onTryAgain,
}: {
  task: string;
  steps: ReturnType<typeof useOverwhelmManager>['steps'];
  breakdowns: ReturnType<typeof useOverwhelmManager>['breakdowns'];
  doneCount: number;
  allDone: boolean;
  onToggle: (id: string) => void;
  onBreakDown: (stepId: string, text: string) => void;
  onStartOver: () => void;
  onTryAgain: () => void;
}) {
  // Auto-dismiss celebration after ~4s (spec §5c).
  const [showCelebration, setShowCelebration] = useState(false);
  useEffect(() => {
    if (!allDone) {
      setShowCelebration(false);
      return;
    }
    setShowCelebration(true);
    const t = setTimeout(() => setShowCelebration(false), 4000);
    return () => clearTimeout(t);
  }, [allDone]);

  return (
    <View>
      <TaskSummary text={task} variant="summary" />
      <StepProgress done={doneCount} total={steps.length} />
      <StepList
        steps={steps}
        onToggle={onToggle}
        breakdowns={breakdowns}
        onBreakDown={onBreakDown}
        labels={{
          cta: COPY.breakDownStepCta,
          loading: COPY.breakingDownStep,
          empty: COPY.breakdownEmpty,
          error: COPY.breakdownError,
        }}
      />

      {showCelebration && (
        <Text
          style={styles.celebration}
          accessibilityLiveRegion="polite"
          maxFontSizeMultiplier={1.6}
        >
          {COPY.allComplete}
        </Text>
      )}

      <View style={styles.resultActions}>
        <SecondaryButton label={COPY.startOverButton} onPress={onStartOver} />
        <SecondaryButton label={COPY.retryButton} onPress={onTryAgain} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.background },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: layout.screenPaddingH,
    paddingTop: space[7],
    paddingBottom: space[6],
  },
  content: {
    flex: 1,
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
  },
  h1: { ...type.h1, color: color.textPrimary, flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  historyLink: { ...type.caption, color: color.accent, fontWeight: '600' as const, marginTop: space[1] },
  subtext: {
    ...type.subtext,
    color: color.textSecondary,
    marginTop: space[3],
  },
  weeklyGap: { marginTop: space[5] },
  inputGap: { marginTop: space[5] },
  micRow: { alignItems: 'flex-end', marginTop: space[2] },
  voiceErrorLine: {
    ...type.caption,
    color: color.error,
    textAlign: 'right',
    marginTop: space[1],
  },
  ctaGap: { marginTop: space[5] },
  prepLine: {
    ...type.caption,
    color: color.textSecondary,
    textAlign: 'center',
    marginTop: space[4],
  },
  gap5: { gap: space[5] },
  thinking: { alignItems: 'center', gap: space[4], paddingVertical: space[4] },
  thinkingText: {
    ...type.subtext,
    color: color.textSecondary,
    textAlign: 'center',
  },
  stopRow: { alignItems: 'center' },
  celebration: {
    ...type.subtext,
    color: color.accent,
    textAlign: 'center',
    marginTop: space[5],
  },
  resultActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: space[6],
  },
});

export default OverwhelmManagerScreen;
