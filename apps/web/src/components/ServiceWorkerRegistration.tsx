'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker, in production only.
 *
 * The worker caches only hashed assets, the curated topic list and a static
 * offline notice — see public/sw.js for why no answer is ever cached. This also
 * satisfies installability and the Trusted Web Activity wrapper, both of which
 * are properties of the deployed site rather than the dev server.
 *
 * Registered on load rather than on interaction because none of that needs
 * consent: it collects nothing and cannot change what an answer says. The
 * install action is offered separately, only when the browser allows it.
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