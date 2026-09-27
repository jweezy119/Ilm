import { describe, expect, it } from 'vitest';
import { stripSefariaHtml } from '../src/services/sefaria';


/**
 * Sefaria returns scripture with HTML markup and inline footnotes. Getting this
 * wrong does not fail loudly: it splices a translator's note into the middle of a
 * verse, and the result still looks like plausible text. These are the exact
 * shapes the live API returned when the bug was found.
 */
describe('stripSefariaHtml', () => {
  it('removes a footnote body rather than untagging it', () => {
    const html =
      'When God began to create<sup class="footnote-marker">a</sup>' +
      '<i class="footnote"><b>When God began to create </b>In contrast to others “In the beginning God created.”</i> heaven and earth—';

    expect(stripSefariaHtml(html)).toBe('When God began to create heaven and earth—');
  });

  it('removes a footnote that contains an italic gloss inside it', () => {
    // The note body has its own <i>, so cutting at the first </i> would leave
    // "uncertain; in contrast to others" behind in the verse.
    const html =
      'And Isaac went out walking<sup class="footnote-marker">g</sup>' +
      '<i class="footnote"><b>walking </b>Meaning of Heb. <i>lasuaḥ</i> uncertain; in contrast to others “to meditate.”</i>' +
      ' in the field toward evening';

    expect(stripSefariaHtml(html)).toBe('And Isaac went out walking in the field toward evening');
  });

  it('keeps italics that are ordinary emphasis, not a footnote', () => {
    expect(stripSefariaHtml('he said <i>Hashem</i> to him')).toBe('he said Hashem to him');
  });

  it('strips <big> around Hebrew but keeps the diacritics', () => {
    expect(stripSefariaHtml('<big>בְּרֵאשִׁ֖ית</big> בָּרָ֣א')).toBe('בְּרֵאשִׁ֖ית בָּרָ֣א');
  });

  it('turns line breaks into spaces and collapses runs of whitespace', () => {
    expect(stripSefariaHtml('the earth was<br>unformed and void')).toBe('the earth was unformed and void');
    expect(stripSefariaHtml('  spaced   out  ')).toBe('spaced out');
  });

  it('decodes entities, including numeric ones', () => {
    expect(stripSefariaHtml('he said &quot;amen&quot; &amp; &#8212; &#x2014;')).toBe('he said "amen" & — —');
  });

  it('returns an empty string for the non-strings Sefaria sends in a verse array', () => {
    expect(stripSefariaHtml(undefined)).toBe('');
    expect(stripSefariaHtml(null)).toBe('');
    expect(stripSefariaHtml(42)).toBe('');
  });
});
