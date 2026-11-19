'use client';

import { useEffect } from 'react';

/** Wake Lock is not in every DOM lib yet, so describe the part we use. */
interface ScreenWakeLock {
  request: (type: 'screen') => Promise<{ release: () => Promise<void> }>;
}

/**
 * Keep the screen awake while audio is playing.
 *
 * The lock is released when the tab is hidden and reacquired when it returns —
 * browsers release it automatically on hide, and a stale sentinel would make a
 * later release throw. Unsupported browsers simply do nothing; playback itself
 * never depends on the lock.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    // Not every engine implements it even where the type exists.
    const wakeLock = (navigator as unknown as { wakeLock?: ScreenWakeLock }).wakeLock;
    if (!wakeLock) return;

    let sentinel: { release: () => Promise<void> } | null = null;
    let cancelled = false;

    const acquire = async () => {
      if (document.visibilityState !== 'visible' || sentinel) return;
      try {
        const acquired = await wakeLock.request('screen');
        if (cancelled) {
          await acquired.release();
          return;
        }
        sentinel = acquired;
      } catch {
        // A denied or unsupported lock is not a playback error.
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void acquire();
      else if (sentinel) {
        void sentinel.release();
        sentinel = null;
      }
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (sentinel) void sentinel.release();
      sentinel = null;
    };
  }, [active]);
}
