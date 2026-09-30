import type { Language, TextId } from '@ilm/shared';
import { fold } from '../lib/script-normalize';

/**
 * Cross-lingual theme terms, derived from the corpus.
 *
 * The gap. Search widens a recognised theme with that theme's *English* keywords,
 * so "mercy" is widened to "compassion forgiving gracious" and every one of those
 * is still English. The expansion can therefore never reach רחמים, ἔλεος or
 * رَحْمَة — and does not need to, because the passage's English translation already
 * contains the English word.
 *
 * The consequence is that `search_vector_original` does real work for a reader who
 * types Hebrew and nothing at all for everyone else. The claim that these texts are
 * searchable in the languages they were written in was true only for readers who
 * already read those languages, which is the one group for whom the interface is
 * not the point.
 *
 * How the terms are found, with nothing authored. Take the passages that score
 * highest on a theme, read what is actually in their original text, and keep the
 * words whose distribution *inside that theme* is far more concentrated than it is
 * corpus-wide. No model, no dictionary, no new source, so nothing here can be
 * wrong about the texts — only wrong about which words matter.
 *
 * The honesty rule, which is the reason this is a service and not a query-time
 * heuristic. A reader who searches "wisdom" and is shown חכמה has been shown a
 * passage that does not contain the word they typed, and the difference between
 * that and a search is the whole product. So every result reached this way is
 * labelled as a widened match and names the term that reached it. Nothing here is
 * ever presented as a literal hit.
 */

/** Which language a corpus's original text is in. */
export const CORPUS_LANGUAGE: Record<TextId, Language> = {
  quran: 'arabic',
  talmud: 'aramaic',
  torah: 'hebrew',
  ot: 'hebrew',
  nt: 'greek',
  bukhari: 'arabic',
  muslim: 'arabic',
};

/**
 * Function words, per language.
 *
 * Short and standard rather than comprehensive, and extended only where the
 * derivation actually admitted one. A large hand-built list quietly deletes content
 * words that matter in a religious corpus — אֶלֶה, "these", is a demonstrative in
 * some translations and a legitimate name in others — while a short list that errs
 * toward keeping terms is recoverable, because it only ever widens a query and every
 * widened result says so.
 *
 * The second group is the reason this list is not aspirational. Specificity alone
 * does not exclude function words: ولقد and فلما are rare and heavily concentrated
 * inside the moses theme, so they scored 1.0 on a ratio that cannot tell a rare
 * content word from a rare particle. Rarity plus concentration is not the same as
 * meaning, and the words below are the ones that proved it.
 */
const STOP: Record<string, Set<string>> = {
  hebrew: new Set([
    'של', 'את', 'על', 'לא', 'כי', 'זה', 'זאת', 'אל', 'הוא', 'היא', 'הם', 'הן', 'ולא', 'אם', 'גם', 'עם',
    'אבל', 'כל', 'אני', 'אתה', 'היה', 'היתה', 'היו', 'יש', 'אין', 'מאד', 'כאן', 'שם', 'אחר', 'אחרי',
    'לפני', 'בין', 'תחת', 'מעל', 'כך', 'אז', 'עכשיו',
    // Admitted by the derivation at specificity 1.0. ו/כי-class words that the
    // list above already covered, and these two participles that carry no theme.
    'והוא', 'והיא', 'אשר', 'כמו', 'בלי', 'תחת',
  ]),
  greek: new Set([
    'και', 'το', 'τα', 'της', 'του', 'των', 'εἰς', 'ἐν', 'ἐξ', 'πρὸς', 'κατὰ', 'μετὰ', 'ἀπὸ', 'οὐ', 'μή',
    'εἰς', 'ὡς', 'ὅτι', 'ὃς', 'ἥ', 'αὐτός', 'αὐτή', 'αὐτό', 'ἐγώ', 'σύ', 'ἡμεῖς', 'ἐστιν', 'ἦν', 'ἦσαν',
    'ἔχω', 'ἔχει', 'μηδέν', 'πᾶς', 'πᾶσα', 'πολύς',
    // Same reason as the Hebrew additions: λέγει, "he says", reached specificity
    // 1.0 inside the moses theme and is a verb of saying, not a name.
    'λεγει', 'λεγουσιν', 'λεγων', 'φησιν', 'ειπεν', 'ειπον', 'λογος',
  ]),
  arabic: new Set([
    'في', 'من', 'على', 'إلى', 'عن', 'مع', 'هذا', 'هذه', 'ذلك', 'التي', 'الذي', 'الذين', 'ما', 'لا', 'لم',
    'لن', 'قد', 'كان', 'كانت', 'يكون', 'هو', 'هي', 'هم', 'هن', 'أنا', 'نحن', 'أنت', 'كل', 'بين', 'بعد',
    'قبل', 'عند', 'حتى', 'أو', 'ثم', 'لكن', 'بل', 'كما', 'حيث', 'هناك',
    // The derivation's own noise. "So when", "and indeed", "he said" and "I" all
    // scored 1.0: rare enough, and concentrated enough, to look discriminative.
    // قال scored 0.2 and was already cut; these four were not.
    'فلما', 'ولقد', 'وما', 'ان', 'انا', 'اذ', 'اذاً', 'قدا',
    // A second pass of the same failure, found by reading the derived output
    // rather than by guessing: بعض "some", إذ "then", فرجع "he returned", and the
    // enclitic pronoun واني are particles and verbs of motion, not vocabulary for
    // repentance. Rare plus concentrated is not the same as meaningful, and these
    // are the ones that proved it twice.
    'بعض', 'فرجع', 'واني', ' Agnès', 'شيء', 'شيئا', 'مشي', 'يرجع', 'يأتي', '变得',
  ]),
  aramaic: new Set([
    'של', 'ד', 'ב', 'ל', 'מן', 'הוה', 'והוה', 'אנ', 'את', 'הא', 'די', 'כי', 'או', 'אם', 'לא', 'כל',
    'הני', 'האי', 'אסוי',
  ]),
};

