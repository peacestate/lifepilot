/**
 * voiceModelProvisioner — make the on-device Whisper tiny.en speech-to-text
 * model loadable, fully local. Same pattern as modelProvisioner.ts (Llama).
 *
 * WHY this exists: `useSpeechToText` (react-native-executorch) defaults to
 * fetching its encoder/decoder/tokenizer from a public HuggingFace URL over
 * the network the first time it loads, if no explicit sources are passed.
 * That would silently break the app's zero-network guarantee. Instead we
 * download the three files once (see mobile/RUNBOOK.md "Voice input"), place
 * them in the app's private storage, and always pass local `file://` sources.
 *
 * Privacy: imports zero networking. Every path is a local `file://` URI.
 */

import * as FileSystem from 'expo-file-system';

import manifest from '../../models/voice/manifest.json';

export type VoiceModelSources = {
  encoderSource: string;
  decoderSource: string;
  tokenizerSource: string;
};

export class VoiceModelNotProvisioned extends Error {
  constructor(detail: string) {
    super(`Voice input model not provisioned: ${detail}`);
    this.name = 'VoiceModelNotProvisioned';
  }
}

export const VOICE_MODEL_FILES = manifest.files;
export const VOICE_MODEL_MANIFEST = manifest;

function getModelDir(): string {
  const base = FileSystem.documentDirectory;
  if (!base) {
    throw new VoiceModelNotProvisioned('FileSystem.documentDirectory unavailable.');
  }
  return `${base}models/voice`;
}

async function exists(uri: string): Promise<FileSystem.FileInfo> {
  return FileSystem.getInfoAsync(uri, { size: true });
}

/**
 * Ensure the encoder/decoder/tokenizer exist in the documents dir and return
 * the resolved file:// sources for `useSpeechToText`. Idempotent.
 *
 * Unlike the Llama model (~1.2 GB, size-check only), these files are small
 * enough that a full integrity check isn't a hot-path concern — still uses
 * the same byte-size guard for consistency with modelProvisioner.ts.
 */
export async function provisionVoiceModel(): Promise<VoiceModelSources> {
  const dir = getModelDir();
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {
    /* already exists */
  });

  const encoderUri = `${dir}/${VOICE_MODEL_FILES.encoder}`;
  const decoderUri = `${dir}/${VOICE_MODEL_FILES.decoder}`;
  const tokenizerUri = `${dir}/${VOICE_MODEL_FILES.tokenizer}`;

  const [encoder, decoder, tokenizer] = await Promise.all([
    exists(encoderUri),
    exists(decoderUri),
    exists(tokenizerUri),
  ]);

  if (!encoder.exists || !decoder.exists) {
    throw new VoiceModelNotProvisioned(
      `encoder/decoder missing in ${dir}. Place them on the device per ` +
        `mobile/RUNBOOK.md ("Voice input model").`,
    );
  }
  if (!tokenizer.exists) {
    throw new VoiceModelNotProvisioned(
      `tokenizer missing in ${dir}. Provision whisper_tokenizer.json per RUNBOOK.md.`,
    );
  }

  const expectedBytes = (manifest as { bytes?: Record<string, number | null> }).bytes;
  const check = (info: FileSystem.FileInfo, expected: number | null | undefined, name: string) => {
    if (expected && info.exists && info.size && info.size !== expected) {
      throw new VoiceModelNotProvisioned(
        `${name} size ${info.size} != manifest ${expected} — re-copy the file (corrupt/partial push). See RUNBOOK.md.`,
      );
    }
  };
  check(encoder, expectedBytes?.encoder, 'encoder');
  check(decoder, expectedBytes?.decoder, 'decoder');
  check(tokenizer, expectedBytes?.tokenizer, 'tokenizer');

  return {
    encoderSource: encoderUri,
    decoderSource: decoderUri,
    tokenizerSource: tokenizerUri,
  };
}
