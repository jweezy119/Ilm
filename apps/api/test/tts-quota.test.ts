import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(__dirname, '../src/routes/api.ts'), 'utf8');

describe('tts quota', () => {
  it('caps the free upstream independently of the global rate limit', () => {
    const start = source.indexOf("app.get('/api/tts'");
    expect(start, 'tts route is missing').toBeGreaterThan(-1);
    const route = source.slice(start, start + 500);
    expect(route).toContain('rateLimit');
    expect(route).toContain('max: 30');
    expect(route).toContain("timeWindow: '1 minute'");
  });
});
