'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Whether a media query currently matches.
 *
 * useSyncExternalStore rather than useState plus an effect. A media query is
 * exactly the shape this hook is for — state that lives outside React and changes
 * without our involvement — and the effect version has to setState on mount to
 * correct its initial guess, which is the cascading-render warning the linter
 * was right about. Reading the current value during render is also what keeps
 * the drawer from flashing on first paint: React sees the real match, not a
 * default that the effect immediately overwrites.
 *
 * The server snapshot is what render-to-string produces, where there is no
 * viewport. Reporting "no match" there is the honest answer and matches what the
 * browser would do before hydration.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    [query]
  );

  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);
  const getServerSnapshot = useCallback(() => false, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** The `lg` breakpoint the layout switches to, from tailwind.config.ts. */
export const DESKTOP_QUERY = '(min-width: 1024px)';

export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}