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
 *
 * v2 (2026-07-06): life-coach framing, 5-8 steps (was 5-10), "under 30 minutes"
 * specificity, numbered-list-only output. The "Topic:" line is GONE — category is
 * now a separate categorize() call (below) instead of piggybacking on this generation,
 * so a small/quantized model doesn't have to juggle two output contracts in one shot.
 * ------------------------------------------------------------------ */
export const SYSTEM_PROMPT =
  'You are a calm, practical life coach. Break tasks into 5 to 8 clear, actionable ' +
  'micro-steps. Each step must be completable in under 30 minutes. Be specific, not ' +
  'vague. Output a numbered list only. No intro text. No explanation.';

/* ------------------------------------------------------------------ *
 * Sub-step prompt — for the "tap a step to break it down further" feature.
 * Takes ONE step (and the overall goal for context) and splits it into a few
 * even smaller actions. Same output format as SYSTEM_PROMPT so parseSteps works
 * unchanged. Owned mobile-side like the main prompt (model-contract §3).
 * ------------------------------------------------------------------ */
export const SUBSTEP_SYSTEM_PROMPT =
  'You are a calm, practical life coach. The user gives you ONE step they find ' +
  'tricky, plus the overall task it belongs to for context. Break just that single ' +
  'step into 3 to 4 even smaller actions, each doable in a minute or two. Output a ' +
  'numbered list only. No intro text. No explanation.';

/* ------------------------------------------------------------------ *
 * Non-English prompt variants — used only when the app locale isn't 'en'.
 *
 * DELIBERATELY built apart from the constants above: SYSTEM_PROMPT is byte-locked
 * to the eval harness (20/20 report) and must not drift. The variants are the same
 * instructions plus an output-language directive (instruction stays English —
 * Llama 3.2 follows English instructions most reliably; each listed language is an
 * officially supported output language of the base model, which is also why the app
 * offers exactly this set). Hindi verified on-device 2026-07-16; ⚠️ the others are
 * not yet eval-verified — needs per-language on-device passes (and ideally eval sets
 * in ml/test/) before being treated as shipped.
 * parseSteps is language-agnostic — it keys on the numbered-list markers, and the
 * prompt pins Arabic numerals ("1." not "१.") so the regex contract holds; the
 * numeral pin matters for Hindi (Devanagari digits) and Thai (Thai digits).
 * ------------------------------------------------------------------ */
const OUTPUT_LANGUAGE: Record<string, string> = {
  es: 'simple, natural Spanish',
  fr: 'simple, natural French',
  de: 'simple, natural German',
  it: 'simple, natural Italian',
  pt: 'simple, natural Portuguese',
  hi: 'simple, natural Hindi (Devanagari script)',
  th: 'simple, natural Thai (Thai script)',
};

/** The breakdown system prompt for the given app locale. */
export function systemPromptFor(locale: string): string {
  const lang = OUTPUT_LANGUAGE[locale];
  if (!lang) return SYSTEM_PROMPT;
  return (
    'You are a calm, practical life coach. Break tasks into 5 to 8 clear, actionable ' +
    'micro-steps. Each step must be completable in under 30 minutes. Be specific, not ' +
    `vague. Write every step in ${lang}, and ONLY in ${lang} — never add an English ` +
    'translation in brackets. Output a ' +
    'numbered list only, using Arabic numerals (1. 2. 3.). No intro text. No explanation.'
  );
}

/** The sub-step system prompt for the given app locale. */
export function subStepSystemPromptFor(locale: string): string {
  const lang = OUTPUT_LANGUAGE[locale];
  if (!lang) return SUBSTEP_SYSTEM_PROMPT;
  return (
    'You are a calm, practical life coach. The user gives you ONE step they find ' +
    'tricky, plus the overall task it belongs to for context. Break just that single ' +
    'step into 3 to 4 even smaller actions, each doable in a minute or two. Write every ' +
    `action in ${lang}, and ONLY in ${lang} — never add an English translation in ` +
    'brackets. Output a numbered list only, ' +
    'using Arabic numerals (1. 2. 3.). No intro text. No explanation.'
  );
}

/** Upper bound on sub-steps shown under a parent (calm; avoids re-overwhelming). */
export const SUB_MAX_STEPS = 6;

/* ------------------------------------------------------------------ *
 * Categorization — a SEPARATE, tiny second call after the main breakdown succeeds.
 * Fixed 7-bucket taxonomy (not freeform, unlike the old "Topic:" line) so it's usable
 * for filtering/insights (weekly insight card, Past Tasks grouping) without needing to
 * normalize arbitrary model-generated labels.
 * ------------------------------------------------------------------ */
