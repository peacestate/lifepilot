/**
 * expenseModel — runs the two Expense Scanner ExecuTorch .pte models (contract:
 * mobile/src/models/expense/manifest.json). Numeric modules (like Energy/Hydration):
 *   line_tagger: input [1,262] -> logits [1,5]  (OTHER/MERCHANT/DATE/TOTAL/ITEM)
 *   category:    input [1,256] -> logits [1,7]  (Food/Groceries/.../Other)
 * Returns null on any failure -> callers fall back to the deterministic parser
 * (ExpenseService.ts), same "never block on the model" spirit as every other feature.
 *
 * PRIVACY: zero networking. Loaded from local file:// paths only.
 */
import manifest from '../../models/expense/manifest.json';
import { provisionExpenseModels } from './expenseModelProvisioner';

type NumericModule = { forward: (i: unknown[]) => Promise<Array<{ dataPtr: Float32Array | number[] }>> };

let lineTaggerPromise: Promise<NumericModule | null> | null = null;
let categoryPromise: Promise<NumericModule | null> | null = null;

async function loadOne(source: string): Promise<NumericModule | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, import/no-unresolved
    const rne: any = require('react-native-executorch');
    const loader = rne.loadModule ?? rne.ExecutorchModule?.load ?? null;
    if (!loader) return null;
    return await loader(source);
  } catch {
    return null;
  }
}

async function getLineTagger(): Promise<NumericModule | null> {
  if (!lineTaggerPromise) {
    lineTaggerPromise = (async () => {
      try {
        const sources = await provisionExpenseModels();
        return await loadOne(sources.lineTaggerSource);
      } catch {
        return null;
      }
    })();
  }
  return lineTaggerPromise;
}

async function getCategoryModel(): Promise<NumericModule | null> {
  if (!categoryPromise) {
    categoryPromise = (async () => {
      try {
        const sources = await provisionExpenseModels();
        return await loadOne(sources.categorySource);
      } catch {
        return null;
      }
    })();
  }
  return categoryPromise;
}

async function forward(mod: NumericModule, input: Float32Array, dim: number): Promise<number[] | null> {
  try {
    const out = await mod.forward([{ dataPtr: input, sizes: [1, dim], scalarType: 'float32' }]);
    const d = out?.[0]?.dataPtr;
    const arr = d instanceof Float32Array ? Array.from(d) : (d as number[]);
    return arr ?? null;
  } catch {
    return null;
  }
}

/** Raw logits for one OCR line's 262-dim feature vector, or null if the model isn't available. */
export async function runLineTagger(input: Float32Array): Promise<number[] | null> {
  const mod = await getLineTagger();
  if (!mod) return null;
  return forward(mod, input, manifest.line_tagger.input_dim);
}

/** Raw logits for the receipt's 256-dim category feature vector, or null if unavailable. */
export async function runCategoryModel(input: Float32Array): Promise<number[] | null> {
  const mod = await getCategoryModel();
  if (!mod) return null;
  return forward(mod, input, manifest.category.input_dim);
}

export const LINE_LABELS = manifest.line_tagger.labels;
export const CATEGORY_LABELS = manifest.category.labels;
