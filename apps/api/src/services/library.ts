/**
 * The library: passages a reader kept.
 *
 * Identity is an anonymous id in a cookie, and that is a deliberate trade. A
 * tool people open to check a reference cannot put an email wall in front of
 * "save this verse" — it would lose more readers at that step than it would ever
 * win back — so there is no account, no password and no recovery. The cost is
 * that clearing cookies or switching device loses the library, and the only
 * reason that is acceptable is that a saved passage is not the point: it is a
 * staging area for a citation, and the citation is the thing that leaves.
 *
 * Entries store a passage key, never a copy of the text. The passage is already
 * in the database and can be corrected, re-translated or re-ingested; a duplicate
 * here would be a second thing to keep in step with the first, and could
 * disagree with it.
 *
 * If no cookie arrives, one is minted and set on the response. Minting rather
 * than rejecting means the library works whether it is reached through the web
 * proxy or called directly, and it removes the failure mode where a cookie is
 * quietly not being set and every reader silently has an empty library.
 */

import { prisma, getPassagesByKeys } from './passage';
import type { Passage } from '@ilm/shared';

export const LIBRARY_COOKIE = 'ilm_uid';

/** A year. Long enough that a reader does not lose it, short enough to matter. */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Nothing sane saves more than this, and it bounds the hydrate query. */
const MAX_ENTRIES = 500;

/**
 * RFC 4122 v4 from the platform's CSPRNG, with a fallback for the rare refusal.
 *
 * `randomUUID` is only exposed on secure contexts, and the fallback uses
 * Math.random — which is not a CSPRNG. That matters less than it sounds: the id
 * is a lookup key for one anonymous reader's own rows, not a secret, and a
 * collision would merge two libraries rather than expose one. Node 18+ and every
 * browser have randomUUID anyway; the branch is for older runtimes.
 */
function mintId(): string {
  const webCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export interface ResolvedIdentity {
  userId: string;
  /** True when a cookie was minted rather than read, so the caller can set one. */
  isNew: boolean;
}

/**
 * The reader's id, from the cookie or a new one.
 *
 * Validated rather than trusted: a cookie is attacker-controlled, and this string
 * becomes a `where` clause against every row a reader can see. Anything that is
 * not a UUID is treated as absent and replaced, which means a hand-edited cookie
 * gets a fresh empty library instead of an error or, worse, a shared one.
 */
export function resolveIdentity(cookieValue: string | undefined): ResolvedIdentity {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (cookieValue && UUID.test(cookieValue)) return { userId: cookieValue, isNew: false };
  return { userId: mintId(), isNew: true };
}

export function cookieOptions() {
  return {
    httpOnly: false,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  };
}

export interface LibraryEntry {
  passageKey: string;
  savedAt: string;
  collectionId: string | null;
  /** Null when the passage has since been removed from the corpus. */
  passage: Passage | null;
}

/**
 * The reader's library, newest first, hydrated.
 *
 * Hydration is one batched query for the whole page rather than a lookup per
 * entry, and an entry whose passage has gone is returned with `passage: null`
 * rather than dropped — a silently shorter list looks like data loss, and a
 * reader who saved a passage deserves to be told it is gone.
 */
export async function getLibrary(userId: string): Promise<LibraryEntry[]> {
  const rows = await prisma.savedPassage.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: MAX_ENTRIES,
    select: { passageKey: true, createdAt: true, collectionId: true },
  });

  if (rows.length === 0) return [];

  const byKey = new Map((await getPassagesByKeys(rows.map((r) => r.passageKey))).map((p) => [p.passageKey, p]));

  return rows.map((row) => ({
    passageKey: row.passageKey,
    savedAt: row.createdAt.toISOString(),
    collectionId: row.collectionId,
    passage: byKey.get(row.passageKey) ?? null,
  }));
}

/** Save a passage. Idempotent: saving twice updates rather than duplicating. */
export async function savePassage(
  userId: string,
  passageKey: string,
  collectionId?: string | null
): Promise<{ passageKey: string; saved: boolean }> {
  const passage = await prisma.passage.findUnique({ where: { passageKey }, select: { id: true } });
  if (!passage) throw new Error(`No passage with key ${passageKey}`);

  await prisma.savedPassage.upsert({
    where: { userId_passageKey: { userId, passageKey } },
    // A re-save keeps the original timestamp, because "when did I find this" is
    // the useful fact and re-saving is usually an accident on a double click.
    create: { userId, passageKey, collectionId: collectionId ?? null },
    update: collectionId === undefined ? {} : { collectionId },
  });

  return { passageKey, saved: true };
}

export async function removePassage(userId: string, passageKey: string): Promise<boolean> {
  const result = await prisma.savedPassage.deleteMany({ where: { userId, passageKey } });
  return result.count > 0;
}

/** The reader's saved keys, for the save buttons on cards and passages. */
export async function getSavedKeys(userId: string): Promise<string[]> {
  const rows = await prisma.savedPassage.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: MAX_ENTRIES,
    select: { passageKey: true },
  });
  return rows.map((r) => r.passageKey);
}
