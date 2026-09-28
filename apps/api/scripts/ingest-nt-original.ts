/**
 * Original-language text for the New Testament.
 *
 * The NT was ingested from a bulk KJV file, which has no Greek, so every NT
 * passage has an empty `originalText`. That blocks two things: lexicon lookup
 * needs a word in its original script, and cognate detection needs two words
 * from different traditions to compare.
 *
 * Sefaria has no Greek New Testament, so this uses eBible's `grctcgnt` — the
 * Text-Critical Greek New Testament, public domain, 1 MB for the whole corpus.
 * Its verse grid is identical to the KJV's, so verses join on book:chapter:verse.
 *
 * Deliberately not `grcsbl`: the SBL Greek NT is CC-BY-4.0. `grctcgnt` carries a
 * request that the editors be credited, which the constants below satisfy.
 *
 * Like ingest-ot-original.ts, this only ever UPDATES. It never inserts a verse.
 * That constraint is the point: a plain upsert would mint rows for verses the
 * Greek and the KJV do not share, which would surface as blank search results.
 *
 *   npx tsx scripts/ingest-nt-original.ts
 *   npx tsx scripts/ingest-nt-original.ts --dry-run
 */

import { inflateRawSync } from 'node:zlib';
import { prisma } from '../src/services/passage';
import { loadLocalEnv } from '../src/lib/env';
import { BIBLE_BOOKS } from './ingest';

loadLocalEnv();

const MODULE = 'grctcgnt';
const URL = `https://ebible.org/Scriptures/${MODULE}_usfm.zip`;
const DRY_RUN = process.argv.includes('--dry-run');

/** Text-critical apparatus characters, present in the Greek modules. */
const CRITICAL = /[\u2E00-\u2E03]/g;

// ============================================================================
// ZIP
// ============================================================================

/**
 * Minimal ZIP reader.
 *
 * Written out rather than shelling out to `unzip`, which is absent from the
 * Alpine runtime image. Handles stored and deflated entries, which is all
 * eBible publishes.
 */
function readZip(buffer: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0 && i >= buffer.length - 22 - 0xffff; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error('not a zip: no end-of-central-directory record');

  const count = buffer.readUInt16LE(eocd + 10);
  let at = buffer.readUInt32LE(eocd + 16);
  const files = new Map<string, Buffer>();

  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) throw new Error(`corrupt central directory at entry ${i}`);

    const method = buffer.readUInt16LE(at + 10);
    const compressed = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const local = buffer.readUInt32LE(at + 42);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extraLength + commentLength;

    if (method !== 0 && method !== 8) continue;

    const dataStart = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const raw = buffer.subarray(dataStart, dataStart + compressed);
    files.set(name, method === 0 ? raw : inflateRawSync(raw));
  }

  return files;
}

// ============================================================================
// USFM
// ============================================================================

/**
 * Strip USFM character markup from a verse.
 *
 * Order matters: footnote blocks come out first, or fragments of apparatus notes
 * end up embedded in words.
 */
