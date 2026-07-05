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

export function LlamaProvider({ children }: { children: React.ReactNode }) {
  const [sources, setSources] = useState<{
    modelSource: string; tokenizerSource: string; tokenizerConfigSource: string;
  } | null>(null);
  const [provisionError, setProvisionError] = useState<unknown>(null);

  useEffect(() => {
    let alive = true;
    provisionModel()
      .then((s) => { if (alive) setSources(s); })
      .catch((e: unknown) => { if (alive) setProvisionError(e); });
    return () => { alive = false; };
  }, []);

  const llm = useLLM({
    modelSource: sources?.modelSource,
    tokenizerSource: sources?.tokenizerSource,
    tokenizerConfigSource: sources?.tokenizerConfigSource,
  } as never);

  const responseRef = useRef('');
  useEffect(() => {
    responseRef.current = llm.response ?? '';
  }, [llm.response]);

  const value: LlamaContextValue = {
    isReady: llm.isReady,
    isGenerating: llm.isGenerating,
    response: llm.response ?? '',
    getResponse: () => responseRef.current,
    downloadProgress: llm.downloadProgress ?? 0,
    error: provisionError ?? llm.error,
    generate: async (messages: ChatMessage[]) => {
      if (typeof llm.generate !== 'function') {
        throw new Error('react-native-executorch useLLM.generate is unavailable.');
      }
      await llm.generate(messages);
    },
    interrupt: () => {
      try { llm.interrupt?.(); } catch { /* no-op — mirrors the original guard */ }
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
