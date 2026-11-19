import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A quick tunnel has no DNS and no Cloudflare Access in front of it, so the
 * app itself offers a Basic gate. It must be wired at both build and runtime:
 * middleware reads process.env, and Next compiles the edge bundle at build.
 */
const readWeb = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');
const readRepo = (p: string) => readFileSync(join(__dirname, '..', '..', '..', '..', p), 'utf8');

describe('tunnel basic auth', () => {
  it('challenges unauthenticated page requests', () => {
    const middleware = readWeb('src/middleware.ts');
    expect(middleware).toContain('process.env.ILM_BASIC_USER');
    expect(middleware).toContain('process.env.ILM_BASIC_PASS');
    expect(middleware).toContain("'WWW-Authenticate': 'Basic realm=\"Ilm\", charset=\"UTF-8\"'");
    expect(middleware).toContain('status: 401');
    expect(middleware).toContain('atob(');
    // The locale middleware still runs for authenticated requests.
    expect(middleware).toContain('return intlMiddleware(request)');
  });

  it('is disabled unless both values are set', () => {
    const middleware = readWeb('src/middleware.ts');
    expect(middleware).toContain('if (!user || !password) return true');
  });

  it('is passed to the web image at build time and runtime', () => {
    const compose = readRepo('deploy/docker-compose.tunnel.yml');
    const dockerfile = readRepo('apps/web/Dockerfile');
    for (const name of ['ILM_BASIC_USER', 'ILM_BASIC_PASS']) {
      expect(compose).toContain(`${name}: \${${name}:-}`);
      expect(dockerfile).toContain(`ARG ${name}=`);
      expect(dockerfile).toContain(`ENV ${name}=$${name}`);
    }
  });
});