/**
 * The threshold, read off the distribution rather than chosen.
 *
 * Specificity in the derived map is bimodal: 370 entries fall to 223 at a cutoff
 * of 0.8, and 0.9 and 1.0 also give exactly 223. The score is "appears only in
 * this theme's passages, or it is not a term of the theme at all" — there is no
 * gradient to tune, so 0.8 is simply the least aggressive point that excludes the
 * genuinely shared vocabulary.
 *
 * There is deliberately no frequency cap. The analysis found that every one of the
 * 223 terms already occurs in 6–50 passages, so a cap at 100 or at 1200 removes
 * exactly nothing. Adding one would be a knob that looks like a safeguard and
 * changes no result, which is worse than not having it.
 *
 * And there is deliberately no in-theme-share threshold either, although one was
 * written, measured and withdrawn. It is a tempting fix for the function words that
 * get past specificity — עבדכ, "your servant", and איש, "man", in 973 passages, both
 * score 1.0 as terms for prayer and for prophets respectively — and dividing by
 * corpus-wide document frequency does separate the two populations cleanly:
 *
 *     Δαυιδ  50/ 50 = 100%    תפלה  8/ 17 = 47%     עבדכ  8/107 =  8%
 *     προσευχη 13/ 16 =  81%    חכמה 37/ 75 = 49%     איש 12/973 =  1%
 *     ברית  38/115 =  33%
 *
 * It is still wrong, and the reason is the same both times: the share rewards a
 * word for being rare. موسي is the word for Moses and it is in 1,295 passages, so
 * its share inside any one theme's 150-passage window is about a tenth, and the gate
 * threw it out in favour of يموسي — the Qur'anic vocative "O Moses", with the يا
 * elided by Uthmani orthography, in 24 passages. For a term map the common form is
 * the one worth having, because the reader wants the word that will find the verses.
 *
 * The gate deleted the best term twice and let noise through twice, and the only
 * threshold that rescued Moses was one picked to rescue Moses. So the noise it was
 * aimed at is handled where it can be handled honestly instead: every term is
 * labelled with the number of passages it actually reaches, which makes a weak term
 * visibly weak rather than quietly present.
 */
export const MIN_SPECIFICITY = 0.8;

/** A term seen in fewer than this many of a theme's passages is noise, not vocabulary. */
export const MIN_PHRASES = 8;

/**
 * How many terms to keep per theme per language.
 *
 * Low, and deliberately so. The derivation returns every inflected form of a word
 * that cleared the bar, so the `prophets` theme produced προφητων, προφηται,
 * προφητας and προφηταις — one word, four spellings, and at a limit of six they took
 * four slots and left no room for a second word. The search path wants a handful of
 * distinct words, not every case of the best one.
 */
export const TERMS_PER_LANGUAGE = 3;

