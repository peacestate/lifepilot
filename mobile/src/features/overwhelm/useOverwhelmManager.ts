/**
 * useOverwhelmManager — RN hook wrapping `react-native-executorch`'s `useLLM`.
 *
 * Responsibilities (keep the screen dumb):
 *  - load + WARM the on-device Llama 3.2 1B model on mount (model-contract §5)
 *  - expose a 4-value `state`: 'loading' | 'ready' | 'generating' | 'error'
 *  - `run(input)`  → build the contract prompt, generate, STREAM parsed steps in
 *  - `stop()`      → interrupt an in-flight generation (real, not cosmetic)
 *  - parse + classify per OverwhelmService (eval-parity)
 *
 * PRIVACY: imports zero networking. Everything runs from the bundled model.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * API ASSUMPTIONS — VERIFIED by CTO against the pinned version (model-contract
 * §6). PIN = react-native-executorch@0.4.8 (bundles the ExecuTorch runtime that
 * matches the HF QLoRA .pte exported with ExecuTorch v0.6.0; its model constants
 * resolve the HF repo at revision `v0.4.0`).
 *   A1. ✅ `useLLM({ modelSource, tokenizerSource, tokenizerConfigSource })` is the
 *       correct three-source API for 0.4.x (the single bundled-`model` object only
 *       arrives in 0.5.0). Returns { isReady, isGenerating, response,
 *       downloadProgress, error, generate, interrupt, configure }.
 *   A2. ❌ CORRECTED. In 0.4.x `generate()` takes a MESSAGES ARRAY
 *       `[{ role, content }]` and applies the Llama chat template INTERNALLY from
 *       tokenizer_config.json. It does NOT take a raw pre-templated string — doing
 *       so would double-template the special tokens and break contract §3. We now
 *       pass `[{role:'system',content:SYSTEM_PROMPT},{role:'user',content:input}]`
 *       and let the library template. `buildPrompt()` (raw §3 string) is retained
 *       ONLY for the Python eval, which feeds the bare ExecuTorch runner directly.
 *       ⚠️ ON-DEVICE VERIFY (AIML + mobile): confirm the library's Llama-3.2 chat
 *       template yields the SAME token sequence as §3 (watch for an injected
 *       "Cutting Knowledge Date / Today Date" system preamble — if present, the
 *       eval's hand-built prompt and the app diverge; align one to the other).
 *   A3. ✅ `response` accumulates the current generation's text and resets each
 *       `generate` call; `interrupt()` halts generation (maps to "Stop"). NOTE:
 *       ExecuTorch requires interrupt() BEFORE unmount or the native runtime
 *       crashes — handled by the unmount-cleanup effect below.
 *   A4. ⚠️ A file:// source is provided once provisioning resolves; the hook
 *       renders before sources exist. CONFIRM 0.4.8 tolerates an undefined
 *       modelSource on first render (it may begin an errored load) — otherwise
 *       gate the screen mount behind provisioning. Tracked in the punch-list.
 * Each call site below is isolated so swapping the API is a one-spot change.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// eslint-disable-next-line import/no-unresolved -- added during native setup
import { useLLM } from 'react-native-executorch';

import {
  buildResult,
  buildContextualPrompt,
  evaluateQuality,
  completedPortion,
  parseSteps,
  parseTopic,
  toSteps,
  toSubSteps,
  subStepUser,
  DECODING,
  STOP_TOKEN_ID,
  SUB_MAX_STEPS,
  SUBSTEP_SYSTEM_PROMPT,
} from './OverwhelmService';
import { overwhelmMemory } from './overwhelmMemory';
import { provisionModel, type ModelSources } from './modelProvisioner';
import { isPowerConstrained } from '../../core/power/powerAwareness';
import { nudgeOverwhelmStep } from '../../core/nudges/featureNudges';
import type {
  Breakdowns,
  OverwhelmError,
  OverwhelmState,
  OverwhelmStep,
  ResultKind,
} from './types';

/** Tiny throwaway prompt so the first REAL request doesn't pay cold-start. */
const WARMUP_INPUT = 'warm up';

/** Chat message shape for react-native-executorch 0.4.x `generate(messages)`. */
type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

/** Build messages with optional personalized system prompt from memory. */
const toMessages = (userInput: string, systemPrompt: string): ChatMessage[] => [
  { role: 'system', content: systemPrompt },
  { role: 'user', content: userInput },
];

