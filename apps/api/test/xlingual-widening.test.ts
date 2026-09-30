import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Cross-lingual query widening.
 *
 * A concept query used to be widened only with the theme's *English* keywords, so
 * "mercy" became "compassion forgiving gracious" and the expansion could never reach
 * רחמים. The original-language vectors did real work for a reader who typed Hebrew
 * and nothing at all for everyone else, which made the homepage's claim that these
 * texts are searchable in the languages they were written in true only for readers
 * who already read them.
 *
 * These assertions are about the shape of the code, because the results live in a
 * database a unit test cannot see. What they protect is the honesty rule, which is
 * the only reason this is safe to ship: a passage the reader did not search for, and
 * which does not contain what they typed, must never be presented as though it did.
 */

const search = readFileSync(join(__dirname, '../src/services/search.ts'), 'utf8');
const xlingual = readFileSync(join(__dirname, '../src/services/xlingual.ts'), 'utf8');
const panel = readFileSync(join(__dirname, '../../web/src/components/VerdictPanel.tsx'), 'utf8');

describe('cross-lingual widening', () => {
  it('searches the original-language terms, not just English ones', () => {
    // The gap in one assertion: if only the English keywords are searched, the
    // feature does nothing that themeSearchTerms did not already do.
    expect(search).toContain('xlingualTermsForTheme(theme)');
    expect(search).toContain("kind: 'xlingual'");
  });

  it('labels every widened result with the term that reached it', () => {
    // Provenance has to be per passage, not per query. Per query cannot say which
    // word found a given row, and a reader who cannot check the claim is being
    // asked to take it on trust.
    expect(search).toContain('provenance.set(key, via)');
    expect(search).toContain('indexResult.provenance?.get(passage.passageKey)');
  });

  it('gives a widened passage credit for coverage it does not have', () => {
    // The filter that discards zero-coverage results exists to drop "a different
    // passage". A Hebrew verse reached through חכמה contains none of the English in
    // "wisdom", so without this it scores zero and is discarded — silently deleting
    // exactly the results this exists to produce, while looking like the feature had
    // found nothing.
    expect(search).toContain('termCoverage(c.passage, terms, indexResult.provenance?.get(');
    const coverage = search.slice(search.indexOf('function termCoverage'));
    expect(coverage.slice(0, 1200)).toContain('if (widenedVia) return 1;');
  });

  it('does not re-rank widened passages above literal ones', () => {
    // The tempting fix is to boost a widened result so it appears on page one. That
    // would make the score printed on the row above it a lie, which is the specific
    // dishonesty this product exists to avoid. The terms are offered instead.
    const widened = search.slice(search.indexOf('async function runExpanded'));
    expect(widened).not.toMatch(/score\s*\*?=\s*[\d.]+\s*\*\s*.*novel/);
    expect(widened).toContain('Math.max(0.1, 1 - i / candidates.length)');
  });

  it('offers the terms to the reader rather than applying them silently', () => {
    expect(panel).toContain('crossLingualHeading');
    // A term whose novel count is zero matched only passages the English widening
    // had already found through the translation, so listing it would be offering a
    // word that leads nowhere new.
    expect(panel).toContain("w.kind === 'xlingual' && w.novel > 0");
  });

  it('widens when the literal results never reached the original text', () => {
    // Thin recall was the only trigger until now, and it is the wrong condition
    // here: "wisdom" matches hundreds of passages and every one of them is an
    // English translation, so the other corpora were invisible while the count
    // looked healthy. Measured: the map reaches 78 passages for "wisdom" that the
    // English expansion does not.
    expect(search).toContain("reachedOriginal = firstPass.hits.some((h) => (h.document.matchedIn ?? '').includes('original'))");
    expect(search).toContain('firstPass.count < THIN_RECALL || !reachedOriginal');
  });

  it('caches per theme, and only once the query has answered', () => {
    // The bug this replaces kept one map of everything fetched so far, so a theme
    // that had not been searched yet returned nothing for five minutes. Since a
    // search asks for exactly one theme, the map worked for whichever theme was
    // searched first and silently did nothing for all the others.
    expect(xlingual).toContain('const cache = new Map<string, CacheEntry>()');
    expect(xlingual).toContain('cache.set(theme, { terms, at: Date.now() })');
  });

  it('discards Latin-script tokens in non-Latin text as typesetting artefacts', () => {
    // The Hebrew corpus carries `\thinsp`, a LaTeX spacing command, and it reached
    // the prayer theme's term list. Hebrew, Greek, Arabic and Aramaic are disjoint
    // from Latin, so a token with a Latin letter in them came out of a typesetting
    // pipeline rather than off a scribe, and this is the one artefact class that can
    // be identified from the text alone.
    expect(xlingual).toContain('if (/\\p{Script=Latin}/u.test(raw)) continue;');
  });

  it('keeps the artefact that is a real word rather than removing it', () => {
    // Freezing the mistake this file once made. The vocative form means "O Moses"
    // and appears in 24 Quranic passages; the plain form means "Moses" and appears
    // in 1,295. A filter tuned to prefer the rare form looks like a precision win
    // and is a large recall loss, and no test here should encode a preference for
    // it.
    expect(xlingual).toContain('export const MIN_SPECIFICITY = 0.8;');
  });

  it('takes its threshold from the distribution and claims no knob it does not have', () => {
    // Specificity is bimodal: 370 entries fall to 223 at a floor of 0.8, and 0.9 and
    // 1.0 give the same 223. There is no gradient to tune. And there is no frequency
    // cap, because every surviving term already occurs in 6–50 passages, so a cap at
    // 100 or at 1200 removes nothing — a knob that changes no result is worse than
    // no knob.
    expect(xlingual).toContain('export const MIN_SPECIFICITY = 0.8;');
    expect(xlingual).not.toMatch(/MAX_IN_PESSAGES|MAX_FREQUENCY/);
    // The share gate is gone, and the reason it is gone is recorded in the file, so
    // the next person does not re-derive it and re-break Moses.
    expect(xlingual).not.toContain('MIN_THEME_SHARE');
    expect(xlingual).toMatch(/measured and withdrawn/);
  });
});
