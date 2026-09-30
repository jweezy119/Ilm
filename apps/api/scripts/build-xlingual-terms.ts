/**
 * Build the cross-lingual term map into the database.
 *
 * Reads the theme labels already in the database, derives each theme's
 * original-language vocabulary, and upserts it into `xlingual_terms`. Idempotent:
 * re-running after a corpus change updates the numbers rather than duplicating
 * rows, and `--replace` clears first if a term has stopped qualifying.
 *
 *   npx tsx scripts/build-xlingual-terms.ts [--depth=150] [--replace] [--dry-run]
 */

import { prisma } from '../src/services/passage';
import { deriveTerms, MIN_SPECIFICITY, type DeriveInput } from '../src/services/xlingual';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const num = (flag: string, fallback: number) => {
    const inline = argv.find((a) => a.startsWith(`${flag}=`));
    if (inline) return Number(inline.slice(flag.length + 1));
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : fallback;
  };
  const depth = num('--depth', 150);
  const dryRun = argv.includes('--dry-run');
  const replace = argv.includes('--replace');

  const labels = await prisma.passageTheme.findMany({
    where: { score: { gt: 0.3 } },
    select: { themeId: true, passage: { select: { textId: true, originalText: true } } },
  });

  const input: DeriveInput[] = labels.map((l) => ({
    themeId: l.themeId,
    textId: l.passage.textId,
    originalText: l.passage.originalText ?? '',
  }));

  console.log(`Theme labels read   : ${labels.length}`);
  console.log(`Depth per theme     : ${depth}`);
  console.log(`Specificity floor   : ${MIN_SPECIFICITY}`);

  const terms = deriveTerms(input, { depth });

  const byLanguage = new Map<string, number>();
  const byTheme = new Map<string, number>();
  for (const t of terms) {
    byLanguage.set(t.language, (byLanguage.get(t.language) ?? 0) + 1);
    byTheme.set(t.theme, (byTheme.get(t.theme) ?? 0) + 1);
  }

  console.log(`\nTerms derived      : ${terms.length}`);
  console.log(`Themes covered     : ${byTheme.size}`);
  for (const [language, n] of [...byLanguage].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${language.padEnd(8)} ${String(n).padStart(4)}`);
  }

  if (dryRun) {
    const sample = [...byTheme.keys()].slice(0, 6);
    for (const theme of sample) {
      const of = terms.filter((t) => t.theme === theme).slice(0, 8);
      console.log(`\n  ${theme}`);
      console.log(`    ${of.map((t) => `${t.term}(${t.inPassages})`).join('  ')}`);
    }
    console.log('\nDry run. Nothing written.');
    return;
  }

  if (replace) {
    const deleted = await prisma.xlingualTerm.deleteMany();
    console.log(`\nCleared ${deleted.count} existing rows`);
  }

  let written = 0;
  for (const term of terms) {
    await prisma.xlingualTerm.upsert({
      where: { theme_language_term: { theme: term.theme, language: term.language, term: term.term } },
      create: term,
      update: { inPassages: term.inPassages, specificity: term.specificity },
    });
    written += 1;
  }

  const total = await prisma.xlingualTerm.count();
  console.log(`Rows written        : ${written}`);
  console.log(`Rows in table       : ${total}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
