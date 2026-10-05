'use client';

import { useState } from 'react';
import { Bot, X, MessageSquare, Loader2, ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { CrossExaminationResponse, TextId } from '@ilm/shared';
import { LOCALE_NAMES } from '@/i18n/routing';

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

export function GlobalAiSidebar() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CrossExaminationResponse | null>(null);

  async function handleCrossExamine(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    try {
      const res = await fetch('/api/cross-examine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      if (data.success) {
        setResult(data.data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-24 end-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-fg shadow-xl transition-transform hover:scale-105 active:scale-95"
        title="Open Concept Cross-Examiner"
      >
        <MessageSquare className="h-6 w-6" />
      </button>
    );
  }

  return (
    <div className="fixed inset-y-0 end-0 z-50 flex w-full max-w-md flex-col border-s border-line bg-panel shadow-2xl transition-transform">
      <div className="flex h-14 items-center justify-between border-b border-line px-4">
        <div className="flex items-center gap-2 font-medium">
          <Bot className="h-5 w-5 text-accent" />
          <span>Concept Cross-Examiner</span>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="icon-btn text-fg-muted hover:text-fg"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {!result && !loading && (
          <div className="flex h-full flex-col items-center justify-center text-center text-fg-muted">
            <Bot className="mb-4 h-12 w-12 opacity-20" />
            <p className="max-w-[250px] text-sm">
              Type a concept or question below to cross-examine it across all texts using Jev AI.
            </p>
          </div>
        )}

        {loading && (
          <div className="flex h-full flex-col items-center justify-center text-accent">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="mt-4 text-sm font-medium">Analyzing across texts...</p>
          </div>
        )}

        {result && !loading && (
          <div className="space-y-6">
            <div className="mb-6 border-b border-line pb-4">
              <h3 className="text-xl font-medium">"{result.query}"</h3>
              <p className="text-xs text-fg-faint">Powered by typesafe-ai</p>
            </div>

            {Object.entries(result.resultsByCorpus).map(([textId, corpusResult]) => {
              if (corpusResult.passages.length === 0) return null;
              
              const verdictColor = 
                corpusResult.verdict === 'addressed' ? 'bg-emerald-500/10 text-emerald-600' :
                corpusResult.verdict === 'partial' ? 'bg-amber-500/10 text-amber-600' :
                'bg-red-500/10 text-red-600';

              return (
                <div key={textId} className="rounded-xl border border-line bg-bg p-4 shadow-sm">
                  <div className="mb-3 flex items-center justify-between">
                    <h4 className={`text-sm font-bold uppercase tracking-wider ${TEXT_COLORS[textId as TextId]}`}>
                      {textId.replace('_', ' ')}
                    </h4>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${verdictColor}`}>
                      {corpusResult.verdict}
                    </span>
                  </div>
                  
                  <div className="space-y-4">
                    {corpusResult.passages.slice(0, 1).map(({ passage, score }) => (
                      <div key={passage.passageKey} className="text-sm">
                        <div className="mb-1 text-[11px] font-medium text-fg-muted">
                          {passage.book} {passage.chapter}:{passage.verse} • Relevance {(score * 100).toFixed(0)}%
                        </div>
                        <p className="leading-relaxed text-fg">
                          {passage.translation}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t border-line bg-bg p-4">
        <form onSubmit={handleCrossExamine} className="relative flex items-center">
          <input
            type="text"
            placeholder="E.g. Is fasting required?"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={loading}
            className="w-full rounded-full border border-line bg-panel py-3 pe-12 ps-5 text-sm outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent"
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="absolute end-2 flex h-8 w-8 items-center justify-center rounded-full bg-accent text-accent-fg disabled:opacity-50"
          >
            <ArrowRight className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