/** Messages for breaking ONE step into smaller sub-steps. */
const toSubMessages = (stepText: string, goal: string): ChatMessage[] => [
  { role: 'system', content: SUBSTEP_SYSTEM_PROMPT },
  { role: 'user', content: subStepUser(stepText, goal) },
];

// 'subrun' = generating sub-steps for a single step; intentionally kept distinct
// from 'run' so the screen stays on the results list (sub-loading is inline).
type Phase = 'idle' | 'warmup' | 'run' | 'subrun';

export type UseOverwhelmManager = {
  /** 'loading' | 'ready' | 'generating' | 'error' */
  state: OverwhelmState;
  /** Streamed, parsed micro-steps (checkbox `done` is screen-owned). */
  steps: OverwhelmStep[];
  /** Designer state of the finished run: 'results' | 'empty-result' | null. */
  resultKind: ResultKind | null;
  /** Model load / warm-up progress, 0..1 (for the calm loading UX). */
  progress: number;
  /** Present only in the 'error' state. */
  error: OverwhelmError | null;
  /** The last submitted text (kept so "Try again" / "Edit" need no retype). */
  lastInput: string;

  /** Per-step breakdowns (the "tap a step to go deeper" feature). */
  breakdowns: Breakdowns;

  /** Generate micro-steps for a freeform overwhelm description. */
  run: (input: string) => Promise<void>;
  /** Stop an in-flight generation (maps to useLLM.interrupt). */
  stop: () => void;
  /** Re-run the last input (designer "Try again"). */
  retry: () => Promise<void>;
  /** Break a single step into 3–6 smaller sub-steps (only when results are ready). */
  breakDown: (stepId: string, stepText: string) => Promise<void>;
  /** Read a step aloud (user-triggered) through the shared nudge bus → glasses/notifications. */
  speakStep: (text: string) => void;
};

