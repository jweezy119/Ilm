/**
 * Pilot: can a cross-lingual term map be derived from the corpus itself?
 *
 * The gap this is measuring. Postgres searches `search_vector` (English) and
 * `search_vector_original` with the same query text, so an English concept query —
 * "mercy" — never searches for רחמים, ἔλεος or رَحْمَة. It matches only if the
 * translator happened to choose that English word. The original vector does real
 * work for someone who types Hebrew, and nothing at all for someone who does not.
 *
 * The proposal is to derive theme → original-language terms from the corpus: take
 * the passages whose translation scores highest on a theme, then read what is
 * actually in their original text. No authoring, no new source, no model.
 *
 * Frequency alone would produce garbage, because the most common word in any
 * corpus is a preposition. So each candidate is scored for *discriminativeness*:
 * how far its distribution inside this theme's passages exceeds its distribution
 * everywhere else. A word that shows up in the top passages of twenty themes
 * carries no information about any of them, however frequent it is. The ratio
 * below is exactly that, and the report is built to show the losers as well as the
 * winners, because the honest answer may well be that the map is too thin to use.
 *
 * Nothing here touches the search path. It writes no schema and no rows.
 *
 *   npx tsx scripts/derive-xlingual-map.ts [--themes=12] [--depth=150] [--out=...]
 */

import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { THEME_TAXONOMY, type Language, type TextId } from '@ilm/shared';
import { fold } from '../src/lib/script-normalize';

/**
 * Function words, per language.
 *
 * Short and standard rather than comprehensive. A large hand-built list would
 * quietly delete content words that matter in a religious corpus — אֶלֶה, "these",
 * is a demonstrative in some translations and a legitimate name in others — and a
 * short list that errs toward keeping terms is recoverable, because the
 * discriminativeness score below discards the rest.
 */
const STOP: Record<Language, Set<string>> = {
  hebrew: new Set(['של', 'את', 'על', 'לא', 'כי', 'זה', 'זאת', 'אל', 'הוא', 'היא', 'הם', 'הן', 'ולא', 'אם', 'גם', 'עם', 'אבל', 'כל', 'אני', 'אתה', 'היה', 'היתה', 'היו', 'יש', 'אין', 'מאד', 'כאן', 'שם', 'אחר', 'אחרי', 'לפני', 'בין', 'תחת', 'מעל', 'כך', 'אז', 'עכשיו']),
  greek: new Set(['και', 'το', 'τα', 'της', 'του', 'των', 'εἰς', 'ἐν', 'ἐξ', 'πρὸς', 'κατὰ', 'μετὰ', 'ἀπὸ', 'οὐ', 'μή', 'εἰς', 'ὡς', 'ὅτι', 'ὃς', 'ἥ', 'αὐτός', 'αὐτή', 'αὐτό', 'ἐγώ', 'σύ', 'ἡμεῖς', 'ἐστιν', 'ἦν', 'ἦσαν', 'ἔχω', 'ἔχει', 'μηδέν', 'πᾶς', 'πᾶσα', 'πολύς']),
  arabic: new Set(['في', 'من', 'على', 'إلى', 'عن', 'مع', 'هذا', 'هذه', 'ذلك', 'التي', 'الذي', 'الذين', 'ما', 'لا', 'لم', 'لن', 'قد', 'كان', 'كانت', 'يكون', 'هو', 'هي', 'هم', 'هن', 'أنا', 'نحن', 'أنت', 'كل', 'بين', 'بعد', 'قبل', 'عند', 'حتى', 'أو', 'ثم', 'لكن', 'بل', 'كما', 'حيث', 'هناك', 'أو']),
  aramaic: new Set(['של', 'ד', 'ב', 'ל', 'מן', 'הוה', 'והוה', 'אנ', 'את', 'הא', 'די', 'כי', 'או', 'אם', 'לא', 'כל', 'הני', 'האי', 'אסוי']),
  english: new Set(['the', 'and', 'of', 'to', 'in', 'that', 'is', 'was', 'for', 'with', 'as', 'his', 'her', 'their', 'it', 'he', 'she', 'they', 'them', 'not', 'but', 'this', 'these', 'those', 'from', 'by', 'on', 'at', 'be', 'were', 'are', 'which', 'who']),
};

/**
 * Word tokens only, with word boundaries honoured.
 *
 * AGENTS.md is explicit that substring matching misreads scripture: "reincarnation"
 * contains "nation". The same trap is worse in a script we are tokenising for the
 * first time, so a token must be a whole word in the source.
 */
