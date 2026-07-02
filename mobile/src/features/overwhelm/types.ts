/**
 * Overwhelm Manager — shared types.
 *
 * Authority: docs/overwhelm-model-contract.md §4 (I/O contract) and the build
 * task. The hook surfaces these; the screen consumes them and never touches
 * `react-native-executorch` directly.
 */

/** A single actionable micro-step. `done` (checkbox) is screen-owned. */
export type OverwhelmStep = {
  /** Stable, index-derived id used for checkbox state. UI owns the *number*. */
  id: string;
  /** Cleaned step text — no leading bullet/number/markdown. */
  text: string;
  /** Checkbox state. Ephemeral / local for v1 (no persistence). */
  done: boolean;
};

/** Final parsed result of one generation. */
export type OverwhelmResult = {
  steps: OverwhelmStep[];
  /** Short topic label the model tagged this task with (e.g. "Cleaning"). */
  topic: string;
  /**
   * Raw model text. Kept for in-session debugging/QA only.
   * NEVER logged off-device or sent anywhere (privacy guarantee, integration §5).
   */
  raw: string;
  /**
   * Which designer state this maps to (model-contract §4a):
   *  - 'results'      → 1..10 usable steps
   *  - 'empty-result' → 0 steps or a refusal/apology
   */
  kind: ResultKind;
};

export type ResultKind = 'results' | 'empty-result';

/**
 * Status of breaking ONE step into smaller sub-steps (the "tap a step to go
 * deeper" feature). Keyed per parent step id in the hook.
 *  - 'idle'    → not requested
 *  - 'loading' → sub-steps generating (may stream in)
 *  - 'done'    → sub-steps ready
 *  - 'empty'   → model returned nothing usable
 *  - 'error'   → generation failed
 */
export type BreakdownStatus = 'idle' | 'loading' | 'done' | 'empty' | 'error';

export type StepBreakdown = {
  status: BreakdownStatus;
  /** Sub-steps; `done` (checkbox) is screen-owned, ids unique under the parent. */
  steps: OverwhelmStep[];
};

/** Per-parent-step breakdowns, keyed by the parent step id. */
export type Breakdowns = Record<string, StepBreakdown>;

/**
 * Hook lifecycle state (per build task).
 *  - 'loading'    → model copying / loading into memory / warming up
 *  - 'ready'      → warm, awaiting input
 *  - 'generating' → inference in progress (steps stream in)
 *  - 'error'      → model load / runtime failure
 */
export type OverwhelmState = 'loading' | 'ready' | 'generating' | 'error';

export type OverwhelmErrorKind = 'model_load' | 'inference';

export type OverwhelmError = {
  kind: OverwhelmErrorKind;
  /** User-safe; the screen maps it to designer copy, does not show verbatim. */
  message: string;
};
