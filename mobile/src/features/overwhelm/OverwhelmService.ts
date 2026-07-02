/**
 * OverwhelmService — pure, unit-testable inference helpers.
 *
 * NO React, NO `react-native-executorch`, NO network. Just strings in / strings out.
 *
 * Authority for this file:
 *  - docs/overwhelm-model-contract.md  §3 (prompt template), §4 (parsing rules)
 *  - The parser is intentionally IDENTICAL to ml/test/overwhelm_eval.py so that
 *    on-device behavior == the AIML eval report. If you change a regex here,
 *    change it there too (and re-run the eval).
 *
 * Privacy: this module imports zero networking. The ESLint network-ban
 * (integration §5.1) is scoped to mobile/src/features/overwhelm/**.
 */

import type { OverwhelmResult, OverwhelmStep, ResultKind } from './types';
import type { MemoryEntry } from './overwhelmMemory';

/* ------------------------------------------------------------------ *
 * System prompt — single source of truth for output format & count.
 * MUST stay byte-identical to SYSTEM in ml/test/overwhelm_eval.py and to
 * model-contract §3, or on-device output drifts from the eval report.
 * ------------------------------------------------------------------ */
export const SYSTEM_PROMPT =
  'You are a calm assistant that helps an overwhelmed person take action. First, ' +
  'output exactly one line "Topic: <a short 1-2 word category>" (e.g. "Topic: ' +
  "Cleaning\"). Then break the user's situation into 5 to 10 small, concrete, " +
  'single-action steps. Each step must start with a verb and be doable in a few ' +
  'minutes. Output the steps as a markdown bullet list using "- ", one step per ' +
  'line, right after the Topic line. No other intro text, no numbering.';

/* ------------------------------------------------------------------ *
 * Sub-step prompt — for the "tap a step to break it down further" feature.
 * Takes ONE step (and the overall goal for context) and splits it into a few
 * even smaller actions. Same output format as SYSTEM_PROMPT so parseSteps works
 * unchanged. Owned mobile-side like the main prompt (model-contract §3).
 * ------------------------------------------------------------------ */
export const SUBSTEP_SYSTEM_PROMPT =
  'You are a calm assistant. The user gives you ONE step they find tricky. Break ' +
  'just that single step into 3 to 5 even smaller actions, each doable in a ' +
  'minute or two. Each action must start with a verb. Output ONLY a markdown ' +
  'bullet list using "- ", one action per line. No intro, no numbering, no extra text.';

/** Upper bound on sub-steps shown under a parent (calm; avoids re-overwhelming). */
export const SUB_MAX_STEPS = 6;

/**
 * Build an enriched system message that injects similar past tasks as few-shot
 * examples. If no relevant past tasks exist, falls back to the base SYSTEM_PROMPT.
 * Called by useOverwhelmManager before each `run()`.
 *
 * The examples are deliberately generic (just "In the past you helped with X and
 * produced these steps") — they are short-circuit context, not user-identifying data.
 */
export function buildContextualPrompt(pastExamples: MemoryEntry[]): string {
  if (!pastExamples.length) return SYSTEM_PROMPT;
  const examples = pastExamples
    .slice(0, 3)
    .map((e, i) => {
      const steps = e.steps.slice(0, 5).map((s) => `- ${s}`).join('\n');
      return `Example ${i + 1}:\nTask: "${e.task}"\nSteps:\n${steps}`;
    })
    .join('\n\n');
  return (
    `${SYSTEM_PROMPT}\n\n` +
    `Here are similar tasks you helped with before — use them as style reference only:\n\n${examples}`
  );
}

/**
 * Evaluate output quality. Returns 'good' if at least 3 valid steps found,
 * 'retry' otherwise. Used by the multi-step workflow to decide if a re-run is needed.
 */
export function evaluateQuality(raw: string): 'good' | 'retry' {
  const steps = parseSteps(raw);
  if (steps.length >= 3) return 'good';
  return 'retry';
}

/** User-turn content for a sub-breakdown: the step, plus the goal for grounding. */
export function subStepUser(parentStep: string, context?: string): string {
  const goal = context?.trim();
  return goal
    ? `Overall goal: ${goal}\nStep to break down: ${parentStep}`
    : `Step to break down: ${parentStep}`;
}

/** Wrap cleaned sub-step strings with ids namespaced under the parent step. */
export function toSubSteps(
  texts: readonly string[],
  parentId: string,
): OverwhelmStep[] {
  return texts
    .slice(0, SUB_MAX_STEPS)
    .map((text, i) => ({ id: `${parentId}-sub-${i}`, text, done: false }));
}

/* ------------------------------------------------------------------ *
 * Decoding config (model-contract §3 / §5). Low temperature for format
 * stability. Matches GEN in the eval harness.
 * ------------------------------------------------------------------ */
export const DECODING = {
  temperature: 0.3,
  topP: 0.9,
  maxNewTokens: 256,
} as const;

