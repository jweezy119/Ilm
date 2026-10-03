/**
 * Quran recitation, by verse.
 *
 * Audio comes from the everyayah.com CDN, which publishes one MP3 per ayah keyed
 * by surah and verse. Per-verse files rather than one file per surah, because a
 * reader reading 2:255 does not want a surah, and because a single file per verse
 * means the verse being recited is known exactly — there is no timing data to get
 * out of step, and no highlighting that can drift onto the wrong line.
 *
 * The URL is derived from the passage key rather than stored, so adding a reciter
 * is a line in RECITERS rather than a backfill over 6,236 rows.
 *
 * Nothing here is fetched at module load: the player asks for an MP3 only when a
 * reader presses play, and `preload="none"` keeps the CDN out of the critical path.
 */

export interface Reciter {
  id: string;
  name: string;
  /** everyayah.com folder name. */
  folder: string;
  /** How the recitation is delivered, where that is not obvious from the name. */
  style?: string;
}

/** Verified reachable on the CDN; each is 128 or 192 kbps MP3. */
export const RECITERS: Reciter[] = [
  { id: 'alafasy', name: 'Mishary Rashid al-ʿAfasy', folder: 'Alafasy_128kbps' },
  { id: 'husary', name: 'Mahmoud Khalil Al-Husary', folder: 'Husary_128kbps' },
  { id: 'abdulbasit-murattal', name: 'Abdul Basit Abdus-Samad', style: 'Murattal — measured, for learning', folder: 'Abdul_Basit_Murattal_192kbps' },
  { id: 'abdulbasit-mujawwad', name: 'Abdul Basit Abdus-Samad', style: 'Mujawwad — improvised, for listening', folder: 'Abdul_Basit_Mujawwad_128kbps' },
  { id: 'minshawy-murattal', name: 'Mahmoud Khalil Al-Husary', style: 'Murattal', folder: 'Minshawy_Murattal_128kbps' },
  { id: 'minshawy-mujawwad', name: 'Muhammad Siddiq al-Minshawi', style: 'Mujawwad', folder: 'Minshawy_Mujawwad_192kbps' },
  { id: 'sudais', name: 'Abdur-Rahman as-Sudais', folder: 'Abdurrahmaan_As-Sudais_192kbps' },
  { id: 'shuraym', name: 'Saʿood bin Ibraaheem ash-Shuraym', folder: 'Saood_ash-Shuraym_128kbps' },
  { id: 'ayyoub', name: 'Muhammad Ayyoub', folder: 'Muhammad_Ayyoub_128kbps' },
  { id: 'hudhaify', name: 'Ali al-Hudhaify', folder: 'Hudhaify_128kbps' },
];

export const DEFAULT_RECITER = RECITERS[0];

export function reciterById(id: string): Reciter {
  return RECITERS.find((r) => r.id === id) ?? DEFAULT_RECITER;
}

/**
 * The audio URL for one ayah, or null when the reference is not a Quran ayah.
 *
 * The CDN addresses a verse as `SSSVVV` — surah then verse, three digits each —
 * which falls straight out of a passage key of `quran:SS:1:VVV`. A range or a
 * non-Quran passage returns null so the player is simply not offered, rather than
 * requesting something that will 404.
 */
export function ayahAudioUrl(verseKey: string, reciterId: string): string | null {
  if (!verseKey) return null;
  const parts = verseKey.split(':');
  if (parts.length !== 4) return null;
  const [textId, surah, chapter, verse] = parts;
  if (textId !== 'quran' || chapter !== '1') return null;
  if (!/^\d+$/.test(surah) || !/^\d+$/.test(verse)) return null;

  const s = String(Number(surah)).padStart(3, '0');
  const v = String(Number(verse)).padStart(3, '0');
  return `https://everyayah.com/data/${reciterById(reciterId).folder}/${s}${v}.mp3`;
}

export const RECITATION_SPEEDS = [0.75, 1, 1.25, 1.5] as const;

/**
 * How a passage is named in speech, read off the key rather than the chapter.
 *
 * A Quran passage key is `quran:surah:1:ayah` — chapter is pinned to 1 — so the
 * surah lives in the *book* segment. Reading `chapter` announced "1:255" for the
 * second surah, which is not a reference any reader could look up.
 */
export function verseLabel(passageKey: string): string | null {
  const parts = (passageKey ?? '').split(':');
  if (parts.length !== 4) return null;
  const [, book, , verse] = parts;
  if (!/^\d+$/.test(book) || !/^\d+$/.test(verse)) return null;
  return `${Number(book)}:${Number(verse)}`;
}