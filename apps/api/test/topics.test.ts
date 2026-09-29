import { describe, it, expect } from 'vitest';
import { TOPICS } from '../src/services/topics';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The curated topic list.
 *
 * Every assertion here is about a mistake that was actually made and then caught
 * by measuring against the corpus, not about a hypothetical. The registry is
 * hand-written data, which means the failure mode is a plausible-looking entry
 * that quietly returns nothing — and nothing in a unit test would notice, because
 * the counts live in the database.
 */

const api = readFileSync(join(__dirname, '../src/services/topics.ts'), 'utf8');
const route = readFileSync(join(__dirname, '../src/routes/api.ts'), 'utf8');
const catalogs = ['en', 'ar', 'he'].map((loc) => ({
  loc,
  data: JSON.parse(readFileSync(join(__dirname, `../../web/messages/${loc}.json`), 'utf8')),
}));

/*
 * Coverage and existence are checked against the database, not here: the theme
 * names are emitted by Jev as well as by the local classifier, so THEME_KEYWORDS
 * is not the universe of valid themes — `parenthood` is in the corpus and in
 * neither that list nor anywhere in the source. `npm run validate-topics` is the
 * check that can see the corpus.
 */
describe('curated topics', () => {
  it('keeps slugs and facet ids in a URL-safe shape', () => {
    // They end up in the path and in the message keys, so a space or a slash
    // breaks the route and a dot breaks a nested translation lookup.
    for (const topic of TOPICS) {
      expect(topic.slug, `${topic.slug} is not a safe slug`).toMatch(/^[a-z][a-z0-9_]*$/);
      for (const facet of topic.facets) {
        expect(facet.id, `${topic.slug}.${facet.id} is not a safe id`).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    }
  });

  it('gives every topic a non-empty query for each facet', () => {
    // An empty phrase would search the whole corpus and present itself as a
    // narrow question.
    for (const topic of TOPICS) {
      for (const facet of topic.facets) {
        expect(facet.query.trim().length, `${topic.slug}.${facet.id} has no query`).toBeGreaterThan(0);
      }
    }
  });

  it('scopes no facet to a theme', () => {
    // Every facet in the first draft carried a theme scope, on the reasoning that
    // it would keep a facet inside its topic. Measured, that was the wrong
    // instinct: the classifier is keyword-based with low recall, so `query AND
    // theme` intersects two thin sets. "the stranger" scoped to the neighbour
    // theme returned 0 passages; unscoped, 129. "judgment" scoped to afterlife
    // returned 2; unscoped, 146.
    expect(TOPICS.flatMap((t) => t.facets).every((f) => f.themes.length === 0)).toBe(true);
  });

  it('gives every topic a distinct slug', () => {
    const slugs = TOPICS.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('keeps facet ids unique within a topic', () => {
    // They key the translations, so a duplicate silently drops a label.
    for (const topic of TOPICS) {
      const ids = topic.facets.map((f) => f.id);
      expect(new Set(ids).size, `duplicate facet in ${topic.slug}`).toBe(ids.length);
    }
  });

  it('has a translation for every topic and facet, in every catalog', () => {
    // next-intl falls back to English on a missing key, so an untranslated facet
    // renders as an empty chip rather than failing — which is exactly why it has
    // to be checked here.
    for (const { loc, data } of catalogs) {
      for (const topic of TOPICS) {
        const item = data.topics?.items?.[topic.slug];
        expect(item, `${loc} is missing topic ${topic.slug}`).toBeDefined();
        expect(item.label.length, `${loc}/${topic.slug} has no label`).toBeGreaterThan(0);
        for (const facet of topic.facets) {
          const label = item.facets?.[facet.id];
          expect(label, `${loc} is missing ${topic.slug}.${facet.id}`).toBeDefined();
          expect(label.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('has no catalog keys for topics that no longer exist', () => {
    // The other direction: a stale key is dead weight that looks maintained.
    const slugs = new Set(TOPICS.map((t) => t.slug));
    for (const { loc, data } of catalogs) {
      for (const slug of Object.keys(data.topics?.items ?? {})) {
        expect(slugs.has(slug), `${loc} has a catalog entry for unknown topic ${slug}`).toBe(true);
      }
    }
  });

  it('filters on a coverage floor rather than serving a thin topic', () => {
    // pilgrimage has 29 passages, eternal_life 41, generosity 8. A quick link is
    // a promise that clicking it shows something.
    expect(api).toContain('MIN_PASSAGES');
    expect(api).toContain('MIN_CORPORA');
    expect(api).toContain('if (passages < MIN_PASSAGES || corpora.length < MIN_CORPORA) return [];');
  });

  it('does not offer a topic whose own theme is below the floor', () => {
    // The wealth topic rides on `charity`, not `generosity` — 8 passages.
    const giving = TOPICS.find((t) => t.slug === 'giving');
    expect(giving?.theme).toBe('charity');
  });

  it('measures coverage per request instead of storing it', () => {
    // A stored count goes stale the moment the corpus changes, and it is on a
    // link the reader is about to trust.
    expect(api).not.toMatch(/passages:\s*\d/);
    expect(route).toContain("app.get('/api/topics'");
  });

  it('gathers coverage in one query, not one per topic', () => {
    expect(api.match(/prisma\.\$?(queryRaw|passageTheme)/g)?.length).toBeLessThanOrEqual(3);
  });
});