/** Llama 3.2 stop token. Generation halts on `<|eot_id|>`. */
export const STOP_TOKEN = '<|eot_id|>';
export const STOP_TOKEN_ID = 128009;

/* ------------------------------------------------------------------ *
 * Regexes — ported 1:1 from overwhelm_eval.py.
 *   STEP_LINE_RE: ^\s*(?:[-*•]|\d+[.)])\s+(.*\S)\s*$
 *   REFUSAL_RE  : \b(i can('|no)t help|i'?m sorry|as an ai|cannot assist)\b  (i flag)
 * ------------------------------------------------------------------ */
const STEP_LINE_RE = /^\s*(?:[-*•]|\d+[.)])\s+(.*\S)\s*$/;
const REFUSAL_RE = /\b(i can('|no)t help|i'?m sorry|as an ai|cannot assist)\b/i;
/** Matches the "Topic: X" line the SYSTEM_PROMPT asks for. Not a bullet, so
 * STEP_LINE_RE (and therefore parseSteps) naturally ignores it — no parser
 * conflict, this only needs its own tiny extractor. */
const TOPIC_LINE_RE = /^\s*Topic:\s*(.+?)\s*$/im;

const MAX_STEPS = 10;
const DEFAULT_TOPIC = 'General';

/**
 * Assemble the exact Llama 3.2 chat-format prompt (literal special tokens).
 * Identical to build_prompt() in overwhelm_eval.py. The system prompt lives
 * here (mobile-owned) so we can iterate wording without re-exporting the model.
 */
export function buildPrompt(userInput: string): string {
  return (
    '<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n' +
    `${SYSTEM_PROMPT}<|eot_id|><|start_header_id|>user<|end_header_id|>\n\n` +
    `${userInput}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n`
  );
}

/**
 * Parse raw model text into cleaned step strings (model-contract §4).
 *
 * Mirrors parse_steps() in overwhelm_eval.py exactly:
 *   1. Split on newlines.
 *   2. Keep lines matching a bullet (-, *, •) OR a number (1. / 1)).
 *   3. Strip the leading marker and surrounding whitespace.
 *   4. Drop empties / non-step lines (anything not matching the regex).
 *   5. Clamp the upper bound to 10 (lower bound handled by classify()).
 *
 * Note: deliberately NO dedupe / no whitespace-collapse — the Python parser
 * doesn't do them, and parity with the eval report is the contract.
 */
export function parseSteps(raw: string): string[] {
  const steps: string[] = [];
  for (const line of raw.split(/\r\n|\r|\n/)) {
    const m = STEP_LINE_RE.exec(line);
    if (m) {
      steps.push(m[1].trim());
    }
  }
  return steps.slice(0, MAX_STEPS);
}

/**
 * Refusal detection — mirrors the eval's `refusal` flag: a refusal only counts
 * when there are also zero usable steps.
 */
export function isRefusal(raw: string, stepCount: number): boolean {
  return REFUSAL_RE.test(raw) && stepCount === 0;
}

/**
 * Map a parsed result to a designer state (model-contract §4a):
 *  - 0 steps OR a refusal → 'empty-result'
 *  - 1..10 steps          → 'results' (1–4 is thin but still shown)
 */
export function classify(steps: readonly string[], raw: string): ResultKind {
  if (steps.length === 0 || isRefusal(raw, steps.length)) {
    return 'empty-result';
  }
  return 'results';
}

/** Wrap cleaned step strings into checkbox-ready steps with stable ids. */
export function toSteps(texts: readonly string[]): OverwhelmStep[] {
  return texts.map((text, i) => ({ id: `step-${i}`, text, done: false }));
}

/**
 * Extract the "Topic: X" line the model was asked to output. Falls back to a
 * generic label if a small/quantized model doesn't comply with the format —
 * same "never block on a model formatting slip" spirit as the rest of parsing.
 */
export function parseTopic(raw: string): string {
  const m = TOPIC_LINE_RE.exec(raw);
  return m ? m[1].trim() : DEFAULT_TOPIC;
}

/**
 * One-shot: raw model text → fully classified result.
 * Used to finalize a generation (the hook streams incrementally with parseSteps
 * + toSteps, then calls this on completion to set the final kind).
 */
export function buildResult(raw: string): OverwhelmResult {
  const texts = parseSteps(raw);
  return {
    steps: toSteps(texts),
    topic: parseTopic(raw),
    raw,
    kind: classify(texts, raw),
  };
}

/**
 * Helper for streaming: return only the portion of `raw` up to and including
 * the last newline, i.e. the COMPLETED lines. Feeding this to parseSteps avoids
 * rendering a half-typed final line mid-stream, while keeping parseSteps itself
 * byte-identical to the Python parser.
 */
export function completedPortion(raw: string): string {
  const i = raw.lastIndexOf('\n');
  return i >= 0 ? raw.slice(0, i + 1) : '';
}
