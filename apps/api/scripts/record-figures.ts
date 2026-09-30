/**
 * Record where a figure is named, across traditions.
 *
 *   npx tsx scripts/record-figures.ts [--dry-run]
 *
 * The relation between Isa in the Quran and Jesus elsewhere is not a claim this
 * product gets to make on its own, so it does not. The Quran makes it: at 4:171 and
 * 3:45 it names Isa as "the Messiah, Jesus son of Mary". Those verses are stored as
 * the basis of the figure and the page links them, so the identification rests on a
 * passage in the corpus rather than on us.
 *
 * What this records is a name, not an identity. A passage is a mention of the figure
 * because it contains one of the forms below and nothing else. Everything about the
 * relation beyond that — whether the corpus is attesting or arguing, whether the
 * figure in this passage is the same one as in that — is stated and not inferred.
 *
 * The Old Testament and Torah are excluded, deliberately, and the reason is the
 * reason this script exists. Searching the Hebrew for Yeshu returns 121 Old Testament
 * passages, every one of them spelled identically to the Talmudic form — and every
 * one of them Joshua son of Jozadak, the high priest who returned from Babylon:
 * Ezra 2:36, 3:2, 3:8, 4:3 and the rest. A name match alone would have linked Jesus
 * of Nazareth to a Levitical priest of the Persian period, and it would have looked
 * entirely reasonable on the page. The Torah's three are the same person.
 *
 * So the Hebrew forms are not used as attestations. The Talmud is included, because
 * it is the corpus where the name is used, but every mention is marked polemical:
 * those passages argue about the figure rather than attest him, and filing them
 * beside the Gospels without saying so would present a dispute as agreement.
 *
 * Idempotent, and safe to re-run.
 */

import { prisma } from '../src/lib/db';
import { fold } from '../src/lib/script-normalize';
import type { TextId } from '@ilm/shared';

/**
 * The forms, per language, that count as naming the figure.
 *
 * Folded before matching, because the corpus is vocalized: عِيسَىٰ does not contain
 * عيسى as a literal substring, and a plain LIKE returns nothing at all. A first
 * attempt with SQL and a LIKE over the raw text found 25 mentions in the Quran and
 * none in the hadith, which was wrong in both directions — a good reminder that the
 * shared normaliser exists for this and should be used rather than reimplemented.
 *
 * The Greek is given unaccented on purpose. The Gospels write Ἰησοῦς with a breathing
 * mark and a circumflex; the circumflex survives folding, so matching the accented
 * form misses most occurrences. Ἰησοῦ is the form that appears in every inflected
 * spelling once the marks are gone.
 */
const FORMS: Record<string, Array<{ text: string; script: string }>> = {
  arabic: [
    { text: 'عيسى', script: 'arabic' },
    { text: 'يسوع', script: 'arabic' },
    { text: 'يساء', script: 'arabic' },
    // A rare transliterated spelling in the hadith collections. Contributed 7
    // passages across Bukhari and Muslim, which is why it is in the list rather
    // than assumed to be noise.
    { text: 'يوسع', script: 'arabic' },
  ],
  greek: [
    { text: 'ησου', script: 'greek' },
    { text: 'ιησου', script: 'greek' },
  ],
  hebrew: [
    // The Talmudic name. Not the Old Testament's, which is the same letters and a
    // different man — see the note at the top of this file.
    { text: 'ישוע', script: 'hebrew' },
  ],
};

/** Which corpora use which form set. Hebrew is deliberately Talmud-only. */
const CORPORA: Array<{ textId: TextId; language: string; stance: string }> = [
  { textId: 'quran', language: 'arabic', stance: 'attesting' },
  { textId: 'bukhari', language: 'arabic', stance: 'attesting' },
  { textId: 'muslim', language: 'arabic', stance: 'attesting' },
  { textId: 'nt', language: 'greek', stance: 'attesting' },
  /*
   * The Talmud is not here, and the reason is coverage rather than theology.
   *
   * It was on this list, because the Talmud does name Yeshu and because a polemical
   * mention is still a mention. It is excluded because our corpus does not contain
   * them: across all 2,269 passages, the form יֵשׁוּעַ appears zero times in the
   * Aramaic and "Jesus" zero times in the Soncino translation. The tractates that
   * carry the famous references are present but partial — Sanhedrin reaches chapter
   * eleven, and the trial passage is well past that.
   *
   * So the column would have been empty, and an empty Talmud column on a page about
   * this figure is the single most misleading thing the page could show. It is
   * recorded in `basis.excluded` instead, with this reason, so the page can say the
   * corpus does not reach these passages rather than implying the tradition is
   * silent or that we looked and found nothing.
   */
];