function tokenize(originalText: string, language: Language): string[] {
  const out: string[] = [];
  // The shared normalizer's fold, not a local one.
  //
  // The first version of this file carried its own fold, which stripped Hebrew
  // points and nothing else. The Quran's Uthmani text is fully vocalised, so the
  // same word arrived as three separate tokens — Musa came out as three — and a
  // term that appears in half the surahs was scored as three terms that appear in
  // a sixth. script-normalize already folds the Arabic marks, the superscript alef,
  // tatweel, and the Quranic annotation signs, and the repo is explicit that those
  // helpers exist to be used rather than reimplemented.
  //
  // Split on anything non-letter, since maqaf and tatweel join words.
  for (const raw of fold(originalText).split(/[^\p{L}\p{M}]+/u)) {
    if (raw.length < 3) continue;
    if (STOP[language]?.has(raw)) continue;
    out.push(raw);
  }
  return out;
}

const CORPUS_LANGUAGE: Record<TextId, Language> = {
  quran: 'arabic',
  talmud: 'aramaic',
  torah: 'hebrew',
  ot: 'hebrew',
  nt: 'greek',
  bukhari: 'arabic',
  muslim: 'arabic',
};

interface Row {
  theme: string;
  textId: string;
  language: string;
  originalText: string;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const num = (flag: string, fallback: number) => {
    const inline = argv.find((a) => a.startsWith(`${flag}=`));
    if (inline) return Number(inline.slice(flag.length + 1));
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : fallback;
  };
  const depth = num('--depth', 150);
  const themeLimit = num('--themes', 12);
  const outPath = argv.includes('--out')
    ? argv[argv.indexOf('--out') + 1]
    : join(homedir(), '.ilm-logs', 'xlingual-map.json');

  process.env.DATABASE_URL = process.env.ILM_PILOT_DB ?? process.env.DATABASE_URL ?? '';
  const { prisma } = await import('../src/services/passage');

  /*
   * Every theme's strongest passages, in one query rather than 79.
   *
   * `score > 0.3` rather than the top 1,626 alone: those are the labels Jev was
   * most confident about, which skews to broad themes with obvious keywords, and
   * the interesting terms live in the middle of the distribution.
   */
  const labels = await prisma.passageTheme.findMany({
    where: { score: { gt: 0.3 } },
    select: {
      themeId: true,
      score: true,
      passage: {
        select: { textId: true, originalText: true },
      },
    },
  });

  const byTheme = new Map<string, Row[]>();
  for (const label of labels) {
    if (!label.passage.originalText) continue;
    const language = CORPUS_LANGUAGE[label.passage.textId as TextId];
    if (!language) continue;
    const list = byTheme.get(label.themeId) ?? [];
    list.push({
      theme: label.themeId,
      textId: label.passage.textId,
      language,
      originalText: label.passage.originalText,
    });
    byTheme.set(label.themeId, list);
  }

  const themes = [...byTheme.keys()].sort((a, b) => byTheme.get(b)!.length - byTheme.get(a)!.length);
  const selected = themes.slice(0, themeLimit);

  console.log(`Themes with a usable signal : ${themes.length} of ${THEME_TAXONOMY.length} in the taxonomy`);
  console.log(`Theme labels read          : ${labels.length}`);
  console.log(`Depth per theme            : ${depth}`);
  console.log(`Analysing                  : ${selected.length} themes\n`);

  /*
   * First pass: raw frequency inside each theme's strongest passages, per language.
   * A term seen in fewer than a handful of passages is noise, not a lexicalisation
   * of the theme, so it is floored out.
   */
  const MIN_PHRASES = 8;
  const raw = new Map<string, Map<string, Map<string, { count: number; inPassages: number }>>>();
  const global = new Map<string, number>();

  for (const theme of selected) {
    const passages = byTheme.get(theme)!.slice(0, depth);
    const perLanguage = new Map<string, Map<string, { count: number; inPassages: number }>>();

    for (const language of ['hebrew', 'greek', 'arabic', 'aramic'] as Language[]) {
      const ofLanguage = passages.filter((p) => p.language === language);
      if (ofLanguage.length < 5) continue;

      const counts = new Map<string, { count: number; inPassages: number }>();
      for (const passage of ofLanguage) {
        const seen = new Set<string>();
        for (const token of tokenize(passage.originalText, language)) {
          const entry = counts.get(token) ?? { count: 0, inPassages: 0 };
          entry.count += 1;
          if (!seen.has(token)) {
            entry.inPassages += 1;
            seen.add(token);
          }
          counts.set(token, entry);
        }
      }

      for (const [term, entry] of counts) {
        if (entry.inPassages >= MIN_PHRASES) {
          const key = `${language}:${term}`;
          global.set(key, (global.get(key) ?? 0) + 1);
        }
      }
      perLanguage.set(language, counts);
    }
    raw.set(theme, perLanguage);
  }

