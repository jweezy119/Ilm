'use client';

/** The shape we use; not every browser implements it. */
interface IdleApi {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
}

/**
 * Run work when the browser is idle, with a timeout so it still happens on a
 * busy device. Returns a canceller for effects that unmount first.
 */
export function runWhenIdle(work: () => void): () => void {
  const win = window as unknown as IdleApi;
  if (win.requestIdleCallback) {
    const id = win.requestIdleCallback(work, { timeout: 2000 });
    return () => win.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(work, 1200);
  return () => window.clearTimeout(id);
}
