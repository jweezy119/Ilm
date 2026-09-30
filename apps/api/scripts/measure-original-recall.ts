/**
 * Measure what searching the original text actually finds.
 *
 * The homepage claims "Four original languages". That claim has been carried on
 * spot checks — 8 of 8 Hebrew, 5 of 5 Greek, 15 of 18 Arabic — which is a sample of
 * convenience rather than a measurement, and it is the claim most exposed if it
 * turns out to be wrong.
 *
 * The method, and why it is not circular.
 *
 * A word drawn from the corpus and searched for will always be found by an index
 * built from that corpus, so testing the words the index contains measures nothing.
 * What can go wrong is not the index but everything between the index and the
 * result: the normaliser folding diacritics, the query builder, the document
 * frequency filter, the ranking, and the caps. So the sample is drawn from the
 * corpus, but the measurement is whether the passages the search *returns* overlap
 * the passages that genuinely contain the term, and by how much.
 *
 * Terms are chosen inside a document-frequency band rather than taken at random. A
 * word in two passages tests almost nothing — one of them will be found by chance.
 * A word in forty thousand returns the corpus. The band used is 30 to 400
 * passages, which is where a reader is likely to be typing something that means a
 * specific thing.
 *
 * Semantic ranking is off. It would make the numbers move with a model call, and the
 * question here is whether the retrieval underneath is sound.
 *
 *   npx tsx scripts/measure-original-recall.ts [--per-corpus=6]
 */

import { prisma } from '../src/lib/db';
import { stemGreek } from '../src/lib/greek-stem';
import { fold } from '../src/lib/script-normalize';
import { searchPassages } from '../src/services/search';
import type { TextId } from '@ilm/shared';

