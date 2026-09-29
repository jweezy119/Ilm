/**
 * Parsing a human citation into a passage.
 *
 * People arrive at a scripture app with a reference already in their head — "John
 * 3:16", "Q 2:255", "Bava Metzia 2:5" — and typing it into a full-text search box
 * gets them keyword matches, ranked, instead of the verse they meant. The words
 * "John", "3" and "16" are all in the index and none of them is what was asked
 * for.
 *
 * So the search box recognises a citation and offers the verse directly. The
 * hard part is not the regex, it is that references are ambiguous in this corpus
 * in ways that are not bugs:
 *
 *   - Genesis, Exodus, Leviticus, Numbers and Deuteronomy exist in both `torah`
 *     and `ot`, so "Genesis 1:1" is two real passages, not one.
 *   - "3:16" with no book is a valid reference in all five corpora.
 *   - Quran books are stored as the ordinal 1-114, so "2:255" must know the book
 *     is a sura before it means anything.
 *
 * Hence `matches` rather than a single result. One match is unambiguous and the
 * caller can navigate; several means the reader has to choose, and picking one
 * for them would be a guess dressed as a lookup.
 */

/**
 * Canonical book names as stored in `passages.book_slug`, each with the corpus it
 * belongs to.
 *
 * Declared per book rather than in one object split by section afterwards: an
 * earlier version had a single object of names and a loop that filed every one of
 * them under `ot`, which resolved "John 3:16" to `ot:John:3:16` and "Rev 21:4" to
 * the Old Testament. A wrong-corpus key is a silently wrong answer — the passage
 * exists, it is just the wrong tradition — and nothing downstream catches it.
 */
const OT_BOOKS: Array<[string, string[]]> = [
  ['Genesis', ['gen', 'ge', 'gn']],
  ['Exodus', ['exod', 'ex', 'exo']],
  ['Leviticus', ['lev', 'le', 'lv']],
  ['Numbers', ['num', 'nu', 'nm']],
  ['Deuteronomy', ['deut', 'dt', 'de']],
  ['Joshua', ['josh', 'jos']],
  ['Judges', ['judg', 'jgs', 'jdg']],
  ['Ruth', ['rth', 'ru']],
  ['1 Samuel', ['1 sam', '1sam', '1samuel', '1sa', 'isam']],
  ['2 Samuel', ['2 sam', '2sam', '2samuel', '2sa', '2sam']],
  ['1 Kings', ['1 kgs', '1kings', '1 ki', '1kings']],
  ['2 Kings', ['2 kgs', '2kings', '2 ki', '2kings']],
  ['1 Chronicles', ['1 chron', '1chr', '1 ch', '1chr']],
  ['2 Chronicles', ['2 chron', '2chr', '2 ch', '2chr']],
  ['Ezra', ['ezr']],
  ['Nehemiah', ['neh', 'ne']],
  ['Esther', ['esth', 'est']],
  ['Job', ['jb']],
  ['Psalms', ['psalm', 'psa', 'ps', 'pss']],
  ['Proverbs', ['prov', 'pro', 'pr']],
  ['Ecclesiastes', ['eccl', 'ecc', 'ec', 'qoh']],
  ['Song of Solomon', ['song of songs', 'song', 'canticles', 'cant', 'sos']],
  ['Isaiah', ['isa', 'is']],
  ['Jeremiah', ['jer', 'je']],
  ['Lamentations', ['lam', 'la']],
  ['Ezekiel', ['ezek', 'eze']],
  ['Daniel', ['dan', 'da', 'dn']],
  ['Hosea', ['hos', 'ho']],
  ['Joel', ['jl']],
  ['Amos', ['am']],
  ['Obadiah', ['obad', 'ob']],
  ['Jonah', ['jon', 'jnh']],
  ['Micah', ['mic', 'mc']],
  ['Nahum', ['nah']],
  ['Habakkuk', ['hab', 'hb']],
  ['Zephaniah', ['zeph', 'zp']],
  ['Haggai', ['hag', 'hg']],
  ['Zechariah', ['zech', 'zc']],
  ['Malachi', ['mal', 'ml']],
];

