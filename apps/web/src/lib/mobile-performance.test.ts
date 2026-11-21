import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Mobile performance is mostly about not doing work the reader cannot see.
 *
 * A slow connection should not pay for a model re-rank, a long chapter should
 * not render every verse at once, turning the page should use the idle time
 * already available, and audio should stop when the tab is hidden. These are
 * browser APIs with no server change, so a static join check is enough to stop
 * one of them being quietly dropped.
 */
const read = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');

const search = read('src/app/[locale]/page.tsx');
const reader = read('src/app/[locale]/read/page.tsx');

describe('mobile performance', () => {
  it('skips semantic re-ranking on a slow connection unless the reader overrides it', () => {
    expect(read('src/lib/useSlowConnection.ts')).toContain('saveData');
    expect(search).toContain('useSlowConnection()');
    expect(search).toContain('async (term: string, texts: TextId[], useSemantic = effectiveSemantic)');
    expect(search).toContain('checked={effectiveSemantic}');
    expect(search).toContain("t('slowNetwork')");
    expect(read('src/lib/useSlowConnection.ts')).toContain('useSyncExternalStore');
    // A shared literal link and its scope must survive the recipient's own
    // connection defaults, without re-running on every URL rewrite.
    expect(search).toContain('literalParam');
    expect(search).toContain('lastDeepLink.current');
    expect(search).toContain('runSearch(candidate, scope, semanticFromLink ?? effectiveSemantic)');
  });

  it('renders long lists in batches as they enter view', () => {
    const inView = read('src/lib/useInView.ts');
    expect(inView).toContain('IntersectionObserver');
    // A null ref at mount used to install no observer at all, capping every
    // list at its first batch. The sentinel must be held in state.
    expect(inView).toContain('useCallback((element: T | null) => setNode(element)');
    expect(inView).toContain('}, [node, rootMargin]);');
    expect(search).toContain('results.slice(0, visibleResults)');
    expect(search).toContain('moreResultsRef');
    expect(reader).toContain('data.verses.slice(0, visibleVerses)');
    expect(reader).toContain('moreVersesRef');
  });

  it('prefetches the next chapter only when idle', () => {
    expect(reader).toContain('runWhenIdle(');
    expect(reader).toContain('chapterCache.set(key, result)');
    expect(read('src/lib/idle.ts')).toContain('requestIdleCallback');
  });

  it('supports background tab playback via Media Session while keeping fixed controls clear', () => {
    // The composer yields to both fixed controls, not just the tray.
    expect(search).toContain("passageKeys.length > 0 && podcastSegments.length > 0");
    expect(search).toContain("'bottom-44'");
    const podcastPlayer = read('src/components/PodcastPlayer.tsx');
    expect(podcastPlayer).toContain('mediaSession');
    expect(podcastPlayer).not.toContain('usePauseOnHidden(');
  });

  it('does not run diagnostics before a reader asks for them', () => {
    const settings = read('src/app/[locale]/settings/page.tsx');
    expect(settings).toContain('if (!diagnosticsOpen) return');
    expect(settings).toContain('<details className="group mt-6"');
    expect(settings).toContain("ts('diagnosticsTitle')");
    // The expensive vector scan is inside the same deferred effect.
    const effect = settings.slice(settings.indexOf('if (!diagnosticsOpen) return'), settings.indexOf('const total'));
    expect(effect).toContain('includeEmbeddings: true');
    expect(settings.indexOf("ts('title')")).toBeLessThan(settings.indexOf("ts('diagnosticsTitle')"));
  });

  it('localises the slow-connection notice', () => {
    for (const locale of ['en', 'he', 'ar']) {
      const messages = JSON.parse(read(`messages/${locale}.json`));
      expect(messages.search.slowNetwork, `${locale} has no slow-connection notice`).toBeTruthy();
      expect(messages.settings.title, `${locale} has no preferences title`).toBeTruthy();
      expect(messages.settings.diagnosticsIntro, `${locale} has no diagnostics explanation`).toBeTruthy();
    }
  });
});
