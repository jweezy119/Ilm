/**
 * Turning Sefaria's markup into plain text.
 *
 * Sefaria returns scripture wrapped in HTML: footnote markers, italic glosses,
 * `<big>` around pointed Hebrew, and `<br>` for poetry line breaks. It also
 * returns inline footnotes, and handling those wrongly is the one bug in here
 * that fails silently — see `removeSefariaFootnotes`.
 *
 * This lives in `src/services` rather than in the ingest script so that a second
 * script can use it without importing the first one's `main()`.
 */

/**
 * Remove Sefaria's inline footnotes with their content.
 *
 * A footnote arrives as `<sup class="footnote-marker">g</sup>` followed by
 * `<i class="footnote">…</i>`, sitting in the same string as the verse. Stripping
 * the tags alone leaves the note's prose spliced into the scripture, which reads as
 * two translations run together — Genesis 1:1 came through as "When God began to
 * createaWhen God began to create In contrast to others "In the beginning God
 * created." heaven and earth—".
 *
 * The note body can itself contain an `<i>` — Sefaria sets a gloss in italics, as
 * in "Meaning of Heb. <i>lasuaḥ</i> uncertain" — so the block is removed by
 * counting nesting depth. Matching to the first closing tag would stop inside the
 * note and leave the remainder in the verse.
 */
export function removeSefariaFootnotes(html: string): string {
  let out = '';
  let cursor = 0;
  let depth = 0;
  let blockTag = '';
  const tagPattern = /<(\/?)(sup|i)\b([^>]*)>/gi;

  for (let match = tagPattern.exec(html); match; match = tagPattern.exec(html)) {
    const [full, closing, name, attributes] = match;
    const isFootnote = /\bclass\s*=\s*["'][^"']*foot-?note/i.test(attributes);

    if (depth === 0 && !isFootnote) {
      out += html.slice(cursor, match.index + full.length);
      cursor = match.index + full.length;
      continue;
    }

    if (depth === 0) {
      // Opening tag of a footnote: drop it and swallow the block.
      blockTag = name;
      depth = 1;
      out += html.slice(cursor, match.index);
      cursor = match.index + full.length;
      continue;
    }

    // Inside the block. Only the block's own tag name changes the depth.
    if (name.toLowerCase() === blockTag) depth += closing ? -1 : 1;
    cursor = match.index + full.length;
  }

  return out + html.slice(cursor);
}

export function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

/**
 * Sefaria markup to plain text. Diacritics and vowel points are part of the
 * scripture, so they are kept; only the markup goes.
 */
export function stripSefariaHtml(value: unknown): string {
  if (typeof value !== 'string') return '';
  return decodeEntities(
    removeSefariaFootnotes(value)
      .replace(/<\s*br\s*\/?\s*>/gi, ' ')
      .replace(/<[^>]*>/g, '')
  )
    .replace(/\s+/g, ' ')
    .trim();
}
