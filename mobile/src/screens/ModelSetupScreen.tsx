/**
 * ModelSetupScreen — the one-time model download, shown on first run.
 *
 * The AI models are ~1.5 GB (a 1B-parameter Llama dominates), which cannot ship
 * inside an APK. Before this screen existed, the only way to get them onto a phone
 * was `adb push` from a computer — fine for a reviewer following RUNBOOK.md,
 * impossible for a normal user.
 *
 * The privacy story is unchanged and the copy says so plainly: this fetches model
 * weights and sends nothing about the user. Afterwards the app never needs the
 * network again — that's the point of the screen, not a caveat to bury.
 *
 * Shown only when a model file is actually missing, so a device already provisioned
 * over adb never sees it.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '../components/PrimaryButton';
import {
  cancelDownload,
  downloadModels,
  formatBytes,
  getMissing,
  totalBytesFor,
  type DownloadProgress,
} from '../core/modelDownload/ModelDownloader';
import { color, layout, radii, space, type } from '../theme/tokens';

type Props = {
  onDone: () => void;
  /** Restrict to a feature subset (e.g. the Overwhelm bundle). Default: every model. */
  features?: readonly string[];
  /** Override the idle-state explanation (the "why this download exists" line). */
  intro?: string;
};
type Phase = 'idle' | 'downloading' | 'error';

const FEATURE_LABEL: Record<string, string> = {
  overwhelm: 'Overwhelm Manager',
  embeddings: 'Personalisation',
  voice: 'Voice input',
  energy: 'Energy Planner',
  hydration: 'Hydration',
  expense: 'Expense Scanner',
};

export function ModelSetupScreen({ onDone, features, intro }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missingBytes, setMissingBytes] = useState<number | null>(null);

  const SET_BYTES = totalBytesFor(features);

  useEffect(() => {
    let alive = true;
    getMissing(features)
      .then(({ missingBytes: n }) => alive && setMissingBytes(n))
      .catch(() => alive && setMissingBytes(null));
    return () => {
      alive = false;
      cancelDownload();
    };
  }, [features]);

  const start = useCallback(async () => {
    setPhase('downloading');
    setError(null);
    try {
      await downloadModels(setProgress, features);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  }, [onDone, features]);

  const pct = progress ? Math.round(progress.fraction * 100) : 0;

  // Two different numbers, and conflating them is what confuses people: the model set is
  // always 1.52 GB, but a resumed setup only has to *fetch* what's left. Show the total as
  // the anchor and the remainder as the cost, never the remainder alone — a user who has
  // already pulled 250 MB should not be greeted by a screen that says "1.26 GB" with no
  // hint that it counted their progress.
  const remaining = missingBytes ?? SET_BYTES;
  const done = SET_BYTES - remaining;
  const partial = done > 0;
  const totalLabel = formatBytes(SET_BYTES);
  const remainingLabel = formatBytes(remaining);

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.content}>
        <Text style={styles.glyph}>◍</Text>

        {phase !== 'downloading' && (
          <>
            <Text style={styles.title} maxFontSizeMultiplier={1.3}>
              {partial ? 'Resume setup' : 'One-time setup'}
            </Text>
            <Text style={styles.body}>
              {partial
                ? `You've downloaded ${formatBytes(done)} of ${totalLabel} so far. ${remainingLabel} to go — nothing is downloaded twice.`
                : (intro ??
                  `LifePilot runs its AI on your phone, so it needs to fetch its models once — about ${totalLabel}.`)}
            </Text>
            <View style={styles.note}>
              <Text style={styles.noteText}>
                This downloads model files only. Nothing about you is sent — no account,
                no telemetry. Once it&apos;s done, every feature works completely offline,
                even in airplane mode.
              </Text>
            </View>
            <Text style={styles.caption}>Best on Wi-Fi. You can close the app and resume later.</Text>
          </>
        )}

        {phase === 'downloading' && (
          <>
            <Text style={styles.title} maxFontSizeMultiplier={1.3}>
              Setting up
            </Text>
            <Text style={styles.body}>
              {progress ? (FEATURE_LABEL[progress.feature] ?? progress.feature) : 'Starting…'}
            </Text>

            <View style={styles.track}>
              <View style={[styles.fill, { width: `${pct}%` }]} />
            </View>

            <Text style={styles.caption}>
              {progress
                ? `${pct}% · ${formatBytes(progress.receivedBytes)} of ${formatBytes(progress.totalBytes)} · file ${progress.fileIndex} of ${progress.totalFiles}`
                : 'Preparing…'}
            </Text>
            <ActivityIndicator color={color.accent} style={styles.spinner} />
            <Text style={styles.caption}>Keep LifePilot open while this finishes.</Text>
          </>
        )}

        {phase === 'error' && error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
            <Text style={styles.caption}>
              Nothing already downloaded is fetched twice — retrying picks up from the exact
              byte it stopped at.
            </Text>
          </View>
        )}
      </View>

      {phase !== 'downloading' && (
        <View style={styles.footer}>
          <PrimaryButton
            label={
              phase === 'error'
                ? 'Try again'
                : partial
                  ? `Resume · ${remainingLabel} left`
                  : `Download models · ${totalLabel}`
            }
            onPress={start}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

export default ModelSetupScreen;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.background },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: layout.screenPaddingH,
    maxWidth: layout.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  glyph: { fontSize: 44, color: color.accent, textAlign: 'center', marginBottom: space[6] },
  title: { ...type.h1, color: color.textPrimary, textAlign: 'center', marginBottom: space[4] },
  body: {
    ...type.body,
    color: color.textSecondary,
    textAlign: 'center',
    marginBottom: space[6],
  },
  note: {
    backgroundColor: color.surfaceAlt,
    borderRadius: radii.md,
    padding: space[4],
    marginBottom: space[5],
  },
  noteText: { ...type.subtext, color: color.textSecondary, textAlign: 'center' },
  caption: { ...type.caption, color: color.textTertiary, textAlign: 'center' },
  track: {
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: color.surfaceAlt,
    overflow: 'hidden',
    marginBottom: space[4],
  },
  fill: { height: '100%', borderRadius: radii.pill, backgroundColor: color.accent },
  spinner: { marginVertical: space[5] },
  errorBox: {
    backgroundColor: color.surface,
    borderColor: color.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: space[4],
    marginBottom: space[5],
  },
  errorText: {
    ...type.subtext,
    color: color.error,
    textAlign: 'center',
    marginBottom: space[2],
  },
  footer: {
    paddingHorizontal: layout.screenPaddingH,
    paddingBottom: space[6],
    maxWidth: layout.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
});
