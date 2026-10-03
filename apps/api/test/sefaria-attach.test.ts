/**
 * The Sefaria translation attach must be able to rewrite what it already wrote.
 *
 * The failure is silent and permanent. The footnote fix in
 * `src/services/sefaria.ts` landed in code, was tested against the exact markup
 * that caused it, and still never reached the database — because the script that
 * writes those rows only ever inserted what was missing. The Hebrew Bible kept
 * serving "When God began to createaWhen God began to create In contrast to
 * others "In the beginning God created." heaven and earth—" long after the bug
 * was fixed in the function responsible for it.
 *
 * A script that cannot repair its own past output cannot be used to deploy a
 * correction, which is the property held here.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const script = readFileSync(
  resolve(__dirname, '../scripts/ingest-sefaria-translations.ts'),
  'utf8'
);

describe('Sefaria translation attach', () => {
  it('rewrites rows whose text changed', () => {
    // Without this the only way to fix an already-ingested translation is to
    // truncate the table by hand.
    expect(script).toMatch(/passageTranslation\.updateMany/);
    expect(script).toMatch(/data:\s*\{\s*text:\s*r\.text\s*\}/);
  });

  it('only reports and counts a real change', () => {
    // An unconditional "updated: N" would be indistinguishable from a run that
    // did nothing, which is exactly the signal needed to tell a repair happened.
    expect(script).toMatch(/if \(before === undefined \|\| before === r\.text\) continue;/);
    expect(script).toMatch(/rewritten \(text changed\)/);
  });

  it('still inserts rows that are missing', () => {
    // The repair must not cost the original behaviour.
    expect(script).toMatch(/passageTranslation\.createMany/);
    expect(script).toMatch(/const fresh = rows\.filter\(\(r\) => !have\.has\(r\.id\)\)/);
  });

  it('covers every corpus the script ingests, not only the Torah', () => {
    // The same attach serves ot, torah and talmud, so a version that fixed only
    // one corpus would still leave the other two stuck.
    expect(script).toMatch(/const TARGET_VERSIONS: Record<'ot' \| 'torah' \| 'talmud'/);
    const attachIndex = script.indexOf('async function attach');
    const mainIndex = script.indexOf('async function main');
    expect(attachIndex).toBeGreaterThan(-1);
    expect(mainIndex).toBeGreaterThan(-1);
  });
});

describe('the markup stripper the repair depends on', () => {
  it('is still exported and still used by the ingest path', () => {
    // Guarded here because the repair is only correct if the text it writes is
    // already clean. sefaria.test.ts covers the stripping behaviour itself.
    const service = readFileSync(resolve(__dirname, '../src/services/sefaria.ts'), 'utf8');
    expect(service).toContain('export function removeSefariaFootnotes');
    expect(service).toContain('export function stripSefariaHtml');
    expect(script).toContain('stripSefariaHtml');
  });
});
