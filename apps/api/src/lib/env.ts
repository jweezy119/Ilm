/**
 * Local environment loading.
 *
 * Configuration comes from the environment. `apps/api/.env` is a local convenience
 * layered on top of it: anything already in the environment wins, so a host that
 * injects real values is never overridden by a file left behind on disk.
 *
 * Loaded explicitly by every entry point — the server and the ingest and index
 * scripts — because a script that silently ran without the key would fall back to
 * local scoring and write those results over good ones without saying so.
 */
export function loadLocalEnv(): void {
  if (process.env.NODE_ENV === 'production') return;
  if (typeof process.loadEnvFile !== 'function') return;

  try {
    process.loadEnvFile();
  } catch {
    // No .env file. Every value has a default or is optional.
  }
}
