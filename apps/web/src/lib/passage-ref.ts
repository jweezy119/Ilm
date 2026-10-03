/**
 * How a passage is written down, in the app and out loud.
 *
 * A passage key is `textId:book:chapter:verse`, and for the Quran the chapter
 * segment is pinned to 1 — `quran:2:1:255` is Al-Baqarah 2:255. So reading the
 * chapter and printing `chapter:verse` gives "1:255", which is not a reference
 * anyone can look up. The surah is in the *book* segment for that corpus and
 * nowhere else.
 *
 * Every surface that names a passage to a reader goes through here, so the
 * recitation player, the graph and the journey list cannot each get it slightly
 * differently. That is not hypothetical: the recitation player said "1:255"
 * until a browser test listened to it.
 */

/**
 * The reference a reader would write: `2:255` for the Quran, `5:14` for Matthew.
 *
 * Quran keys are surah-pinned, so the book carries the surah and the chapter is
 * always 1. Every other corpus uses the chapter as-is.
 */
export function passageReference(passageKey: string): string {
  const parts = (passageKey ?? '').split(':');
  if (parts.length !== 4) return passageKey ?? '';
  const [textId, book, chapter, verse] = parts;
  if (!/^\d+$/.test(verse)) return passageKey;
  if (textId === 'quran') {
    return /^\d+$/.test(book) ? `${Number(book)}:${Number(verse)}` : `${book}:${Number(verse)}`;
  }
  return /^\d+$/.test(chapter) ? `${Number(chapter)}:${Number(verse)}` : `${chapter}:${Number(verse)}`;
}