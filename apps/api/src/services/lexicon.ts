/**
 * Lexicon lookup.
 *
 * Tapping a word in a passage's original text returns the entries that published
 * dictionaries give for it — BDB, Jastrow, Klein, Strong's — each kept with the
 * dictionary it came from.
 *
 * This is reference data, not generated text. Every sense here was written by a
 * lexicographer, and the dictionary is named on every entry so a reader can see
 * whose definition they are reading. Nothing in this file asks a model to explain
 * a word, which is the line the product does not cross.
 *
 * Sefaria is queried once per word and the answer is cached in Postgres, so the
 * second reader to tap a word costs nothing.
 */

import { prisma } from './passage';
import { stripSefariaHtml } from './sefaria';
import { HttpError } from '../lib/errors';

const SEFARIA_WORDS_API = 'https://www.sefaria.org/api/words';

/** Most entries a reader will read. Beyond this it is a dictionary, not a lookup. */
const MAX_ENTRIES = 8;

/** How much of one sense to show before it stops being a definition. */
const MAX_SENSE_CHARS = 400;

export interface LexiconSense {
  definition: string;
}

export interface LexiconEntry {
  headword: string;
  lexicon: string;
  language: string;
  transliteration: string | null;
  strongNumber: string | null;
  morphology: string | null;
  senses: LexiconSense[];
  source: string | null;
}

/**
 * Strip vowel points, cantillation and maqaf so that one root is one lookup rather
 * than one lookup per vocalisation.
 *
 * These ranges are written as escapes on purpose. As literal marks they are
 * invisible in a diff, and an upper bound one codepoint too high — U+05FF instead
 * of U+05C7 — silently deletes every Hebrew letter, because letters start at
 * U+05D0. That failure returns an empty string for every word and looks like the
 * dictionary simply having no entries.
 *
 *   U+0591-U+05C7  points, accents and cantillation
 *   U+05BE         maqaf, which joins two words into one token
 *   U+05BF-U+05C0  rafe and paseq
 */
const HEBREW_NON_LETTERS = /[\u0591-\u05C7\u05BE-\u05C0]/g;

/** U+05D0-U+05EA: the Hebrew block proper, excluding the marks above. */
const HEBREW_LETTERS = /[\u05D0-\u05EA]/;

export function normalizeHebrewWord(word: string): string {
  return word.replace(HEBREW_NON_LETTERS, '').trim();
}

/** True when a token is plausibly a Hebrew or Aramaic word worth looking up. */
export function isLexiconCandidate(word: string): boolean {
  // An Arabic or Greek token must not be sent to a Hebrew lexicon.
  if (!HEBREW_LETTERS.test(word)) return false;
  // Single letters are prefixes and particles — the vav and bet that open most
  // tokens in the corpus and that no dictionary carries. Rejecting them here means
  // they never reach the network.
  return word.replace(HEBREW_NON_LETTERS, '').length >= 2;
}

interface RawSefariaEntry {
  headword?: string;
  parent_lexicon?: string;
  content?: { morphology?: string; senses?: Array<{ definition?: string }> };
  strong_number?: string | number;
  transliteration?: string;
  language_code?: string;
  parent_lexicon_details?: { source?: string; language?: string };
}

/**
 * Order entries so the most useful is first: an exact headword before a derived
 * form, and the Strong's-augmented dictionary before the rest because it is the one
 * that carries a Strong's number and a transliteration.
 */
const LEXICON_PRIORITY = ['bdb augmented strong', 'jastrow dictionary', 'klein dictionary', 'bdb dictionary', 'strong'];

function rankEntry(entry: LexiconEntry, lookupWord: string, exactHeadword: boolean): number {
  let rank = exactHeadword ? 0 : 100;
  const lexicon = entry.lexicon.toLowerCase();
  const priority = LEXICON_PRIORITY.findIndex((p) => lexicon.includes(p));
  if (priority >= 0) rank += priority;
  // Prefer a lexicographer over an augmented database when both are present.
  if (entry.strongNumber) rank -= 0.5;
  return rank;
}

function toEntry(raw: RawSefariaEntry, lookupWord: string): LexiconEntry | null {
  const headword = raw.headword?.trim();
  const lexicon = raw.parent_lexicon?.trim();
  if (!headword || !lexicon) return null;

  const senses = (raw.content?.senses ?? [])
    .map((s) => (typeof s?.definition === 'string' ? stripSefariaHtml(s.definition) : ''))
    .filter((definition) => definition.length > 0)
    .map((definition) => ({ definition: definition.slice(0, MAX_SENSE_CHARS) }));

  return {
    headword,
    lexicon,
    language: raw.language_code ?? raw.parent_lexicon_details?.language ?? 'hebrew',
    transliteration: raw.transliteration ?? null,
    strongNumber: raw.strong_number != null ? String(raw.strong_number) : null,
    morphology: raw.content?.morphology ?? null,
    senses,
    source: raw.parent_lexicon_details?.source ?? lexicon,
  };
}

