'use client';

import { Passage, TextId } from '@ilm/shared';
import { SearchResult } from '@ilm/shared';
import { BookOpen, ChevronRight, Plus, ExternalLink } from 'lucide-react';
import { getTextBadgeClass, getTextColorClass } from '@/lib/utils';

interface PassageCardProps {
  result: SearchResult;
  index: number;
  onClick: (passage: SearchResult['passage']) => void;
  onAddToComparison: (passage: SearchResult['passage']) => void;
  showComparison: boolean;
}

export function PassageCard({ result, index, onClick, onAddToComparison, showComparison }: PassageCardProps) {
  const { passage, score, highlights } = result;
  const textId = passage.textId as TextId;
  
  const displayText = highlights.translation?.[0] || highlights.originalText?.[0] || passage.translation;
  const snippet = displayText.length > 200 ? displayText.substring(0, 200) + '...' : displayText;

  return (
    <article
      className="card-hover p-4 group"
      onClick={() => onClick(passage)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick(passage)}
    >
      <div className="flex items-start gap-3">
        {/* Text badge */}
        <span className={`flex-shrink-0 ${getTextBadgeClass(textId)}`}>
          {getTextLabel(textId)}
        </span>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Reference */}
          <div className="flex items-center gap-2 mb-2">
            <span className="font-medium text-ilm-900 dark:text-ilm-100">
              {passage.book} {passage.chapter}:{passage.verse}
            </span>
            <span className="text-xs text-ilm-500 dark:text-ilm-400">
              ({score * 100}% match)
            </span>
          </div>

          {/* Snippet with highlights */}
          <p className="text-sm text-ilm-700 dark:text-ilm-300 line-clamp-3 prose prose-sm max-w-none">
            {renderHighlightedSnippet(snippet)}
          </p>

          {/* Themes */}
          {passage.themes && passage.themes.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-3">
              {passage.themes.slice(0, 3).map((theme) => (
                <span
                  key={theme.theme}
                  className="px-2 py-0.5 rounded text-xs bg-ilm-100 text-ilm-700 dark:bg-ilm-800 dark:text-ilm-300"
                >
                  {theme.theme}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {showComparison && (
            <button
              onClick={(e) => { e.stopPropagation(); onAddToComparison(passage); }}
              className="btn-secondary text-xs px-2 py-1"
              aria-label="Add to comparison"
            >
              <Plus className="w-3 h-3" />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onClick(passage); }}
            className="btn-ghost p-1"
            aria-label="Open passage"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </article>
  );
}

function renderHighlightedSnippet(snippet: string) {
  // Simple highlight rendering - in production use proper HTML sanitization
  const parts = snippet.split(/(<mark>|<\/mark>)/);
  return (
    <span>
      {parts.map((part, i) =>
        part === '<mark>' ? (
          <mark key={i} className="bg-yellow-200 dark:bg-yellow-800 px-0.5 rounded" />
        ) : part === '</mark>' ? null : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  );
}

function getTextLabel(textId: TextId): string {
  const labels: Record<TextId, string> = {
    quran: 'Quran',
    talmud: 'Talmud',
    torah: 'Torah',
    ot: 'OT',
    nt: 'NT',
  };
  return labels[textId];
}

function getTextBadgeClass(textId: TextId): string {
  const classes: Record<TextId, string> = {
    quran: 'badge-quran',
    talmud: 'badge-talmud',
    torah: 'badge-torah',
    ot: 'badge-ot',
    nt: 'badge-nt',
  };
  return classes[textId];
}

function getTextColorClass(textId: TextId): string {
  const classes: Record<TextId, string> = {
    quran: 'text-quran-dark bg-quran-light',
    talmud: 'text-talmud-dark bg-talmud-light',
    torah: 'text-torah-dark bg-torah-light',
    ot: 'text-ot-dark bg-ot-light',
    nt: 'text-nt-dark bg-nt-light',
  };
  return classes[textId];
}