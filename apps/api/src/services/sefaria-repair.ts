/**
 * Checking Sefaria-derived translations against Sefaria, from inside the app.
 *
 * ## Why this exists
 *
 * Some Torah rows were written by a markup stripper that untagged Sefaria's inline
 * footnotes instead of removing them, so a translator's note runs into the middle
 * of the verse: Genesis 1:1 as "When God began to createaWhen God began to create
 * In contrast to others "In the beginning God created." heaven and earth—".
 *
 * The stripper was fixed and tested. The rows were not, because the script that
 * writes them only inserted what was missing — an insert-only script cannot carry
 * a correction. Re-running that script needs a database URL, which means a shell,
 * and this plan does not have one. So the app does it.
 *
 * ## Why not pattern-match the damage
 *
 * It was tried and it does not work. "createaWhen" is caught by a letter welded
 * to a capital; "wasawithout" is not, because nothing follows in capitals, and
 * every pattern loose enough to catch that one also matches ordinary words like
 * "and". Guessing at damage would leave some verses broken while reporting
 * success, which is worse than not reporting at all.
 *
 * So there is no guess. Each row records whether it has been compared with
 * Sefaria's current text, and the repair is the difference between the two. Every
 * row written before this existed is unchecked, so the first boot walks the
 * Sefaria corpora once and later boots find nothing to do.
 *
 * ## Why this is safe to run on a live service
 *
 * It runs after listen(), so it never sits between a deploy and its first
 * request. It is bounded by a deadline. It is per row, so an interrupted run
 * resumes exactly where it stopped rather than re-fetching whole chapters. And
 * the only thing it ever writes is Sefaria's own text for that verse, so a row
 * that was never damaged can only end up identical to itself.
 */

import { prisma } from './passage';
import { stripSefariaHtml } from './sefaria';

const SEFARIA_API = 'https://www.sefaria.org/api';

/** Be polite: this is somebody else's free API and a repair is not urgent. */
const REQUEST_DELAY_MS = 350;
const REQUEST_TIMEOUT_MS = 30_000;

/** Corpora whose English comes from Sefaria, and so can be checked against it. */
const SEFARIA_CORPORA = ['torah', 'ot', 'talmud'] as const;

interface Candidate {
  /** passage_translations.id, so a row is written by its own key. */
  rowId: string;
  passageId: string;
  textId: string;
  bookSlug: string;
  chapterNum: number;
  verseNum: number;
  translationId: string;
  translationName: string;
  text: string;
}

