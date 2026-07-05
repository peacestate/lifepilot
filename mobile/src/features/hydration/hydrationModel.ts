/**
 * hydrationModel — runs the on-device ExecuTorch hydration `.pte` (contract §11).
 *
 * Numeric-in / numeric-out (NOT useLLM, no tokenizer) — the same generic ExecuTorch
 * module path as Energy Predictor. Input = 8 normalized features → output = 4 mL
 * components [baseline, heat, activity, aqi]. The device sums + clamps + builds the
 * breakdown in HydrationEngine.buildTarget (shared with the formula fallback).
 *
 * PRIVACY: imports zero networking. Loaded from a local file:// path only. If anything
 * fails (model missing pre-export, runtime mismatch), this returns null and the caller
 * falls back to the deterministic engine — so the app ALWAYS works.
 *
 * The .pte is NOT bundled via Metro's require() — `**\/*.pte` is gitignored repo-wide
 * (models are provisioned on-device per RUNBOOK.md, never committed), so a static
 * require() only resolves on a machine that happens to have the file locally (e.g.
 * this dev's PC) and silently produces an unresolvable module reference on a clean
 * EAS cloud build, crashing the app on boot with "Requiring unknown module". Load by
 * file:// path instead, same pattern as modelProvisioner.ts (Llama) and
 * voiceModelProvisioner.ts (Whisper).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * API ASSUMPTIONS (verify against pinned react-native-executorch@0.4.8 — same as
 * Energy Predictor's EnergyModel; isolated to the single forward() call site below):
 *   - generic module: load a .pte, call forward([TensorPtr]) → TensorPtr[].
 *   - TensorPtr = { dataPtr: Float32Array, sizes: number[], scalarType }.
 * If 0.4.8's exact API differs, this is a one-spot change (and the fallback covers it).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as FileSystem from 'expo-file-system';

import type { Components, HydrationInputs } from './types';
import manifest from '../../models/hydration/manifest.json';

const MEAN = manifest.scaler.mean;
const STD = manifest.scaler.std;

const INTENSITY_SCALAR: Record<string, number> = { light: 0.3, moderate: 0.5, vigorous: 0.85 };

/** Build the raw 8-feature vector in the manifest's feature order. */
function featureVector(inp: HydrationInputs): number[] {
  return [
    inp.bodyMassKg,
    inp.sex === 'female' ? 1 : 0,
    inp.ageYears ?? 38,
    inp.temperatureC ?? 20,
    inp.humidityPct ?? 55,
    inp.aqi ?? 50,
    inp.activeMinutes ?? (inp.steps != null ? Math.max(0, (inp.steps - 5000) / 1000) * 10 : 0),
    INTENSITY_SCALAR[inp.workoutIntensity ?? 'moderate'] ?? 0.5,
  ];
}

const normalize = (raw: number[]) => raw.map((x, i) => (x - MEAN[i]) / STD[i]);

type GenericModule = {
  forward: (inputs: unknown[]) => Promise<Array<{ dataPtr: Float32Array | number[] }>>;
};

let modulePromise: Promise<GenericModule | null> | null = null;

/** Lazily load the bundled .pte once. Returns null if unavailable (→ fallback). */
async function getModule(): Promise<GenericModule | null> {
  if (!modulePromise) {
    modulePromise = (async () => {
      try {
        // Lazy import so the app builds/runs even before the native module is wired.
        // eslint-disable-next-line @typescript-eslint/no-var-requires, import/no-unresolved
        const rne: any = require('react-native-executorch');
        const loader = rne.loadModule ?? rne.ExecutorchModule?.load ?? null;
        if (!loader) return null;
        const uri = `${FileSystem.documentDirectory}models/hydration/${manifest.pte_filename}`;
        const info = await FileSystem.getInfoAsync(uri, { size: true });
        if (!info.exists) return null; // not provisioned yet → engine fallback
        if (manifest.bytes && info.size && info.size !== manifest.bytes) return null; // corrupt/partial push
        return await loader(uri);
      } catch {
        return null; // model not present yet / runtime mismatch → engine fallback
      }
    })();
  }
  return modulePromise;
}

/**
 * Predict the 4 mL components via the ExecuTorch model. Returns null on any failure;
 * the caller (useHydrationTracker) then uses HydrationEngine.engineComponents instead.
 */
export async function predictComponents(inp: HydrationInputs): Promise<Components | null> {
  const mod = await getModule();
  if (!mod) return null;
  try {
    const x = Float32Array.from(normalize(featureVector(inp)));
    // ── single isolated forward() call site (API assumption above) ──
    const out = await mod.forward([{ dataPtr: x, sizes: [1, 8], scalarType: 'float32' }]);
    const d = out?.[0]?.dataPtr;
    const arr = d instanceof Float32Array ? Array.from(d) : (d as number[]);
    if (!arr || arr.length < 4) return null;
    return {
      baseline: Math.max(0, arr[0]),
      heat: Math.max(0, arr[1]),
      activity: Math.max(0, arr[2]),
      aqi: Math.max(0, arr[3]),
    };
  } catch {
    return null;
  }
}

/** True once a real .pte is loaded (lets the UI honestly say 'model' vs 'estimate'). */
export async function isModelReady(): Promise<boolean> {
  return (await getModule()) != null;
}
