/**
 * Running the check more than once, and reporting whether it worked.
 *
 * Every question about this feature has been the same two questions — did it
 * run, and could it reach Sefaria — and the only answer available was a log,
 * which is precisely what an operator without a shell does not have. So the
 * behaviours pinned here are the ones that decide those answers: overlap is
 * refused, the interval has a floor, and the status distinguishes "never ran"
 * from "ran and could not answer".
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const service = readFileSync(resolve(__dirname, '../src/services/sefaria-repair.ts'), 'utf8');
const boot = readFileSync(resolve(__dirname, '../src/index.ts'), 'utf8');
const routes = readFileSync(resolve(__dirname, '../src/routes/api.ts'), 'utf8');

describe('scheduling', () => {
  it('runs at boot and then on an interval', () => {
    // Boot-only is a repair that waits for the next deploy to be any use at
    // all. This one sat undeployed for hours with the corpus still broken.
    expect(service).toContain('startSefariaMaintenance');
    expect(service).toContain("void runRepairOnce('boot');");
    expect(service).toContain("void runRepairOnce('interval');");
    expect(service).toContain('SEFARIA_REPAIR_INTERVAL_MS');
  });

  it('refuses to overlap two passes', () => {
    // A boot run on a slow connection can outlive the first interval, and two
    // passes over the same rows would double the requests to somebody else's
    // free API for no benefit. Skipped rather than queued, so a backlog cannot
    // build up behind a slow run.
    expect(service).toMatch(/if \(status\.inFlight\) return repairStatus\(\);/);
    expect(service).toContain('status.inFlight = true;');
    expect(service).toContain('status.inFlight = false;');
  });

  it('has a floor on the interval', () => {
    // Below a minute this is a load generator against a third party rather than
    // a repair, so the floor is enforced rather than trusted.
    expect(service).toMatch(/every < 60_000/);
    expect(service).toContain('Number(process.env.SEFARIA_REPAIR_INTERVAL_MS ?? 30 * 60_000)');
  });

  it('does not hold the process open', () => {
    // An un-unref'd interval keeps Node alive through a shutdown, which turns
    // every deploy into a slow stop.
    expect(service).toContain('timer.unref?.();');
    expect(service).toContain('stopSefariaMaintenance');
  });

  it('is still switchable off', () => {
    // Owned by the service, which is where the schedule lives, so the entry
    // point only has to start it.
    expect(service).toContain("process.env.SKIP_SEFARIA_REPAIR === '1'");
  });

  it('is started detached, after listen, and never awaited', () => {
    const listenIndex = boot.indexOf('await app.listen');
    const hookIndex = boot.indexOf('startSefariaMaintenance');
    expect(listenIndex).toBeGreaterThan(-1);
    expect(hookIndex).toBeGreaterThan(listenIndex);
    expect(boot).toContain('void (async () => {');
  });

  it('cannot take the service down', () => {
    expect(boot).toMatch(/catch \(error\)[\s\S]{0,200}Sefaria translation check failed to start/);
  });
});

describe('the status it reports', () => {
  it('separates "never ran" from "ran and could not answer"', () => {
    // The two failures look identical from outside and need opposite responses:
    // deploy, or stop asking Sefaria. `everRan` tells them apart.
    expect(service).toContain('everRan: boolean;');
    expect(service).toContain('consecutiveUnresolved: number;');
    expect(service).toMatch(/checked > 0 && report\.repaired === 0 && report\.alreadyCorrect === 0/);
  });

  it('records whether the corpus is caught up', () => {
    expect(service).toContain('caughtUp: boolean;');
    expect(service).toMatch(/caughtUp = report\.checked === 0 && !report\.truncated/);
  });

  it('records how long a run took, so a hung one is visible', () => {
    expect(service).toContain('lastDurationMs: number | null;');
    expect(service).toContain('lastDurationMs = Date.now() - startedAt;');
  });

  it('is reachable without a shell', () => {
    expect(routes).toContain("app.get('/api/maintenance/sefaria'");
    // Counts and timings only — no secrets, and not the text being repaired.
    expect(routes).toContain('ok(repairStatus())');
  });

  it('reports the outstanding count per corpus', () => {
    expect(service).toContain('outstandingByCorpus: Record<string, number>;');
    expect(service).toContain('unverifiedCount');
  });
});
