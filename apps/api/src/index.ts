/**
 * Ilm API — Fastify entry point.
 */

import { execFileSync } from 'node:child_process';
import { loadLocalEnv } from './lib/env';

loadLocalEnv();

import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { registerRoutes } from './routes/api';
import { HttpError } from './lib/errors';
import { initializeOramaIndex } from './search/engine';
import { prisma } from './services/passage';
import { getJevJudge } from './services/typesafe-client';

async function main(): Promise<void> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      ...(process.env.NODE_ENV !== 'production'
        ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
        : {}),
    },
    ajv: { customOptions: { strict: false, coerceTypes: true } },
  });

  // Parses the request cookie and exposes `reply.setCookie`, which the library
  // needs to mint an anonymous id. Registered before the routes so that a
  // reader's first request can be given a cookie by the same response that
  // serves it.
  await app.register(fastifyCookie, {});

  await app.register(fastifyHelmet, { contentSecurityPolicy: false });

  await app.register(fastifyCors, {
    origin: process.env.CORS_ORIGIN?.split(',').map((o) => o.trim()) ?? ['http://localhost:3000'],
    credentials: true,
  });

  await app.register(fastifyRateLimit, {
    max: Number(process.env.RATE_LIMIT_MAX ?? 600),
    timeWindow: Number(process.env.RATE_LIMIT_WINDOW ?? 60000),
  });

  // Fastify 5 types the handler's error as `unknown`, so the shape Fastify errors
  // actually have is recovered here once rather than asserted at each use.
  app.setErrorHandler((rawError: unknown, request, reply) => {
    if (rawError instanceof HttpError) {
      return reply.status(rawError.statusCode).send({
        success: false,
        error: { code: rawError.code, message: rawError.message, ...(rawError.details ? { details: rawError.details } : {}) },
      });
    }

    if (rawError instanceof ZodError) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Request failed validation', details: rawError.flatten() },
      });
    }

    const error = rawError as { validation?: unknown; statusCode?: number; code?: string; message?: string };

    if (error.validation) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: error.message, details: error.validation },
      });
    }

    const status = typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (status >= 500) request.log.error({ err: error }, 'request failed');

    return reply.status(status).send({
      success: false,
      error: {
        code: status >= 500 ? 'INTERNAL_ERROR' : (error.code ?? 'ERROR'),
        message: status >= 500 && process.env.NODE_ENV === 'production' ? 'Something went wrong' : error.message,
      },
    });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({
      success: false,
      error: { code: 'NOT_FOUND', message: `${request.method} ${request.url} is not a route` },
    })
  );

  await registerRoutes(app);

  // Warm the search index but never block startup on it.
  initializeOramaIndex()
    .then(() => app.log.info('search index ready'))
    .catch((error) => app.log.error({ err: error }, 'search index unavailable; searches will be degraded until it is built'));

  const jev = getJevJudge();
  if (!jev.available) {
    app.log.warn(`Jev disabled (${jev.reason}). Recommendations and themes fall back to local scoring.`);
  }

  const port = Number(process.env.PORT ?? 4000);
  const host = process.env.HOST ?? '0.0.0.0';

  // Pending migrations are applied before the server accepts traffic.
  //
  // The host's build command generates the Prisma client but does not migrate, so
  // code that reads a new table deploys cleanly and then fails every request that
  // touches it. Doing it here means a schema change cannot ship ahead of its
  // migration.
  //
  // A failure exits non-zero rather than starting: a half-migrated database
  // cannot serve requests anyway, and failing the boot rolls the deploy back to a
  // commit whose code matches the schema, which does work. Starting anyway would
  // leave the service up and returning 500s.
  if (process.env.SKIP_MIGRATE !== '1') {
    app.log.info('applying pending migrations');
    try {
      execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
        cwd: new URL('..', import.meta.url).pathname,
        stdio: 'inherit',
        env: process.env,
        timeout: Number(process.env.MIGRATE_TIMEOUT_MS ?? 120_000),
      });
    } catch (error) {
      app.log.error({ err: error }, 'migrate deploy failed — refusing to start with a schema the code does not match');
      process.exit(1);
    }
  }

  // Auto-ingest Enoch if it's missing from the database
  try {
    const enochCount = await prisma.passage.count({ where: { textId: 'enoch' } });
    if (enochCount === 0) {
      app.log.info('Auto-ingesting Enoch passages...');
      execFileSync('npx', ['tsx', 'scripts/ingest-enoch.ts'], {
        cwd: new URL('..', import.meta.url).pathname,
        stdio: 'inherit',
        env: process.env,
      });
      app.log.info('Successfully auto-ingested Enoch.');
    }
  } catch (error) {
    app.log.error({ err: error }, 'Failed to check or auto-ingest Enoch.');
  }

  await app.listen({ port, host });
  app.log.info(`Ilm API listening on http://${host}:${port}`);

  /*
   * Check Sefaria-derived translations against Sefaria, in the background.
   *
   * Some Torah rows were written by a markup stripper that untagged Sefaria's
   * inline footnotes instead of removing them, so a translator's note runs into
   * the middle of the verse — Genesis 1:1 as "When God began to createaWhen God
   * began to create In contrast to others ...". The stripper was fixed and
   * tested; the rows were not, because the script that writes them only inserted
   * what was missing. Re-running that script needs a database URL and therefore a
   * shell, and this plan does not have one, so the app checks itself.
   *
   * Each row records whether it has been compared, so the first pass walks the
   * Sefaria corpora once and later passes find nothing to do. Per row rather than
   * per translation, so an interrupted run resumes where it stopped.
   *
   * Deliberately after listen() and never awaited: it makes network calls to a
   * third party and must never sit between a deploy and its first request.
   * Bounded by a deadline, so it cannot become an outage.
   *
   * On an interval as well as at boot, because a boot-only repair is one that
   * waits for the next deploy to be any use at all — and a deploy can be missed.
   * That is not hypothetical: this sat undeployed for hours while the corpus
   * stayed broken. Re-running is nearly free once caught up, and the status
   * endpoint exists so the question can be answered without a shell.
   */
  void (async () => {
    try {
      const { startSefariaMaintenance } = await import('./services/sefaria-repair');
      startSefariaMaintenance();
    } catch (error) {
      // Swallowed on purpose. A check that fails to start is something to notice
      // in the logs; it is never a reason to take a working service down.
      app.log.error({ err: error }, 'Sefaria translation check failed to start');
    }
  })();

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('Failed to start Ilm API:', error);
  process.exit(1);
});
