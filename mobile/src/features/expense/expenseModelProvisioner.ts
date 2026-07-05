/**
 * expenseModelProvisioner — make the two Expense Scanner ExecuTorch models
 * (line-tagger, category) loadable, fully local. Same pattern as modelProvisioner.ts
 * (Llama) and voiceModelProvisioner.ts (Whisper).
 *
 * Privacy: imports zero networking. Every path is a local `file://` URI.
 */
import * as FileSystem from 'expo-file-system';

import manifest from '../../models/expense/manifest.json';

export type ExpenseModelSources = {
  lineTaggerSource: string;
  categorySource: string;
};

export class ExpenseModelNotProvisioned extends Error {
  constructor(detail: string) {
    super(`Expense models not provisioned: ${detail}`);
    this.name = 'ExpenseModelNotProvisioned';
  }
}

function getModelDir(): string {
  const base = FileSystem.documentDirectory;
  if (!base) throw new ExpenseModelNotProvisioned('FileSystem.documentDirectory unavailable.');
  return `${base}models/expense`;
}

async function exists(uri: string): Promise<FileSystem.FileInfo> {
  return FileSystem.getInfoAsync(uri, { size: true });
}

/** Ensure both .pte files exist in the documents dir and return their file:// sources. Idempotent. */
export async function provisionExpenseModels(): Promise<ExpenseModelSources> {
  const dir = getModelDir();
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {
    /* already exists */
  });

  const lineTaggerUri = `${dir}/${manifest.line_tagger.pte}`;
  const categoryUri = `${dir}/${manifest.category.pte}`;

  const [lineTagger, category] = await Promise.all([exists(lineTaggerUri), exists(categoryUri)]);

  if (!lineTagger.exists || !category.exists) {
    throw new ExpenseModelNotProvisioned(
      `model files missing in ${dir}. Place them on the device per mobile/RUNBOOK.md.`,
    );
  }

  const check = (info: FileSystem.FileInfo, expected: number | undefined, name: string) => {
    if (expected && info.exists && info.size && info.size !== expected) {
      throw new ExpenseModelNotProvisioned(`${name} size ${info.size} != manifest ${expected} — re-copy the file.`);
    }
  };
  check(lineTagger, manifest.line_tagger.bytes, 'line_tagger');
  check(category, manifest.category.bytes, 'category');

  return { lineTaggerSource: lineTaggerUri, categorySource: categoryUri };
}
