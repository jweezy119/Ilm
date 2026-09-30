'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker, in production only.
 *
 * The worker does nothing — see public/sw.js for why that is deliberate rather than
 * unfinished. This exists to satisfy installability and the Trusted Web Activity
 * wrapper, and both of those are properties of the deployed site, not the dev server.
 *
 * Registered on load rather than on interaction because there is nothing to prompt
 * for: it caches nothing, collects nothing, and cannot make the app behave
 * differently. Asking a reader to consent to an inert file would be theatre.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        /*
         * Silent on purpose.
         *
         * A failed registration costs the reader the ability to install, which is a
         * small loss on a device that already has the page open. It must not cost
         * them a console error or a failed render, and there is nothing actionable
         * for them to do about it either way.
         */
      });
    };

    // After load, so it never competes with the first paint for the main thread.
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });

    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}