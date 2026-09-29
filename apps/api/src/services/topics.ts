/**
 * Curated topics for the quick links.
 *
 * The themes table already holds 79 tags, and they are a machine artefact: they
 * include `wisdom`, `righteousness` and `sacrifice`, which are legible to the
 * classifier and would be a strange thing to hand a reader as a front door. A
 * topic here is a thing a person arrives looking for.
 *
 * The distinction from a theme is the facets. "Marriage" is a theme, and so is
 * "family" — but the question that brought the reader to the app is usually
 * narrower than either: the role of a spouse, a contract, an inheritance. A
 * facet is that narrower question, expressed as a search phrase scoped to a
 * theme, so clicking one runs a real query and returns passages with real scores.
 * There is no generated text anywhere in this file, or in what it produces.
 *
 * Queries are English because the search index is English: `search_vector` is
 * built with the 'english' configuration over the primary translation, so an
 * Arabic or Hebrew phrase matches nothing. Facet *labels* are translated in the
 * web catalogs; the phrases they run are not, and pretending otherwise would
 * produce confident, empty result sets.
 */

import { prisma } from './passage';
import type { TextId } from '@ilm/shared';

export interface TopicFacet {
  /** Stable key. The web catalog keys its translations off this. */
  id: string;
  /**
   * The phrase to search for, in the English translation. See the note above on
   * why this is not localised.
   */
  query: string;
  /** Themes to restrict the search to, so the facet stays inside its topic. */
  themes: string[];
}

export interface TopicDefinition {
  slug: string;
  /** The theme the topic's passage groups come from. */
  theme: string;
  facets: TopicFacet[];
}

export interface Topic extends TopicDefinition {
  passages: number;
  books: number;
  corpora: TextId[];
}

/**
 * A topic below these is not a dead end worth offering.
 *
 * `pilgrimage` has 29 passages across 18 books, `eternal_life` 41 across two
 * corpora, and `generosity` 8 across three. A quick link is a promise that
 * clicking it shows something, and a reader who clicks one and gets a handful of
 * near-random verses has been told the corpus is thin on a subject it is not.
 * The wealth topic therefore rides on `charity` and `almsgiving`, not on
 * `generosity`.
 */
export const MIN_PASSAGES = 150;
export const MIN_CORPORA = 4;

/**
 * Every query below was measured against the corpus before being written down.
 *
 * The first pass of this file scoped each facet to its topic's theme, on the
 * reasoning that it would keep a facet inside its topic. That was wrong: the
 * theme classifier is keyword-based with low recall, so `query AND theme` is a
 * conjunction of two thin sets. "the stranger" scoped to the neighbour theme
 * returned 0 passages and unscoped returned 129; "judgment" scoped to afterlife
 * returned 2 and unscoped returned 146. Scoping is gone, and each query here is
 * one that measurably returns something — the smallest is 20.
 */
const facet = (id: string, query: string): TopicFacet => ({ id, query, themes: [] });

export const TOPICS: TopicDefinition[] = [
  {
    slug: 'marriage',
    theme: 'marriage',
    facets: [
      facet('spouse', 'wife'),
      facet('fidelity', 'adultery'),
      facet('covenant', 'covenant'),
      facet('divorce', 'divorce'),
    ],
  },
  {
    slug: 'children',
    theme: 'parenthood',
    facets: [
      facet('parents', 'thy father'),
      facet('discipline', 'rebuke'),
      facet('inheritance', 'inheritance'),
      facet('orphans', 'orphan'),
    ],
  },
  {
    slug: 'family',
    theme: 'family',
    facets: [
      facet('kin', 'brother'),
      facet('household', 'household'),
      facet('mothers', 'thy mother'),
      facet('servants', 'servant'),
    ],
  },
  {
    slug: 'neighbour',
    theme: 'neighbor',
    facets: [
      facet('neighbour', 'neighbour'),
      facet('stranger', 'stranger'),
      facet('enemy', 'enemy'),
      facet('the_meek', 'meek'),
    ],
  },
  {
    slug: 'the_vulnerable',
    theme: 'poor',
    facets: [
      facet('poor', 'the poor'),
      facet('widows', 'widow'),
      facet('fatherless', 'fatherless'),
      facet('debt', 'debtor'),
    ],
  },
  {
    slug: 'giving',
    theme: 'charity',
    facets: [
      facet('giving', 'give'),
      facet('abundance', 'abundance'),
      facet('needy', 'the needy'),
      facet('lending', 'usury'),
    ],
  },
  {
    slug: 'truth',
    theme: 'honesty',
    facets: [
      facet('false_witness', 'false witness'),
      facet('oaths', 'oath'),
      facet('speech', 'tongue'),
      facet('lying', 'liar'),
    ],
  },
  {
    slug: 'anger',
    theme: 'patience',
    facets: [
      facet('patience', 'patience'),
      facet('wrath', 'wrath'),
      facet('forgiveness', 'forgive'),
      facet('enduring', 'enduring'),
    ],
  },
  {
    slug: 'prayer',
    theme: 'prayer',
    facets: [
      facet('prayer', 'prayer'),
      facet('fasting', 'fast'),
      facet('sabbath', 'sabbath'),
      facet('worship', 'worship'),
    ],
  },
  {
    slug: 'creation',
    theme: 'creation',
    facets: [
      facet('created', 'created'),
      facet('animals', 'beast'),
      facet('water', 'the waters'),
      facet('harvest', 'harvest'),
    ],
  },
  {
    slug: 'law',
    theme: 'commandment',
    facets: [
      facet('commandments', 'commandment'),
      facet('covenant', 'covenant'),
      facet('obedience', 'hearken'),
      facet('the_land', 'the land'),
    ],
  },
  {
    slug: 'death',
    theme: 'afterlife',
    facets: [
      facet('dying', 'death'),
      facet('judgment', 'judgment'),
      facet('resurrection', 'resurrection'),
      facet('the_dead', 'the dead'),
    ],
  },
];

/**
 * Coverage for every curated topic, in one query.
 *
 * Grouping by theme in SQL rather than one call per topic: twelve round trips to
 * render a list of links is the kind of cost that hides until a free database
 * tier starts refusing connections.
 */
export async function getTopics(): Promise<Topic[]> {
  const rows = await prisma.passageTheme.groupBy({
    by: ['themeId'],
    where: { themeId: { in: [...new Set(TOPICS.map((t) => t.theme))] } },
    _count: { _all: true },
  });
  if (rows.length === 0) return [];

  const coverage = await prisma.$queryRaw<Array<{ themeId: string; corpora: string[]; books: bigint }>>`
    SELECT pt.theme_id AS "themeId",
           array_agg(DISTINCT p.text_id) AS corpora,
           count(DISTINCT p.text_id || ':' || p.book_slug)::bigint AS books
    FROM passage_themes pt
    JOIN passages p ON p.id = pt.passage_id
    WHERE pt.theme_id = ANY(${[...new Set(TOPICS.map((t) => t.theme))]}::text[])
    GROUP BY pt.theme_id
  `;

  const byTheme = new Map(coverage.map((row) => [row.themeId, row]));
  const countByTheme = new Map(rows.map((row) => [row.themeId, row._count._all]));

  return TOPICS.flatMap((topic) => {
    const passages = countByTheme.get(topic.theme) ?? 0;
    const detail = byTheme.get(topic.theme);
    const corpora = (detail?.corpora ?? []) as TextId[];

    if (passages < MIN_PASSAGES || corpora.length < MIN_CORPORA) return [];

    return [
      {
        ...topic,
        passages,
        corpora,
        books: Number(detail?.books ?? 0),
      },
    ];
  });
}
