/**
 * The one database client for this process.
 *
 * There used to be three — services/passage, search/orama and search/postgres —
 * and each opens its own pool sized `cpus * 2 + 1`. On a two-CPU instance that is
 * roughly fifteen connections, and the host's connection pooler has a limit below
 * that. Exceeding it does not fail the query: connections queue, so requests hang
 * until the caller gives up. That presented as /health never responding, the
 * service failing its health check, and Render cycling instances.
 *
 * One client, one pool, sized to the instance.
 *
 * A shutdown hook is registered once here rather than in every caller, so the
 * process releases its connections on SIGTERM instead of being killed with them
 * open.
 */
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { __ilmPrisma?: PrismaClient };

/**
 * Reused across hot reloads in development. Without this, `tsx watch` opens a new
 * pool on every file change until the database refuses connections.
 */
export const prisma =
  globalForPrisma.__ilmPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.__ilmPrisma = prisma;