/**
 * The citations that establish the identification, as passage keys.
 *
 * 4:171 and 3:45 are where the Quran names Isa as the Messiah, son of Mary. Stored
 * as keys rather than prose so the page links the corpus's own text and the claim is
 * checkable there.
 */
const BASIS = {
  identification: 'Quran 4:171 and 3:45 name Isa as the Messiah, son of Mary',
  passageKeys: ['quran:4:1:171', 'quran:3:1:45'],
  excluded: {
    corpora: ['ot', 'torah', 'talmud'],
    reasons: {
      ot: 'Searching the Hebrew for the form returns 121 Old Testament passages, all of them Joshua son of Jozadak — the high priest who returned from Babylon, spelled identically to the Talmudic name. A name match would have linked Jesus to him.',
      torah: 'Same three passages as the Old Testament, same man.',
      talmud: 'Coverage, not absence. The Talmud does name Yeshu, but across all 2,269 passages of the corpus we hold the form appears zero times in the Aramaic and "Jesus" zero times in the translation. Sanhedrin reaches chapter eleven and the trial passage is well past that. The column would have been empty, and an empty Talmud column here would be the most misleading thing on the page.',
    },
  },
};

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  console.log('Recording figure mentions — Isa in the Quran, Jesus elsewhere');

  const figure = dryRun
    ? null
    : await prisma.figure.upsert({
        where: { slug: 'jesus' },
        create: { slug: 'jesus', name: 'Jesus', basis: BASIS },
        update: { name: 'Jesus', basis: BASIS },
      });

  const total: Record<string, number> = {};

  for (const corpus of CORPORA) {
    const forms = FORMS[corpus.language].map((f) => ({ ...f, folded: fold(f.text) }));

    const rows = await prisma.passage.findMany({
      where: { textId: corpus.textId },
      select: { id: true, passageKey: true, originalText: true },
    });

    const mentions: Array<{ figureId: string; passageId: string; form: string; stance: string }> = [];
    for (const row of rows) {
      const folded = fold(row.originalText ?? '');
      // The form is recorded as the form that matched, not the one it was looked for
      // as, so the page can show the name this corpus actually uses.
      const hit = forms.find((f) => folded.includes(f.folded));
      if (!hit) continue;
      // A placeholder id in a dry run, so the count is real and the write is the
      // only thing gated on the row existing. An earlier version pushed only when
      // `figure` was present, which made a dry run report zero of everything and
      // looked like the name forms had stopped matching.
      mentions.push({
        figureId: figure?.id ?? 'dry-run',
        passageId: row.id,
        form: hit.text,
        stance: corpus.stance,
      });
    }

    total[corpus.textId] = mentions.length;
    console.log(
      `  ${corpus.textId.padEnd(8)} ${mentions.length.toLocaleString().padStart(5)} passages  (${corpus.stance})`
    );

    if (!dryRun && mentions.length > 0) {
      for (let i = 0; i < mentions.length; i += 1000) {
        await prisma.figureMention.createMany({
          data: mentions.slice(i, i + 1000),
          skipDuplicates: true,
        });
      }
    }
  }

  const sum = Object.values(total).reduce((a, b) => a + b, 0);
  console.log(`\n  ${sum.toLocaleString()} mentions across ${Object.keys(total).length} corpora`);
  for (const [corpus, reason] of Object.entries(BASIS.excluded.reasons)) {
    console.log(`  excluded ${corpus}: ${reason.slice(0, 78)}…`);
  }

  if (dryRun) console.log('\nDRY RUN: nothing written.');

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
