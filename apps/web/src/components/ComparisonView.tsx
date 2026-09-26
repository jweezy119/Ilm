'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Passage } from '@ilm/shared';
import { Alignment } from '@ilm/shared';
import { X, ChevronLeft, ChevronRight, GripVertical, Copy, Download, Settings, Maximize2, Minimize2 } from 'lucide-react';
import { Motion, motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';
import { PassageRenderer } from './PassageRenderer';
import { AlignmentHighlights } from './AlignmentHighlights';
import { getTextBadgeClass, getTextLabel, getTextDirection } from '@/lib/utils';

interface ComparisonViewProps {
  passages: Passage[];
  onRemove: (passageId: string) => void;
  onClear: () => void;
}

export function ComparisonView({ passages, onRemove, onClear }: ComparisonViewProps) {
  const [alignments, setAlignments] = useState<Alignment[]>([]);
  const [loadingAlignments, setLoadingAlignments] = useState(false);
  const [syncScroll, setSyncScroll] = useState(true);
  const [viewMode, setViewMode] = useState<'side-by-side' | 'stacked'>('side-by-side');
  const [showOriginal, setShowOriginal] = useState(true);
  const [showTranslation, setShowTranslation] = useState(true);
  const panelRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const isScrolling = useRef(false);

  // Fetch alignments on mount
  useEffect(() => {
    if (passages.length < 2) return;
    
    const fetchAlignments = async () => {
      setLoadingAlignments(true);
      try {
        const response = await api.post('/compare', {
          passageIds: passages.map(p => p.id),
          options: { includeAlignments: true, includeThemes: true },
        });
        setAlignments(response.data.data.alignments || []);
      } catch (error) {
        console.error('Failed to fetch alignments:', error);
      } finally {
        setLoadingAlignments(false);
      }
    };
    
    fetchAlignments();
  }, [passages]);

  // Synchronized scrolling
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>, passageId: string) => {
    if (!syncScroll || isScrolling.current) return;
    
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    const scrollRatio = scrollTop / (scrollHeight - clientHeight);
    
    isScrolling.current = true;
    
    panelRefs.current.forEach((panel, id) => {
      if (id !== passageId && panel) {
        const targetScrollTop = scrollRatio * (panel.scrollHeight - panel.clientHeight);
        panel.scrollTop = targetScrollTop;
      }
    });
    
    // Reset flag after a tick
    requestAnimationFrame(() => {
      isScrolling.current = false;
    });
  }, [syncScroll]);

  const handleReorder = (fromIndex: number, toIndex: number) => {
    // Would use comparison store reorder
  };

  if (passages.length === 0) return null;

  return (
    <div className="fixed inset-0 z-50 bg-white dark:bg-ilm-950 flex flex-col animate-in">
      {/* Header */}
      <header className="border-b border-ilm-200 dark:border-ilm-800 p-4 flex items-center justify-between sticky top-0 bg-white/95 dark:bg-ilm-950/95 backdrop-blur z-10">
        <div className="flex items-center gap-4">
          <button onClick={onClear} className="btn-ghost" aria-label="Close comparison">
            <X className="w-5 h-5" />
          </button>
          <h2 className="text-lg font-semibold text-ilm-900 dark:text-ilm-50">
            Comparing {passages.length} passage{passages.length !== 1 ? 's' : ''}
          </h2>
          {loadingAlignments && (
            <span className="text-xs text-ilm-500 animate-pulse">Loading alignments...</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-ilm-600 dark:text-ilm-400">
            <input
              type="checkbox"
              checked={syncScroll}
              onChange={(e) => setSyncScroll(e.target.checked)}
              className="rounded border-ilm-300 text-ilm-600 focus:ring-ilm-500"
            />
            Sync scroll
          </label>
          
          <label className="flex items-center gap-2 text-sm text-ilm-600 dark:text-ilm-400">
            <input
              type="checkbox"
              checked={showOriginal}
              onChange={(e) => setShowOriginal(e.target.checked)}
              className="rounded border-ilm-300 text-ilm-600 focus:ring-ilm-500"
            />
            Original
          </label>
          
          <label className="flex items-center gap-2 text-sm text-ilm-600 dark:text-ilm-400">
            <input
              type="checkbox"
              checked={showTranslation}
              onChange={(e) => setShowTranslation(e.target.checked)}
              className="rounded border-ilm-300 text-ilm-600 focus:ring-ilm-500"
            />
            Translation
          </label>

          <button
            onClick={() => setViewMode(viewMode === 'side-by-side' ? 'stacked' : 'side-by-side')}
            className="btn-ghost p-2"
            aria-label={viewMode === 'side-by-side' ? 'Stack view' : 'Side-by-side view'}
          >
            {viewMode === 'side-by-side' ? <Maximize2 className="w-5 h-5" /> : <Minimize2 className="w-5 h-5" />}
          </button>

          <button onClick={onClear} className="btn-ghost text-sm text-red-600 hover:text-red-700">
            Clear All
          </button>
        </div>
      </header>

      {/* Passage List Bar */}
      <div className="border-b border-ilm-200 dark:border-ilm-800 px-4 py-2 overflow-x-auto flex gap-2">
        {passages.map((passage, index) => (
          <div
            key={passage.id}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-ilm-50 dark:bg-ilm-900 shrink-0"
          >
            <span className={`${getTextBadgeClass(passage.textId as any)} text-xs`}>
              {getTextLabel(passage.textId as any)}
            </span>
            <span className="font-mono text-sm text-ilm-700 dark:text-ilm-300">
              {passage.book} {passage.chapter}:{passage.verse}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onRemove(passage.id); }}
              className="text-ilm-400 hover:text-red-500 p-1"
              aria-label="Remove from comparison"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      {/* Alignment Indicators */}
      {alignments.length > 0 && (
        <div className="px-4 py-2 bg-ilm-50 dark:bg-ilm-900/50 border-b border-ilm-200 dark:border-ilm-800">
          <div className="flex items-center gap-2 text-sm text-ilm-700 dark:text-ilm-300">
            <span className="font-medium">{alignments.length} alignment{alignments.length !== 1 ? 's' : ''} found:</span>
            {alignments.map((a, i) => (
              <span key={i} className="badge bg-ilm-200 dark:bg-ilm-800">
                {a.type.replace('_', ' ')} ({(a.strength * 100).toFixed(0)}%)
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Panels */}
      <div className="flex-1 overflow-hidden">
        {viewMode === 'side-by-side' ? (
          <div
            className="comparison-container h-full"
            style={{ gridTemplateColumns: `repeat(${passages.length}, 1fr)` }}
          >
            {passages.map((passage) => (
              <ComparisonPanel
                key={passage.id}
                passage={passage}
                ref={panelRefs.current}
                alignments={alignments.filter(a => a.passageAId === passage.id || a.passageBId === passage.id)}
                onScroll={handleScroll}
                showOriginal={showOriginal}
                showTranslation={showTranslation}
                textDirection={getTextDirection(passage.textId as any)}
              />
            ))}
          </div>
        ) : (
          <div className="h-full overflow-y-auto p-4 space-y-6">
            {passages.map((passage) => (
              <div key={passage.id} className="card">
                <ComparisonPanel
                  passage={passage}
                  ref={panelRefs.current}
                  alignments={alignments.filter(a => a.passageAId === passage.id || a.passageBId === passage.id)}
                  onScroll={handleScroll}
                  showOriginal={showOriginal}
                  showTranslation={showTranslation}
                  textDirection={getTextDirection(passage.textId as any)}
                  fullWidth
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface ComparisonPanelProps {
  passage: Passage;
  ref: Map<string, HTMLDivElement>;
  alignments: Alignment[];
  onScroll: (e: React.UIEvent<HTMLDivElement>, passageId: string) => void;
  showOriginal: boolean;
  showTranslation: boolean;
  textDirection: 'rtl' | 'ltr';
  fullWidth?: boolean;
}

function ComparisonPanel({ passage, ref, alignments, onScroll, showOriginal, showTranslation, textDirection, fullWidth }: ComparisonPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current.set(passage.id, panelRef.current!);
    return () => ref.current.delete(passage.id);
  }, [passage.id, ref]);

  const passageAlignments = alignments.filter(
    a => a.passageAId === passage.id || a.passageBId === passage.id
  );

  return (
    <motion.div
      ref={panelRef}
      className={`comparison-panel ${fullWidth ? '' : 'h-full'} flex flex-col`}
      onScroll={(e) => onScroll(e, passage.id)}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Passage Header */}
      <div className="p-4 border-b border-ilm-200 dark:border-ilm-800 flex-shrink-0">
        <div className="flex items-center justify-between mb-2">
          <span className={getTextBadgeClass(passage.textId as any)}>
            {getTextLabel(passage.textId as any)}
          </span>
          <div className="flex items-center gap-2">
            {passageAlignments.length > 0 && (
              <span className="badge bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                {passageAlignments.length} links
              </span>
            )}
          </div>
        </div>
        <h3 className="font-semibold text-ilm-900 dark:text-ilm-100">
          {passage.book} {passage.chapter}:{passage.verse}
        </h3>
      </div>

      {/* Passage Content */}
      <div className="flex-1 overflow-y-auto p-4" dir={textDirection}>
        <PassageRenderer
          passage={passage}
          showOriginal={showOriginal}
          showTranslation={showTranslation}
          alignments={passageAlignments}
          textDirection={textDirection}
        />
      </div>
    </motion.div>
  );
}