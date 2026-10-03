/**
 * Journey guards.
 *
 * These read the source rather than calling it, for the same reason
 * postgres-search.test.ts does: the failures worth guarding here are invisible to
 * the type checker and only show up as a wrong graph — a themed pair that never
 * gets a line, or an edge the reader cannot tell from their own assertion.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const service = readFileSync(
  resolve(__dirname, '../src/services/journey-graph.ts'),
  'utf8'
);
const schema = readFileSync(
  resolve(__dirname, '../prisma/schema.prisma'),
  'utf8'
);
const migration = readFileSync(
  resolve(__dirname, '../prisma/migrations/12_journeys/migration.sql'),
  'utf8'
);
const routes = readFileSync(resolve(__dirname, '../src/routes/api.ts'), 'utf8');

describe('journeys have no edge table, by design', () => {
  it('does not store user-authored edges', () => {
    /*
     * The whole provenance claim rests on this. An edge the reader asserted would
     * be drawn in the same style as a quotation somebody found in the text, and
     * nothing afterwards could tell the two apart. A reader's own thought about a
     * relation is a note on the node, which is visibly their writing.
     */
    expect(schema).not.toMatch(/model JourneyEdge\b/);
    expect(migration).not.toMatch(/CREATE TABLE[^;]*journey_edges/i);
    expect(service).not.toMatch(/journeyEdge\.(create|upsert|update)/);
  });

  it('does not write into the tables the graph reads', () => {
    /*
     * passage_affinities is the read-through cache for recommendation ranking,
     * keyed on the ordered pair. User edges in there would silently change what
     * every other reader is shown. cross_references is machine-detected and
     * @@unique on pair+type.
     */
    for (const table of ['passageAffinity', 'crossReference', 'alignment']) {
      expect(service, `${table} must not be written`).not.toMatch(
        new RegExp(`prisma\\.${table}\\.(create|upsert|update|delete)`)
      );
    }
  });

  it('keeps a passage key rather than a copy of the text', () => {
    // The passage can be re-translated or re-ingested; a duplicate here would be
    // a second thing to keep in step with the first.
    expect(schema).toMatch(/model JourneyNode[\s\S]*?passageKey String @map\("passage_key"\)/);
    expect(schema).not.toMatch(/model JourneyNode[\s\S]{0,700}?\btranslation\b/);
  });
});

describe('edges are thresholds for their own quantity', () => {
  it('scores a theme on a theme scale, not a confidence scale', () => {
    /*
     * strength on a cross-reference is a confidence; a theme score is how
     * strongly a passage carries a theme, and most sit between 0.1 and 0.5. One
     * threshold for both dropped every shared theme — six mercy-and-creation
     * verses produced a graph with no edges, which reads as "these are unrelated"
     * rather than as a threshold set for the wrong quantity.
     */
    expect(service).toContain('const MIN_THEME_SCORE = 0.1');
    expect(service).toMatch(
      /strength < \(kind === 'shared-theme' \? MIN_THEME_SCORE : MIN_EDGE_STRENGTH\)/
    );
  });

  it('names both endpoints and the detector separately', () => {
    // An edge has two endpoints and one detector. Collapsing them is how a graph
    // ends up showing a reader's assertion in the same style as a quotation.
    const shared = readFileSync(resolve(__dirname, '../../../packages/shared/src/index.ts'), 'utf8');
    expect(shared).toMatch(/JourneyEdgeSchema[\s\S]*?from: z\.string\(\)/);
    expect(shared).toMatch(/JourneyEdgeSchema[\s\S]*?provenance: z\.enum\(\['jev', 'derived', 'manual'\]\)/);
    expect(shared).not.toMatch(/JourneyEdgeSchema = z\.object\(\{[\s\S]{0,200}?source: z\.enum/);
  });

  it('labels every edge it draws', () => {
    expect(service).toMatch(/edges\.push\(\{ from, to, kind, strength, provenance/);
    // A theme edge with no theme named would be a line meaning "something".
    expect(service).toMatch(/\.\.\.\(theme \? \{ theme \} : \{\}\)/);
  });
});

describe('the reader owns the order', () => {
  it('sends an order of keys, not a list of positions', () => {
    /*
     * Two nodes ending up claiming one slot is the failure this avoids, and it
     * comes from trusting client-supplied position numbers. Positions are
     * rewritten from the order the keys arrive in.
     */
    expect(service).toMatch(/const ordered: string\[\] = \[\]/);
    expect(service).toMatch(/ordered\.map\(\(passageKey, position\) =>/);
    expect(service).toMatch(/if \(!known\.has\(parsed\.data\) \|\| seen\.has\(parsed\.data\)\) continue;/);
  });
});

describe('ownership', () => {
  it('answers the same for missing and not-yours', () => {
    // A 403 tells a stranger a journey id exists. There is nothing to gain from
    // the distinction.
    expect(service).toMatch(/findFirst\(\{ where: \{ id: journeyId, userId \} \}\)/);
    expect(service).toMatch(/if \(!journey\) throw new JourneyError\('Journey not found\.', 404\)/);
  });
});

describe('the API surface', () => {
  it('mints and uses the same anonymous cookie as the library', () => {
    expect(routes).toContain("app.get('/api/journeys', async (request: FastifyRequest, reply: FastifyReply) => {\n    const userId = identityOf(request, reply);");
  });

  it('bounds the reorder payload', () => {
    // A journey holds 200 passages; 500 is the cap above which the request is
    // rejected rather than trimmed, so a client bug is visible.
    expect(routes).toMatch(/keys\.length > 500/);
    expect(routes).toContain("fail(reply, 400, 'INVALID_INPUT', 'Send at most 500 keys in one reorder')");
  });
});
