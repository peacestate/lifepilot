/**
 * overwhelmDraft — crash-recovery for in-flight LLM generation.
 *
 * WHY this exists: a native SIGSEGV inside react-native-executorch's XNNPACK backend
 * (confirmed on-device 2026-07-06, coincides with severe system memory pressure — see
 * RUNBOOK.md "Known issues") kills the whole app process mid-generate(), with no
 * catchable JS exception. Without this, the user's typed task is silently lost and the
 * screen just reopens blank. Persisting the input the instant a run starts (before the
 * risky native call) means a crash can still be recovered from on next launch.
 *
 * PRIVACY: pure on-device file, same as overwhelmMemory.ts.
 */
import * as FileSystem from 'expo-file-system';

const DRAFT_PATH = `${FileSystem.documentDirectory}overwhelm_draft.json`;

export const overwhelmDraft = {
  /** Called right before a risky generate() call starts. Best-effort — a failure here is no worse than the crash itself. */
  async save(input: string): Promise<void> {
    try {
      await FileSystem.writeAsStringAsync(DRAFT_PATH, JSON.stringify({ input, startedAt: Date.now() }));
    } catch {
      /* no-op */
    }
  },

  /** Called whenever a run ends for any JS-reachable reason (success, error, stop). */
  async clear(): Promise<void> {
    try {
      await FileSystem.deleteAsync(DRAFT_PATH, { idempotent: true });
    } catch {
      /* no-op */
    }
  },

  /**
   * One-shot recovery check on mount: read + immediately clear so it's only ever
   * offered once. A leftover draft means the JS side never got to call clear() —
   * i.e. the process died mid-run. Null if there's nothing to recover.
   */
  async take(): Promise<string | null> {
    try {
      const raw = await FileSystem.readAsStringAsync(DRAFT_PATH);
      await FileSystem.deleteAsync(DRAFT_PATH, { idempotent: true });
      const parsed = JSON.parse(raw) as { input?: unknown };
      return typeof parsed.input === 'string' && parsed.input.trim() ? parsed.input : null;
    } catch {
      return null;
    }
  },
};
