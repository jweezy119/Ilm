'use client';

import { useCallback, useSyncExternalStore } from 'react';

interface NetworkInformation {
  effectiveType?: string;
  saveData?: boolean;
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
}

const connection = () => (typeof navigator === 'undefined' ? undefined : (navigator as unknown as { connection?: NetworkInformation }).connection);

const subscribe = (onChange: () => void) => {
  const current = connection();
  current?.addEventListener?.('change', onChange);
  return () => current?.removeEventListener?.('change', onChange);
};

const isSlow = () => {
  const current = connection();
  return Boolean(current?.saveData) || ['slow-2g', '2g'].includes(current?.effectiveType ?? '');
};

/**
 * Whether a connection should skip extra model calls.
 *
 * `saveData` is an explicit reader choice and `slow-2g` / `2g` are slow enough
 * that waiting for a re-rank is worse than a literal answer. This is read
 * synchronously through useSyncExternalStore rather than in a mount effect, so
 * a deep-linked first search sees the same connection state the checkbox does.
 */
export function useSlowConnection(): boolean {
  const subscribeToConnection = useCallback(subscribe, []);
  const snapshot = useCallback(isSlow, []);
  return useSyncExternalStore(subscribeToConnection, snapshot, () => false);
}
