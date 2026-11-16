/**
 * Build apps/api/data/enoch.json from the R.H. Charles text of 1 Enoch.
 *
 *   node build-enoch.mjs                      # fetch the source and convert
 *   node build-enoch.mjs path/to/ENO.json     # convert a local copy instead
 *
 * Source: https://garovartabedian.com/scriptures/text/charles/ENO.json
 * Translation: R. H. Charles, 1913 — public domain. Chapter and verse divisions
 * follow Charles's edition: 108 chapters.
 *
 * The source marks Charles's conjectural readings with U+2308/U+2309 corner
 * brackets. They are stripped here, because the reader is reading scripture
 * rather than a critical apparatus; stripping the brackets keeps the words.
 *
 * The output shape is what scripts/ingest-enoch.ts reads:
 *   [{ chapter: 1, verses: [{ verse: 1, text: "..." }] }, ...]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const SOURCE_URL = 'https://garovartabedian.com/scriptures/text/charles/ENO.json';
const OUTPUT = new URL('../data/enoch.json', import.meta.url);

const stripApparatus = (s) =>
  s
    .replace(/[⌈⌉]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();

async function load() {
  const local = process.argv[2];
  if (local) return JSON.parse(readFileSync(local, 'utf8'));
  const response = await fetch(SOURCE_URL);
  if (!response.ok) throw new Error(`source returned ${response.status}`);
  return response.json();
}

const raw = await load();
const chapters = raw.chapters.map((verses, index) => ({
  chapter: index + 1,
  verses: verses.map((text, verseIndex) => ({
    verse: verseIndex + 1,
    text: stripApparatus(text),
  })),
}));

const total = chapters.reduce((sum, chapter) => sum + chapter.verses.length, 0);
const empty = chapters.flatMap((chapter) => chapter.verses).filter((verse) => !verse.text);

if (empty.length) {
  console.error(`\u26a0 ${empty.length} verses came out empty \u2014 the source changed shape.`);
  process.exit(1);
}

writeFileSync(OUTPUT, `${JSON.stringify(chapters, null, 2)}\n`);
console.log(`\u2713 ${chapters.length} chapters, ${total} verses \u2192 ${OUTPUT.pathname}`);