async function fetchFromSefaria(word: string): Promise<LexiconEntry[]> {
  const url = `${SEFARIA_WORDS_API}/${encodeURIComponent(word)}`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'ilm-lexicon/1.0 (comparative text research)' },
    signal: AbortSignal.timeout(20_000),
  });

  // Sefaria answers 200 with an empty array for a word it does not have, which is
  // an ordinary outcome rather than a failure.
  if (!response.ok) throw new HttpError(502, 'LEXICON_UNAVAILABLE', `Lexicon lookup failed: HTTP ${response.status}`);

  const raw = (await response.json()) as RawSefariaEntry[];
  if (!Array.isArray(raw)) return [];

  const exact = normalizeHebrewWord(word);
  return raw
    .map((entry) => toEntry(entry, exact))
    .filter((entry): entry is LexiconEntry => entry !== null)
    .sort((a, b) => rankEntry(a, exact, normalizeHebrewWord(a.headword) === exact) - rankEntry(b, exact, normalizeHebrewWord(b.headword) === exact))
    .slice(0, MAX_ENTRIES);
}

async function cacheEntries(lookupWord: string, entries: LexiconEntry[]): Promise<void> {
  if (entries.length === 0) return;

  await prisma.$transaction(
    entries.map((entry) =>
      prisma.lexiconEntry.upsert({
        where: { lookupWord_lexicon_headword: { lookupWord, lexicon: entry.lexicon, headword: entry.headword } },
        create: {
          lookupWord,
          headword: entry.headword,
          lexicon: entry.lexicon,
          language: entry.language,
          transliteration: entry.transliteration,
          strongNumber: entry.strongNumber,
          morphology: entry.morphology,
          senses: entry.senses as object,
          source: entry.source,
        },
        update: { senses: entry.senses as object, transliteration: entry.transliteration, strongNumber: entry.strongNumber },
      })
    )
  );
}

export interface LexiconLookup {
  /** The word as it was looked up, pointing stripped. */
  word: string;
  entries: LexiconEntry[];
  /** True when the answer came from the cache rather than Sefaria. */
  cached: boolean;
  /** True when Sefaria has nothing for this word. Cached, so absence is asked once. */
  notFound: boolean;
}

/** Lexicon name used for the row that records "Sefaria has nothing for this word". */
const NO_ENTRY = '__none__';

/**
 * Look a word up, preferring the cache.
 *
 * A word with no entries is remembered too, as a marker row. Without that, every
 * reader who taps a word Sefaria does not carry pays for a request that is certain
 * to come back empty. Short particles never get this far: `isLexiconCandidate`
 * rejects anything under two letters, which covers the vav and bet prefixes that
 * would otherwise miss on every tap.
 */
export async function lookupWord(rawWord: string): Promise<LexiconLookup> {
  const word = normalizeHebrewWord(rawWord);

  if (!isLexiconCandidate(word)) {
    return { word, entries: [], cached: true, notFound: true };
  }

  const rows = await prisma.lexiconEntry.findMany({ where: { lookupWord: word } });
  const real = rows.filter((row) => row.lexicon !== NO_ENTRY);

  if (real.length > 0) {
    return { word, entries: real.map(rowToEntry), cached: true, notFound: false };
  }

  if (rows.length > 0) {
    // Only the marker is present: this word was already looked up and had no entry.
    return { word, entries: [], cached: true, notFound: true };
  }

  const entries = await fetchFromSefaria(word);

  if (entries.length === 0) {
    await prisma.lexiconEntry.upsert({
      where: { lookupWord_lexicon_headword: { lookupWord: word, lexicon: NO_ENTRY, headword: word } },
      create: { lookupWord: word, headword: word, lexicon: NO_ENTRY, senses: [] as object },
      update: {},
    });
  } else {
    await cacheEntries(word, entries);
  }

  return { word, entries, cached: false, notFound: entries.length === 0 };
}

function rowToEntry(row: {
  headword: string;
  lexicon: string;
  language: string;
  transliteration: string | null;
  strongNumber: string | null;
  morphology: string | null;
  senses: unknown;
  source: string | null;
}): LexiconEntry {
  return {
    headword: row.headword,
    lexicon: row.lexicon,
    language: row.language,
    transliteration: row.transliteration,
    strongNumber: row.strongNumber,
    morphology: row.morphology,
    senses: Array.isArray(row.senses) ? (row.senses as LexiconSense[]) : [],
    source: row.source,
  };
}
