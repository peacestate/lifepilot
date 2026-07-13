/**
 * The download catalog and the per-feature manifests must not drift apart.
 *
 * The app downloads what the catalog lists, then the provisioners verify what they
 * find against the manifests. If those two disagree, first run ends in a download
 * that completes and is then rejected — with the user watching a 1.5 GB progress bar
 * for nothing. Cheaper to catch here.
 */
import catalog from '../../models/downloadCatalog.json';
import embeddingsManifest from '../../models/embeddings/manifest.json';
import energyManifest from '../../models/energy/manifest.json';
import expenseManifest from '../../models/expense/manifest.json';
import hydrationManifest from '../../models/hydration/manifest.json';
import overwhelmManifest from '../../models/overwhelm/manifest.json';
import voiceManifest from '../../models/voice/manifest.json';

type CatalogFile = { feature: string; target: string; asset: string; bytes: number; sha256: string };
const files = catalog.files as CatalogFile[];
const find = (feature: string, target: string) =>
  files.find((f) => f.feature === feature && f.target === target);

describe('download catalog', () => {
  it('serves every file the provisioners look for', () => {
    const expected: [string, string][] = [
      ['overwhelm', overwhelmManifest.files.model],
      ['overwhelm', overwhelmManifest.files.tokenizer],
      ['overwhelm', overwhelmManifest.files.tokenizerConfig],
      ['embeddings', embeddingsManifest.files.model],
      ['embeddings', embeddingsManifest.files.tokenizer],
      ['embeddings', embeddingsManifest.files.tokenizerConfig],
      ['voice', voiceManifest.files.encoder],
      ['voice', voiceManifest.files.decoder],
      ['voice', voiceManifest.files.tokenizer],
      ['energy', energyManifest.pte_filename],
      ['hydration', hydrationManifest.pte_filename],
      ['expense', expenseManifest.line_tagger.pte],
      ['expense', expenseManifest.category.pte],
    ];
    for (const [feature, target] of expected) {
      expect(find(feature, target)).toBeDefined();
    }
    expect(files).toHaveLength(expected.length);
  });

  it('matches the sha256 each manifest expects', () => {
    expect(find('overwhelm', overwhelmManifest.files.model)?.sha256).toBe(overwhelmManifest.sha256.model);
    expect(find('embeddings', embeddingsManifest.files.model)?.sha256).toBe(embeddingsManifest.sha256.model);
    expect(find('voice', voiceManifest.files.encoder)?.sha256).toBe(voiceManifest.sha256.encoder);
    expect(find('voice', voiceManifest.files.decoder)?.sha256).toBe(voiceManifest.sha256.decoder);
    expect(find('energy', energyManifest.pte_filename)?.sha256).toBe(energyManifest.sha256);
    expect(find('hydration', hydrationManifest.pte_filename)?.sha256).toBe(hydrationManifest.sha256);
    expect(find('expense', expenseManifest.line_tagger.pte)?.sha256).toBe(expenseManifest.line_tagger.sha256);
    expect(find('expense', expenseManifest.category.pte)?.sha256).toBe(expenseManifest.category.sha256);
  });

  it('matches the byte sizes the provisioners check on disk', () => {
    // These are the sizes a provisioner compares against and refuses to load on mismatch.
    expect(find('overwhelm', overwhelmManifest.files.model)?.bytes).toBe(overwhelmManifest.bytes.model);
    expect(find('energy', energyManifest.pte_filename)?.bytes).toBe(energyManifest.bytes);
    expect(find('expense', expenseManifest.line_tagger.pte)?.bytes).toBe(expenseManifest.line_tagger.bytes);
    expect(find('expense', expenseManifest.category.pte)?.bytes).toBe(expenseManifest.category.bytes);
  });

  it('gives every asset a unique, collision-free name', () => {
    // Release assets share one flat namespace and two features both ship a
    // `tokenizer.json` — an unprefixed name would silently overwrite the other.
    const names = files.map((f) => f.asset);
    expect(new Set(names).size).toBe(names.length);
    for (const f of files) expect(f.asset).toBe(`${f.feature}__${f.target}`);
  });

  it('points at a real release tag and totals its parts', () => {
    expect(catalog.baseUrl).toMatch(/^https:\/\/github\.com\/[\w-]+\/[\w-]+\/releases\/download\/v[\d.]+\/$/);
    expect(catalog.totalBytes).toBe(files.reduce((n, f) => n + f.bytes, 0));
  });
});
