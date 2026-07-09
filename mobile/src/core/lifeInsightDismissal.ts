/**
 * lifeInsightDismissal — remembers that the user dismissed the Home insight card, keyed
 * by the card's content signature. So a dismissed "You have X in progress" stays gone
 * across app launches, but a NEW/changed insight (task finished, hydration behind, etc.)
 * surfaces again. On-device only, same sandboxed JSON substrate as the feature stores.
 */
import { createJsonFileStore } from './storage/jsonFileStore';

let dismissedSig: string | undefined;

const disk = createJsonFileStore<{ sig?: string }>('lp_insight_dismissed.json', (loaded) => {
  dismissedSig = loaded.sig;
});
void disk.ready();

/** Stable signature for an insight's sentences (order-sensitive is fine — order is deterministic). */
export function insightSignature(sentences: string[]): string {
  return sentences.join('␟');
}

export const lifeInsightDismissal = {
  ready: () => disk.ready(),
  isDismissed: (sig: string) => dismissedSig === sig,
  dismiss: (sig: string) => {
    dismissedSig = sig;
    disk.save({ sig });
  },
};