/** The most frequent terms in a corpus are its function words. Excluded from the sample. */
const STOPWORD_CEILING = 300;
/** A term in fewer passages than this is not something a reader is likely to type. */
const MIN_DF = 12;
const TOP_K = 20;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const inline = argv.find((a) => a.startsWith('--per-corpus='));
  const i = argv.indexOf('--per-corpus');
  const perCorpus = Number(inline ? inline.slice(13) : i >= 0 ? argv[i + 1] : 6);

  console.log('Original-language recall — are the four languages really searchable?\n');
  console.log(`  function words excluded: top ${STOPWORD_CEILING}   minimum passages per term: ${MIN_DF}   top ${TOP_K} results   semantic off`);

  const corpora: Array<{ textId: TextId; label: string }> = [
    { textId: 'quran', label: 'Arabic (Quran)' },
    { textId: 'bukhari', label: 'Arabic (al-Bukhari)' },
    { textId: 'muslim', label: 'Arabic (Sahih Muslim)' },
    { textId: 'ot', label: 'Hebrew (OT)' },
    { textId: 'torah', label: 'Hebrew (Torah)' },
    { textId: 'nt', label: 'Greek (NT)' },
    { textId: 'talmud', label: 'Aramaic (Talmud)' },
  ];

  const totals: Array<{ label: string; hits: number; of: number; recall: number }> = [];

  for (const corpus of corpora) {
    /*
     * A sample of the corpus, folded once. The full text of seven corpora is far more
     * than needs to be in memory to find terms in a sensible frequency band, and the
     * point is recall rather than an exhaustive census.
     */
    const rows = await prisma.passage.findMany({
      where: { textId: corpus.textId },
      select: { passageKey: true, originalText: true },
      orderBy: { verseOrder: 'asc' },
      /*
       * The whole corpus, and the sample size turned out to decide the result.
       *
       * At 3,000 passages the 30–400 document-frequency band held about 200 terms
       * and every one of them was inside the 200 most frequent — that is, the band
       * *was* the function words and nothing else. Content words in that frequency
       * range simply do not exist in a sample that small, so the first two runs
       * found nothing to measure and would have reported the languages as having no
       * searchable terms at all, which is the opposite of what was true.
       */
    });

    if (rows.length === 0) {
      console.log(`  ${corpus.label.padEnd(20)} no original text`);
      continue;
    }

    /*
     * Two indexes over the same rows, because one number cannot answer the
     * question a reader is asking.
     *
     * `surface` maps a token to the passages containing that exact spelling. `stem`
     * maps a token's stem to the passages containing *any* inflected form. The
     * second is the honest definition of "the passages this word means" — a reader
     * typing ἀνθρωποι wants ἀνθρώπων and ἀνθρώπῳ as well, and none of those three
     * passages contains the string they typed.
     *
     * Having only ever measured against `surface` is why the Greek figure was
     * 53% and why it could not be read. A surface-truth measurement scores a
     * stem-based index for failing to match a form it was never asked for, and it
     * scores an exact index for the thing it is actually good at. Both numbers are
     * reported from here on, because a stem index trades the first for the second
     * and a single figure can only hide that trade.
     */
    const surface = new Map<string, Set<string>>();
    const stemIndex = new Map<string, Set<string>>();
    for (const row of rows) {
      const text = fold(row.originalText ?? '');
      if (text.length < 20) continue;
      const seen = new Set<string>();
      const stems = new Set<string>();
      for (const word of text.split(/[^\p{L}\p{M}]+/u)) {
        if (word.length < 2) continue;
        if (!seen.has(word)) {
          seen.add(word);
          const set = surface.get(word) ?? new Set<string>();
          set.add(row.passageKey);
          surface.set(word, set);
        }
        if (/\p{Script=Greek}/u.test(word)) {
          const st = stemGreek(word);
          if (st.length < 2) continue;
          stems.add(st);
        }
      }
      for (const st of stems) {
        const set = stemIndex.get(st) ?? new Set<string>();
        set.add(row.passageKey);
        stemIndex.set(st, set);
      }
    }
    // Greek has no surface/stem distinction to measure without a stemmer; for every
    // other script the two indexes are the same thing and the columns collapse to
    // one number, which is the correct answer rather than a gap in the report.
    const index = surface;

    /*
     * Function words are excluded, and the first attempt found the problem rather
     * than avoiding it: the 30–400 band in Arabic is almost entirely من, ان, في, ك��
     * and the same in Hebrew and Greek. A recall figure built on those measures
     * whether the index can find "from" and "that", which it can, and says nothing
     * about whether a reader can find a concept. So the most frequent terms are
     * treated as stopwords and the sample is drawn from the content words in the
     * band.
     */
    const ranked = [...index.entries()].sort((a, b) => b[1].size - a[1].size);
    const functionWords = new Set(ranked.slice(0, STOPWORD_CEILING).map(([w]) => w));

    /*
     * Chosen by rank, not by an absolute frequency band.
     *
     * The band was a mistake twice over. 30–400 passages is a sensible-looking range
     * and it is empty at full corpus size, because the distribution is bimodal: the
     * few hundred function words carry most of the corpus and everything else sits
     * below 30 passages. The gap is real, so any band inside it contains nothing.
     *
     * So the sample is "the most common terms that are not function words", which
     * is what a reader is actually typing, spread through the head of that list
     * rather than taken from its top.
     */
    const content = ranked.slice(STOPWORD_CEILING).filter(([, keys]) => keys.size >= MIN_DF);
    const band = content;
    if (band.length === 0) {
      console.log(`  ${corpus.label.padEnd(20)} no term fell in the band`);
      continue;
    }
    const stride = Math.max(1, Math.floor(band.length / perCorpus));
    const sample = band.filter((_, n) => n % stride === 0).slice(0, perCorpus);

    let hits = 0;
    let denominator = 0;
    /*
     * Two tiers, because one number was badly misleading.
     *
     * A term in 140 passages cannot score above 20/140 when only twenty results are
     * returned, so folding those into a single recall figure measures the page size
     * rather than the index. The first version reported 34% for the hadith and it
     * was almost entirely this: every high-frequency term had returned exactly 20
     * of its passages and been counted as a near-total miss.
     *
     * So terms at or below the page size are reported on their own, which is the
     * question a reader is actually asking — I type this word, are its passages in
     * front of me — and the rest is reported separately as reach rather than recall.
     */
    let withinHits = 0;
    let withinTotal = 0;
    let beyondHits = 0;
    let beyondTotal = 0;
    let conceptHits = 0;
    let conceptDenominator = 0;
    let conceptWithinHits = 0;
    let conceptWithinTotal = 0;
    let conceptBeyondHits = 0;
    let conceptBeyondTotal = 0;
    const detail: string[] = [];

    for (const [term, truth] of sample) {
      const result = await searchPassages({
        query: term,
        limit: TOP_K,
        offset: 0,
        includeScores: false,
        semantic: false,
        // Theme widening is off so the term is measured on its own. A query that
        // silently borrows a theme's vocabulary would be a different measurement,
        // and this one is asking whether the word itself is findable.
        expand: false,
        filters: { texts: [corpus.textId] },
      });
      const returned = new Set(result.results.map((r) => r.passage.passageKey));
      const found = [...truth].filter((key) => returned.has(key)).length;
      hits += found;
      denominator += truth.size;
      if (truth.size <= TOP_K) {
        withinHits += found;
        withinTotal += truth.size;
      } else {
        beyondHits += found;
        beyondTotal += truth.size;
      }

      // The concept score: every passage holding any form of this word, whether or
      // not it holds the exact string. Non-Greek terms have no stemmer and their
      // concept set is the surface set, so they report the same number twice — which
      // is the honest result, not a missing column.
      const concept = /\p{Script=Greek}/u.test(fold(term))
        ? (stemIndex.get(stemGreek(fold(term))) ?? new Set<string>())
        : truth;
      const conceptFound = [...concept].filter((key) => returned.has(key)).length;
      conceptHits += conceptFound;
      conceptDenominator += concept.size;
      if (concept.size <= TOP_K) {
        conceptWithinHits += conceptFound;
        conceptWithinTotal += concept.size;
      } else {
        conceptBeyondHits += conceptFound;
        conceptBeyondTotal += concept.size;
      }

      detail.push(
        `      ${term.padEnd(14)} ${String(found).padStart(3)}/${String(truth.size).padEnd(4)}` +
          (truth.size > TOP_K ? '  (page too small to hold them all)' : '') +
          (concept.size !== truth.size
            ? `   concept ${String(conceptFound).padStart(3)}/${String(concept.size).padEnd(4)}`
            : '')
      );
    }

    const recall = denominator > 0 ? hits / denominator : 0;
    const within = withinTotal > 0 ? withinHits / withinTotal : 0;
    const conceptWithin = conceptWithinTotal > 0 ? conceptWithinHits / conceptWithinTotal : 0;
    totals.push({ label: corpus.label, hits, of: denominator, recall });
    console.log(`\n  ${corpus.label} — ${sample.length} terms, ${hits}/${denominator} passages (${(recall * 100).toFixed(0)}% overall)`);
    console.log(`    surface, within one page: ${withinHits}/${withinTotal} (${(within * 100).toFixed(0)}%)`);
    console.log(`    concept, within one page: ${conceptWithinHits}/${conceptWithinTotal} (${(conceptWithin * 100).toFixed(0)}%)`);
    console.log(`    surface, beyond one page: ${beyondHits}/${beyondTotal}, capped by the ${TOP_K}-result limit`);
    console.log(`    concept, beyond one page: ${conceptBeyondHits}/${conceptBeyondTotal}`);
    console.log(detail.join('\n'));
  }

  console.log(`\n--- summary ---`);
  for (const t of totals) {
    const bar = '#'.repeat(Math.round(t.recall * 20)).padEnd(20, '.');
    console.log(`  ${t.label.padEnd(20)} ${bar} ${(t.recall * 100).toFixed(0)}%`);
  }

  const byLanguage = new Map<string, number[]>();
  for (const t of totals) {
    const lang = t.label.startsWith('Arabic') ? 'Arabic' : t.label.startsWith('Hebrew') ? 'Hebrew' : t.label.startsWith('Greek') ? 'Greek' : 'Aramaic';
    byLanguage.set(lang, [...(byLanguage.get(lang) ?? []), t.recall]);
  }
  console.log('\n  by language:');
  for (const [lang, values] of byLanguage) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    console.log(`    ${lang.padEnd(8)} ${(mean * 100).toFixed(0)}%  (${values.length} corpora)`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
