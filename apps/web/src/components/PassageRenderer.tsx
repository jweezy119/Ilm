'use client';

import { Passage, Alignment } from '@ilm/shared';
import { Highlighter } from '@/lib/highlighter';

interface PassageRendererProps {
  passage: Passage;
  showOriginal: boolean;
  showTranslation: boolean;
  alignments: Alignment[];
  textDirection: 'rtl' | 'ltr';
}

export function PassageRenderer({ passage, showOriginal, showTranslation, alignments, textDirection }: PassageRendererProps) {
  const dir = textDirection;
  const isRTL = dir === 'rtl';

  return (
    <div className="prose prose-ilm max-w-none" dir={dir}>
      {/* Original Text */}
      {showOriginal && passage.originalText && (
        <div className="mb-6 p-4 rounded-lg bg-ilm-50 dark:bg-ilm-900/50 border border-ilm-200 dark:border-ilm-800">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-ilm-600 dark:text-ilm-400 uppercase tracking-wider">
              Original ({getLanguageName(passage.metadata.language)})
            </span>
            <span className="text-xs text-ilm-500 dark:text-ilm-400 font-mono">
              {passage.originalText.length} chars
            </span>
          </div>
          <div
            className={`text-lg leading-relaxed ${isRTL ? 'text-right' : 'text-left'} font-arabic`}
            dir={dir}
          >
            {renderWithAlignments(passage.originalText, alignments, 'original')}
          </div>
        </div>
      )}

      {/* Translation */}
      {showTranslation && passage.translation && (
        <div className="p-4 rounded-lg bg-white dark:bg-ilm-900 border border-ilm-200 dark:border-ilm-800">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-ilm-600 dark:text-ilm-400 uppercase tracking-wider">
              Translation (English)
            </span>
          </div>
          <div className="text-base leading-relaxed text-ilm-700 dark:text-ilm-300">
            {renderWithAlignments(passage.translation, alignments, 'translation')}
          </div>
        </div>
      )}

      {/* Alternative Translations */}
      {showTranslation && passage.alternativeTranslations && passage.alternativeTranslations.length > 0 && (
        <details className="mt-4 group">
          <summary className="flex items-center gap-2 text-sm text-ilm-600 dark:text-ilm-400 cursor-pointer p-2 rounded hover:bg-ilm-100 dark:hover:bg-ilm-800">
            <span>Alternative Translations ({passage.alternativeTranslations.length})</span>
          </summary>
          <div className="mt-2 space-y-3 pl-4 border-l-2 border-ilm-200 dark:border-ilm-800">
            {passage.alternativeTranslations.map((trans) => (
              <div key={trans.id} className="text-sm text-ilm-700 dark:text-ilm-300">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium">{trans.translator}</span>
                  {trans.year && <span className="text-ilm-500">({trans.year})</span>}
                </div>
                <p className="italic">{trans.text}</p>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Themes */}
      {passage.themes && passage.themes.length > 0 && (
        <details className="mt-4">
          <summary className="flex items-center gap-2 text-sm font-medium text-ilm-600 dark:text-ilm-400 cursor-pointer p-2 rounded hover:bg-ilm-100 dark:hover:bg-ilm-800">
            <span>Themes ({passage.themes.length})</span>
          </summary>
          <div className="mt-2 flex flex-wrap gap-2">
            {passage.themes
              .sort((a, b) => b.score - a.score)
              .map((theme) => (
                <span
                  key={theme.theme}
                  className="px-2 py-1 rounded-full text-xs bg-ilm-100 text-ilm-700 dark:bg-ilm-800 dark:text-ilm-300"
                  title={`${(theme.score * 100).toFixed(0)}% confidence`}
                >
                  {theme.theme} {(theme.score * 100).toFixed(0)}%
                </span>
              ))}
          </div>
        </details>
      )}

      {/* Cross References */}
      {passage.crossReferences && passage.crossReferences.length > 0 && (
        <details className="mt-4">
          <summary className="flex items-center gap-2 text-sm font-medium text-ilm-600 dark:text-ilm-400 cursor-pointer p-2 rounded hover:bg-ilm-100 dark:hover:bg-ilm-800">
            <span>Cross-References ({passage.crossReferences.length})</span>
          </summary>
          <div className="mt-2 space-y-2">
            {passage.crossReferences
              .sort((a, b) => b.strength - a.strength)
              .slice(0, 10)
              .map((ref) => (
                <div key={ref.targetPassageId} className="text-sm text-ilm-700 dark:text-ilm-300 p-2 rounded bg-ilm-50 dark:bg-ilm-900/50">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={getTextBadgeClass(ref.targetText as any)}>{getTextLabel(ref.targetText as any)}</span>
                    <span className="font-mono">{ref.targetPassageId}</span>
                    <span className="badge bg-ilm-200 dark:bg-ilm-800">
                      {ref.type} ({(ref.strength * 100).toFixed(0)}%)
                    </span>
                  </div>
                  {ref.notes && <p className="text-xs text-ilm-500">{ref.notes}</p>}
                </div>
              ))}
          </div>
        </details>
      )}
    </div>
  );
}

function renderWithAlignments(text: string, alignments: Alignment[], type: 'original' | 'translation') {
  // For now, just render text - alignment highlighting would be more complex
  // In production, use the Highlighter utility
  return <p>{text}</p>;
}

function getLanguageName(lang: string): string {
  const names: Record<string, string> = {
    arabic: 'Arabic',
    hebrew: 'Hebrew',
    aramaic: 'Aramaic',
    greek: 'Greek',
    english: 'English',
  };
  return names[lang] || lang;
}

function getTextLabel(textId: string): string {
  const labels: Record<string, string> = {
    quran: 'Quran',
    talmud: 'Talmud',
    torah: 'Torah',
    ot: 'OT',
    nt: 'NT',
  };
  return labels[textId] || textId;
}

function getTextBadgeClass(textId: string): string {
  const classes: Record<string, string> = {
    quran: 'badge-quran',
    talmud: 'badge-talmud',
    torah: 'badge-torah',
    ot: 'badge-ot',
    nt: 'badge-nt',
  };
  return classes[textId] || 'badge';
}