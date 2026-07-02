/**
 * OverwhelmService parser tests.
 *
 * Parity check: the SELFTEST_SAMPLES below are copied verbatim from
 * ml/test/overwhelm_eval.py (selftest()). On-device parsing MUST yield the same
 * step counts / states as the eval harness, or the report won't reflect reality.
 *
 * Runner: Jest (configure via package.json once the RN app is scaffolded). This
 * file imports only the pure service — no React, no native, no model required.
 */

import {
  buildPrompt,
  parseSteps,
  classify,
  buildResult,
  completedPortion,
  subStepUser,
  toSubSteps,
  SUB_MAX_STEPS,
  SYSTEM_PROMPT,
} from './OverwhelmService';

// --- Mirror of overwhelm_eval.py SELFTEST_SAMPLES -------------------------
const SAMPLES = {
  good:
    '- Open the calendar app\n- Pick a date for the party\n- Make a guest list\n' +
    '- Choose a venue or your living room\n- Send invites to five people',
  numbered: '1. Sort the mail into keep and toss\n2. Shred the junk\n3. File the bills',
  refusal: "I'm sorry, I can't help with that.",
  preamble:
    'Sure! Here are some steps:\n- Take a deep breath\n- Write one sentence\n' +
    '- List three tasks\n- Do the first one\n- Reward yourself',
};

describe('parseSteps — eval parity', () => {
  it('good: 5 bullet steps', () => {
    const steps = parseSteps(SAMPLES.good);
    expect(steps).toHaveLength(5);
    expect(steps[0]).toBe('Open the calendar app');
    expect(classify(steps, SAMPLES.good)).toBe('results');
  });

  it('numbered: strips "1." / numbering, keeps 3 steps', () => {
    const steps = parseSteps(SAMPLES.numbered);
    expect(steps).toEqual([
      'Sort the mail into keep and toss',
      'Shred the junk',
      'File the bills',
    ]);
    // 1–4 steps is thin but still a results state (contract §4a).
    expect(classify(steps, SAMPLES.numbered)).toBe('results');
  });

  it('refusal: 0 steps → empty-result', () => {
    const steps = parseSteps(SAMPLES.refusal);
    expect(steps).toHaveLength(0);
    expect(classify(steps, SAMPLES.refusal)).toBe('empty-result');
  });

  it('preamble: ignores the intro line, keeps 5 steps', () => {
    const steps = parseSteps(SAMPLES.preamble);
    expect(steps).toHaveLength(5);
    expect(steps[0]).toBe('Take a deep breath');
    expect(classify(steps, SAMPLES.preamble)).toBe('results');
  });
});

describe('parseSteps — defensive rules', () => {
  it('clamps >10 steps to 10', () => {
    const raw = Array.from({ length: 14 }, (_, i) => `- step ${i + 1}`).join('\n');
    expect(parseSteps(raw)).toHaveLength(10);
  });

  it('handles bullet variants (-, *, •)', () => {
    expect(parseSteps('- a\n* b\n• c')).toEqual(['a', 'b', 'c']);
  });

  it('handles "1)" and "1." numbering', () => {
    expect(parseSteps('1) a\n2. b')).toEqual(['a', 'b']);
  });

  it('drops non-step / empty lines', () => {
    expect(parseSteps('\n   \nHere you go:\n- only step\nLet me know!')).toEqual([
      'only step',
    ]);
  });

  it('does not match a bare line with no marker', () => {
    expect(parseSteps('just write the report')).toEqual([]);
  });
});

describe('buildResult', () => {
  it('produces stable ids and done:false', () => {
    const result = buildResult(SAMPLES.good);
    expect(result.kind).toBe('results');
    expect(result.steps.map((s) => s.id)).toEqual([
      'step-0',
      'step-1',
      'step-2',
      'step-3',
      'step-4',
    ]);
    expect(result.steps.every((s) => s.done === false)).toBe(true);
  });

  it('empty-result for refusal text', () => {
    expect(buildResult(SAMPLES.refusal).kind).toBe('empty-result');
  });
});

describe('completedPortion (streaming)', () => {
  it('returns only completed lines (up to last newline)', () => {
    expect(completedPortion('- a\n- b\n- half typed')).toBe('- a\n- b\n');
  });

  it('returns empty string when no newline yet', () => {
    expect(completedPortion('- still typing')).toBe('');
  });
});

describe('sub-step helpers (go-deeper feature)', () => {
  it('subStepUser includes the goal as context when present', () => {
    expect(subStepUser('Buy a domain', 'make a news website')).toBe(
      'Overall goal: make a news website\nStep to break down: Buy a domain',
    );
  });

  it('subStepUser omits the goal line when no context', () => {
    expect(subStepUser('Buy a domain')).toBe('Step to break down: Buy a domain');
  });

  it('toSubSteps namespaces ids under the parent and caps at SUB_MAX_STEPS', () => {
    const raw = Array.from({ length: 9 }, (_, i) => `- sub ${i + 1}`).join('\n');
    const subs = toSubSteps(parseSteps(raw), 'step-2');
    expect(subs).toHaveLength(SUB_MAX_STEPS);
    expect(subs[0]).toEqual({ id: 'step-2-sub-0', text: 'sub 1', done: false });
    // sub ids never collide with a top-level id
    expect(subs.every((s) => s.id.startsWith('step-2-sub-'))).toBe(true);
  });
});

describe('buildPrompt', () => {
  it('embeds the system prompt and literal Llama special tokens', () => {
    const p = buildPrompt('my room is a mess');
    expect(p.startsWith('<|begin_of_text|><|start_header_id|>system<|end_header_id|>')).toBe(
      true,
    );
    expect(p).toContain(SYSTEM_PROMPT);
    expect(p).toContain('<|start_header_id|>user<|end_header_id|>\n\nmy room is a mess<|eot_id|>');
    expect(p.endsWith('<|start_header_id|>assistant<|end_header_id|>\n\n')).toBe(true);
  });
});
