/**
 * Every message key a component uses has to exist, in every catalogue.
 *
 * next-intl does not complain about a missing key. It renders the key path, so a
 * control labelled `journeys.removeNamed` ships looking like a bug and is read
 * aloud by a screen reader as a string of punctuation. Nothing else in the
 * project catches it: no-dangling-references.test.ts checks the legal and
 * settings pages, and this component set was written afterwards.
 *
 * That is not hypothetical — `removeNamed` was used in a component, never added
 * to the catalogue, and shipped that way.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const webRoot = resolve(__dirname, '../..'); // src/lib -> apps/web
const LOCALES = ['en', 'he', 'ar'] as const;

/** Components this covers. Widening it later is the point. */
const FILES = [
  'src/components/JourneyGraphView.tsx',
  'src/components/AddToJourney.tsx',
  'src/app/[locale]/journeys/page.tsx',
  'src/app/[locale]/journeys/[journeyId]/page.tsx',
];

function flatKeys(obj: Record<string, unknown>, prefix = ''): Set<string> {
  const out = new Set<string>();
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) for (const inner of flatKeys(v as Record<string, unknown>, path)) out.add(inner);
    else out.add(path);
  }
  return out;
}

const catalogues: Record<string, Set<string>> = {};
for (const locale of LOCALES) {
  const raw = JSON.parse(readFileSync(join(webRoot, 'messages', `${locale}.json`), 'utf8'));
  catalogues[locale] = flatKeys(raw);
}

/** Every `t('x')` literal passed to a translator in a file. */
function usedKeys(file: string): string[] {
  const src = readFileSync(join(webRoot, file), 'utf8');
  const keys: string[] = [];
  // t('key') and t('key', {...}) — the namespace comes from useTranslations.
  for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) keys.push(m[1]);
  return keys;
}

describe('journey and recitation messages', () => {
  for (const file of FILES) {
    it(`${file} uses only keys that exist in every catalogue`, () => {
      // The namespace each file reads, so `t('title')` resolves to `journeys.title`.
      const src = readFileSync(join(webRoot, file), 'utf8');
      const namespaces = [...src.matchAll(/useTranslations\(\s*'([a-zA-Z0-9_]+)'/g)].map((m) => m[1]);

      const missing: string[] = [];
      for (const namespace of namespaces) {
        for (const key of usedKeys(file)) {
          const path = `${namespace}.${key}`;
          for (const locale of LOCALES) {
            if (!catalogues[locale].has(path)) missing.push(`${path} (${locale})`);
          }
        }
      }
      expect(missing, `missing keys in ${file}`).toEqual([]);
    });
  }

  it('has the same keys in all three catalogues', () => {
    const en = catalogues.en;
    for (const locale of LOCALES.filter((l) => l !== 'en')) {
      const missing = [...en].filter((k) => !catalogues[locale].has(k));
      const extra = [...catalogues[locale]].filter((k) => !en.has(k));
      expect(missing, `${locale} is missing keys present in en`).toEqual([]);
      expect(extra, `${locale} has keys en does not`).toEqual([]);
    }
  });

  it('names every control on the journey pages', () => {
    // The specific key that shipped broken. Cheap to keep, and it names the class.
    expect(catalogues.en.has('journeys.removeNamed')).toBe(true);
    expect(catalogues.he.has('journeys.removeNamed')).toBe(true);
    expect(catalogues.ar.has('journeys.removeNamed')).toBe(true);
  });

  it('reads at least one translation namespace in each file', () => {
    // Guards the guard: if the regex above stops matching, the test would pass
    // vacuously by finding no keys to check.
    for (const file of FILES) {
      const src = readFileSync(join(webRoot, file), 'utf8');
      expect(/useTranslations\(\s*'[a-zA-Z0-9_]+'/.test(src), `${file} declares no namespace`).toBe(true);
      expect(usedKeys(file).length, `${file} uses no t() keys`).toBeGreaterThan(0);
    }
  });
});

describe('the message files themselves', () => {
  it('has one JSON file per locale and none is empty', () => {
    const dir = join(webRoot, 'messages');
    const found = readdirSync(dir).filter((f) => f.endsWith('.json'));
    for (const locale of LOCALES) {
      expect(found, `${locale}.json is missing`).toContain(`${locale}.json`);
      expect(statSync(join(dir, `${locale}.json`)).size).toBeGreaterThan(0);
    }
  });
});