import { describe, it, expect } from 'vitest';
import { resolveIdentity } from '../src/services/library';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The library.
 *
 * The identity decision is the whole feature and the whole risk. There is no
 * account: identity is a cookie, and a cookie is attacker-controlled input that
 * ends up in a `where` clause deciding which rows a caller can read. Everything
 * here follows from that.
 *
 * The other thing worth guarding is what is *not* stored. The library saves a
 * passage key, not a copy of the text, and the two differ in a way that matters:
 * a copy is a second source of truth that can disagree with the first.
 */

const schema = readFileSync(join(__dirname, '../prisma/schema.prisma'), 'utf8');
const service = readFileSync(join(__dirname, '../src/services/library.ts'), 'utf8');
const routes = readFileSync(join(__dirname, '../src/routes/api.ts'), 'utf8');

function code(of: string): string {
  return of.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('library identity', () => {
  it('mints an id when there is no cookie', () => {
    const a = resolveIdentity(undefined);
    const b = resolveIdentity(undefined);
    expect(a.isNew).toBe(true);
    expect(b.isNew).toBe(true);
    // Two readers with no cookie must not share a library.
    expect(a.userId).not.toBe(b.userId);
  });

  it('trusts a well-formed cookie', () => {
    const first = resolveIdentity(undefined).userId;
    const second = resolveIdentity(first);
    expect(second.isNew).toBe(false);
    expect(second.userId).toBe(first);
  });

  it('replaces a malformed cookie rather than using it', () => {
    // This is the security-relevant test. The cookie becomes a `where` clause
    // over saved_passages, so a hand-edited value must not be able to select
    // somebody else's rows — and must not become a syntax error either, which is
    // the other thing a naive string interpolation would do.
    const hostile = [
      "' OR 1=1 --",
      "'; DROP TABLE saved_passages; --",
      "x' UNION SELECT * FROM user_preferences --",
      '../../etc/passwd',
      'not-a-uuid',
      '1',
      '',
      '   ',
      'a'.repeat(500),
      '00000000-0000-0000-0000-000000000000\u0000admin',
    ];
    for (const value of hostile) {
      const result = resolveIdentity(value);
      expect(result.isNew, `"${value.slice(0, 20)}" was trusted`).toBe(true);
      expect(result.userId).not.toBe(value);
    }
  });

  it('accepts the UUID forms a browser will actually send', () => {
    // Upper case and the version nibble variants a crypto implementation might
    // produce. Rejecting a legitimate cookie empties a real reader's library.
    for (const value of [
      'f137336d-4a8b-4c2e-9f1a-2b3c4d5e6f70',
      'F137336D-4A8B-4C2E-9F1A-2B3C4D5E6F70',
      '00000000-0000-4000-8000-000000000000',
    ]) {
      expect(resolveIdentity(value).isNew, `${value} was rejected`).toBe(false);
    }
  });
});

describe('library storage', () => {
  it('stores a passage key and not the text', () => {
    // A copy of the text is a second source of truth that can disagree with
    // `passages` after a re-ingest or a re-translation, and nothing would notice.
    const body = code(schema);
    expect(body).toMatch(/model SavedPassage[\s\S]*passageKey\s+String\s+@map\("passage_key"\)/);
    expect(body).not.toMatch(/model SavedPassage[\s\S]{0,600}?\btranslation\b/);
    expect(body).not.toMatch(/model SavedPassage[\s\S]{0,600}?original_text/);
  });

  it('allows one save per passage', () => {
    // Otherwise a double click makes two rows and unsave has nothing unambiguous
    // to delete.
    expect(code(schema)).toContain('@@unique([userId, passageKey])');
  });

  it('indexes the read the library page actually performs', () => {
    // "my saves, newest first" for one user, against a table that only grows.
    expect(code(schema)).toMatch(/@@index\(\[userId, createdAt\(sort: Desc\)\]\)/);
  });

  it('hydrates rather than storing, and keeps orphans visible', () => {
    // A list that silently drops an entry whose passage has gone is
    // indistinguishable from data loss. The entry is returned with a null passage
    // and the UI says so.
    expect(code(service)).toContain('passage: byKey.get(row.passageKey) ?? null');
    expect(code(service)).not.toMatch(/\.filter\([^)]*byKey/);
  });

  it('hydrates in one query for the whole page', () => {
    expect(code(service)).toMatch(/getPassagesByKeys\(rows\.map/);
  });

  it('bounds how much one reader can ask for', () => {
    expect(code(service)).toMatch(/const MAX_ENTRIES = \d+/);
    expect(code(service)).toContain('take: MAX_ENTRIES');
  });

  it('does not move the save timestamp on a re-save', () => {
    // "When did I find this" is the useful fact, and a re-save is usually a
    // double click rather than a new discovery.
    expect(code(service)).toMatch(/update:\s*collectionId === undefined \? \{\} :/);
  });

  it('rejects a key that is not in the corpus', () => {
    // A well-formed key that names nothing would otherwise be saved and then
    // render as a permanently broken library entry.
    expect(code(service)).toMatch(/if \(!passage\) throw new Error/);
  });
});

describe('library routes', () => {
  it('sets a cookie on every library route, minting one when absent', () => {
    // Minting rather than rejecting means the library works through the web proxy
    // and when called directly, and it removes the silent failure where a cookie
    // is not being set and every reader has an empty library with no error.
    expect(code(routes)).toMatch(/const identityOf[\s\S]{0,400}setCookie/);
    expect(code(routes)).toMatch(/if \(identity\.isNew\) reply\.setCookie/);
  });

  it('has a keys route separate from the hydrated list', () => {
    // The save buttons appear on every card of a forty-result page. Hydrating all
    // of them to draw a bookmark is absurd; the key list is the cheap shape.
    expect(code(routes)).toContain("app.get('/api/library/keys'");
    expect(code(routes)).toContain('getSavedKeys(userId)');
  });

  it('scopes every read and write to the caller', () => {
    // The whole authorisation story is the userId in the where clause. A single
    // route that omits it leaks every reader's library to whoever asks.
    for (const call of ['getLibrary(userId)', 'getSavedKeys(userId)', 'removePassage(userId,']) {
      expect(code(routes), `missing ${call}`).toContain(call);
    }
  });

  it('treats removing something absent as success', () => {
    // That is the state the caller asked for, and a 404 would make a double
    // removal look like an error.
    expect(code(routes)).toContain('return ok({ removed })');
  });
});