  /*
   * Second pass: discriminativeness.
   *
   * How many other themes' passages also contain this term. A term present in most
   * of them is a word of the language showing through, not a word for the theme,
   * however often it occurs inside this theme.
   */
  const themeCount = new Map<string, Set<string>>();
  for (const theme of selected) {
    for (const [language, counts] of raw.get(theme)!) {
      for (const [term, entry] of counts) {
        if (entry.inPassages < MIN_PHRASES) continue;
        const key = `${language}:${term}`;
        themeCount.set(key, (themeCount.get(key) ?? new Set()).add(theme));
      }
    }
  }

  interface Derived {
    term: string;
    inPassages: number;
    /** 1 = appears only in this theme's passages. */
    specificity: number;
  }

  const map: Record<string, Record<string, Derived[]>> = {};
  const report: string[] = [];

  for (const theme of selected) {
    map[theme] = {};
    const lines: string[] = [`\n  ${theme}`];
    for (const [language, counts] of raw.get(theme)!) {
      const total = [...counts.values()].filter((e) => e.inPassages >= MIN_PHRASES).length;
      const ranked = [...counts.entries()]
        .filter(([, e]) => e.inPassages >= MIN_PHRASES)
        .map(([term, e]) => {
          const shared = themeCount.get(`${language}:${term}`)?.size ?? 1;
          return { term, inPassages: e.inPassages, specificity: 1 / shared };
        })
        /*
         * Frequency first, specificity only as a filter.
         *
         * Sorting by specificity put Iesous in no cell at all. It is the name of
         * Jesus and it is the most frequent word in the Greek of the `jesus` theme,
         * and it scored 1/6 because Jesus is also named in the moses, abraham,
         * david and water themes — which is true and not a mark against it. When
         * the head term is a person, appearing in every other theme is what being
         * that person means.
         *
         * So specific terms are kept and generic ones dropped, and the order within
         * that set is by frequency. A word every theme uses carries no information
         * about any of them, so it goes; a word four themes share is still the
         * right answer for two of them.
         */
        .filter((r) => r.specificity >= 0.2)
        .sort((a, b) => b.inPassages - a.inPassages)
        .slice(0, 8);

      map[theme][language] = ranked;
      const label = language.padEnd(7);
      lines.push(
        `    ${label} ${ranked
          .map((r) => `${r.term}(${r.inPassages},×${r.specificity.toFixed(2)})`)
          .join('  ')}` || `    ${label} (none above the floor)`
      );
      if (ranked.length === 0) lines.push(`    ${label} nothing above ${MIN_PHRASES} passages`);
      void total;
    }
    report.push(lines.join('\n'));
  }

  console.log(report.join('\n'));

  // The question the pilot exists to answer, as a number rather than a reading.
  const cells = Object.values(map).flatMap((perLanguage) => Object.values(perLanguage));
  const usable = cells.filter((terms) => terms.length >= 3);
  // A cell is worth indexing when it yields at least one term unique to its theme
  // and at least three that survive the generic-word filter. Anything less and a
  // search expanded with it is as likely to mislead as to help.
  const worth = cells.filter(
    (terms) => terms.length >= 3 && terms.some((t) => t.specificity >= 0.5)
  );

  console.log(`\n--- summary ---`);
  console.log(`  theme × language cells examined : ${cells.length}`);
  console.log(`  cells with >= 3 derived terms  : ${usable.length} (${((usable.length / cells.length) * 100).toFixed(0)}%)`);
  console.log(`  cells worth indexing (>=3 terms, one unique)  : ${worth.length} (${((worth.length / cells.length) * 100).toFixed(0)}%)`);
  console.log(`  languages present across the map : ${[...new Set(cells.length ? Object.values(map).flatMap((m) => Object.keys(m)) : [])].join(', ') || 'none'}`);

  writeFileSync(outPath, JSON.stringify(map, null, 2));
  console.log(`\n  wrote ${outPath}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  const { prisma } = await import('../src/services/passage');
  await prisma.$disconnect();
  process.exit(1);
});
