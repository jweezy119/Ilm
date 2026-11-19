'use client';

import { useEffect, useState } from 'react';

interface NetworkInformation {
  effectiveType?: string;
  saveData?: boolean;
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
}

/**
 * Whether a connection should skip extra model calls.
 *
 * `saveData` is an explicit reader choice and `slow-2g` / `2g` are slow enough
 * that waiting for a re-rank is worse than a literal answer. Both are advisory:
 * the reader can still turn ranking by meaning back on, and the UI says when
 * the app made the choice for them.
 */
export function useSlowConnection(): boolean {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const connection = (navigator as unknown as { connection?: NetworkInformation }).connection;
    if (!connection) return;

    const update = () => {
      setSlow(Boolean(connection.saveData) || ['slow-2g', '2g'].includes(connection.effectiveType ?? ''));
    };
    update();
    connection.addEventListener?.('change', update);
    return () => connection.removeEventListener?.('change', update);
  }, []);

  return slow;
}
