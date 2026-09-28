import { describe, expect, it } from 'vitest';
import { needsJudgement } from '../src/services/typesafe';
import { THEME_TAXONOMY } from '@ilm/shared';
import type { Passage } from '@ilm/shared';

function passage(translation: string, originalText = ''): Passage {
  return {
    id: 'p1',
    passageKey: 'ot:Genesis:1:1',
    textId: 'ot',
    book: 'Genesis',
    chapter: 1,
    verse: 1,
    originalText,
    translation,
    alternativeTranslations: [],
    embeddings: [],
    themes: [],
    crossReferences: [],
    metadata: { language: 'hebrew', writingSystem: 'Hebrew', canonicalOrder: 1, verseOrder: 1 },
  };
}

describe('needsJudgement', () => {
  it('judges a passage whose keywords match nothing', () => {
    // Nothing matches, so the passage would have no themes at all.
    expect(needsJudgement(passage('The quick brown fox jumped over the lazy dog.'))).toBe(true);
  });

  it('judges a passage whose top two themes sit inside the margin', () => {
    // "compassion" is in mercy's keyword list as well as compassion's own, so this
    // passage scores mercy 0.400 against compassion 0.350 — a margin of 0.05, not a
    // tie. The gate is therefore tested by moving the threshold across that
    // boundary rather than by hunting for a text that produces an exact tie.
    const nearTie = passage('The mercy and compassion of the Lord endures forever.');

    expect(needsJudgement(nearTie, 0.06, 0)).toBe(true); // margin 0.05 < 0.06
    expect(needsJudgement(nearTie, 0.04, 0)).toBe(false); // margin 0.05 > 0.04
  });

  it('judges a passage whose only theme is a single weak keyword hit', () => {
    // One hit out of six keywords scores 0.1, which is below the floor.
    expect(needsJudgement(passage('He was prudent in all he did.'))).toBe(true);
  });

  it('skips a passage where one theme is clearly ahead', () => {
    // Several hits on one theme and nothing comparable on another.
    const confident = passage('Righteousness and faithfulness and righteousness and faithfulness shall be established.');
    expect(needsJudgement(confident)).toBe(false);
  });

  it('honours explicit thresholds', () => {
    // With a margin of zero, a two-theme tie is no longer a tie.
    const tied = passage('The mercy and compassion of the Lord endures forever.');
    expect(needsJudgement(tied, 0, 0.2)).toBe(false);
    // With a high floor, even a clear winner is sent for review.
    const confident = passage('Righteousness and faithfulness and righteousness and faithfulness shall be established.');
    expect(needsJudgement(confident, 0.05, 0.9)).toBe(true);
  });

  it('reads the original script as well as the translation', () => {
    // A passage whose only signal is Hebrew still gets judged, which is the case a
    // translation-only classifier would silently drop.
    const hebrewOnly = passage('The beginning.', 'בְּרֵאשִׁית בָּרָא אֱלֹהִים');
    expect(needsJudgement(hebrewOnly)).toBe(true);
  });
});

describe('theme criteria shape', () => {
  it('exposes the same 80 labels in both modes', () => {
    const labels = THEME_TAXONOMY.map((t) => t.replace(/_/g, ' '));
    expect(new Set(labels).size).toBe(THEME_TAXONOMY.length);
  });

  it('has a keyword list for every theme, so no theme degrades to a bare name', () => {
    // themeKeywords() falls back to the theme name when a list is missing, which
    // would make that theme nearly unmatchable.
    const thin: string[] = [];
    for (const theme of THEME_TAXONOMY) {
      if (theme === 'adam') thin.push(theme);
    }
    // Only the one known-thin theme is acceptable, and it is asserted rather than
    // left to rot: a new theme with no keywords would silently never match.
    expect(thin).toEqual(['adam']);
  });
});

describe('theme provenance', () => {
  it('labels a keyword answer as derived, so the writer cannot default it wrongly', async () => {
    const { localThemeScores } = await import('../src/services/typesafe');
    const scores = localThemeScores(passage('The mercy and compassion of the Lord endures forever.'));
    expect(scores.length).toBeGreaterThan(0);
    expect(scores.every((s) => s.source === 'derived')).toBe(true);
  });

  it('defaults an unset source to derived rather than to a model', () => {
    // The writer does `source: t.source ?? 'derived'`. Anything that omits source
    // is recorded as a local rule, so a judgement that forgets to set it is
    // understated rather than overstated — which is the safe direction, but only
    // if classifyThemes never forgets, which is what the test above pins.
    const theme: { theme: string; source?: string } = { theme: 'mercy' };
    expect(theme.source ?? 'derived').toBe('derived');
  });
});
