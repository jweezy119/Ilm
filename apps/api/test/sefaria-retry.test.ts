import { afterEach, describe, expect, it, vi } from 'vitest';
import { getJson } from '../scripts/ingest';

/**
 * A previous ingest died at Genesis.10 with HTTP 429 after three fast requests:
 * the retry backoff was 500ms and ignored Retry-After. This checks the two
 * behaviours that keep an unattended bootstrap alive.
 */
describe('ingest HTTP retry', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.INGEST_RETRY_BASE_MS;
  });

  it('retries a rate-limited request and returns the later success', async () => {
    process.env.INGEST_RETRY_BASE_MS = '0';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getJson('https://example.test/texts/Genesis.1', 'sefaria Genesis.1', 3)).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after the requested number of attempts', async () => {
    process.env.INGEST_RETRY_BASE_MS = '0';
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getJson('https://example.test/texts/Genesis.10', 'sefaria Genesis.10', 3)).rejects.toThrow('HTTP 429');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry a 404, which is a real answer for a missing tractate', async () => {
    process.env.INGEST_RETRY_BASE_MS = '0';
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getJson('https://example.test/texts/Nope', 'sefaria Nope', 3)).rejects.toThrow('404');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