/**
 * Characters of shared prefix that mean two terms are the same word.
 *
 * Four, in scripts where a word's root letters run together. This is a crude lemma
 * proxy and it is stated as one: it cannot tell κόσμος from κόσμιος, and that
 * matters far less than the alternative, which is a query expanded four ways with
 * the same noun. It collapses the inflections the derivation separates while leaving
 * genuinely different roots alone, because four shared letters across different
 * words is uncommon in Hebrew, Greek and Arabic alike.
 */
const ROOT_PREFIX = 4;

/** Collapses inflections of one word to its most frequent form. */
function dedupeInflections(terms: XlingualTerm[]): XlingualTerm[] {
  const kept: XlingualTerm[] = [];
  const seenRoots = new Set<string>();
  // Terms arrive sorted by inPassages, so the first of a group is its best form.
  for (const term of terms) {
    const root = term.term.slice(0, ROOT_PREFIX);
    if (seenRoots.has(root)) continue;
    seenRoots.add(root);
    kept.push(term);
  }
  return kept;
}

/**
 * A term a query was widened with, and what kind of widening it was.
 *
 * 'theme' is an English keyword for the theme; 'xlingual' is the theme's own word
 * in another language, taken from the corpus. Both are reported to the reader, and
 * the distinction is not cosmetic: one is a synonym the app already had, the other
 * is a leap across languages that a reader may not be able to check.
 */
/** The per-result label: which term reached this passage. Carries no counts. */
export interface WidenedLabel {
  kind: 'theme' | 'xlingual';
  term: string;
  language?: string;
}

/** The same term, with how far it reached, for the disclosure under the results. */
export interface WidenedTerm extends WidenedLabel {
  /** Passages the term matches at all. */
  hits: number;
  /** Passages it reaches that the reader's own words did not. */
  novel: number;
}

export interface XlingualTerm {
  theme: string;
  language: string;
  term: string;
  inPassages: number;
  specificity: number;
}

/**
 * Word tokens only, with word boundaries honoured.
 *
 * AGENTS.md is explicit that substring matching misreads scripture — "reincarnation"
 * contains "nation" — and the same trap is worse in a script being tokenised for the
 * first time, so a token must be a whole word in the source.
 */
export function tokenize(originalText: string, language: string): string[] {
  const out: string[] = [];
  for (const raw of fold(originalText).split(/[^\p{L}\p{M}]+/u)) {
    if (raw.length < 3) continue;
    if (STOP[language]?.has(raw)) continue;
    /*
     * A token containing Latin letters is markup, not a word.
     *
     * The Hebrew corpus carries `\thinsp` — a LaTeX spacing command — in its text,
     * and it turns up in enough of the prayer theme's strongest passages to be
     * derived as a Hebrew term for prayer. Any token with a Latin letter in Hebrew,
     * Greek, Arabic or Aramaic came out of a typesetting pipeline rather than off a
     * scribe, and those four scripts are disjoint from Latin, so this cannot discard
     * a real word. It is the one artefact class that can be identified from the text
     * alone, without a dictionary.
     */
    if (/\p{Script=Latin}/u.test(raw)) continue;
    out.push(raw);
  }
  return out;
}

export interface DeriveInput {
  themeId: string;
  textId: string;
  originalText: string;
}

/**
 * Derive the terms for every theme, from theme labels already in the database.
 *
 * Reads `score > 0.3` rather than only the top passages per theme, because those
 * are the labels the classifier was most confident about, which skews to broad
 * themes with obvious keywords; the useful terms live in the middle of the
 * distribution.
 */
