#!/usr/bin/env node
/**
 * Stages the on-device model files as flat GitHub Release assets and emits the
 * catalog the app downloads from on first run (src/models/downloadCatalog.json).
 *
 * Why staging rather than uploading in place: Release assets share one flat
 * namespace, and two features ship a file called `tokenizer.json`. Each file is
 * therefore copied to `<feature>__<filename>`, which is also what the app asks
 * for. The on-device path it lands at (`models/<feature>/<filename>`) is
 * unchanged — the same path the adb/RUNBOOK route writes to — so a device that
 * already has its models provisioned re-downloads nothing.
 *
 * Every file is hashed here and the hash is checked against the feature's
 * manifest, which is the same value the app verifies after downloading. If a
 * source file ever drifts from what the app expects, this fails loudly rather
 * than publishing a bundle the app would reject.
 *
 * Usage (from mobile/):  node scripts/build-model-catalog.js [--tag v1.1.0]
 */
const { createHash } = require('crypto');
const { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync, rmSync } = require('fs');
const { join, resolve } = require('path');

const REPO = 'peacestate/lifepilot';
const tagArg = process.argv.indexOf('--tag');
const TAG = tagArg !== -1 ? process.argv[tagArg + 1] : 'v1.1.0';

const ROOT = resolve(__dirname, '..', '..'); // D:/LifePilot
const STAGE = join(ROOT, 'models', `_release_${TAG.replace(/\./g, '_')}`);
const CATALOG = resolve(__dirname, '..', 'src', 'models', 'downloadCatalog.json');

/**
 * source → (feature, on-device filename). Sources are the verified artifacts:
 * the four trained models come from ml/models/ (the AMD MI300X build, matching
 * ml/models/AMD_PROVENANCE.txt); the rest are the upstream pre-quantized files.
 */
const FILES = [
  ['overwhelm', 'llama3_2_qat_lora.pte', 'models/llama3_2_qat_lora.pte'],
  ['overwhelm', 'tokenizer.json', 'models/tokenizer.json'],
  ['overwhelm', 'tokenizer_config.json', 'models/tokenizer_config.json'],

  ['embeddings', 'multi-qa-MiniLM-L6-cos-v1_xnnpack.pte', 'models/embeddings/multi-qa-MiniLM-L6-cos-v1_xnnpack.pte'],
  ['embeddings', 'tokenizer.json', 'models/embeddings/tokenizer.json'],
  ['embeddings', 'tokenizer_config.json', 'models/embeddings/tokenizer_config.json'],

  ['voice', 'whisper_tiny_en_xnnpack_encoder.pte', 'models/_whisper_dl/xnnpack/whisper_tiny_en_xnnpack_encoder.pte'],
  ['voice', 'whisper_tiny_en_xnnpack_decoder.pte', 'models/_whisper_dl/xnnpack/whisper_tiny_en_xnnpack_decoder.pte'],
  ['voice', 'whisper_tokenizer.json', 'models/_whisper_dl/whisper_tokenizer.json'],

  ['energy', 'energy_predictor.pte', 'ml/models/energy/energy_predictor.pte'],
  ['hydration', 'hydration_predictor.pte', 'ml/models/hydration/hydration_predictor.pte'],
  ['expense', 'expense_line_tagger.pte', 'ml/models/expense/expense_line_tagger.pte'],
  ['expense', 'expense_category.pte', 'ml/models/expense/expense_category.pte'],
];

/** The sha256 each feature's manifest expects, flattened to <feature>/<file>. */
function expectedHashes() {
  const m = (f) => JSON.parse(readFileSync(resolve(__dirname, '..', 'src', 'models', f, 'manifest.json'), 'utf8'));
  const out = {};
  const ow = m('overwhelm');
  out[`overwhelm/${ow.files.model}`] = ow.sha256.model;

  const emb = m('embeddings');
  for (const [k, name] of Object.entries(emb.files)) {
    if (emb.sha256?.[k]) out[`embeddings/${name}`] = emb.sha256[k];
  }
  const v = m('voice');
  for (const [k, name] of Object.entries(v.files)) {
    if (v.sha256?.[k]) out[`voice/${name}`] = v.sha256[k];
  }
  const en = m('energy');
  out[`energy/${en.pte_filename}`] = en.sha256;
  const hy = m('hydration');
  out[`hydration/${hy.pte_filename}`] = hy.sha256;
  const ex = m('expense');
  out[`expense/${ex.line_tagger.pte}`] = ex.line_tagger.sha256;
  out[`expense/${ex.category.pte}`] = ex.category.sha256;
  return out;
}

const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

function main() {
  const expected = expectedHashes();
  rmSync(STAGE, { recursive: true, force: true });
  mkdirSync(STAGE, { recursive: true });

  const files = [];
  const mismatches = [];

  for (const [feature, target, src] of FILES) {
    const abs = join(ROOT, src);
    const bytes = statSync(abs).size;
    const hash = sha256(abs);
    const key = `${feature}/${target}`;

    if (expected[key] && expected[key] !== hash) {
      mismatches.push(`${key}\n    manifest: ${expected[key]}\n    file:     ${hash}`);
    }

    const asset = `${feature}__${target}`;
    copyFileSync(abs, join(STAGE, asset));
    files.push({ feature, target, asset, bytes, sha256: hash, verified: Boolean(expected[key]) });
    console.log(`  ${key.padEnd(52)} ${String(bytes).padStart(11)}  ${expected[key] ? 'manifest-verified' : 'no manifest hash'}`);
  }

  if (mismatches.length) {
    console.error(`\nFAIL — ${mismatches.length} file(s) do not match their manifest:\n\n${mismatches.join('\n\n')}\n`);
    console.error('The app verifies these hashes after download and would reject the bundle. Fix the source files.');
    process.exit(1);
  }

  const catalog = {
    _comment:
      'Generated by scripts/build-model-catalog.js — do not hand-edit. Drives the first-run model download.',
    tag: TAG,
    baseUrl: `https://github.com/${REPO}/releases/download/${TAG}/`,
    totalBytes: files.reduce((n, f) => n + f.bytes, 0),
    files,
  };
  writeFileSync(CATALOG, `${JSON.stringify(catalog, null, 2)}\n`);

  const gb = (catalog.totalBytes / 1e9).toFixed(2);
  console.log(`\nStaged ${files.length} assets (${gb} GB) → ${STAGE}`);
  console.log(`Catalog → ${CATALOG}`);
  console.log(`\nUpload with:\n  gh release create ${TAG} --repo ${REPO} --title "..." --notes "..." \\\n    ${STAGE.replace(/\\/g, '/')}/*`);
}

main();