export const CATEGORIES = ['work', 'health', 'home', 'learning', 'finance', 'personal', 'social'] as const;
export type Category = (typeof CATEGORIES)[number];
const DEFAULT_CATEGORY: Category = 'personal';

export const CATEGORIZE_SYSTEM_PROMPT =
  `Classify the user's task into exactly ONE of these categories: ${CATEGORIES.join(', ')}. ` +
  'Output ONLY the single category word, lowercase, nothing else. No explanation.';

export function categorizeUser(taskText: string): string {
  return `Task: "${taskText}"`;
}

/**
 * Keyword-heuristic category — REPLACES the separate LLM categorize() call.
 *
 * WHY (2026-07-07): that call was a full THIRD model generation per submission, fired
 * invisibly after results were already on screen — a major reliability cost on
 * memory-constrained devices (a whole extra 1.2GB-model inference = another chance for the
 * native runtime to hang/segfault right after an apparently-successful result). Deriving
 * the bucket from keywords is deterministic, instant, and needs zero native inference, so
 * the visible result no longer depends on a hidden second/third generation succeeding.
 * Categorization is only used for grouping/insights, where "good enough" easily suffices.
 */
export function categorizeHeuristic(taskText: string): Category {
  const t = taskText.toLowerCase();
  const table: [Category, RegExp][] = [
    ['work', /\b(work|job|meet(ing)?|email|report|deadline|project|client|boss|presentation|office|slide)\b/],
    ['health', /\b(gym|exercise|workout|doctor|medic|health|diet|sleep|water|hydrat|run|walk|yoga|therapy|dentist)\b/],
    ['home', /\b(clean|room|house|kitchen|laundry|dish|tidy|organi[sz]e|declutter|garden|repair|grocer|cook|fridge)\b/],
    ['learning', /\b(study|learn|read|course|exam|homework|assignment|practice|practise|research|revise|lecture)\b/],
    ['finance', /\b(budget|money|bill|pay|tax|invoice|expense|bank|save|invest|debt|rent|salary)\b/],
    ['social', /\b(friend|family|party|birthday|call|visit|meet up|gift|wedding|date|dinner|guest)\b/],
  ];
  for (const [cat, re] of table) if (re.test(t)) return cat;
  return DEFAULT_CATEGORY; // 'personal'
}

/** Parse the categorize() call's raw output into one of the fixed CATEGORIES, defaulting on any miss. */
export function parseCategory(raw: string): Category {
  const cleaned = raw.trim().toLowerCase().replace(/[^a-z]/g, '');
  return (CATEGORIES as readonly string[]).includes(cleaned) ? (cleaned as Category) : DEFAULT_CATEGORY;
}

/**
 * Build an enriched system message that injects similar past tasks as few-shot
 * examples. If no relevant past tasks exist, falls back to the base SYSTEM_PROMPT.
 * Called by useOverwhelmManager before each `run()`.
 *
 * The examples are deliberately generic (just "In the past you helped with X and
 * produced these steps") — they are short-circuit context, not user-identifying data.
 */
export function buildContextualPrompt(pastExamples: MemoryEntry[]): string {
  // FEW-SHOT INJECTION DISABLED (on-device evidence, 2026-07-07/08): across two days
  // of testing, EVERY generation that used the bare SYSTEM_PROMPT (memory empty)
  // succeeded, and EVERY generation that used the enriched prompt (memory populated)
  // hung or crashed — surviving three attempted fixes (3-examples→1 shrink with hard
  // char caps, app-wide native serialization, and disabling the embeddings model
  // load). This injection is the last remaining difference between the known-good
  // and always-failing paths, and it buys almost nothing: memory still fully powers
  // Past Tasks, progress nudges, and the weekly insight card. So the breakdown
  // generation now ALWAYS runs with the eval-verified base prompt (20/20 report),
  // whatever `pastExamples` holds. Signature kept so useOverwhelmManager and tests
  // don't churn; revisit only after the runtime pin moves and an on-device
  // two-generation test passes with memory populated.
  void pastExamples;
  return SYSTEM_PROMPT;
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
 *
 * NOTE: the eval harness honours these, but the on-device runtime does not —
 * react-native-executorch 0.4.10 exposes no sampling API (its ChatConfig is
 * only { initialMessageHistory, contextWindowLength, systemPrompt }), so the
 * app decodes with the runtime's built-in defaults. Kept as the documented
 * contract; wire them in if a future runtime exposes the knobs.
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
