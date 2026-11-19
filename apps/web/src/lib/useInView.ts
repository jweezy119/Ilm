'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Whether a sentinel is on screen, toggling as it enters and leaves.
 *
 * Not sticky on purpose: a list that renders more items when the sentinel is
 * visible has to see it leave again before the next batch is loaded. Browsers
 * without IntersectionObserver simply report true, so the whole list shows.
 */
export function useInView<T extends HTMLElement>(rootMargin = '300px') {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (!('IntersectionObserver' in window)) {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { rootMargin });
    observer.observe(element);
    return () => observer.disconnect();
  }, [rootMargin]);

  return { ref, inView };
}
