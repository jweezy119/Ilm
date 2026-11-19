'use client';

import { useEffect, useRef, useState } from 'react';
import { Bot, X, MessageSquare, Loader2, ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { CrossExaminationResponse, TextId } from '@ilm/shared';
import { api, ApiError } from '@/lib/api';

const TEXT_COLORS: Record<TextId, string> = {
  quran: 'text-emerald-500',
  torah: 'text-blue-500',
  ot: 'text-blue-500',
  nt: 'text-purple-500',
  talmud: 'text-amber-600',
  bukhari: 'text-emerald-600',
  muslim: 'text-emerald-600',
  enoch: 'text-rose-500',
};

const VERDICT_KEY: Record<string, string> = {
  addressed: 'verdictAddressed',
  partial: 'verdictPartial',
  unaddressed: 'verdictUnaddressed',
  unknown: 'verdictUnknown',
};

const VERDICT_COLOR: Record<string, string> = {
  addressed: 'bg-emerald-500/10 text-emerald-600',
  partial: 'bg-amber-500/10 text-amber-600',
  unaddressed: 'bg-red-500/10 text-red-600',
};

const SOURCE_KEY: Record<string, string> = {
  jev: 'sourceJev',
  derived: 'sourceDerived',
  local: 'sourceLocal',
};

/**
 * Ask one question of every corpus and show the verdicts side by side.
 *
 * The source label is not decoration. The same panel works with no model key,
 * in which case the verdicts come from ranking, and presenting those as model
 * judgements would be the exact failure this product exists to avoid.
 *
 * On a phone this is a bottom sheet; from `md` up it is the right-hand drawer.
 * One component, two presentations, so the two platforms cannot drift.
 */
export function GlobalAiSidebar() {
  const t = useTranslations('crossExamine');
  const tc = useTranslations('common');
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [result, setResult] = useState<CrossExaminationResponse | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    // On desktop, move focus into the drawer. On a phone that would raise the
    // soft keyboard over the sheet the moment it opens, so the reader taps the
    // field when they are ready. Escape dismisses it either way.
    if (window.matchMedia('(min-width: 768px)').matches) inputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  async function handleCrossExamine(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(false);
    try {
      setResult(await api.crossExamine(trimmed));
    } catch (caught) {
      setResult(null);
      setError(true);
      console.error(caught instanceof ApiError ? caught.message : caught);
    } finally {
      setLoading(false);
    }
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        // A finger clears the floating podcast player; on desktop the old
        // position is kept so the button stays out of the reading column.
        className="fixed bottom-32 end-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-fg shadow-xl transition-transform hover:scale-105 active:scale-95 md:bottom-24 md:end-6"
        title={t('open')}
        aria-label={t('open')}
      >
        <MessageSquare className="h-6 w-6" />
      </button>
    );
  }

  const hasResult = Boolean(result && Object.values(result.resultsByCorpus).some((c) => c.passages.length));

  return (
    <>
      {/* A scrim on small screens, where the sheet covers the page. The desktop
          drawer leaves the page usable, so it does not need one. */}
      <button
        type="button"
        aria-label={tc('close')}
        onClick={() => setIsOpen(false)}
        className="fixed inset-0 z-40 bg-black/40 md:hidden"
      />
      <section
        role="dialog"
        aria-label={t('title')}
        className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col rounded-t-2xl border-t border-line bg-panel shadow-2xl md:inset-y-0 md:end-0 md:start-auto md:max-h-none md:w-full md:max-w-md md:rounded-none md:border-s md:border-t-0"
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
          <div className="flex items-center gap-2 font-medium">
            <Bot className="h-5 w-5 text-accent" />
            <span>{t('title')}</span>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="icon-btn text-fg-muted hover:text-fg"
            aria-label={tc('close')}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {!result && !loading && !error ? (
            <div className="flex h-full flex-col items-center justify-center text-center text-fg-muted">
              <Bot className="mb-4 h-12 w-12 opacity-20" />
              <p className="max-w-[280px] text-sm leading-relaxed">{t('intro')}</p>
            </div>
          ) : null}

          {loading ? (
            <div className="flex h-full flex-col items-center justify-center text-accent">
              <Loader2 className="h-8 w-8 animate-spin" />
              <p className="mt-4 text-sm font-medium">{t('analyzing')}</p>
            </div>
          ) : null}

          {error && !loading ? (
            <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200">
              {t('failed')}
            </p>
          ) : null}

          {result && !loading ? (
            <div className="space-y-6">
              <div className="border-b border-line pb-4">
                <h3 className="text-xl font-medium">“{result.query}”</h3>
                <p className="mt-1 text-xs text-fg-faint">
                  {t(SOURCE_KEY[result.source] ?? 'sourceUnknown')}
                </p>
              </div>

              {!hasResult ? <p className="text-sm text-fg-muted">{t('noAnswer')}</p> : null}

              {Object.entries(result.resultsByCorpus).map(([textId, corpusResult]) => {
                if (corpusResult.passages.length === 0) return null;

                return (
                  <div key={textId} className="rounded-xl border border-line bg-bg p-4 shadow-sm">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <h4 className={`text-sm font-bold uppercase tracking-wider ${TEXT_COLORS[textId as TextId] ?? ''}`}>
                        {textId.replace('_', ' ')}
                      </h4>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${
                          VERDICT_COLOR[corpusResult.verdict] ?? 'bg-panel text-fg-muted'
                        }`}
                      >
                        {t(VERDICT_KEY[corpusResult.verdict] ?? 'verdictUnknown')}
                      </span>
                    </div>

                    <div className="space-y-4">
                      {corpusResult.passages.slice(0, 1).map(({ passage, score }) => (
                        <div key={passage.passageKey} className="text-sm">
                          <div className="mb-1 text-[11px] font-medium text-fg-muted">
                            {passage.book} {passage.chapter}:{passage.verse} · {t('relevance')} {Math.round(score * 100)}%
                          </div>
                          <p className="leading-relaxed text-fg">{passage.translation}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>

        <form onSubmit={handleCrossExamine} className="shrink-0 border-t border-line bg-bg p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="relative flex items-center">
            <input
              ref={inputRef}
              type="text"
              placeholder={t('placeholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={loading}
              aria-label={t('title')}
              className="w-full rounded-full border border-line bg-panel py-3 pe-12 ps-5 text-sm outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent"
            />
            <button
              type="submit"
              disabled={loading || !query.trim()}
              className="absolute end-2 flex h-8 w-8 items-center justify-center rounded-full bg-accent text-accent-fg disabled:opacity-50"
              aria-label={t('open')}
            >
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