async function getJson(url: string): Promise<any | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const response = await fetch(url, {
      headers: { 'User-Agent': 'ilm/1.0 (+https://ilm-web.onrender.com)' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One chapter of a version's English text, with its footnotes already gone.
 *
 * `ven` is tried first and the default is used as a fallback, because the
 * version names in this database are not all Sefaria's. The Torah's primary
 * translation is labelled "Sefaria English (JPS 1985)" — a name chosen for
 * display by the ingest and not a Sefaria `versionTitle` at all, so asking for it
 * by name returns nothing. Those rows were fetched without `ven` in the first
 * place, so asking the same way again returns the same version they came from.
 * The two versions whose names *are* real titles resolve directly.
 *
 * `stripItags=1` is what makes this safe: Sefaria removes the whole footnote,
 * marker and body, rather than leaving the text for us to unpick. The alternative
 * is the exact failure this module exists to undo.
 */
async function fetchChapter(bookSlug: string, chapterNum: number, versionName: string): Promise<unknown[]> {
  const base = `${SEFARIA_API}/texts/${encodeURIComponent(`${bookSlug}.${chapterNum}`)}`;
  const common = 'context=0&commentary=0&pad=0&stripItags=1';

  const named = await getJson(`${base}?ven=${encodeURIComponent(versionName)}&${common}`);
  const namedVerses = Array.isArray(named?.text) ? (named.text as unknown[]) : [];
  if (namedVerses.length > 0) return namedVerses;

  const fallback = await getJson(`${base}?${common}`);
  return Array.isArray(fallback?.text) ? (fallback.text as unknown[]) : [];
}

/** How many rows still need checking, by corpus. Cheap enough for a log line. */
export async function unverifiedCount(): Promise<Record<string, number>> {
  const rows = await prisma.passageTranslation.groupBy({
    by: ['translationId'],
    where: { verifiedAt: null, translation: { textId: { in: [...SEFARIA_CORPORA] } } },
    _count: { _all: true },
  });
  if (rows.length === 0) return {};

  const translations = await prisma.translation.findMany({
    where: { id: { in: rows.map((r) => r.translationId) } },
    select: { id: true, textId: true },
  });
  const textIdOf = new Map(translations.map((t) => [t.id, t.textId]));

  const out: Record<string, number> = {};
  for (const row of rows) {
    const textId = textIdOf.get(row.translationId);
    if (!textId) continue;
    out[textId] = (out[textId] ?? 0) + row._count._all;
  }
  return out;
}

export interface RepairReport {
  checked: number;
  repaired: number;
  alreadyCorrect: number;
  /** Rows Sefaria would not answer for: no version, no verse, request failed. */
  unresolved: number;
  /** True when the deadline stopped the run with rows still unchecked. */
  truncated: boolean;
}

/**
 * Compare unchecked rows with Sefaria and rewrite the ones that differ.
 *
 * `limit` bounds the rows read, `budgetMs` the wall clock. Both exist so this can
 * be called from a boot without becoming an outage.
 */
export async function repairSefariaTranslations(
  options: { budgetMs?: number; limit?: number } = {}
): Promise<RepairReport> {
  /*
   * Sized to finish the whole Sefaria corpus in one pass, because "it repairs a
   * bit more on every deploy" is not a plan — it would take a dozen deployments
   * and would leave the corpus broken in between. At 350ms per chapter the
   * corpora are roughly fifteen minutes of requests; the job is detached, so the
   * service is answering throughout, and every boot after this one finds nothing
   * unchecked and costs a single query.
   *
   * Lower SEFARIA_REPAIR_BUDGET_MS to spread it over several restarts, or set
   * SKIP_SEFARIA_REPAIR=1 to turn it off.
   */
  const budgetMs = options.budgetMs ?? Number(process.env.SEFARIA_REPAIR_BUDGET_MS ?? 900_000);
  const limit = options.limit ?? 30_000;

  const report: RepairReport = {
    checked: 0,
    repaired: 0,
    alreadyCorrect: 0,
    unresolved: 0,
    truncated: false,
  };

  let rows: any[];
  try {
    rows = await prisma.passageTranslation.findMany({
      where: { verifiedAt: null, translation: { textId: { in: [...SEFARIA_CORPORA] } } },
      select: {
        id: true,
        text: true,
        translation: { select: { id: true, name: true, textId: true } },
        passage: { select: { id: true, bookSlug: true, chapterNum: true, verseNum: true } },
      },
      take: limit,
    });
  } catch {
    // A repair that cannot even read must never take the service down.
    return report;
  }

  if (rows.length === 0) return report;

  const candidates: Candidate[] = rows.map((r) => ({
    rowId: r.id,
    passageId: r.passage.id,
    textId: r.translation.textId,
    bookSlug: r.passage.bookSlug,
    chapterNum: r.passage.chapterNum,
    verseNum: r.passage.verseNum,
    translationId: r.translation.id,
    translationName: r.translation.name,
    text: r.text,
  }));

  // One request per chapter rather than per verse: a chapter's text travels
  // together, so one fetch settles every unchecked row in it.
  const byChapter = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const key = `${c.textId}|${c.bookSlug}|${c.chapterNum}|${c.translationId}`;
    const list = byChapter.get(key);
    if (list) list.push(c);
    else byChapter.set(key, [c]);
  }

  const deadline = Date.now() + budgetMs;

  for (const [, group] of byChapter) {
    if (Date.now() >= deadline) {
      report.truncated = true;
      break;
    }

    const first = group[0];
    const verses = await fetchChapter(first.bookSlug, first.chapterNum, first.translationName);

    const now = new Date();

    for (const candidate of group) {
      report.checked += 1;
      const raw = verses[candidate.verseNum - 1];

      if (typeof raw !== 'string') {
        // Sefaria has no text for this verse in this version. Left unchecked, so
        // a later run can pick it up if the row is ever corrected by hand —
        // marking it verified would silently accept whatever is stored.
        report.unresolved += 1;
        continue;
      }

      const clean = stripSefariaHtml(raw);
      if (!clean) {
        report.unresolved += 1;
        continue;
      }

      try {
        if (clean !== candidate.text) {
          await prisma.passageTranslation.update({
            where: { id: candidate.rowId },
            data: { text: clean, verifiedAt: now },
          });
          // The passage's own primary column can be the damaged one, so it is
          // rewritten in step; leaving it would swap one broken surface for
          // another. Only where it currently matches the damaged text, so a
          // primary set from a different source is never overwritten.
          await prisma.passage.updateMany({
            where: { id: candidate.passageId, primaryTranslation: candidate.text },
            data: { primaryTranslation: clean },
          });
          report.repaired += 1;
        } else {
          await prisma.passageTranslation.update({
            where: { id: candidate.rowId },
            data: { verifiedAt: now },
          });
          report.alreadyCorrect += 1;
        }
      } catch {
        report.unresolved += 1;
      }
    }

    await sleep(REQUEST_DELAY_MS);
  }

  return report;
}
