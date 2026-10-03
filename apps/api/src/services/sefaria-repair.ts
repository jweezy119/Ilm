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

/** Rows held in memory at once. Flat, so the heap does not scale with the corpus. */
const BATCH_ROWS = 150;
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

/**
 * Why a chapter could not be fetched, kept rather than collapsed to null.
 *
 * The first version returned null for everything — a 403 from a host that
 * blocks cloud ranges, a 429 from rate limiting, a DNS failure and a TLS failure
 * all produced the same silent "unresolved". That is exactly the distinction
 * needed to act, and it cost a whole deployment cycle to find out it was missing:
 * the run reported thirty thousand unresolved rows and no way to say why.
 */
type FetchOutcome =
  | { ok: true; text: unknown[] }
  | { ok: false; reason: string };

async function getJson(url: string): Promise<FetchOutcome> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const response = await fetch(url, {
      // A browser-like agent, because Sefaria is a public site rather than an
      // API with published terms, and an unrecognised agent is the sort of thing
      // that gets refused outright. It was 'ilm/1.0' before, which is a thing
      // nobody asked for and which a rate limiter may reasonably single out.
      headers: {
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: 'application/json',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);

    if (!response.ok) {
      return { ok: false, reason: `HTTP ${response.status} ${response.statusText}`.trim() };
    }
    // json() is typed unknown here, so the shape it is read through is named
    // rather than inferred away.
    const body = (await response.json()) as { text?: unknown } | null;
    const text = Array.isArray(body?.text) ? (body.text as unknown[]) : [];
    // An empty chapter is a legitimate answer from Sefaria — a chapter it does
    // not hold in this version — and must not be confused with being refused.
    return { ok: true, text };
  } catch (error) {
    const name = error instanceof Error ? error.name : 'Error';
    const detail = error instanceof Error ? error.message : String(error);
    // Node's fetch collapses DNS, TLS and connection-reset into one opaque
    // TypeError, so the class is the most there is to report.
    return { ok: false, reason: name === 'AbortError' ? `timeout after ${REQUEST_TIMEOUT_MS}ms` : `${name}: ${detail}` };
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
async function fetchChapter(
  bookSlug: string,
  chapterNum: number,
  versionName: string
): Promise<{ ok: true; text: unknown[] } | { ok: false; reason: string }> {
  const base = `${SEFARIA_API}/texts/${encodeURIComponent(`${bookSlug}.${chapterNum}`)}`;
  const common = 'context=0&commentary=0&pad=0&stripItags=1';

  const named = await getJson(`${base}?ven=${encodeURIComponent(versionName)}&${common}`);
  if (named.ok && named.text.length > 0) return named;

  // A stored name that is not a Sefaria version title resolves to nothing — the
  // Torah's primary is labelled "Sefaria English (JPS 1985)" and was fetched
  // without a version parameter in the first place — so the default is asked the
  // same way.
  const fallback = await getJson(`${base}?${common}`);
  if (fallback.ok) return fallback;

  // Both refused. Report the refusal rather than the last, emptier answer.
  return named.ok ? { ok: true, text: [] } : fallback;
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
  /** Rows Sefaria would not answer for: no version, no verse, or a refusal. */
  unresolved: number;
  /** True when the deadline stopped the run with rows still unchecked. */
  truncated: boolean;
  /**
   * Why the fetches failed, most frequent first. Empty when nothing failed.
   *
   * The distinction that matters is "HTTP 403" — a host refusing this network —
   * against "HTTP 429" — throttling, which wants a slower run — against a
   * network-level TypeError, which is our problem and not Sefaria's.
   */
  fetchFailures: Record<string, number>;
  /**
   * True when the run gave up early because Sefaria was not answering at all.
   *
   * Without this the run keeps going: a thousand chapters, each refused, each
   * counted as unresolved, and the only trace is a number nobody can explain.
   * Refusing to continue is both politer to a third party and faster to
   * diagnose — five requests tell the story that twelve hundred would.
   */
  abortedUnreachable: boolean;
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
    fetchFailures: {},
    abortedUnreachable: false,
  };

  /*
   * Give up once Sefaria is plainly not answering.
   *
   * Five chapters in a row, none with a verse in them, is not a chapter it does
   * not hold — it is a host that is refusing us, and continuing would be a
   * thousand requests at somebody who has already said no.
   */
  const MAX_CONSECUTIVE_FETCH_FAILURES = 5;
  let consecutiveFetchFailures = 0;
  const noteFailure = (reason: string) => {
    report.fetchFailures[reason] = (report.fetchFailures[reason] ?? 0) + 1;
  };

  const deadline = Date.now() + budgetMs;

  /*
   * Streamed in batches, not read in one go.
   *
   * The first version took the whole unchecked set at once — thirty thousand
   * rows with a nested translation and passage each — and the API is started
   * with a capped heap (`--max-old-space-size=${API_HEAP_MB:-320}`). That is a
   * large allocation on a small budget, and the symptom is not a crash in the
   * repair but the *process* being killed: Render restarts the API, the web's
   * proxy sees ECONNRESET and logs "socket hang up", and the repair starts over
   * from the beginning on the next boot. It never finishes, and it takes the
   * service down repeatedly on the way.
   *
   * So the set is walked with a cursor, a batch at a time, and nothing larger
   * than one batch is ever resident. Memory is flat whether the corpus is a
   * thousand rows or a million, and the deadline still cuts the run short.
   */
  let cursor: string | undefined;
  let seen = 0;

  while (seen < limit) {
    if (Date.now() >= deadline) {
      report.truncated = true;
      break;
    }

    const batchSize = Math.min(BATCH_ROWS, limit - seen);
    let rows: any[];
    try {
      rows = await prisma.passageTranslation.findMany({
        where: {
          verifiedAt: null,
          translation: { textId: { in: [...SEFARIA_CORPORA] } },
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        select: {
          id: true,
          text: true,
          translation: { select: { id: true, name: true, textId: true } },
          passage: { select: { id: true, bookSlug: true, chapterNum: true, verseNum: true } },
        },
        orderBy: { id: 'asc' },
        take: batchSize,
      });
    } catch {
      // A repair that cannot even read must never take the service down.
      return report;
    }

    if (rows.length === 0) break;
    seen += rows.length;
    cursor = rows[rows.length - 1].id;

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

    const now = new Date();

    for (const [, group] of byChapter) {
      if (Date.now() >= deadline) {
        report.truncated = true;
        break;
      }

      const first = group[0];
      const outcome = await fetchChapter(first.bookSlug, first.chapterNum, first.translationName);

      if (!outcome.ok) {
        noteFailure(outcome.reason);
        consecutiveFetchFailures += 1;
        report.unresolved += group.length;
        report.checked += group.length;
        if (consecutiveFetchFailures >= MAX_CONSECUTIVE_FETCH_FAILURES) {
          report.abortedUnreachable = true;
          report.truncated = true;
          break;
        }
        await sleep(REQUEST_DELAY_MS);
        continue;
      }

      // A chapter with no English in this version is Sefaria answering, not
      // refusing, so the streak resets and the run continues.
      if (outcome.text.length === 0) consecutiveFetchFailures = 0;
      else consecutiveFetchFailures = 0;

      const verses = outcome.text;

      for (const candidate of group) {
        report.checked += 1;
        const raw = verses[candidate.verseNum - 1];

        if (typeof raw !== 'string') {
          // Sefaria has no text for this verse in this version. Left unchecked,
          // so a later run can pick it up — marking it verified would silently
          // accept whatever happens to be stored.
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

    if (report.truncated) break;
  }

  return report;
}

/* ============================================================================
   Running it more than once, and being able to see whether it worked
   ============================================================================ */

/**
 * What the last run did, so this can be answered without a shell.
 *
 * Every question about this feature turned out to be the same question — did it
 * run, and could it reach Sefaria — and the only way to answer it was a log,
 * which is the one thing an operator without a shell does not have. Two numbers
 * distinguish the failure modes that look identical from the outside: a
 * deployment that never happened reports no run at all, while a deployment that
 * ran but could not reach Sefaria reports `unresolved` equal to `checked`.
 */
export interface RepairStatus {
  /** Whether a run has ever completed on this process. */
  everRan: boolean;
  inFlight: boolean;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastDurationMs: number | null;
  /** The last report, or null before the first run finishes. */
  lastReport: RepairReport | null;
  /**
   * True when the last run gave up because Sefaria was not answering.
   *
   * The one flag that separates "we could not fix it" from "we could not reach
   * it" — different problems, different fixes, and until now the same silence.
   */
  sefariaUnreachable: boolean;
  outstandingByCorpus: Record<string, number>;
  /** Consecutive runs that checked rows and resolved none of them. */
  consecutiveUnresolved: number;
  /** True when the last run checked nothing at all, i.e. the corpus is clean. */
  caughtUp: boolean;
  intervalMs: number | null;
}

const status: RepairStatus = {
  everRan: false,
  inFlight: false,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastDurationMs: null,
  lastReport: null,
  sefariaUnreachable: false,
  outstandingByCorpus: {},
  consecutiveUnresolved: 0,
  caughtUp: false,
  intervalMs: null,
};

export function repairStatus(): RepairStatus {
  return { ...status, lastReport: status.lastReport ? { ...status.lastReport } : null };
}

/**
 * Run the check once, recording what happened.
 *
 * Guarded against overlap rather than merely scheduled: a boot run on a slow
 * connection can still be going when the first interval fires, and two passes
 * over the same rows would double the requests to somebody else's free API for
 * no benefit. A run that arrives while one is in flight is skipped, not queued.
 */
export async function runRepairOnce(reason: string): Promise<RepairStatus> {
  if (status.inFlight) return repairStatus();

  status.inFlight = true;
  status.lastStartedAt = new Date().toISOString();
  const startedAt = Date.now();

  try {
    const report = await repairSefariaTranslations();

    status.everRan = true;
    status.lastReport = report;
    status.sefariaUnreachable = report.abortedUnreachable;
    /*
     * Counted after the run, not before.
     *
     * Read before, it reports what was waiting rather than what is: a run that
     * cleared six thousand rows would still show six thousand outstanding, and
     * the number would be wrong in exactly the case somebody is watching it to
     * find out whether the repair worked. It costs one query, which is nothing
     * next to the run itself.
     */
    try {
      status.outstandingByCorpus = await unverifiedCount();
    } catch {
      // Leave the previous value rather than reporting a failure as zero.
    }
    status.consecutiveUnresolved = report.checked > 0 && report.repaired === 0 && report.alreadyCorrect === 0
      ? status.consecutiveUnresolved + 1
      : 0;
    status.caughtUp = report.checked === 0 && !report.truncated;

    return repairStatus();
  } catch {
    // Recorded as an attempt that resolved nothing, which is what it is.
    status.consecutiveUnresolved += 1;
    return repairStatus();
  } finally {
    status.inFlight = false;
    status.lastFinishedAt = new Date().toISOString();
    status.lastDurationMs = Date.now() - startedAt;
    void reason;
  }
}

let timer: NodeJS.Timeout | null = null;

/**
 * Check once at boot, then on an interval.
 *
 * The interval exists because the boot run is not enough on its own. A deploy
 * can be missed — this service had one sitting undeployed for hours while the
 * corpus stayed broken and nothing but a log could have said so — and a repair
 * that only runs when the process starts is a repair that waits for the next
 * deploy to be useful. Re-running is nearly free once the corpus is caught up:
 * one query finds nothing unchecked and the pass ends.
 *
 * The timer is unref'd so it never holds the process open on shutdown, and the
 * whole thing is skipped by SKIP_SEFARIA_REPAIR=1 like the boot run before it.
 */
export function startSefariaMaintenance(intervalMs?: number): void {
  if (process.env.SKIP_SEFARIA_REPAIR === '1') return;

  const every = intervalMs ?? Number(process.env.SEFARIA_REPAIR_INTERVAL_MS ?? 30 * 60_000);
  if (!Number.isFinite(every) || every < 60_000) {
    // Below a minute this becomes a load generator against somebody else's free
    // API rather than a repair, so the floor is enforced rather than trusted.
    status.intervalMs = null;
    return;
  }
  status.intervalMs = every;

  // Detached, like the boot run before it: the service is already listening and
  // must not sit behind a third party's API.
  void runRepairOnce('boot');

  timer = setInterval(() => {
    void runRepairOnce('interval');
  }, every);
  timer.unref?.();
}

export function stopSefariaMaintenance(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
