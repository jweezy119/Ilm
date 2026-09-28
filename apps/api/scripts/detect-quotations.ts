/**
 * Detect quotations across the whole corpus.
 *
 * Run it like this, from the repository root:
 *
 *   npm run detect-quotations -w @ilm/api -- [--min-run 6] [--max-df 8] [--dry-run]
 *
 * The approach is the one in src/services/quotations.ts: find word sequences that
 * appear in exactly one passage in one place and another passage somewhere else,
 * then verify the wording directly before claiming anything. Why not a model is
 * argued there; the short version is that a fabricated quotation is
 * indistinguishable from a real one to a reader, and this way every claim carries
 * the text it rests on.
 *
 * Two parameters decide how much you get, and they pull in opposite directions:
 *
 *   --min-run     How many consecutive shared words are needed. Six is where
 *                 shared idiom stops being plausible. Nine or ten is safer and
 *                 finds less, because much of the Old Testament is quoted in
 *                 slightly altered wording.
 *   --max-df      How many passages an n-gram may appear in before it is treated
 *                 as stock phrasing. This is the important one: without it,
 *                 phrases like "and he said unto him" link thousands of passages
 *                 and the output is noise.
 *
 * The index is built in memory over every passage at once, which needs more RAM
 * than the web service has. This is a script, not a request path — run it from a
 * machine that can spare a gigabyte.
 */
import { prisma } from '../src/lib/db';
import { loadLocalEnv } from '../src/lib/env';
import {
  DEFAULT_MAX_DOCUMENT_FREQUENCY,
  DEFAULT_MIN_RUN,
  findQuotation,
  hashWords,
  normalise,
  scoreQuotation,
  type MatchedSegment,
} from '../src/services/quotations';

loadLocalEnv();

interface PassageText {
  id: string;
  passageKey: string;
  textId: string;
  book: string;
  chapter: number;
  verse: number;
  words: string[];
}

function parseArgs(argv: string[]) {
  const num = (flag: string, fallback: number) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : fallback;
  };
  return {
    minRun: num('--min-run', DEFAULT_MIN_RUN),
    maxDf: num('--max-df', DEFAULT_MAX_DOCUMENT_FREQUENCY),
    limit: num('--limit', Infinity),
    dryRun: argv.includes('--dry-run'),
  };
}

