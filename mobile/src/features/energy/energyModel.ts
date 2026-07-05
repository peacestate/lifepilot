/**
 * energyModel — runs the Energy Predictor ExecuTorch .pte (contract §3/§4).
 * Numeric module (like Hydration): input [1,12,7] normalized → output [1,24] curve 0..100.
 * Returns null on any failure → the hook falls back to EnergyForecast.heuristicCurve.
 *
 * PRIVACY: zero networking. Loaded from a local file:// path only.
 * The forward() call site is isolated (verify against react-native-executorch@0.4.8).
 *
 * The .pte is NOT bundled via Metro's require() — `**\/*.pte` is gitignored repo-wide
 * (models are provisioned on-device per RUNBOOK.md, never committed), so a static
 * require() only resolves on a machine that happens to have the file locally (e.g.
 * this dev's PC) and silently produces an unresolvable module reference on a clean
 * EAS cloud build, crashing the app on boot with "Requiring unknown module". Load by
 * file:// path instead, same pattern as modelProvisioner.ts (Llama) and
 * voiceModelProvisioner.ts (Whisper).
 */
import * as FileSystem from 'expo-file-system';

import manifest from '../../models/energy/manifest.json';

let modulePromise: Promise<{ forward: (i: unknown[]) => Promise<Array<{ dataPtr: Float32Array | number[] }>> } | null> | null = null;

async function getModule() {
  if (!modulePromise) {
    modulePromise = (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires, import/no-unresolved
        const rne: any = require('react-native-executorch');
        const loader = rne.loadModule ?? rne.ExecutorchModule?.load ?? null;
        if (!loader) return null;
        const uri = `${FileSystem.documentDirectory}models/energy/${manifest.pte_filename}`;
        const info = await FileSystem.getInfoAsync(uri, { size: true });
        if (!info.exists) return null; // not provisioned yet → heuristic fallback
        if (manifest.bytes && info.size && info.size !== manifest.bytes) return null; // corrupt/partial push
        return await loader(uri);
      } catch {
        return null; // not exported yet / runtime mismatch → heuristic fallback
      }
    })();
  }
  return modulePromise;
}

/** Run inference. `input` is the flat [12*7] Float32Array from buildInputTensor. */
export async function predictCurve(input: Float32Array): Promise<number[] | null> {
  const mod = await getModule();
  if (!mod) return null;
  try {
    const out = await mod.forward([{ dataPtr: input, sizes: [1, 12, 7], scalarType: 'float32' }]);
    const d = out?.[0]?.dataPtr;
    const arr = d instanceof Float32Array ? Array.from(d) : (d as number[]);
    if (!arr || arr.length < 24) return null;
    return arr.slice(0, 24).map((v) => Math.max(0, Math.min(100, Math.round(v))));
  } catch {
    return null;
  }
}
