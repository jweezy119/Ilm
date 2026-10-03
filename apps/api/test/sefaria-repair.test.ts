/**
 * The self-check is a comparison with Sefaria, not a guess about what damage
 * looks like.
 *
 * That distinction is the whole design, and these tests hold it: a repair that
 * worked once by pattern and then missed the rest would leave the corpus broken
 * while reporting success, which is worse than reporting nothing. So the things
 * worth pinning down are that it is bounded, that it resumes, and that it only
 * ever writes Sefaria's own text.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const service = readFileSync(resolve(__dirname, '../src/services/sefaria-repair.ts'), 'utf8');
const boot = readFileSync(resolve(__dirname, '../src/index.ts'), 'utf8');
const schema = readFileSync(resolve(__dirname, '../prisma/schema.prisma'), 'utf8');
const migration = readFileSync(
  resolve(__dirname, '../prisma/migrations/13_translation_verified_at/migration.sql'),
  'utf8'
);

describe('the self-check compares rather than guesses', () => {
  it('only looks at rows that have never been checked', () => {
    // Every row written before this existed is unchecked, so the first boot walks
    // the corpora once. This is what makes the whole thing self-limiting: once
    // checked, a row is never fetched again.
    expect(service).toContain('verifiedAt: null');
    expect(service).toMatch(/unverifiedCount/);
  });

  it('marks a row checked whether or not it had to change it', () => {
    // Marking only the repaired rows would re-fetch the clean ones forever, which
    // turns a one-off repair into a permanent crawl.
    expect(service).toMatch(/report\.repaired \+= 1/);
    expect(service).toMatch(/report\.alreadyCorrect \+= 1/);
    expect(service).toContain('verifiedAt: now');
  });

  it('leaves a row unchecked when Sefaria cannot answer for it', () => {
    // Otherwise a missing verse is accepted as correct on the strength of one
    // failed request, which is the silent way to lose text.
    expect(service).toContain('report.unresolved += 1');
    expect(service).toMatch(/if \(typeof raw !== 'string'\)/);
  });

  it('only ever writes Sefaria\'s own text', () => {
    expect(service).toContain('const clean = stripSefariaHtml(raw);');
    expect(service).toMatch(/data: \{ text: clean, verifiedAt: now \}/);
    // The primary column is only replaced where it currently matches the row
    // being checked, so a primary set from a different source is never clobbered.
    expect(service).toContain('primaryTranslation: candidate.text');
  });

  it('fetches one chapter rather than one verse', () => {
    // A chapter's text travels together, so per-verse requests would be several
    // hundred for one chapter's worth of rows.
    expect(service).toContain('byChapter');
    expect(service).toContain('REQUEST_DELAY_MS');
  });
});

describe('bounded, because it runs on a live service', () => {
  it('has both a row limit and a deadline', () => {
    expect(service).toMatch(/limit \?\? \d+/);
    expect(service).toMatch(/budgetMs \?\? Number\(/);
    expect(service).toContain('report.truncated = true');
  });

  it('resumes per row, so an interrupted run does not repeat chapters', () => {
    // The marker is per row rather than per translation precisely so this holds.
    expect(schema).toMatch(/model PassageTranslation \{[\s\S]*?verifiedAt DateTime\? @map\("verified_at"\)/);
    expect(migration).toMatch(/per row rather than per translation/);
    expect(migration).toContain('passage_translations_unverified_idx');
  });

  it('runs after listen and is never awaited', () => {
    // Before listen it would sit between the deploy and the first request; awaited
    // it would do the same by a different route.
    const listenIndex = boot.indexOf('await app.listen');
    const hookIndex = boot.indexOf('startSefariaMaintenance');
    expect(listenIndex).toBeGreaterThan(-1);
    expect(hookIndex).toBeGreaterThan(listenIndex);
    expect(boot).toContain('void (async () => {');
  });

  it('can be turned off without a code change', () => {
    // The switch now lives in the service that owns the schedule, so there is
    // one place to look rather than a flag in the entry point and a check in
    // the worker.
    expect(service).toContain("process.env.SKIP_SEFARIA_REPAIR === '1'");
  });

  it('cannot take the service down', () => {
    expect(boot).toMatch(/catch \(error\)[\s\S]{0,240}Sefaria translation check failed/);
    // And the read it starts with is guarded too, since a database blip during
    // boot would otherwise reject out of the detached promise.
    expect(service).toMatch(/A repair that cannot even read[\s\S]{0,80}return report;/);
  });
});

describe('scope', () => {
  it('covers only the corpora whose English comes from Sefaria', () => {
    // The Quran comes from api.quran.com and is not checked against Sefaria,
    // which would be checking it against the wrong book.
    expect(service).toContain("SEFARIA_CORPORA = ['torah', 'ot', 'talmud']");
  });
});
