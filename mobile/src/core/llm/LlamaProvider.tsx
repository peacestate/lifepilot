/**
 * LlamaProvider — the ONE app-wide Llama 3.2 instance, shared by every feature that
 * needs on-device LLM inference (today: Overwhelm Manager, Expense Scanner's
 * intelligent-parsing pass).
 *
 * WHY this exists: `useLLM()` (react-native-executorch) ties the native model's
 * lifecycle to WHICHEVER component calls it — calling it from two different screens
 * would load TWO separate ~1.18GB instances into memory, pay cold-start twice, and
 * put a second, never-exercised surface on the documented interrupt-before-unmount
 * crash path (LLM.kt SIGSEGV — see project history). Mounting exactly one call here,
 * at the app root (same always-alive pattern App.tsx's NudgeChecks already uses for
 * the Hydration/Energy hooks), and sharing its state/methods via context is what
 * makes "reuse Llama across features" actually true instead of aspirational.
 *
 * RISK ACCEPTED (owner decision): Expense Scanner now shares the same instance and
 * therefore the same interrupt-before-unmount crash path Overwhelm has always had —
 * previously untested on this second screen. Needs a real on-device pass navigating
 * away from Expense Scanner mid-generation before this ships to a demo.
 *
 * CONFIRMED BUG, FIXED HERE (found via real on-device testing 2026-07-06): the
 * underlying `useLLM().error` field is STICKY — once set, it never clears, even after
 * a later successful load + generation. Before this provider existed, each Overwhelm
 * screen mount got a FRESH `useLLM()` instance, so a stale error from one mount
 * couldn't survive to the next. Now that `useLLM()` lives permanently at the app root,
 * an early transient error (observed: a `HuggingFaceTokenizer.initHybrid` native race
 * during first load) permanently poisoned the UI's `error` state for the rest of the
 * app session, even though the model went on to load and generate correctly seconds
 * later. Fix: once `isReady` is true, the model has PROVABLY loaded successfully, so
 * any lingering `.error` value is stale by definition — suppress it. Genuine post-ready
 * failures (a real inference-time error) still surface fine through the caller's own
 * local error state (see useOverwhelmManager.ts's `runError`), which isn't touched here.
 *
 * PRIVACY: imports zero networking — same guarantee as before, just one shared instance.
 */
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
// eslint-disable-next-line import/no-unresolved -- added during native setup
import { useLLM } from 'react-native-executorch';

import type { ChatConfig, ToolsConfig } from 'react-native-executorch';

import { provisionModel } from '../../features/overwhelm/modelProvisioner';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

/** Real shape per the pinned react-native-executorch version (types/llm.d.ts) — kept
 * precise here (not `unknown`) so a caller passing an unsupported key like the
 * pre-existing `generationConfig` bug in useOverwhelmManager.ts stays visible to tsc
 * instead of being silently typed away by this wrapper. */
export type LlamaConfigureOpts = { chatConfig?: Partial<ChatConfig>; toolsConfig?: ToolsConfig };

export type LlamaContextValue = {
  isReady: boolean;
  /**
   * Resolve true as soon as the model is loaded, or false after `timeoutMs` if it
   * still isn't. Lets best-effort consumers (Expense Scanner's refine pass) briefly
   * wait out a cold start instead of silently skipping their smartest step.
   * Never rejects, never triggers a load — the load is already underway app-wide.
   */
  waitUntilReady: (timeoutMs: number) => Promise<boolean>;
  isGenerating: boolean;
  /** Reactive — updates on every streamed token. For consumers that render mid-generation. */
  response: string;
  /**
   * Ref-backed — always the LATEST value, safe to read from inside an async function
   * right after `await generate(...)` resolves (reading the plain `response` field in
   * that same closure can be stale, since the closure captured it at an earlier render).
   */
  getResponse: () => string;
  downloadProgress: number;
  error: unknown;
  generate: (messages: ChatMessage[]) => Promise<void>;
  interrupt: () => void;
  configure: (opts: LlamaConfigureOpts) => void;
};

const LlamaContext = createContext<LlamaContextValue | null>(null);

/* ─── Serialize ALL native generation across the app ──────────────────────────
 * The shared native runtime (ONE model + ONE XNNPACK threadpool) is NOT
 * reentrant-safe: two overlapping generate() calls make a threadpool worker
 * dereference freed memory → SIGSEGV. Captured on-device 2026-07-07:
 *   signal 11 (SIGSEGV), code 1 (SEGV_MAPERR) on an XNNPACK worker thread,
 *   #03 pthreadpool_parallelize_1d_tile_1d → XNNExecutor::forward →
 *   TextPrefiller::prefill → example::Runner::generate.
 * Every consumer — Overwhelm warm-up / run / sub-steps AND Expense Scanner —
 * funnels through the provider's generate() below, so chaining here guarantees a
 * second call never touches native until the first has FULLY settled (the native
 * forward() returned). Module-level so it spans provider re-renders and every
 * feature sharing this one instance.
 *
 * Deliberate fail-safe trade-off: the slot releases only when the underlying
 * generate() promise settles. If the pinned runtime's known orphaned-promise bug
 * ever leaves one unresolved (native finished, JS promise never fulfils), the
 * queue STALLS rather than risking a reentrant crash — a recoverable hang (app
 * relaunch) is strictly safer than a hard SIGSEGV, and the Overwhelm watchdog
 * still surfaces a retry to the user either way. A rejection never poisons the
 * chain (the next turn runs regardless of how the previous one ended). */
