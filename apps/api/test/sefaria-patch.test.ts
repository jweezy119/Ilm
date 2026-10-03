/**
 * Corrections that travel with the code, for a deployment that is refused.
 *
 * Sefaria answers this host with `403 Forbidden` — a refusal of the network
 * rather than of the request, so no user agent or retry schedule changes it.
 * These tests pin the properties that make the data file a safe substitute for a
 * runtime fetch: it is compared before it is written, it only ever writes Sefaria's
 * own text, and its absence must not stop the service starting.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const service = readFileSync(resolve(__dirname, '../src/services/sefaria-repair.ts'), 'utf8');
const here = dirname(fileURLToPath(import.meta.url));
const dataPath = resolve(here, '../data/sefaria-translation-fixes.json');

describe('the corrections file', () => {
  it('exists, and is keyed by passage key', () => {
    expect(existsSync(dataPath), 'run scripts/build-sefaria-patch.ts to generate it').toBe(true);
    const data = JSON.parse(readFileSync(dataPath, 'utf8'));
    expect(typeof data.verses).toBe('object');
    const keys = Object.keys(data.verses);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys.slice(0, 200)) {
      expect(key, `${key} is not a passage key`).toMatch(/^torah:[A-Za-z]+:\d+:\d+$/);
    }
  });

  it('says how it was generated, so it can be rebuilt', () => {
    const data = JSON.parse(readFileSync(dataPath, 'utf8'));
    expect(data.generatedFrom).toBeTruthy();
    expect(data._comment).toBeTruthy();
    expect(data.count).toBe(Object.keys(data.verses).length);
  });

  it('holds no damaged text of its own', () => {
    /*
     * The file is the output of the fixed stripper. If it ever contained the
     * damage, applying it would be the bug rather than the repair — and the test
     * would be asserting the repair works because the repair was a no-op.
     */
    const data = JSON.parse(readFileSync(dataPath, 'utf8'));
    const damage = /\b[a-z](?=[A-Z“"'])|In contrast to others|KJV version|See the note/;
    let checked = 0;
    for (const [key, text] of Object.entries<string>(data.verses)) {
      checked += 1;
      expect(damage.test(text), `${key} still carries a spliced footnote`).toBe(false);
      expect(text.trim().length).toBeGreaterThan(0);
    }
    expect(checked).toBe(Object.keys(data.verses).length);
  });

  it('reads the file from the path that exists', () => {
    // One level short resolves to src/data, which is silently never found —
    // and the whole feature then reports "available: false" rather than failing.
    expect(service).toContain("'../../data/sefaria-translation-fixes.json'");
  });
});

describe('applying them', () => {
  it('compares before writing, so a correct row is left alone', () => {
    expect(service).toMatch(/if \(row\.text === correct\) \{/);
    expect(service).toContain('report.alreadyCorrect += 1;');
    expect(service).toContain('report.applied += 1;');
  });

  it('only ever writes the text Sefaria supplied', () => {
    expect(service).toContain('data: { text: correct, verifiedAt: now },');
  });

  it('repairs every translation row, not just the primary', () => {
    // The damage was written to all of them; fixing one would swap a broken
    // surface for another.
    expect(service).toMatch(/passageTranslation\.findMany\(\{\s*where: \{ passageId: passage\.id \}/);
  });

  it('overwrites a primary only where it currently holds damaged text', () => {
    expect(service).toContain('primaryTranslation: passage.primaryTranslation');
  });

  it('counts a verse it cannot find rather than failing', () => {
    expect(service).toMatch(/if \(!passage\) \{\s*report\.missing \+= 1;/);
  });

  it('starts anyway when the file is absent', () => {
    // A deployment predating the file must still boot.
    expect(service).toMatch(/catch \{[\s\S]{0,160}patchCache = null;/);
  });

  it('runs before the network check, which cannot work here', () => {
    const patchIndex = service.indexOf('await applySefariaPatch()');
    const fetchIndex = service.indexOf('await repairSefariaTranslations()');
    expect(patchIndex).toBeGreaterThan(-1);
    expect(fetchIndex).toBeGreaterThan(patchIndex);
  });

  it('marks the rows verified, so the check stops re-fetching them', () => {
    /*
     * Honest as well as cheap: the text came from Sefaria, so it has been
     * compared with Sefaria. Without it, a thousand requests a month are spent
     * asking about verses the file already holds the right text for.
     */
    expect(service).toMatch(/row\.text === correct\) \{[\s\S]{0,200}verifiedAt: now/);
  });

  it('reports its outcome in the status', () => {
    expect(service).toContain('patch: PatchReport | null;');
    expect(service).toContain('status.patch = await applySefariaPatch();');
  });
});
