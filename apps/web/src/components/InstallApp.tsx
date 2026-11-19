'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Download, X } from 'lucide-react';

/** Chromium's beforeinstallprompt is not in the DOM typings. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Offer install only when the browser says it can be installed.
 *
 * The event is Browser-owned and can only be consumed once, so it is captured
 * and held until the reader acts. There is no nagging: dismissing hides it for
 * the session, and installing removes it entirely. The copy says what offline
 * actually means here — an open page stays, a fresh answer needs the network.
 */
export function InstallApp() {
  const t = useTranslations('install');
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setPrompt(null);
      setDismissed(true);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!prompt || dismissed) return null;

  const install = async () => {
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === 'accepted') setPrompt(null);
    else setDismissed(true);
  };

  return (
    <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-raised px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{t('title')}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">{t('body')}</p>
      </div>
      <button
        type="button"
        onClick={() => void install()}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg"
      >
        <Download className="h-3.5 w-3.5" />
        {t('button')}
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="icon-btn shrink-0 text-fg-faint hover:text-fg"
        aria-label={t('dismiss')}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
