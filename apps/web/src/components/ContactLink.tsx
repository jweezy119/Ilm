'use client';

import { Link } from '@/i18n/navigation';
import { useLocale } from 'next-intl';

/**
 * The link to the contact page, in the locale's own language.
 *
 * Extracted rather than inlined in both legal pages because the one thing that went
 * wrong here is worth making structurally hard to repeat: each page referred to a
 * contact page that did not exist, and each separately. One component means one
 * place where the route can be wrong.
 */
export function ContactLink() {
  const locale = useLocale();
  return (
    <Link
      href="/contact"
      className="mt-2 inline-block text-sm text-accent underline underline-offset-4"
    >
      {locale === 'he' ? 'יצירת קשר' : locale === 'ar' ? 'اتصل بنا' : 'Contact'}
    </Link>
  );
}