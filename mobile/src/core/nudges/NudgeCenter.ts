/**
 * NudgeCenter — ONE shared nudge bus for the whole app.
 *
 * Instead of wiring each feature's reminder into each output (glasses, notifications…),
 * every feature PUBLISHES a nudge here, and every output SUBSCRIBES once. Add a new
 * output (phone notifications, watch, etc.) in one place and all features get it for free;
 * add a new feature and it reaches every output by calling `publish` once.
 *
 *   Hydration ─┐
 *   Energy   ──┼─▶  NudgeCenter  ─┬─▶ glasses (speakNudge)
 *   Overwhelm ─┘                  └─▶ (future) phone notification / watch / …
 *
 * Centralizes the cross-cutting policy too: quiet-hours/enabled gating and de-dupe live
 * here, so no feature re-implements them. PRIVACY: pure in-process pub/sub, zero network.
 */

export type NudgeFeature = 'hydration' | 'energy' | 'overwhelm';

export type Nudge = {
  id: string;
  feature: NudgeFeature;
  /** Final, GENERIC, non-sensitive sentence (it may be spoken aloud — glasses §5). */
  message: string;
  reason: string;           // e.g. 'behindPace', 'focusWindow'
  at: number;               // epoch ms
};

export type NudgeSettings = {
  enabled: boolean;
  perFeature: Record<NudgeFeature, boolean>;
  quietFromHour: number;    // inclusive
  quietToHour: number;      // exclusive (wake)
  /** min gap between ANY two delivered nudges, ms */
  minGapMs: number;
};

const DEFAULT_SETTINGS: NudgeSettings = {
  enabled: true,
  perFeature: { hydration: true, energy: true, overwhelm: true },
  quietFromHour: 22,
  quietToHour: 8,
  minGapMs: 30 * 60_000,
};

type Subscriber = (n: Nudge) => void;

class NudgeCenterImpl {
  private subs = new Set<Subscriber>();
  private settings: NudgeSettings = { ...DEFAULT_SETTINGS };
  private lastDeliveredAt = 0;
  private lastByFeature: Partial<Record<NudgeFeature, number>> = {};

  configure(patch: Partial<NudgeSettings>) {
    this.settings = { ...this.settings, ...patch, perFeature: { ...this.settings.perFeature, ...patch.perFeature } };
  }
  getSettings(): NudgeSettings {
    return this.settings;
  }

  /** Any output (glasses, notifications…) subscribes once; returns an unsubscribe fn. */
  subscribe(fn: Subscriber): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  /**
   * A feature publishes a decided nudge. The center applies the shared gate (enabled,
   * per-feature toggle, quiet hours, global de-bounce) and only then fans out to outputs.
   * Returns true if delivered.
   */
  publish(input: Omit<Nudge, 'id' | 'at'> & { at?: number }): boolean {
    const at = input.at ?? Date.now();
    if (!this.passesGate(input.feature, at)) return false;
    const nudge: Nudge = { ...input, at, id: `${at}-${input.feature}` };
    this.lastDeliveredAt = at;
    this.lastByFeature[input.feature] = at;
    this.subs.forEach((fn) => {
      try { fn(nudge); } catch { /* an output failing must not break others */ }
    });
    return true;
  }

  private passesGate(feature: NudgeFeature, at: number): boolean {
    const s = this.settings;
    if (!s.enabled || !s.perFeature[feature]) return false;
    const hour = new Date(at).getHours();
    const quiet = s.quietFromHour <= s.quietToHour
      ? hour >= s.quietFromHour && hour < s.quietToHour
      : hour >= s.quietFromHour || hour < s.quietToHour; // wraps midnight
    if (quiet) return false;
    if (at - this.lastDeliveredAt < s.minGapMs) return false;
    return true;
  }
}

/** App-wide singleton — the single wiring point. */
export const nudgeCenter = new NudgeCenterImpl();