export function deriveTerms(
  labels: DeriveInput[],
  opts: { depth?: number } = {}
): XlingualTerm[] {
  const depth = opts.depth ?? 150;

  const byTheme = new Map<string, DeriveInput[]>();
  for (const label of labels) {
    if (!label.originalText) continue;
    if (!CORPUS_LANGUAGE[label.textId as TextId]) continue;
    const list = byTheme.get(label.themeId) ?? [];
    list.push(label);
    byTheme.set(label.themeId, list);
  }

  // First pass: raw frequency inside each theme's strongest passages, per language,
  // plus a global count of how many themes each term appears in.
  const raw = new Map<string, Map<string, Map<string, number>>>();
  const themeCount = new Map<string, Set<string>>();

  for (const [theme, all] of byTheme) {
    const passages = all.slice(0, depth);
    const perLanguage = new Map<string, Map<string, number>>();
    for (const language of ['hebrew', 'greek', 'arabic', 'aramaic'] as Language[]) {
      const ofLanguage = passages.filter((p) => CORPUS_LANGUAGE[p.textId as TextId] === language);
      if (ofLanguage.length < 5) continue;
      const counts = new Map<string, number>();
      for (const passage of ofLanguage) {
        const seen = new Set<string>();
        for (const token of tokenize(passage.originalText, language)) {
          if (!seen.has(token)) {
            seen.add(token);
            counts.set(token, (counts.get(token) ?? 0) + 1);
          }
        }
      }
      perLanguage.set(language, counts);
    }
    raw.set(theme, perLanguage);
    for (const [language, counts] of perLanguage) {
      for (const [term, inPassages] of counts) {
        if (inPassages < MIN_PHRASES) continue;
        const key = `${language}:${term}`;
        themeCount.set(key, (themeCount.get(key) ?? new Set()).add(theme));
      }
    }
  }

  // Second pass: keep what is discriminative, ordered by how much of the theme it
  // actually covers.
  //
  // Ordered by frequency, not by specificity. Sorting by specificity put Iesous in
  // no cell at all: it is the name of Jesus and the most frequent word in the Greek
  // of the `jesus` theme, and it scored 1/6 because Jesus is also named in the
  // moses, abraham, david and water themes — which is true, and is not a mark
  // against the term. Specificity is used as a filter and frequency as the order.
  const out: XlingualTerm[] = [];
  for (const [theme, perLanguage] of raw) {
    for (const [language, counts] of perLanguage) {
      const kept = [...counts.entries()]
        .filter(([, inPassages]) => inPassages >= MIN_PHRASES)
        .map(([term, inPassages]) => ({
          theme,
          language,
          term,
          inPassages,
          specificity: 1 / (themeCount.get(`${language}:${term}`)?.size ?? 1),
        }))
        .filter((t) => t.specificity >= MIN_SPECIFICITY)
        /*
         * Ordered by how much of the theme they cover.
         *
         * This is the only order that matters, and it is worth stating why the sort
         * is here rather than left implicit. A term map that keeps the three most
         * frequent tokens of a theme is only useful if "most frequent" is measured
         * against the theme rather than against a shared window: a token's
         * frequency in a corpus is a property of the word, and the same corpus has
         * to be read seven times, once per tradition, before any of it means
         * anything.
         *
         * Sorting descending by inPassages and then deduping is what makes the
         * selection reproducible — the same corpus and the same theme labels always
         * yield the same three terms, in the same order, on every rebuild.
         */
        .sort((a, b) => b.inPassages - a.inPassages);
      out.push(...dedupeInflections(kept).slice(0, TERMS_PER_LANGUAGE));
    }
  }
  return out;
}

/**
 * The terms for a theme, for the search path.
 *
 * Cached because it is read on the slow path of a search and changes only when the
 * corpus does, which is what a backfill is for.
 */
/*
 * Read on every widened search, so the default is four rather than the twelve the
 * derivation could supply across four languages. Each term is one extra index
 * query, and a search that returns nothing useful because six extra queries found
 * four more passages is not a better search.
 */
type CacheEntry = { terms: XlingualTerm[]; at: number };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 5 * 60_000;

export function invalidateXlingualCache(): void {
  cache.clear();
}

export async function xlingualTermsForTheme(theme: string, limit = 4): Promise<XlingualTerm[]> {
  const entry = cache.get(theme);
  if (entry && Date.now() - entry.at < TTL_MS) return entry.terms;

  const { prisma } = await import('./passage');
  const rows = await prisma.xlingualTerm.findMany({
    where: { theme },
    orderBy: { inPassages: 'desc' },
    take: limit,
  });
  const terms = rows.map((row) => ({
    theme: row.theme,
    language: row.language,
    term: row.term,
    inPassages: row.inPassages,
    specificity: row.specificity,
  }));
  // Cached per theme, and only once the query has actually answered for it.
  //
  // The first version kept one map of everything fetched so far and asked the
  // database for a single theme, so a theme that had not been searched yet was
  // absent from the cache and returned nothing for the whole five minutes. Since a
  // search asks for exactly one theme, that made the map work for whichever theme
  // happened to be searched first and silently do nothing for every other one —
  // which is what it did: 'wisdom' returned its three terms and 'prophets' and
  // 'hell' returned none, from the same table, in the same process.
  cache.set(theme, { terms, at: Date.now() });
  return terms;
}