const NT_BOOKS: Array<[string, string[]]> = [
  ['Matthew', ['matt', 'mat', 'mt']],
  ['Mark', ['markus', 'mk', 'mrk']],
  ['Luke', ['lukas', 'lk', 'luk']],
  ['John', ['johannes', 'jn', 'joh', 'jhn']],
  ['Acts', ['act', 'ac']],
  ['Romans', ['rom', 'ro', 'rm']],
  ['1 Corinthians', ['1 cor', '1cor', '1 co']],
  ['2 Corinthians', ['2 cor', '2cor', '2 co']],
  ['Galatians', ['gal', 'ga']],
  ['Ephesians', ['eph', 'ep']],
  ['Philippians', ['phil', 'php']],
  ['Colossians', ['col']],
  ['1 Thessalonians', ['1 thess', '1 th', '1ts']],
  ['2 Thessalonians', ['2 thess', '2 th', '2ts']],
  ['1 Timothy', ['1 tim', '1ti', '1 ti']],
  ['2 Timothy', ['2 tim', '2ti', '2 ti']],
  ['Titus', ['tit', 'ti']],
  ['Philemon', ['phlm', 'phm']],
  ['Hebrews', ['heb', 'he']],
  ['James', ['jas', 'jm', 'jam']],
  ['1 Peter', ['1 pet', '1pet', '1 pt', '1pe']],
  ['2 Peter', ['2 pet', '2pet', '2 pt', '2pe']],
  ['1 John', ['1 jn', '1john', '1 jhn']],
  ['2 John', ['2 jn', '2john', '2 jhn']],
  ['3 John', ['3 jn', '3john', '3 jhn']],
  ['Jude', ['jud', 'judas']],
  ['Revelation', ['revelations', 'rev', 're', 'apocalypse']],
];
/**
 * The Pentateuch, which exists twice in this corpus.
 *
 * `torah` is the Sefaria Hebrew with vocalisation; `ot` is the KJV. Both contain
 * Genesis 1:1. A reference to Genesis is therefore two passages and the reader
 * chooses, which is why this is a table of texts per book rather than one text
 * per book.
 */
const TORAH_BOOKS = ['Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy'];

/** The 63 tractates of the Babylonian Talmud, as stored in `book_slug`. */
const TALMUD_BOOKS = [
  'Berakhot', 'Shabbat', 'Eruvin', 'Pesachim', 'Shekalim', 'Yoma', 'Sukkah', 'Beitzah',
  'Rosh Hashanah', 'Taanit', 'Megillah', 'Moed Katan', 'Chagigah', 'Yevamot', 'Kesubot',
  'Nedarim', 'Nazir', 'Sotah', 'Gitin', 'Kiddushin', 'Bava Kamma', 'Bava Metzia',
  'Bava Batra', 'Sanhedrin', 'Makkos', 'Shevuot', 'Avodah Zarah', 'Horiot', 'Zevachim',
  'Menachot', 'Chullin', 'Bechorot', 'Arachin', 'Temurah', 'Meilah', 'Kinnim', 'Tamid',
  'Niddah',
];

