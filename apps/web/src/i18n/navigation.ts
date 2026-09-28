import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

/**
 * Locale-aware Link and router.
 *
 * Components import these instead of `next/link` and `next/navigation`. The plain
 * ones do not know about the locale segment, so a `<Link href="/compare">` in
 * Arabic navigates to the English page — the URL loses its prefix and the
 * interface changes language under the reader. Every internal link has to go
 * through here for that to not happen.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