async function main(): Promise<void> {
  const { minRun, maxDf, limit, dryRun } = parseArgs(process.argv.slice(2));

  console.log(`Quotation detection — min run ${minRun} words, max document frequency ${maxDf}`);

  const passages = await prisma.passage.findMany({
    select: { id: true, passageKey: true, textId: true, bookSlug: true, chapterNum: true, verseNum: true },
    orderBy: { id: 'asc' },
    take: Number.isFinite(limit) ? limit : undefined,
  });

  console.log(`Loaded ${passages.length.toLocaleString()} passages.`);

  // The primary translation, because that is the text a quotation is copied from
  // and the one an English-language reader will check against.
  // No passage filter: the table is one row per passage per translation, so
  // filtering it by a list of 45,454 ids only hits Postgres's 32,767 bind-variable
  // ceiling, which is an error rather than a slow query.
  const rows = await prisma.passageTranslation.findMany({
    select: { passageId: true, text: true, translation: { select: { isPrimary: true } } },
    orderBy: { passageId: 'asc' },
  });

  const best = new Map<string, { text: string; isPrimary: boolean }>();
  for (const row of rows) {
    const current = best.get(row.passageId);
    if (!current || (row.translation.isPrimary && !current.isPrimary)) {
      best.set(row.passageId, { text: row.text, isPrimary: row.translation.isPrimary });
    }
  }

  const corpus: PassageText[] = [];
  for (const passage of passages) {
    const translation = best.get(passage.id);
    if (!translation) continue;
    const words = normalise(translation.text);
    // A passage shorter than one n-gram cannot contain a quotation, and short
    // passages are exactly the ones that generate false pairs.
    if (words.length >= minRun) {
      corpus.push({
        id: passage.id,
        passageKey: passage.passageKey,
        textId: passage.textId,
        book: passage.bookSlug,
        chapter: passage.chapterNum,
        verse: passage.verseNum,
        words,
      });
    }
  }
  console.log(`${corpus.length.toLocaleString()} passages have usable text (${(corpus.reduce((s, p) => s + p.words.length, 0) / 1e6).toFixed(1)}M words).`);

  /*
   * One pass over the corpus, collecting for each n-gram hash which passages hold
   * it. Only hashes seen in two or more passages can produce a quotation, and only
   * those below the document-frequency ceiling are worth keeping, so the working
   * set stays small instead of holding every n-gram in the corpus.
   */
  console.log('Building the n-gram index…');
  const postings = new Map<number, number[]>();
  for (let i = 0; i < corpus.length; i += 1) {
    const { words } = corpus[i];
    for (let w = 0; w + minRun <= words.length; w += 1) {
      const hash = hashWords(words, w, minRun);
      const list = postings.get(hash);
      if (list) list.push(i);
      else postings.set(hash, [i]);
    }
  }
  console.log(`${postings.size.toLocaleString()} distinct n-grams.`);

  let kept = 0;
  let droppedByFrequency = 0;
  const pairKeys = new Map<string, number[]>();
  for (const list of postings.values()) {
    if (list.length < 2) continue;
    if (list.length > maxDf) {
      droppedByFrequency += 1;
      continue;
    }
    kept += 1;
    // Deduplicate: a passage can hold the same n-gram at several offsets.
    const unique = [...new Set(list)];
    for (let x = 0; x < unique.length; x += 1) {
      for (let y = x + 1; y < unique.length; y += 1) {
        const lo = Math.min(unique[x], unique[y]);
        const hi = Math.max(unique[x], unique[y]);
        pairKeys.set(`${lo}:${hi}`, [lo, hi]);
      }
    }
  }
  console.log(
    `${kept.toLocaleString()} n-grams shared by 2+ passages and under the frequency ceiling; ` +
      `${droppedByFrequency.toLocaleString()} discarded as stock phrasing. ` +
      `${pairKeys.size.toLocaleString()} candidate pairs.`
  );

  // Per-passage n-gram offsets, built lazily so only the passages that take part
  // in a candidate pair are ever indexed.
  const offsetCache = new Map<number, Map<number, number[]>>();
  const offsetsFor = (index: number) => {
    let index2 = offsetCache.get(index);
    if (!index2) {
      const { words } = corpus[index];
      index2 = new Map<number, number[]>();
      for (let w = 0; w + minRun <= words.length; w += 1) {
        const hash = hashWords(words, w, minRun);
        const list = index2.get(hash);
        if (list) list.push(w);
        else index2.set(hash, [w]);
      }
      offsetCache.set(index, index2);
    }
    return index2;
  };

  interface Finding {
    a: PassageText;
    b: PassageText;
    /*
     * Two different claims, kept apart.
     *
     * `quotation` is a citation: one text is drawing on another, which is the
     * claim a reader of this corpus cares about. `parallel` is the same text
     * repeating itself — the Quran's formulaic echoes, the synoptic gospels, the
     * duplicate narratives in the Pentateuch. Those are real and scholars argue
     * about them, but calling them quotations would be wrong, and the app's whole
     * convention is that a claim states what produced it.
     */
    kind: 'quotation' | 'parallel' | 'duplicate';
    strength: number;
    longestRun: number;
    totalShared: number;
    segments: MatchedSegment[];
  }

  const findings: Finding[] = [];
  let examined = 0;
  for (const [lo, hi] of pairKeys.values()) {
    examined += 1;
    if (examined % 500_000 === 0) console.log(`  examined ${examined.toLocaleString()} pairs, ${findings.length} quotations`);
    const a = corpus[lo];
    const b = corpus[hi];
    const candidate = findQuotation(offsetsFor(lo), offsetsFor(hi), a.words, b.words, minRun);
    if (!candidate || candidate.longestRun < minRun) continue;

    findings.push({
      a,
      b,
      kind: classify(a, b),
      strength: scoreQuotation(candidate.longestRun, candidate.totalShared),
      longestRun: candidate.longestRun,
      totalShared: candidate.totalShared,
      segments: candidate.segments,
    });
  }

  findings.sort((x, y) => y.strength - x.strength || y.longestRun - x.longestRun);
  console.log(`\n${findings.length.toLocaleString()} quotations found from ${examined.toLocaleString()} candidate pairs.`);

  const citations = findings.filter((f) => f.kind === 'quotation');
  const parallels = findings.filter((f) => f.kind === 'parallel');
  const duplicates = findings.filter((f) => f.kind === 'duplicate');
  console.log(`\n${citations.length.toLocaleString()} citations across corpora.`);
  console.log(`${parallels.length.toLocaleString()} parallels within a corpus (repetition, not citation).`);
  console.log(`${duplicates.length.toLocaleString()} duplicate witnesses — the same verse in two collections, which is not lineage.`);

  const byCorpus = new Map<string, number>();
  for (const f of citations) {
    for (const id of [f.a.textId, f.b.textId]) byCorpus.set(id, (byCorpus.get(id) ?? 0) + 1);
  }
  console.log('\nCorpora involved in cross-corpus citations:');
  for (const [id, count] of [...byCorpus].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${id.padEnd(8)} ${count.toLocaleString()} citations`);
  }

  // Which corpora cite which. Unordered, and labelled so: verse order is per
  // corpus, so there is no shared timeline to infer a direction from, and an
  // arrow here would be claiming a chronology the data does not contain.
  const pairs = new Map<string, number>();
  for (const f of citations) {
    const key = [f.a.textId, f.b.textId].sort().join(' <-> ');
    pairs.set(key, (pairs.get(key) ?? 0) + 1);
  }
  console.log('\nWhich corpora cite which (unordered — no direction is implied):');
  for (const [key, count] of [...pairs].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key.padEnd(22)} ${count.toLocaleString()}`);
  }

  const strong = citations.filter((f) => f.longestRun >= 10);
  console.log(`\n${strong.length.toLocaleString()} citations share ten or more consecutive words.`);

  console.log('\nStrongest 25 cross-corpus citations:');
  for (const f of citations.slice(0, 25)) {
    console.log(`  [${f.strength.toFixed(2)}] ${f.longestRun} words  ${f.a.passageKey}  <-  ${f.b.passageKey}`);
    console.log(`        "${f.segments[0]?.textA ?? ''}"`);
    console.log(`        "${f.segments[0]?.textB ?? ''}"`);
  }

  if (dryRun) {
    console.log('\nDRY RUN: nothing written.');
    return;
  }

  /*
   * Stored with the lower passage as source, so a citation reads in the order it
   * was made. detectedBy is `ngram` rather than `jev`, because nothing here was a
   * model's opinion and the strength is arithmetic. The unique constraint is on
   * (source, target, type), so re-running replaces rather than duplicates.
   */
  console.log(`\nWriting ${findings.length.toLocaleString()} cross-references…`);
  let written = 0;
  for (const f of findings) {
    // Orientation: the verse order is per-corpus, so a shared global ordering does
    // not exist. Direction is therefore left bidirectional rather than guessed.
    await prisma.crossReference.upsert({
      where: {
        sourcePassageId_targetPassageId_type: {
          sourcePassageId: f.a.id,
          targetPassageId: f.b.id,
          type: f.kind,
        },
      },
      create: {
        sourcePassageId: f.a.id,
        targetPassageId: f.b.id,
        type: f.kind,
        strength: f.strength,
        direction: 'bidirectional',
        detectedBy: 'ngram',
        notes:
          `Longest verbatim run ${f.longestRun} words, ${f.totalShared} shared in total ` +
          `(${segmentsSummary(f.segments)}).`,
        matchedSegments: f.segments as unknown as object,
      },
      update: {
        strength: f.strength,
        detectedBy: 'ngram',
        notes:
          `Longest verbatim run ${f.longestRun} words, ${f.totalShared} shared in total ` +
          `(${segmentsSummary(f.segments)}).`,
        matchedSegments: f.segments as unknown as object,
      },
    });
    written += 1;
    if (written % 500 === 0) console.log(`  ${written.toLocaleString()} written`);
  }
  console.log(`Done: ${written.toLocaleString()} cross-references stored.`);
}

/*
 * What kind of relationship this is.
 *
 * `duplicate` exists because two of the five corpora overlap. The Pentateuch
 * appears in both `torah` and `ot`, so most pairs between them are the same verse
 * in two collections — a duplicate witness, not a citation. Without this they
 * arrive as 2,721 confident-looking "OT cites Torah" claims, which would be the
 * single most misleading thing this script could do: the majority of them are the
 * same text counted twice, and a reader who caught one would be right to distrust
 * the other 2,720.
 */
function classify(a: PassageText, b: PassageText): 'quotation' | 'parallel' | 'duplicate' {
  if (a.textId === b.textId) return 'parallel';
  if (a.book === b.book && a.chapter === b.chapter && a.verse === b.verse) return 'duplicate';
  return 'quotation';
}

function segmentsSummary(segments: MatchedSegment[]): string {
  if (segments.length === 0) return 'no segments';
  if (segments.length === 1) return '1 segment';
  return `${segments.length} segments`;
}

main()
  .catch((error) => {
    console.error('Quotation detection failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
