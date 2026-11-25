import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Instructions to the operator are not copy for the reader.
 *
 * Three shipped at once: the explore empty state told a reader to run
 * `npm run index`, the settings page asked them to add an API key and restart,
 * and the contact page displayed hello@example.com. Each looked like content
 * and each described a mechanism the reader did not have.
 */
const read = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');

const PAGES = [
  'src/app/[locale]/page.tsx',
  'src/app/[locale]/explore/page.tsx',
  'src/app/[locale]/settings/page.tsx',
  'src/app/[locale]/contact/page.tsx',
  'src/app/[locale]/support/page.tsx',
  'src/app/[locale]/privacy/page.tsx',
  'src/app/[locale]/terms/page.tsx',
];

describe('reader-facing copy', () => {
  it('contains no build commands, environment variables or placeholder addresses', () => {
    for (const page of PAGES) {
      const source = read(page);
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      expect(code, `${page} shows an operator instruction`).not.toMatch(/npm run |TYPESAFE_API_KEY|example\.com/);
    }
  });

  it('explains an unconfigured model honestly instead of asking the reader to fix it', () => {
    const settings = read('src/app/[locale]/settings/page.tsx');
    expect(settings).toContain('labelled with the source that produced it');
  });

  it('keeps the pinned composer clear of the comparison tray', () => {
    const search = read('src/app/[locale]/page.tsx');
    expect(search).toContain("passageKeys.length > 0 && podcastSegments.length > 0");
  });

  it('does not promise a contact address the deployment does not have', () => {
    // Both legal pages used to say "the contact page has the address" even on
    // deployments where the contact page says the opposite.
    for (const page of ['privacy', 'terms']) {
      const source = read(`src/app/[locale]/${page}/page.tsx`);
      expect(source, `${page} promises an address unconditionally`).toContain('contactAddress() ?');
    }
  });

  it('localises the reader-facing empty state', () => {
    for (const locale of ['en', 'he', 'ar']) {
      const messages = JSON.parse(read(`messages/${locale}.json`));
      expect(messages.explore.emptyBody, `${locale} has no explore empty state`).toBeTruthy();
      expect(messages.contact.addressNote, `${locale} has no unconfigured notice`).toBeTruthy();
      expect(messages.support.notConfigured, `${locale} has no unconfigured support notice`).toBeTruthy();
    }
  });
});