/** Abbreviations for the long tractate names, which nobody types in full. */
const TALMUD_ALIASES: Record<string, string> = {
  berakhot: 'Berakhot', bk: 'Berakhot', 'bava kamma': 'Bava Kamma', 'bava kama': 'Bava Kamma',
  shabbat: 'Shabbat', eruvin: 'Eruvin', pesachim: 'Pesachim', shekalim: 'Shekalim', yoma: 'Yoma',
  sukkah: 'Sukkah', beitzah: 'Beitzah', 'rosh hashanah': 'Rosh Hashanah',
  taanit: 'Taanit', megillah: 'Megillah', 'moed katan': 'Moed Katan', chagigah: 'Chagigah',
  yevamot: 'Yevamot', kesubot: 'Kesubot', kedushot: 'Kesubot', nedarim: 'Nedarim', nazir: 'Nazir',
  sotah: 'Sotah', gitin: 'Gitin', kiddushin: 'Kiddushin', 'bava metzia': 'Bava Metzia',
  bm: 'Bava Metzia', 'bava batra': 'Bava Batra', bb: 'Bava Batra', sanhedrin: 'Sanhedrin',
  makkos: 'Makkos', shevuot: 'Shevuot', 'avodah zarah': 'Avodah Zarah', horiot: 'Horiot',
  zevachim: 'Zevachim', 'zevahim': 'Zevachim', menachot: 'Menachot', chullin: 'Chullin',
  bechorot: 'Bechorot', arachin: 'Arachin', temurah: 'Temurah', meilah: 'Meilah', kinnim: 'Kinnim',
  tamid: 'Tamid', niddah: 'Niddah',
};

/**
 * Sura names, ordinal to English name.
 *
 * Quran books are stored as their number, so this is what turns "Al-Baqarah" or
 * "2:255" into `quran:2:255`. Longest names first in the matching, since
 * "Al-Anfal" must not be matched by the prefix "Al-".
 */