function stripUsfm(text: string): string {
  return text
    .replace(/\\f\s+[^*]*?\\f\*/g, ' ')
    .replace(/\\f\*/g, ' ')
    .replace(/\\w\s+([^|]*?)\|[^\\]*\\w\*/g, '$1')
    .replace(/\\[a-z0-9]+\s*/g, ' ')
    .replace(CRITICAL, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface Verse {
  chapter: number;
  verse: number;
  text: string;
}

function parseUsfm(source: string): Verse[] {
  const verses: Verse[] = [];
  let chapter = 0;
  let current: Verse | null = null;

  for (const raw of source.split('\n')) {
    const line = raw.replace(/\r/g, '').trimEnd();
    if (!line.trim()) continue;

    const c = /^\\c\s+(\d+)/.exec(line);
    if (c) {
      chapter = Number(c[1]);
      current = null;
      continue;
    }

    const v = /^\\v\s+(\d+)(?:\s+(.*))?$/.exec(line);
    if (v) {
      current = { chapter, verse: Number(v[1]), text: stripUsfm(v[2] ?? '') };
      verses.push(current);
      continue;
    }

    // Wrapped continuation of the verse above. Section headings (\s1) and other
    // blocks do not start with a backslash, so they must be excluded or an
    // English heading lands in a Greek-only field.
    if (current && !line.startsWith('\\')) {
      const extra = stripUsfm(line);
      if (extra) current.text = `${current.text} ${extra}`.trim();
    }
  }

  return verses;
}

// ============================================================================
// INGESTION
// ============================================================================

async function main(): Promise<void> {
  console.log(`New Testament originals — Text-Critical Greek NT (${MODULE})${DRY_RUN ? ' (dry run)' : ''}`);
  console.log('   Public domain. Robinson & Boyd; editors credited as they request.\n');

  const response = await fetch(URL);
  if (!response.ok) throw new Error(`${MODULE}: HTTP ${response.status}`);
  const files = readZip(Buffer.from(await response.arrayBuffer()));

  // The module ships 00-FRT and 01-INT front matter and a 75-XXA appendix; the 27
  // canon books are the contiguous run in between, in canonical order.
  const ordered = [...files.keys()]
    .filter((name) => name.endsWith('.usfm'))
    .map((name) => ({ name, ordinal: Number(/^(\d+)-/.exec(name)?.[1] ?? Number.MAX_SAFE_INTEGER) }))
    .sort((a, b) => a.ordinal - b.ordinal)
    .filter((entry) => entry.ordinal >= 46 && entry.ordinal <= 72)
    .map((entry) => entry.name);

  const books = BIBLE_BOOKS.nt;
  if (ordered.length !== books.length) {
    throw new Error(`expected ${books.length} book files in the 46-72 range, found ${ordered.length}`);
  }

  let filled = 0;
  let noGreek = 0;

  for (let i = 0; i < books.length; i += 1) {
    const book = books[i];
    const greek = new Map<number, Map<number, string>>();

    for (const verse of parseUsfm(files.get(ordered[i])!.toString('utf8'))) {
      if (!greek.has(verse.chapter)) greek.set(verse.chapter, new Map());
      greek.get(verse.chapter)!.set(verse.verse, verse.text);
    }

    // Only verses that already exist, and only the ones still empty.
    const passages = await prisma.passage.findMany({
      where: { textId: 'nt', bookSlug: book, originalText: '' },
      select: { id: true, chapterNum: true, verseNum: true },
      orderBy: [{ chapterNum: 'asc' }, { verseNum: 'asc' }],
    });

    const updates: Array<{ id: string; originalText: string }> = [];
    for (const passage of passages) {
      const text = greek.get(passage.chapterNum)?.get(passage.verseNum);
      if (!text) {
        noGreek += 1;
        continue;
      }
      updates.push({ id: passage.id, originalText: text });
    }

    if (updates.length > 0 && !DRY_RUN) {
      // One statement per book rather than per verse: 7,957 individual UPDATEs is
      // minutes of round trips for no benefit.
      await prisma.$transaction([
        ...updates.map((u) => prisma.passage.update({ where: { id: u.id }, data: { originalText: u.originalText } })),
        // The NT was ingested from an English-only file, so every row says
        // `english`. With Greek attached, the script has to be corrected too or
        // the passage renders in the Latin font and reads "Original (english)".
        prisma.passage.updateMany({ where: { id: { in: updates.map((u) => u.id) } }, data: { language: 'greek' } }),
      ]);
    }

    filled += updates.length;
    if (DRY_RUN && i === 0 && updates[0]) {
      console.log(`   sample ${book} ${passages[0].chapterNum}:${passages[0].verseNum} -> ${updates[0].originalText.slice(0, 80)}…`);
    }
  }

  const remaining = await prisma.passage.count({ where: { textId: 'nt', originalText: '' } });

  console.log(`\n${DRY_RUN ? 'would fill' : '✅ filled'} ${filled} verses`);
  // Greek and KJV do not divide every passage identically, so a handful of
  // English verses have no Greek counterpart. They are left empty on purpose:
  // minting a row for them would surface a passage with no translation.
  console.log(`   no Greek for that verse number: ${noGreek}`);
  console.log(`   still empty: ${remaining}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error('\n❌ Greek ingestion failed:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
