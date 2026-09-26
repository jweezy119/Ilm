'use client';

import { useState, useEffect } from 'react';
import { Motion, AnimatePresence } from 'framer-motion';
import { X, ChevronRight, SlidersHorizontal, BarChart2, ExternalLink } from 'lucide-react';
import { api } from '@/lib/api';
import { RecommendationResponse, Recommendation, TextId } from '@ilm/shared';
import { getTextBadgeClass, getTextLabel } from '@/lib/utils';

interface RecommendationPanelProps {
  passageId: string;
}

export function RecommendationPanel({ passageId }: RecommendationPanelProps) {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const [weights, setWeights] = useState({
    thematic: 0.3,
    linguistic: 0.2,
    historical: 0.15,
    narrative: 0.15,
    theological: 0.2,
  });
  const [showWeights, setShowWeights] = useState(false);

  useEffect(() => {
    fetchRecommendations();
  }, [passageId, weights]);

  const fetchRecommendations = async () => {
    setLoading(true);
    try {
      const response = await api.post('/recommendations', {
        passageId,
        weights,
        limit: 8,
      });
      setRecommendations(response.data.data.recommendations || []);
    } catch (error) {
      console.error('Failed to fetch recommendations:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateWeight = (key: keyof typeof weights, value: number) => {
    const newWeights = { ...weights, [key]: value };
    // Normalize to sum to 1
    const sum = Object.values(newWeights).reduce((a, b) => a + b, 0);
    const normalized = Object.fromEntries(
      Object.entries(newWeights).map(([k, v]) => [k, v / sum])
    ) as typeof weights;
    setWeights(normalized);
  };

  if (recommendations.length === 0 && !loading) return null;

  return (
    <AnimatePresence>
      <Motion.div
        initial={{ x: 320, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 320, opacity: 0 }}
        className="fixed right-0 top-16 bottom-0 w-80 sm:w-96 bg-white dark:bg-ilm-950 border-l border-ilm-200 dark:border-ilm-800 shadow-xl z-40 flex flex-col"
      >
        {/* Header */}
        <div className="p-4 border-b border-ilm-200 dark:border-ilm-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart2 className="w-5 h-5 text-ilm-600 dark:text-ilm-400" />
            <h3 className="font-semibold text-ilm-900 dark:text-ilm-50">Recommendations</h3>
            <span className="badge bg-ilm-100 dark:bg-ilm-800 text-ilm-700 dark:text-ilm-300">
              {recommendations.length}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowWeights(!showWeights)}
              className="btn-ghost p-1"
              aria-label="Adjust weights"
            >
              <SlidersHorizontal className="w-4 h-4" />
            </button>
            <button className="btn-ghost p-1" onClick={() => setRecommendations([])}>
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Weights Panel */}
        <AnimatePresence>
          {showWeights && (
            <Motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="p-4 border-b border-ilm-200 dark:border-ilm-800 overflow-hidden"
            >
              <h4 className="text-sm font-medium text-ilm-700 dark:text-ilm-300 mb-3">Scoring Weights</h4>
              <div className="space-y-3">
                {[
                  { key: 'thematic', label: 'Thematic', icon: '🎯' },
                  { key: 'linguistic', label: 'Linguistic', icon: '🔤' },
                  { key: 'historical', label: 'Historical', icon: '📜' },
                  { key: 'narrative', label: 'Narrative', icon: '📖' },
                  { key: 'theological', label: 'Theological', icon: '⛪' },
                ].map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-3">
                    <span className="text-lg">{key === 'thematic' && '🎯' || key === 'linguistic' && '🔤' || key === 'historical' && '📜' || key === 'narrative' && '📖' || '⛪'}</span>
                    <label className="text-sm text-ilm-700 dark:text-ilm-300 w-24">{label}</label>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={weights[key as keyof typeof weights]}
                      onChange={(e) => updateWeight(key as keyof typeof weights, parseFloat(e.target.value))}
                      className="flex-1 h-2 bg-ilm-200 dark:bg-ilm-800 rounded-lg appearance-none cursor-pointer accent-ilm-600"
                    />
                    <span className="text-xs font-mono text-ilm-500 w-10 text-right">
                      {(weights[key as keyof typeof weights] * 100).toFixed(0)}%
                    </span>
                  </div>
                ))}
                <button
                  onClick={() => setWeights({ thematic: 0.3, linguistic: 0.2, historical: 0.15, narrative: 0.15, theological: 0.2 })}
                  className="btn-ghost text-xs w-full"
                >
                  Reset to defaults
                </button>
              </div>
            </Motion.div>
          )}
        </AnimatePresence>

        {/* Recommendations List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading && (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="skeleton h-24 rounded-lg" />
              ))}
            </div>
          )}
          
          {recommendations.map((rec, index) => (
            <RecommendationCard key={rec.passageId} rec={rec} index={index} />
          ))}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-ilm-200 dark:border-ilm-800 text-xs text-ilm-500 dark:text-ilm-400">
          <p>Scores are computed using TypeSafe Jev semantic judgments.</p>
          <p className="mt-1">No AI-generated inferences — only weighted scoring.</p>
        </div>
      </Motion.div>
    </AnimatePresence>
  );
}

function RecommendationCard({ rec, index }: { rec: Recommendation; index: number }) {
  const textId = rec.textId as TextId;
  const compositePct = Math.round(rec.scores.composite * 100);

  return (
    <Motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="recommendation-card group"
    >
      <div className="flex items-start gap-3">
        <span className={`${getTextBadgeClass(textId)} flex-shrink-0`}>
          {getTextLabel(textId)}
        </span>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span className="font-medium text-sm text-ilm-900 dark:text-ilm-100 truncate">
              {rec.book} {rec.chapter}:{rec.verse}
            </span>
            <span className="text-xs font-mono font-bold text-ilm-600 dark:text-ilm-400">
              {compositePct}%
            </span>
          </div>
          
          <p className="text-sm text-ilm-600 dark:text-ilm-400 line-clamp-2 mb-2">
            {rec.preview}
          </p>

          {/* Score breakdown */}
          <div className="flex flex-wrap gap-1 mb-2">
            {[
              { key: 'thematic', label: 'T', color: 'bg-blue-100 text-blue-700' },
              { key: 'linguistic', label: 'L', color: 'bg-green-100 text-green-700' },
              { key: 'historical', label: 'H', color: 'bg-amber-100 text-amber-700' },
              { key: 'narrative', label: 'N', color: 'bg-purple-100 text-purple-700' },
              { key: 'theological', label: 'Th', color: 'bg-red-100 text-red-700' },
            ].map(({ key, label, color }) => {
              const score = rec.scores[key as keyof typeof rec.scores];
              return (
                <span
                  key={key}
                  className={`recommendation-score px-1.5 py-0.5 rounded ${color} dark:bg-opacity-30`}
                  title={`${label}: ${(score * 100).toFixed(0)}%`}
                >
                  {label} {(score * 100).toFixed(0)}%
                </span>
              );
            })}
          </div>

          {/* Matched themes/terms */}
          {(rec.matchedThemes.length > 0 || rec.matchedTerms.length > 0) && (
            <div className="flex flex-wrap gap-1 text-xs text-ilm-500 dark:text-ilm-400">
              {rec.matchedThemes.slice(0, 3).map((theme) => (
                <span key={theme} className="px-1.5 py-0.5 rounded bg-ilm-100 dark:bg-ilm-800">
                  #{theme}
                </span>
              ))}
              {rec.matchedTerms.slice(0, 3).map((term) => (
                <span key={term} className="px-1.5 py-0.5 rounded bg-ilm-100 dark:bg-ilm-800 font-mono">
                  {term}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Reasoning tooltip */}
      <div className="mt-2 text-xs text-ilm-500 dark:text-ilm-400 italic opacity-0 group-hover:opacity-100 transition-opacity">
        {rec.reasoning}
      </div>
    </Motion.div>
  );
}