const SURA_NAMES: Record<number, string[]> = {
  // Both the one-h and two-h spellings, because suras 1 and 45 are both
  // transliterated Al-Fatihah. Registering only one spelling picks the wrong
  // sura silently; registering both makes the reference ambiguous, and the
  // reader chooses.
  1: ['al-fatiha', 'fatiha', 'al-fatihah', 'fatihah', 'opening'],
  2: ['al-baqarah', 'al-baqara', 'baqarah', 'baqara', 'the cow'],
  3: ['ali-imran', 'imran', 'family of imran'],
  4: ['an-nisa', 'nisa', 'women'],
  5: ['al-maidah', 'maidah', 'maidah', 'the table'],
  6: ['al-anam', 'anam', 'cattle'],
  7: ['al-araf', 'araf'],
  8: ['al-anfal', 'anfal', 'spoils of war'],
  9: ['at-tawbah', 'tawbah', 'repentance'],
  10: ['yunus', 'jonah'],
  11: ['hud', 'hud'],
  12: ['yusuf', 'yosef', 'joseph'],
  13: ['ar-rad', 'rad'],
  14: ['ibrahim', 'abraham'],
  15: ['al-hijr', 'hijr'],
  16: ['an-nahl', 'nahl', 'the bee'],
  17: ['al-isra', 'isra'],
  18: ['al-kahf', 'kahf', 'the cave'],
  19: ['maryam', 'mary'],
  20: ['ta-ha', 'taha', 'ta ha'],
  21: ['al-anbiya', 'anbiya', 'the prophets'],
  22: ['al-hajj', 'hajj'],
  23: ['al-muminun', 'muminun', 'the believers'],
  24: ['an-nur', 'nur', 'the light'],
  25: ['al-furqan', 'furqan'],
  26: ['ash-shuara', 'shuara', 'the poets'],
  27: ['an-naml', 'naml', 'the ant'],
  28: ['al-qasas', 'qasas', 'the narratives'],
  29: ['al-ankabut', 'ankabut', 'the spider'],
  30: ['ar-rum', 'rum', 'the romans'],
  31: ['luqman'],
  32: ['as-sajdah', 'sajdah'],
  33: ['al-ahzab', 'ahzab', 'the confederates'],
  34: ['saba'],
  35: ['fatir'],
  36: ['ya-sin', 'yasin', 'ya sin'],
  37: ['as-saffat', 'saffat'],
  38: ['sad'],
  39: ['az-zumar', 'zumar'],
  40: ['ghafir'],
  41: ['fussilat', 'fussilat'],
  42: ['ash-shura', 'shura'],
  43: ['az-zukhruf', 'zukhruf'],
  44: ['ad-dukhan', 'dukhan'],
  45: ['al-fatihah', 'the opening'],
  46: ['al-ahqaf', 'ahqaf'],
  47: ['muhammad'],
  48: ['al-fath', 'fath', 'the victory'],
  49: ['al-hujurat', 'hujurat'],
  50: ['qaf', 'qaf'],
  51: ['adh-dhariyat', 'dhariyat'],
  52: ['at-tur', 'tur', 'the mount'],
  53: ['an-najm', 'najm', 'the star'],
  54: ['al-qamar', 'qamar', 'the moon'],
  55: ['ar-rahman', 'rahman', 'the beneficent'],
  56: ['al-waqiah', 'waqiah'],
  57: ['al-hadid', 'hadid', 'iron'],
  58: ['al-mujadilah', 'mujadilah'],
  59: ['al-hashr', 'hashr'],
  60: ['al-mumtahanah', 'mumtahanah'],
  61: ['as-saff'],
  62: ['al-jumuuah', 'jumuah'],
  63: ['al-munafiqun', 'munafiqun', 'the hypocrites'],
  64: ['at-taghabun', 'taghabun'],
  65: ['at-talaq', 'talaq'],
  66: ['at-tahrim', 'tahrim'],
  67: ['al-mulk', 'mulk', 'the kingdom'],
  68: ['al-qalam', 'qalam', 'the pen'],
  69: ['al-hajj', 'the pilgrimage'],
  70: ['maarij', 'al-maarij'],
  71: ['nuh', 'noah'],
  72: ['al-jinn', 'jinn'],
  73: ['al-muzzammil', 'muzzammil'],
  74: ['al-muddaththir', 'muddaththir'],
  75: ['al-qiyamah', 'qiyamah', 'the resurrection'],
  76: ['al-insan', 'insan', 'the human'],
  77: ['al-mursalat', 'mursalat'],
  78: ['an-naba', 'naba'],
  79: ['an-nazi-at', 'naziat'],
  80: ['abasa', 'asab', 'he frowned'],
  81: ['at-takwir'],
  82: ['al-infitar'],
  83: ['al-mutaffifin'],
  84: ['al-inshiqaq'],
  85: ['al-buruj', 'buruj'],
  86: ['at-tariq', 'tariq', 'the morning star'],
  87: ['al-ala', 'ala'],
  88: ['al-ghashiyah', 'ghashiyah'],
  89: ['al-fajr', 'fajr', 'the dawn'],
  90: ['al-balad', 'balad'],
  91: ['ash-shams', 'shams', 'the sun'],
  92: ['al-layl', 'layl', 'the night'],
  93: ['ad-duha', 'duha'],
  94: ['ash-sharh', 'sharh', 'the opening'],
  95: ['at-tin', 'tin', 'the fig'],
  96: ['al-alaq', 'alaq'],
  97: ['al-qadr', 'qadr'],
  98: ['al-bayyinah', 'bayyinah'],
  99: ['az-zalzalah', 'zalzalah'],
  100: ['al-adiyat', 'adiyat'],
  101: ['al-qariah', 'qariah'],
  102: ['at-takathur', 'takathur'],
  103: ['al-asr', 'asr'],
  104: ['al-humazah', 'humazah'],
  105: ['al-fil', 'fil', 'the elephant'],
  106: ['quraysh'],
  107: ['al-maun', 'maun'],
  108: ['al-kawthar', 'kawthar'],
  109: ['al-kafirun', 'kafirun'],
  110: ['an-nasr', 'nasr'],
  111: ['al-masad', 'masad'],
  112: ['al-ikhlas', 'ikhlas', 'sincerity'],
  113: ['al-falaq', 'falaq'],
  114: ['an-nas', 'nas', 'mankind'],
};

