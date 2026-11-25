import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Nothing in the app may point at a page that does not exist, or at a translation
 * key that is not there.
 *
 * Both happened, in the same week, on the same three pages.
 *
 * The privacy policy ended with a section headed "Contact" that rendered as *nothing
 * at all*, because `nav.contact` was never added and next-intl returns an empty
 * string for a missing key rather than a visible placeholder. The paragraph under it
 * told a reader to write in and ask for their search log to be deleted, and there was
 * no address, no link, and no contact page — so the app described a mechanism it did
 * not have. GDPR and CCPA both turn on the mechanism existing rather than on the
 * prose describing it.
 *
 * The failure was invisible in every way this project's tests normally catch things:
 * the pages built, returned 200, and passed a 200-response check. A link to nowhere
 * is a successful request.
 */

const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const locales = ['en', 'he', 'ar'] as const;

function routes(): string[] {
  const base = join(root, 'src/app/[locale]');
  const found = new Set<string>(['', '/en', '/he', '/ar']);
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(join(base, dir), { withFileTypes: true })) {
      const rel = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        // A dynamic segment is satisfied by any value; a static one is a literal.
        walk(rel, entry.name.startsWith('[') ? `${prefix}/[x]` : rel);
      } else if (entry.name === 'page.tsx') {
        found.add(prefix || '/');
      }
    }
  };
  walk('', '');
  return [...found];
}

describe('nothing points at nothing', () => {
  it('has a route for every internal link in the app', () => {
    const known = routes();
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(rel);
        else if (/\.tsx$/.test(entry.name)) files.push(rel);
      }
    };
    walk('src');

    // /contact is the one this project actually got wrong, so it is asserted by name
    // as well as found by the sweep.
    for (const file of files) {
      const source = readFileSync(join(root, file), 'utf8');
      for (const match of source.matchAll(/href=\{?[\`"']?\/\u0024\{locale\}\/([a-z-]+)/g)) {
        expect(known, `${file} links to /${match[1]} which has no page`).toContain(`/${match[1]}`);
      }
    }
    expect(existsSync(join(root, 'src/app/[locale]/contact/page.tsx'))).toBe(true);
  });

  it('has every translation key the pages ask for, in every language', () => {
    /*
     * A missing key renders as an empty string, not as a visible error, so a heading
     * simply disappears and the section under it looks unlabelled. Both legal pages
     * had a heading that vanished this way.
     */
    for (const locale of locales) {
      const messages = JSON.parse(read(`messages/${locale}.json`));
      const keys = new Set<string>();
      const walk = (node: unknown, path: string[]) => {
        if (node && typeof node === 'object') {
          for (const [key, value] of Object.entries(node)) {
            if (typeof value === 'object') walk(value, [...path, key]);
            else keys.add([...path, key].join('.'));
          }
        }
      };
      walk(messages, []);

      for (const file of [
        'src/app/[locale]/privacy/page.tsx',
        'src/app/[locale]/terms/page.tsx',
        'src/app/[locale]/contact/page.tsx',
        'src/app/[locale]/support/page.tsx',
        'src/app/[locale]/settings/page.tsx',
      ]) {
        const source = read(file);

        /*
         * Which namespace each local name refers to.
         *
         * Guessing fails in both directions: a bare `terms` on the privacy page is
         * `nav.terms`, and a test that assumed a namespace would either miss real
         * gaps or drown in false ones, and a test that cries wolf gets ignored.
         * So the bindings are read out of the file.
         */
        const bindings = new Map<string, string>();
        for (const m of source.matchAll(/const (\w+) = (?:await )?(?:get|use)Translations\(['"]([^'"]+)['"]\)/g)) {
          bindings.set(m[1], m[2]);
        }

        for (const m of source.matchAll(/(?:\bt\b|\bn\b|\btc\b)\('([^']+)'/g)) {
          const ns = bindings.get(m[0].slice(0, -m[0].length + m[0].indexOf('('))) ?? m[0].slice(0, 1);
          const path = [ns, m[1]].join('.');
          expect(keys.has(path), `${file} asks ${locale} for "${m[1]}" (${ns}) which does not exist`).toBe(true);
        }
      }
    }
  });

  it('makes the legal pages reachable from the interface', () => {
    // They existed with nothing pointing at them. Play requires a public URL, which
    // they had, so the store listing would have passed while the app told nobody
    // anything — discoverability is not the same as availability.
    const settings = read('src/app/[locale]/settings/page.tsx');
    for (const route of ['/privacy', '/terms', '/contact', '/support']) {
      expect(settings, `settings does not link to ${route}`).toContain(`href="${route}"`);
    }
    // Support also has to be visible without opening Settings: a donation link
    // buried in a settings page is not a funding channel.
    expect(read('src/components/Shell.tsx')).toContain('href="/support"');
  });

  it('gives the contact page a real address rather than a silent placeholder', () => {
    // A form needs an endpoint that delivers mail, and one that silently fails is
    // worse than a visible address. A mailto to hello@example.com is no better:
    // the privacy policy promises a deletion mechanism, and that address reaches
    // nobody. Local builds say so plainly; deployed builds refuse to build.
    const page = read('src/app/[locale]/contact/page.tsx');
    expect(read('src/lib/contact.ts')).toContain('NEXT_PUBLIC_CONTACT_EMAIL');
    expect(page).toContain('mailto:');
    expect(page).toContain('addressNote');
    expect(page).not.toContain('hello@example.com');

    const config = read('next.config.js');
    expect(config).toContain('NEXT_PUBLIC_CONTACT_EMAIL must be a real address');
  });

  it('gives the support page a real destination rather than a fake button', () => {
    // A support button that cannot reach a provider is worse than a sentence
    // saying that this deployment has no link yet.
    const page = read('src/app/[locale]/support/page.tsx');
    expect(read('src/lib/support.ts')).toContain('NEXT_PUBLIC_SUPPORT_URL');
    expect(page).toContain('supportUrl()');
    expect(page).toContain('notConfigured');
    expect(page).not.toContain('example.com');
  });
});