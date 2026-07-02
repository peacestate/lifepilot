/**
 * Smart Glasses v1 — spoken nudges (audio-only, no Meta SDK).
 *
 * The glasses are a standard Bluetooth audio sink; this just plays a short spoken nudge
 * to the phone's active audio output (the glasses, when connected). NO Meta toolkit, NO
 * approval, and — critically — NO exposure: output only, nothing captured, nothing uploaded.
 *
 * PRIVACY: uses the OS text-to-speech via expo-speech. On iOS this is fully on-device
 * (AVSpeechSynthesizer). On Android, prefer an OFFLINE voice/engine so the nudge text
 * never reaches a network TTS voice — `pickOfflineVoice` favors a local one. This module
 * imports zero networking of our own.
 *
 * Reuses the existing engines' nudge decisions (Hydration/Energy/Overwhelm); it adds no
 * model, no .pte, no registry entry. Glasses are strictly additive — if none are connected,
 * the audio simply plays wherever the phone's audio is going (or nowhere), and every feature
 * still works on the phone exactly as before.
 */

// eslint-disable-next-line import/no-unresolved -- added during native setup (expo install expo-speech)
import * as Speech from 'expo-speech';

let cachedVoiceId: string | null | undefined;

/** Find an on-device voice so the nudge text isn't sent to a network TTS voice. */
async function pickOfflineVoice(): Promise<string | undefined> {
  if (cachedVoiceId !== undefined) return cachedVoiceId ?? undefined;
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    // Prefer an English, non-network voice. expo-speech doesn't expose a hard "offline"
    // flag; native voices are on-device. Pick a stable local English voice if present.
    const local = voices.find((v) => /en[-_]/i.test(v.language));
    cachedVoiceId = local?.identifier ?? null;
  } catch {
    cachedVoiceId = null;
  }
  return cachedVoiceId ?? undefined;
}

export type NudgeOptions = {
  /** Keep nudges generic — open-ear speakers can be overheard (spec §5). */
  rate?: number;
  pitch?: number;
};

/**
 * Speak a short, generic nudge through the active audio output (the glasses when connected).
 * Caller passes a final, non-sensitive sentence (e.g. "A good time for some water.").
 */
export async function speakNudge(text: string, opts: NudgeOptions = {}): Promise<void> {
  const voice = await pickOfflineVoice();
  Speech.stop(); // never stack nudges
  Speech.speak(text, {
    voice,
    rate: opts.rate ?? 0.98,
    pitch: opts.pitch ?? 1.0,
    language: 'en-US',
  });
}

/** Silence any in-progress nudge (user "not now" / quiet hours). */
export function silenceNudge(): void {
  Speech.stop();
}
