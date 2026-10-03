/**
 * Why a run found nothing, told apart.
 *
 * This exists because the first version could not tell anyone. It reported
 * thirty thousand unresolved rows and no way to distinguish a host refusing us
 * from a chapter it does not hold — and those need opposite responses: stop
 * asking, or ask more slowly, or do nothing at all.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const service = readFileSync(resolve(__dirname, '../src/services/sefaria-repair.ts'), 'utf8');

describe('a refused fetch is reported, not swallowed', () => {
  it('keeps the status code and text of a refusal', () => {
    // "unresolved: 30000" said everything and communicated nothing.
    expect(service).toMatch(/HTTP \$\{response\.status\} \$\{response\.statusText\}/);
  });

  it('keeps the class of a network failure', () => {
    // Node collapses DNS, TLS and connection reset into one opaque TypeError, so
    // the class is the most there is to report — but it is much more than
    // nothing, and it is ours rather than Sefaria's.
    expect(service).toContain("const name = error instanceof Error ? error.name : 'Error';");
    expect(service).toMatch(/name === 'AbortError' \? `timeout after/);
    expect(service).toContain('${name}: ${detail}');
  });

  it('tallies failures by reason, most frequent first', () => {
    expect(service).toContain('fetchFailures: Record<string, number>;');
    expect(service).toMatch(/report\.fetchFailures\[reason\] = \(report\.fetchFailures\[reason\] \?\? 0\) \+ 1/);
  });

  it('tells an empty chapter apart from a refused one', () => {
    // Sefaria answering "I do not hold this chapter in this version" is an
    // answer. Collapsing it with a 403 is what made the diagnosis impossible.
    expect(service).toContain('ok: true; text: unknown[]');
    expect(service).toMatch(/A chapter with no English in this version is Sefaria answering/);
  });

  it('identifies both refusals rather than reporting the emptier one', () => {
    // The named version and the default are two requests; when both fail, the
    // reason has to come from one of them rather than from "no verses".
    expect(service).toMatch(/return named\.ok \? \{ ok: true, text: \[\] \} : fallback;/);
  });
});

describe('it stops asking when Sefaria is not answering', () => {
  it('gives up after a run of empty refusals', () => {
    // A thousand chapters, each refused, is a thousand requests at somebody who
    // has already said no — and the only trace was a number nobody could explain.
    expect(service).toContain('MAX_CONSECUTIVE_FETCH_FAILURES = 5');
    expect(service).toMatch(/consecutiveFetchFailures >= MAX_CONSECUTIVE_FETCH_FAILURES/);
    expect(service).toContain('report.abortedUnreachable = true;');
  });

  it('resets the streak on a chapter that answers, however briefly', () => {
    // Five misses in a row is a refusal; one chapter in five empty is a corpus
    // with gaps, and must not stop the run.
    expect(service).toMatch(/if \(outcome\.text\.length === 0\) consecutiveFetchFailures = 0;\s*else consecutiveFetchFailures = 0;/);
  });

  it('counts every row of an abandoned chapter as unresolved', () => {
    // Otherwise the arithmetic disagrees with itself: rows reported as checked
    // but neither repaired, confirmed, nor mentioned anywhere.
    expect(service).toMatch(/report\.unresolved \+= group\.length;\s*report\.checked \+= group\.length;/);
  });

  it('marks the run truncated as well, so the budget is not the excuse', () => {
    expect(service).toMatch(/report\.abortedUnreachable = true;\s*report\.truncated = true;/);
  });
});

describe('the status says which problem this is', () => {
  it('carries one flag for "we could not reach it"', () => {
    expect(service).toContain('sefariaUnreachable: boolean;');
    expect(service).toContain('status.sefariaUnreachable = report.abortedUnreachable;');
  });

  it('is initialised false, so absence of a run is not a failure', () => {
    expect(service).toContain('sefariaUnreachable: false,');
  });
});

describe('the agent it identifies as', () => {
  it('is a browser rather than an unrecognised crawler', () => {
    // Sefaria is a public site rather than an API with published terms, and an
    // agent nobody asked for is the sort of thing that gets refused. 'ilm/1.0'
    // was exactly that.
    expect(service).toContain('Mozilla/5.0');
    expect(service).not.toMatch(/'User-Agent':\s*'ilm\/1\.0'/);
    expect(service).toContain("Accept: 'application/json'");
  });
});
