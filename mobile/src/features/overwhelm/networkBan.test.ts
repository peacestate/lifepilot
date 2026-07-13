/**
 * The privacy promise, enforced in code rather than asserted in a README.
 *
 * The Overwhelm Manager sees the most sensitive input in the app — a freeform
 * description of what's overwhelming someone — and it must never be able to
 * leave the device. There is nothing for this feature to call: no fetch, no
 * HTTP client, no network layer. This test fails the build if that ever stops
 * being true.
 *
 * (Originally specified as ESLint `overrides` in .eslintrc.overwhelm.js, per
 * integration doc §5.1. Implemented here instead so it runs in `npm test` with
 * no extra toolchain — the guarantee is what matters, not which tool checks it.)
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const FEATURE_DIR = join(__dirname);
const SCREEN_FILES = [
  join(__dirname, '..', '..', 'screens', 'OverwhelmScreen.tsx'),
  join(__dirname, '..', '..', 'screens', 'overwhelmCopy.ts'),
];

/** Networking primitives and HTTP clients — none may appear in this feature. */
const BANNED: { pattern: RegExp; why: string }[] = [
  { pattern: /\bfetch\s*\(/, why: 'fetch() — no network in the Overwhelm feature' },
  { pattern: /\bXMLHttpRequest\b/, why: 'XMLHttpRequest — no network in the Overwhelm feature' },
  { pattern: /\bWebSocket\b/, why: 'WebSocket — no network in the Overwhelm feature' },
  { pattern: /\bnavigator\s*\.\s*sendBeacon\b/, why: 'navigator.sendBeacon — no telemetry of user content' },
  { pattern: /from\s+['"](axios|node-fetch)['"]/, why: 'HTTP client import' },
  { pattern: /from\s+['"][^'"]*\/(api|network)\//, why: 'network-layer import' },
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (!/\.(ts|tsx)$/.test(entry)) return [];
    if (/\.test\.tsx?$/.test(entry)) return []; // this file scans; it doesn't ship
    return [full];
  });
}

describe('Overwhelm feature: network ban (privacy golden rule)', () => {
  const files = [...sourceFiles(FEATURE_DIR), ...SCREEN_FILES];

  it('scans a non-empty set of source files', () => {
    // Guards against the scan silently passing because it found nothing.
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files.map((f) => [f]))('%s makes no network call', (file) => {
    const src = readFileSync(file, 'utf8');
    const violations = BANNED.filter(({ pattern }) => pattern.test(src)).map(({ why }) => why);
    expect(violations).toEqual([]);
  });
});