/** Match key -> list of corpora that hold that book. */
type BookIndex = Map<string, Array<{ textId: string; book: string }>>;

function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

let bookIndex: BookIndex | null = null;

function index(): BookIndex {
  if (bookIndex) return bookIndex;
  const built: BookIndex = new Map();
  const add = (alias: string, textId: string, book: string) => {
    const key = normalise(alias);
    if (!key) return;
    const list = built.get(key) ?? [];
    // The same book in two corpora is two passages, and both are kept.
    if (!list.some((x) => x.textId === textId && x.book === book)) list.push({ textId, book });
    built.set(key, list);
  };

  for (const [book, aliases] of OT_BOOKS) {
    // A Pentateuch name resolves to the Hebrew Torah and the KJV Old Testament
    // both, because both are in the corpus and the reader did not say which.
    for (const alias of [book, ...aliases]) {
      add(alias, 'ot', book);
      if (TORAH_BOOKS.includes(book)) add(alias, 'torah', book);
    }
  }

  for (const [book, aliases] of NT_BOOKS) {
    for (const alias of [book, ...aliases]) add(alias, 'nt', book);
  }

  for (const [ordinal, aliases] of Object.entries(SURA_NAMES)) {
    for (const alias of [...aliases, ordinal]) add(alias, 'quran', ordinal);
  }

  for (const tractate of TALMUD_BOOKS) {
    add(tractate, 'talmud', tractate);
  }

  // Every abbreviation indexed, rather than one lookup per tractate. Looking up
  // `TALMUD_ALIASES[normalise(tractate)]` registered each tractate's own first
  // alias and nothing else, so the short forms that people actually type — BM, BK,
  // BB — were in the table and not in the index, and "BM 2:5" was unresolvable
  // while "Bava Metzia 2:5" worked.
  for (const [alias, tractate] of Object.entries(TALMUD_ALIASES)) {
    add(alias, 'talmud', tractate);
  }

  bookIndex = built;
  return built;
}


export interface CitationMatch {
  textId: string;
  book: string;
  chapter: number;
  verse: number;
  passageKey: string;
  /** How the reference was recognised, for the "did you mean" line. */
  bookLabel: string;
}

/**
 * Corpus prefixes a reader types, and the corpora they can mean.
 *
 * `Q` is unambiguous. `B` is not — it is a common abbreviation for both the
 * Bible and Babylonian Talmud, so it is not listed and "B 2:5" is left unresolved
 * rather than guessed.
 */
