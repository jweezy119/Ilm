'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Whether a sentinel is on screen, toggling as it enters and leaves.
 *
 * The sentinel is conditionally rendered, so a ref read once in an effect is
 * null on mount and never observed. A callback ref keeps the node in state and
 * re-runs the observer whenever the sentinel appears or disappears.
 *
 * Not sticky on purpose: a list that renders more items when the sentinel is
 * visible has to see it leave again before the next batch is loaded. Browsers
 * without IntersectionObserver simply report true, so the whole list shows.
 */
export function useInView<T extends HTMLElement>(rootMargin = '300px') {
  const [node, setNode] = useState<T | null>(null);
  const [inView, setInView] = useState(false);
  const ref = useCallback((element: T | null) => setNode(element), []);

  useEffect(() => {
    if (!node) return;
    if (!('IntersectionObserver' in window)) {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { rootMargin });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, rootMargin]);

  return { ref, inView };
}
