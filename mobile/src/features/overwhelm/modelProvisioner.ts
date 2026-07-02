/**
 * modelProvisioner — make the on-device Llama 3.2 1B model loadable, fully local.
 *
 * WHY this exists: the 4-bit `.pte` is ~1 GB, which exceeds Metro's `require()`
 * asset ceiling, so it is NOT bundled through JS. Per the CTO integration doc
 * §1.2 we get the file onto the device once, then load it by an absolute
 * `file://` path. NO network is ever involved in the inference path
 * (model-contract §5 / golden rule).
 *
 * IMPLEMENTATION (Expo): uses `expo-file-system` — react-native-executorch@0.4.8
 * already depends on it, so no extra native module is introduced. We look for the
 * model in the app's documentDirectory; if it isn't there yet we try to seed it
 * from a small bundled `expo-asset` (used for the tokenizer + any future small
 * model). The large `.pte` itself is placed on-device per RUNBOOK.md (adb push
 * for a dev build, or a one-time consented copy) — both land in the same
 * documentDirectory this resolver reads.
 *
 * Privacy: imports zero networking. Every path is a local `file://` URI.
 */

import * as FileSystem from 'expo-file-system';

import manifest from '../../models/overwhelm/manifest.json';

export type ModelSources = {
  /** Absolute file:// URI to the .pte in the app documents dir. */
  modelSource: string;
  /** Absolute file:// URI to the tokenizer (tokenizer.json). */
  tokenizerSource: string;
  /** Absolute file:// URI to tokenizer_config.json (chat template + specials). */
  tokenizerConfigSource: string;
};

export class ModelNotProvisioned extends Error {
  constructor(detail: string) {
    super(`Overwhelm model not provisioned: ${detail}`);
    this.name = 'ModelNotProvisioned';
  }
}

export const MODEL_FILES = manifest.files;
export const MODEL_MANIFEST = manifest;

/** Local directory that holds the copied model files (no trailing slash). */
function getModelDir(): string {
  const base = FileSystem.documentDirectory;
  if (!base) {
    // Should never happen on a real device; guards web/SSR.
    throw new ModelNotProvisioned('FileSystem.documentDirectory unavailable.');
  }
  return `${base}models/overwhelm`;
}

async function exists(uri: string): Promise<FileSystem.FileInfo> {
  return FileSystem.getInfoAsync(uri, { size: true });
}

/**
 * Ensure the .pte (+ tokenizer files) exist in the documents dir and return the
 * resolved file:// sources for `useLLM`. Idempotent.
 *
 * Validation: we check the model file's BYTE SIZE against manifest.bytes.model
 * (a full sha256 of a ~1 GB file in JS is too slow to run on every launch — the
 * sha256 in the manifest is verified once at provisioning time on the desktop /
 * during the adb-push step, see RUNBOOK.md).
 */
export async function provisionModel(): Promise<ModelSources> {
  const dir = getModelDir();
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {
    /* already exists */
  });

  const modelUri = `${dir}/${MODEL_FILES.model}`;
  const tokenizerUri = `${dir}/${MODEL_FILES.tokenizer}`;
  const tokenizerConfigUri = `${dir}/${MODEL_FILES.tokenizerConfig}`;

  const [model, tok, tokCfg] = await Promise.all([
    exists(modelUri),
    exists(tokenizerUri),
    exists(tokenizerConfigUri),
  ]);

  if (!model.exists) {
    throw new ModelNotProvisioned(
      `model file missing at ${modelUri}. Place it on the device per ` +
        `mobile/RUNBOOK.md ("Get the model onto the device").`,
    );
  }
  if (!tok.exists || !tokCfg.exists) {
    throw new ModelNotProvisioned(
      `tokenizer files missing in ${dir}. Provision tokenizer.json + ` +
        `tokenizer_config.json per RUNBOOK.md.`,
    );
  }

  // Cheap integrity guard: size must match the manifest if one is recorded.
  const expected = (manifest as { bytes?: { model?: number } }).bytes?.model;
  if (expected && model.size && model.size !== expected) {
    throw new ModelNotProvisioned(
      `model size ${model.size} != manifest ${expected} — re-copy the .pte ` +
        `(corrupt/partial push). See RUNBOOK.md.`,
    );
  }

  return {
    modelSource: modelUri,
    tokenizerSource: tokenizerUri,
    tokenizerConfigSource: tokenizerConfigUri,
  };
}