export function useOverwhelmManager(): UseOverwhelmManager {
  // --- model sources (first-run provision, no network) ---------------------
  const [sources, setSources] = useState<ModelSources | null>(null);
  const [provisionError, setProvisionError] = useState<OverwhelmError | null>(null);

  useEffect(() => {
    let alive = true;
    provisionModel()
      .then((s) => alive && setSources(s))
      .catch((e: unknown) =>
        alive &&
        setProvisionError({
          kind: 'model_load',
          message: e instanceof Error ? e.message : 'Could not prepare the model.',
        }),
      );
    return () => {
      alive = false;
    };
  }, []);

  // --- the library hook (single LLM instance app-wide) ---------------------
  // A1/A4: sources may be null on first render; the library begins loading once
  // a valid file:// source is provided. Verify null-tolerance on the pinned ver.
  const llm = useLLM({
    modelSource: sources?.modelSource,
    tokenizerSource: sources?.tokenizerSource,
    tokenizerConfigSource: sources?.tokenizerConfigSource,
  } as never);

  // --- local generation state ---------------------------------------------
  const [steps, setSteps] = useState<OverwhelmStep[]>([]);
  const [resultKind, setResultKind] = useState<ResultKind | null>(null);
  const [warmedUp, setWarmedUp] = useState(false);
  const [runError, setRunError] = useState<OverwhelmError | null>(null);
  const [lastInput, setLastInput] = useState('');
  const [breakdowns, setBreakdowns] = useState<Breakdowns>({});

  const phaseRef = useRef<Phase>('idle');
  const responseRef = useRef<string>('');
  const interruptRef = useRef<(() => void) | undefined>(undefined);
  /** Which step id the current 'subrun' is generating sub-steps for. */
  const subTargetRef = useRef<string | null>(null);

  // Mutating phaseRef.current alone does NOT trigger a re-render, so the
  // `state` useMemo below (keyed on a fixed dep array) can go stale and get
  // stuck on a phase that already ended. setPhase mutates the ref (kept for
  // synchronous re-entrancy guards elsewhere) AND bumps this counter so any
  // memo/effect that lists it as a dep is forced to re-evaluate.
  const [phaseTick, setPhaseTick] = useState(0);
  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhaseTick((t) => t + 1);
  }, []);

  // Keep a ref of the live response so finalize() reads the latest text.
  useEffect(() => {
    responseRef.current = llm.response ?? '';
  }, [llm.response]);

  // Keep the latest interrupt fn so unmount-cleanup can always reach it.
  useEffect(() => {
    interruptRef.current = llm.interrupt;
  });

  // ExecuTorch REQUIRES interrupting an in-flight generation before unmount, or
  // the native runtime crashes the app (react-native-executorch docs). The
  // Overwhelm screen unmounts on navigate-away, so guard it here.
  useEffect(
    () => () => {
      try {
        interruptRef.current?.();
      } catch {
        /* no-op */
      }
    },
    [],
  );

  // --- configure decoding once the model is ready --------------------------
  useEffect(() => {
    if (!llm.isReady || typeof llm.configure !== 'function') return;
    try {
      // A2/A3 isolation point. Decoding config + stop token from the contract.
      llm.configure({
        generationConfig: {
          temperature: DECODING.temperature,
          topP: DECODING.topP,
          maxNewTokens: DECODING.maxNewTokens,
          // Llama 3.2 stops on <|eot_id|> (128009). Tokenizer config also
          // carries this; we set it explicitly for safety.
          stopTokenIds: [STOP_TOKEN_ID],
        },
      });
    } catch {
      // configure shape varies by version; non-fatal. CTO verify on pinned ver.
    }
  }, [llm]);

  // --- warm-up once ready (model-contract §5) ------------------------------
  // This fires on its own, without the user asking for it — so unlike a real "run",
  // it's skipped when the battery is low and unplugged (power-aware inference). The
  // first REAL request just pays the cold-start cost in that case, same as if warm-up
  // had failed for any other reason (already a non-fatal path below).
  useEffect(() => {
    if (!llm.isReady || warmedUp || phaseRef.current !== 'idle') return;
    let alive = true;
    (async () => {
      if (await isPowerConstrained()) {
        if (alive) setWarmedUp(true);
        return;
      }
      setPhase('warmup');
      try {
        await safeGenerate(llm, toMessages(WARMUP_INPUT, 'You are a helpful assistant.'));
      } catch {
        // warm-up failure is non-fatal — the first real run just pays cold-start.
      } finally {
        if (alive) {
          setPhase('idle');
          setWarmedUp(true);
        }
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [llm.isReady]);

  // --- STREAM: append parsed steps as completed "- ..." lines arrive -------
  useEffect(() => {
    const raw = completedPortion(llm.response ?? '');
    if (phaseRef.current === 'run') {
      setSteps(toSteps(parseSteps(raw)));
    } else if (phaseRef.current === 'subrun') {
      const parentId = subTargetRef.current;
      if (!parentId) return;
      const subs = toSubSteps(parseSteps(raw), parentId);
      setBreakdowns((prev) => ({
        ...prev,
        [parentId]: { status: 'loading', steps: subs },
      }));
    }
  }, [llm.response]);

  // --- finalize a run: parse the FULL raw, set steps + classified kind ------
  const finalize = useCallback(() => {
    const result = buildResult(responseRef.current);
    setSteps(result.steps);
    setResultKind(result.kind);
    setPhase('idle');
  }, [setPhase]);

  // --- run (multi-step workflow) -------------------------------------------
  // Step 1: retrieve similar past tasks from on-device memory
  // Step 2: build contextual system prompt with past examples
  // Step 3: generate steps (LLM inference)
  // Step 4: evaluate quality — if too few steps, retry once with base prompt
  // Step 5: save completed task + steps to memory for future personalization
  const run = useCallback(
    async (input: string) => {
      const trimmed = input.trim();
      if (!trimmed || !llm.isReady) return;
      setLastInput(trimmed);
      setRunError(null);
      setResultKind(null);
      setSteps([]);
      setBreakdowns({});
      responseRef.current = '';
      setPhase('run');
      try {
        // Step 1 + 2: retrieve memory → build contextual prompt
        const past = await overwhelmMemory.retrieve(trimmed);
        const systemPrompt = buildContextualPrompt(past);

        // Step 3: generate
        await safeGenerate(llm, toMessages(trimmed, systemPrompt));
        finalize();

        // Step 4: evaluate quality; retry with base prompt if weak
        if (evaluateQuality(responseRef.current) === 'retry') {
          responseRef.current = '';
          setSteps([]);
          setPhase('run');
          await safeGenerate(llm, toMessages(trimmed, buildContextualPrompt([])));
          finalize();
        }

        // Step 5: save to memory (only if we got usable steps)
        const finalSteps = parseSteps(responseRef.current);
        if (finalSteps.length >= 3) {
          void overwhelmMemory.save(trimmed, finalSteps, parseTopic(responseRef.current));
        }
      } catch (e) {
        setPhase('idle');
        setRunError({
          kind: 'inference',
          message:
            e instanceof Error ? e.message : 'Generation failed on this device.',
        });
      }
    },
    [llm, finalize, setPhase],
  );

  // --- stop (real interrupt) -----------------------------------------------
  const stop = useCallback(() => {
    if (phaseRef.current !== 'run') return;
    try {
      llm.interrupt?.();
    } catch {
      /* no-op */
    }
    // Keep whatever streamed in so far, classified.
    finalize();
  }, [llm, finalize]);

  const retry = useCallback(() => run(lastInput), [run, lastInput]);

  // --- breakDown: split ONE step into smaller sub-steps --------------------
  // Only runs from the settled results list (phase 'idle'); never overlaps a
  // top-level generation. Streams into breakdowns[stepId], then finalizes.
  const breakDown = useCallback(
    async (stepId: string, stepText: string) => {
      if (!llm.isReady || phaseRef.current !== 'idle') return;
      // Re-tapping a step that's already broken down is a no-op (toggle is UI-side).
      if (breakdowns[stepId]?.status === 'loading') return;

      subTargetRef.current = stepId;
      setPhase('subrun');
      responseRef.current = '';
      setBreakdowns((prev) => ({
        ...prev,
        [stepId]: { status: 'loading', steps: [] },
      }));
      try {
        await safeGenerate(llm, toSubMessages(stepText, lastInput));
        const subs = toSubSteps(parseSteps(responseRef.current), stepId).slice(
          0,
          SUB_MAX_STEPS,
        );
        setBreakdowns((prev) => ({
          ...prev,
          [stepId]: { status: subs.length ? 'done' : 'empty', steps: subs },
        }));
      } catch {
        setBreakdowns((prev) => ({
          ...prev,
          [stepId]: { status: 'error', steps: prev[stepId]?.steps ?? [] },
        }));
      } finally {
        setPhase('idle');
        subTargetRef.current = null;
      }
    },
    [llm, lastInput, breakdowns, setPhase],
  );

  // --- derive the single public state --------------------------------------
  const error: OverwhelmError | null = useMemo(() => {
    if (provisionError) return provisionError;
    if (runError) return runError;
    if (llm.error) {
      const kind = !llm.isReady ? 'model_load' : 'inference';
      return { kind, message: String(llm.error) };
    }
    return null;
  }, [provisionError, runError, llm.error, llm.isReady]);

  const state: OverwhelmState = useMemo(() => {
    if (error) return 'error';
    if (!llm.isReady || !warmedUp) return 'loading';
    // Only a TOP-LEVEL run drives the full 'generating' screen. A 'subrun' (one
    // step being broken down) stays 'ready' so the results list remains visible
    // with inline per-step loading. llm.isGenerating stays in deps to retrigger.
    if (phaseRef.current === 'run') return 'generating';
    return 'ready';
    // phaseTick is a deliberate dep: phaseRef.current changes don't re-trigger
    // this memo on their own (refs don't), so setPhase's counter bump is what
    // forces a recompute when the phase actually transitions.
  }, [error, llm.isReady, llm.isGenerating, warmedUp, phaseTick]);

  const speakStep = useCallback((text: string) => {
    nudgeOverwhelmStep(text);
  }, []);

  return {
    state,
    steps,
    resultKind,
    progress: llm.downloadProgress ?? 0,
    error,
    lastInput,
    breakdowns,
    run,
    stop,
    retry,
    breakDown,
    speakStep,
  };
}

/**
 * Single isolated generation call site (API ASSUMPTION A2/A3).
 * In react-native-executorch 0.4.x `generate` accepts a MESSAGES ARRAY and
 * applies the chat template internally, streaming into `llm.response`. Swap here
 * if the pinned version differs.
 */
async function safeGenerate(
  llm: { generate?: (messages: ChatMessage[]) => Promise<void> },
  messages: ChatMessage[],
) {
  if (typeof llm.generate !== 'function') {
    throw new Error('react-native-executorch useLLM.generate is unavailable.');
  }
  await llm.generate(messages);
}
