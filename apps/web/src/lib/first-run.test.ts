import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The first screen has one job: get a question into the search box.
 *
 * Six suggestions, six topic chips and twenty-eight theme chips used to sit
 * under the input at the same time. They are still available, but behind a
 * disclosure so they cannot compete with the one control a newcomer needs.
 * Scores say where they came from on every platform, not just on hover.
 */
const read = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');

describe('first-run entry', () => {
  it('keeps one primary input and hides the starting links behind a disclosure', () => {
    const page = read('src/app/[locale]/page.tsx');
    expect(page).toContain('<details className="group mt-8">');
    expect(page).toContain("{t('startHere')}");
    expect(page).toContain('ref={inputRef}');
  });

  it('focuses the same input from a desktop shortcut', () => {
    const page = read('src/app/[locale]/page.tsx');
    expect(page).toContain("event.key.toLowerCase() === 'k'");
    expect(page).toContain("inputRef.current?.focus()");
  });

  it('explains a score on touch as well as on desktop', () => {
    const explainer = read('src/components/ScoreExplainer.tsx');
    expect(explainer).toContain('showModal()');
    expect(explainer).toContain('bottom-0');
    expect(explainer).toContain('sm:top-1/2');

    for (const file of [
      'src/components/PassageCard.tsx',
      'src/app/[locale]/compare/page.tsx',
      'src/app/[locale]/passage/[...key]/page.tsx',
      'src/components/GlobalAiSidebar.tsx',
    ]) {
      expect(read(file), `${file} shows a score without an explanation`).toContain('<ScoreExplainer');
    }
  });

  it('keeps the locale in shared links and returns focus from the drawer', () => {
    expect(read('src/components/CopyCitation.tsx')).toContain('siteUrl}/${locale}/passage/');
    const sidebar = read('src/components/GlobalAiSidebar.tsx');
    expect(sidebar).toContain('launcherRef.current?.focus()');
    expect(sidebar).toContain("aria-label={t('ask')}");
  });

  it('localises every score explanation', () => {
    for (const locale of ['en', 'he', 'ar']) {
      const messages = JSON.parse(read(`messages/${locale}.json`));
      for (const key of ['jev', 'local', 'derived', 'manual', 'literal']) {
        expect(messages.scoreInfo[key], `${locale} has no ${key} explanation`).toBeTruthy();
      }
      expect(messages.search.startHere, `${locale} has no disclosure label`).toBeTruthy();
    }
  });
});
