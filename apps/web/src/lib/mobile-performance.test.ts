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
  });

  it('renders long lists in batches as they enter view', () => {
    expect(read('src/lib/useInView.ts')).toContain('IntersectionObserver');
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

  it('stops audio when the tab is hidden', () => {
    expect(read('src/lib/usePauseOnHidden.ts')).toContain("visibilityState === 'hidden'");
    for (const file of ['src/components/PodcastPlayer.tsx', 'src/components/RecitationPlayer.tsx']) {
      expect(read(file), `${file} keeps playing in a hidden tab`).toContain('usePauseOnHidden(');
    }
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
