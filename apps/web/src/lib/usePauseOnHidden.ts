'use client';

import { useEffect, useRef } from 'react';

/**
 * Stop audio when the tab is hidden.
 *
 * Browsers often keep speech synthesis and media elements running in a hidden
 * tab, which means a reader who switches away hears the rest of a chapter from
 * an app they are no longer looking at. The callback is kept in a ref so the
 * listener is installed once rather than on every play/pause change.
 */
export function usePauseOnHidden(pause: () => void): void {
  const latest = useRef(pause);
  latest.current = pause;

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') latest.current();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);
}
