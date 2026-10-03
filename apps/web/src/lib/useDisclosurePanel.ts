'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';

/**
 * Escape-to-close, and focus returned to whatever opened the panel.
 *
 * The three definition surfaces in this app — the glossary, the lexicon, the
 * citation suggestion — are all opened by a button and closed by another one, and
 * none of them handled Escape or remembered where focus came from. For a keyboard
 * user that meant an Escape did nothing at all, and for a screen-reader user it
 * meant focus stayed parked in the middle of the document after the panel closed,
 * with no announcement of the change.
 *
 * Deliberately not a dialog. These panels sit inline under the text they explain
 * rather than floating over it, so the reader can scroll the passage and the
 * definition together. That rules out focus trapping, which is correct here — a
 * trapped reader cannot get back to the passage they came from — but it does not
 * excuse losing the position on close.
 */
export function useDisclosurePanel<T>() {
  const [panel, setPanel] = useState<T | null>(null);
  const panelId = useId();
  const triggerRef = useRef<HTMLElement | null>(null);

  const open = useCallback((next: T, trigger?: HTMLElement | null) => {
    triggerRef.current = trigger ?? null;
    setPanel(next);
  }, []);

  const close = useCallback(() => {
    setPanel(null);
    // After the panel unmounts, so focus lands on a live element rather than
    // briefly on nothing.
    const trigger = triggerRef.current;
    if (trigger) {
      requestAnimationFrame(() => {
        if (trigger.isConnected) trigger.focus();
      });
    }
  }, []);

  useEffect(() => {
    if (panel === null) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [panel, close]);

  return { panel, panelId, open, close, isOpen: (value: T) => panel === value };
}