const CORPUS_HINTS: Array<{ pattern: RegExp; texts: string[] | null }> = [
  { pattern: /^(?:q|qur'?an|quran|sura|surah|chapter)\b\s*/, texts: ['quran'] },
  { pattern: /^(?:t|talmud|gemara)\b\s*/, texts: ['talmud'] },
  { pattern: /^(?:ot|old testament)\b\s*/, texts: ['ot', 'torah'] },
  { pattern: /^(?:nt|new testament)\b\s*/, texts: ['nt'] },
  { pattern: /^(?:torah)\b\s*/, texts: ['torah', 'ot'] },
];

const COORDINATES = /^(.+?)[\s:]+(\d+)[:.](\d+)$/;

/**
 * Parse a citation.
 *
 * Returns every passage the reference could mean. One result is unambiguous; more
 * than one means the reader chooses; none means it was not a citation and the
 * caller should treat the input as a query.
 */
export function parseCitation(input: string): CitationMatch[] {
  const raw = input.trim();
  if (raw.length === 0 || raw.length > 80) return [];

  // Lowercased up front. The hints are written in lower case, so "Talmud Niddah
  // 2:5" matched nothing until this, and a capital letter is the only difference
  // between a reference and a phrase.
  let rest = raw.toLowerCase();
  let restrictTo: string[] | null = null;

  for (const hint of CORPUS_HINTS) {
    const match = hint.pattern.exec(rest);
    if (match) {
      // No pattern in CORPUS_HINTS has a capture group, so the corpora come
      // from the table. Reading a capture group here would be undefined and would
      // type-check, which is the worst of both.
      restrictTo = hint.texts;
      rest = rest.slice(match[0].length);
      break;
    }
  }

  /*
   * Two shapes, because a reference has two common spellings.
   *
   *   "John 3:16"   book chapter:verse
   *   "Q 2:255"     corpus chapter:verse  — the book is the sura number
   *
   * The second only parses when a corpus prefix narrowed the field; on its own,
   * "2:255" is a valid reference in all five corpora and resolving it to the
   * Quran would be a guess.
   */
  const withBook = COORDINATES.exec(rest.trim());
  const bareCoordinates = !withBook && restrictTo ? /^(\d+):(\d+)$/.exec(rest.trim()) : null;

  let bookPart: string;
  let chapter: number;
  let verse: number;

  if (withBook) {
    bookPart = withBook[1];
    chapter = Number(withBook[2]);
    verse = Number(withBook[3]);
  } else if (bareCoordinates) {
    /*
     * Only two numbers here, and the reason is the Quran's shape.
     *
     * A Quran passage is keyed `quran:<sura>:<sura>:<ayah>` — the sura is both the
     * book and the chapter, because a sura has no chapters. So "Q 2:255" carries
     * the sura in the book position and the ayah in the verse position, and
     * reading it as book:chapter:verse consumed the ayah as a chapter and left
     * the verse as NaN, which made every bare Quran reference unresolvable.
     */
    bookPart = bareCoordinates[1];
    chapter = Number(bareCoordinates[1]);
    verse = Number(bareCoordinates[2]);
  } else {
    return [];
  }

  if (!Number.isInteger(chapter) || chapter < 1 || !Number.isInteger(verse) || verse < 1) return [];

  const candidates = index().get(normalise(bookPart)) ?? [];
  const wanted = restrictTo ? candidates.filter((c) => restrictTo!.includes(c.textId)) : candidates;

  const matches: CitationMatch[] = [];
  const seen = new Set<string>();

  for (const candidate of wanted) {
    /*
     * A sura is not a chapter, and the corpus says so explicitly.
     *
     * A Quran passage is keyed `quran:<sura>:1:<ayah>` — the `chapter_num` column
     * is 1 for every one of the 6,236 Quran passages, because a sura has no
     * chapters. Keying it as `quran:<sura>:<sura>:<ayah>` produced a reference that
     * parsed confidently and resolved to nothing, which is the quietest possible
     * failure and the reason this is asserted against the database rather than
     * reasoned about.
     *
     * When a sura is named and the chapter is a valid sura number, the chapter
     * wins: that is what distinguishes "Al-Fatihah 1:1" (sura 1) from "Al-Fatihah
     * 45:1" (sura 45), two suras with the same transliteration. When the chapter
     * is not a sura number it is ignored, because "Al-Baqarah 2:255" repeats the
     * sura and nobody writes "Al-Baqarah 255:1" meaning anything.
     */
    const isQuran = candidate.textId === 'quran';
    const sura = Number(candidate.book);
    let bookChapter = chapter;

    if (isQuran) {
      if (chapter >= 1 && chapter <= 114 && chapter !== sura) continue;
      bookChapter = 1;
    }

    const passageKey = `${candidate.textId}:${candidate.book}:${bookChapter}:${verse}`;
    if (seen.has(passageKey)) continue;
    seen.add(passageKey);
    matches.push({ ...candidate, chapter: bookChapter, verse, passageKey, bookLabel: candidate.book });
  }

  return matches;
}

/** True when the input is unambiguously a reference and can be navigated to. */
export function isUnambiguousCitation(input: string): boolean {
  return parseCitation(input).length === 1;
}