let nativeGenerationChain: Promise<unknown> = Promise.resolve();
function serializeNativeGeneration<T>(task: () => Promise<T>): Promise<T> {
  const result = nativeGenerationChain.then(task, task);
  nativeGenerationChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function LlamaProvider({
  children,
  enabled = true,
}: {
  children: React.ReactNode;
  /**
   * When false, provisioning is deferred: the Overwhelm bundle downloads lazily on
   * first open, so at app start the .pte may simply not exist yet. Provisioning then
   * would set a provisionError that nothing ever retries. Flipping enabled to true
   * (after the download completes) starts the same null→sources transition the
   * mount-time path has always used, so useLLM loads exactly as before.
   */
  enabled?: boolean;
}) {
  const [sources, setSources] = useState<{
    modelSource: string; tokenizerSource: string; tokenizerConfigSource: string;
  } | null>(null);
  const [provisionError, setProvisionError] = useState<unknown>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    provisionModel()
      .then((s) => { if (alive) setSources(s); })
      .catch((e: unknown) => { if (alive) setProvisionError(e); });
    return () => { alive = false; };
  }, [enabled]);

  const llm = useLLM({
    modelSource: sources?.modelSource,
    tokenizerSource: sources?.tokenizerSource,
    tokenizerConfigSource: sources?.tokenizerConfigSource,
  } as never);

  const responseRef = useRef('');
  useEffect(() => {
    responseRef.current = llm.response ?? '';
  }, [llm.response]);

  // Ready-state ref + waiter queue backing waitUntilReady. A ref (not the captured
  // `llm.isReady`) so an async caller polling across renders always sees the latest.
  const isReadyRef = useRef(false);
  const readyWaiters = useRef<Array<() => void>>([]);
  useEffect(() => {
    isReadyRef.current = llm.isReady;
    if (llm.isReady) {
      const waiters = readyWaiters.current;
      readyWaiters.current = [];
      waiters.forEach((resolve) => resolve());
    }
  }, [llm.isReady]);

  const value: LlamaContextValue = {
    isReady: llm.isReady,
    waitUntilReady: (timeoutMs: number) => {
      if (isReadyRef.current) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(isReadyRef.current), timeoutMs);
        readyWaiters.current.push(() => {
          clearTimeout(timer);
          resolve(true);
        });
      });
    },
    isGenerating: llm.isGenerating,
    response: llm.response ?? '',
    getResponse: () => responseRef.current,
    downloadProgress: llm.downloadProgress ?? 0,
    // Suppress a stale/sticky library error once the model has proven itself ready —
    // see the file header for why this is necessary now that useLLM() is app-level.
    error: llm.isReady ? null : (provisionError ?? llm.error),
    // Serialized app-wide (see serializeNativeGeneration above): no two native
    // generate() calls — warm-up, run, sub-steps, or Expense's parse — can ever
    // overlap on the shared, non-reentrant XNNPACK threadpool.
    generate: (messages: ChatMessage[]) =>
      serializeNativeGeneration(async () => {
        if (typeof llm.generate !== 'function') {
          throw new Error('react-native-executorch useLLM.generate is unavailable.');
        }
        await llm.generate(messages);
      }),
    interrupt: () => {
      try { llm.interrupt?.(); } catch { /* no-op — mirrors the original guard */ }
      // CONFIRMED ON-DEVICE 2026-07-08 ("first generation works, the next one hangs"):
      // when a generate()'s native promise orphans (Mode A bug), the serialization
      // chain above never releases, so every later generation — the user's next task,
      // "Try again" after the watchdog, even warm-up on remount — queues forever
      // behind it. interrupt() is the one signal that the native runtime is being
      // forced idle (verified safe on a stuck state, RUNBOOK 2026-07-07), so break
      // the chain here: release the slot so the next generate() reaches native.
      nativeGenerationChain = Promise.resolve();
    },
    configure: (opts: LlamaConfigureOpts) => {
      try { llm.configure?.(opts); } catch { /* non-fatal — mirrors the original guard */ }
    },
  };

  return <LlamaContext.Provider value={value}>{children}</LlamaContext.Provider>;
}

/** Every consumer (Overwhelm, Expense Scanner, future features) calls this instead of useLLM directly. */
export function useSharedLlm(): LlamaContextValue {
  const ctx = useContext(LlamaContext);
  if (!ctx) throw new Error('useSharedLlm() must be called within <LlamaProvider>.');
  return ctx;
}
