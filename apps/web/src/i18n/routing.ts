import { defineRouting } from 'next-intl/routing';

/**
 * The locales Ilm ships.
 *
 * Arabic and Hebrew are here because the corpus is largely written in them: the
 * Quran, the Torah and the Talmud are Arabic and Hebrew, so an Arabic or Hebrew
 * interface is reading scripture in its own script rather than reading a
 * translation of an interface.
 *
 * `localePrefix: 'always'` is deliberate. Without it the default locale is served
 * from bare paths and the others from prefixed ones, which means the same page has
 * two URLs and a shared link silently changes language depending on who sent it.
 * Prefixing always makes the language part of the address.
 */
export const routing = defineRouting({
  locales: ['en', 'ar', 'he'],
  defaultLocale: 'en',
  localePrefix: 'always',
});

/**
 * Right-to-left locales.
 *
 * Kept beside `routing` rather than in a component so the middleware, the layout's
 * `dir` attribute and the stylesheet all read the same list. A locale that sets
 * `dir="ltr"` in one place and `dir="rtl"` in another produces a mirrored layout
 * that still reads wrong.
 */
export const RTL_LOCALES = new Set(['ar', 'he']);

export function isRtl(locale: string): boolean {
  return RTL_LOCALES.has(locale);
}

/** Endonyms, so a language is always named in itself. */
export const LOCALE_NAMES: Record<string, string> = {
  en: 'English',
  ar: 'العربية',
  he: 'עברית',
};
