'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, BookOpen, Scale, Lightbulb, ArrowLeftRight, ChevronDown, Settings, Menu, X, Sun, Moon } from 'lucide-react';
import { SearchResult, Passage, TextId, THEME_TAXONOMY } from '@ilm/shared';
import { api } from '@/lib/api';
import { PassageCard } from '@/components/PassageCard';
import { ComparisonView } from '@/components/ComparisonView';
import { RecommendationPanel } from '@/components/RecommendationPanel';
import { ThemeProvider } from '@/components/ThemeProvider';
import { useSearchStore } from '@/store/searchStore';
import { useComparisonStore } from '@/store/comparisonStore';

export default function HomePage() {
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [activeTheme, setActiveTheme] = useState<string | null>(null);
  
  const { results, setResults, clearResults, recentSearches, addRecentSearch } = useSearchStore();
  const { passages, addPassage, removePassage, clearPassages } = useComparisonStore();

  const handleSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) return;
    
    setIsSearching(true);
    try {
      const response = await api.post('/search', {
        query: searchQuery,
        limit: 20,
        includeScores: true,
      });
      
      setResults(response.data.data.results);
      addRecentSearch(searchQuery);
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setIsSearching(false);
    }
  }, [setResults, addRecentSearch]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && query.trim()) {
      handleSearch(query);
    }
  };

  const handlePassageClick = (passage: SearchResult['passage']) => {
    if (showComparison) {
      addPassage(passage);
    } else {
      // Navigate to passage view
      window.location.href = `/passage/${passage.textId}/${passage.book}/${passage.chapter}/${passage.verse}`;
    }
  };

  const handleAddToComparison = (passage: SearchResult['passage']) => {
    addPassage(passage);
    setShowComparison(true);
  };

  return (
    <ThemeProvider>
      <div className="min-h-screen flex flex-col">
        {/* Header */}
        <header className="border-b border-ilm-200 dark:border-ilm-800 bg-white/80 dark:bg-ilm-950/80 backdrop-blur-sm sticky top-0 z-40">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex h-16 items-center justify-between">
              {/* Logo */}
              <div className="flex items-center gap-3">
                <a href="/" className="flex items-center gap-2" aria-label="Ilm Home">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-ilm-700 to-ilm-900 flex items-center justify-center">
                    <BookOpen className="w-5 h-5 text-white" />
                  </div>
                  <span className="font-semibold text-xl text-ilm-900 dark:text-ilm-50">Ilm</span>
                </a>
                <span className="hidden sm:block text-xs text-ilm-500 uppercase tracking-wider">علم</span>
              </div>

              {/* Search Bar */}
              <div className="flex-1 max-w-3xl mx-8">
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-ilm-400" aria-hidden="true" />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Search Quran, Bible, Talmud, Torah... (e.g., 'mercy', 'covenant', 'light')"
                    className="input pl-12 pr-12"
                    autoFocus
                    aria-label="Search sacred texts"
                  />
                  {query && (
                    <button
                      onClick={() => setQuery('')}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-ilm-400 hover:text-ilm-600"
                      aria-label="Clear search"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  )}
                </div>
                
                {/* Quick theme filters */}
                <div className="flex flex-wrap gap-2 mt-2">
                  {['mercy', 'covenant', 'light', 'justice', 'forgiveness', 'prayer'].map((theme) => (
                    <button
                      key={theme}
                      onClick={() => {
                        setActiveTheme(theme);
                        handleSearch(theme);
                      }}
                      className={`theme-pill ${
                        activeTheme === theme
                          ? 'bg-ilm-700 text-white'
                          : 'bg-ilm-100 text-ilm-700 hover:bg-ilm-200 dark:bg-ilm-800 dark:text-ilm-300 dark:hover:bg-ilm-700'
                      }`}
                    >
                      {theme}
                    </button>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowComparison(!showComparison)}
                  className={`btn-secondary ${showComparison ? 'bg-ilm-700 text-white' : ''}`}
                  aria-label={showComparison ? 'Exit comparison' : 'Enter comparison mode'}
                >
                  <ArrowLeftRight className="w-4 h-4" />
                  <span className="hidden sm:inline">{showComparison ? 'Exit' : 'Compare'}</span>
                  {passages.length > 0 && (
                    <span className="w-5 h-5 rounded-full bg-ilm-600 text-white text-xs flex items-center justify-center">
                      {passages.length}
                    </span>
                  )}
                </button>

                <button className="btn-ghost" aria-label="Settings">
                  <Settings className="w-5 h-5" />
                </button>

                <button className="btn-ghost" aria-label="Theme toggle" onClick={() => document.documentElement.classList.toggle('dark')}>
                  <Sun className="w-5 h-5 hidden dark:block" />
                  <Moon className="w-5 h-5 block dark:hidden" />
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
          {showComparison && passages.length > 0 && (
            <ComparisonView passages={passages} onRemove={removePassage} onClear={clearPassages} />
          )}

          {!showComparison && (
            <>
              {/* Welcome / Empty State */}
              {results.length === 0 && query === '' && (
                <div className="text-center py-16">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-ilm-100 to-ilm-200 dark:from-ilm-800 dark:to-ilm-900 flex items-center justify-center mx-auto mb-6">
                    <Lightbulb className="w-8 h-8 text-ilm-600 dark:text-ilm-400" />
                  </div>
                  <h1 className="text-3xl font-bold text-ilm-900 dark:text-ilm-50 mb-2">Welcome to Ilm</h1>
                  <p className="text-ilm-600 dark:text-ilm-400 max-w-2xl mx-auto mb-8">
                    Ilm (علم) means knowledge and understanding. Compare sacred texts side-by-side,
                    discover thematic connections across traditions, and explore the shared wisdom of
                    Quran, Bible, Talmud, and Torah.
                  </p>
                  <div className="flex flex-wrap gap-3 justify-center">
                    {['mercy', 'covenant', 'creation', 'abraham', 'jesus', 'moses', 'prayer', 'justice'].map((term) => (
                      <button
                        key={term}
                        onClick={() => handleSearch(term)}
                        className="btn-secondary text-sm"
                      >
                        {term}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Search Results */}
              {results.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-ilm-900 dark:text-ilm-50">
                      {results.length} result{results.length !== 1 ? 's' : ''} for &ldquo;{query}&rdquo;
                    </h2>
                    <button onClick={() => { clearResults(); setQuery(''); }} className="btn-ghost text-sm">
                      Clear
                    </button>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {results.map((result, index) => (
                      <PassageCard
                        key={result.passage.id}
                        result={result}
                        index={index}
                        onClick={handlePassageClick}
                        onAddToComparison={handleAddToComparison}
                        showComparison={showComparison}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Recent Searches */}
              {results.length === 0 && query === '' && recentSearches.length > 0 && (
                <div className="mt-12">
                  <h3 className="text-sm font-semibold text-ilm-700 dark:text-ilm-300 mb-4">Recent Searches</h3>
                  <div className="flex flex-wrap gap-2">
                    {recentSearches.slice(0, 8).map((search) => (
                      <button
                        key={search}
                        onClick={() => handleSearch(search)}
                        className="btn-ghost text-sm"
                      >
                        {search}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </main>

        {/* Footer */}
        <footer className="border-t border-ilm-200 dark:border-ilm-800 py-6">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-sm text-ilm-500 dark:text-ilm-400">
            <p>Ilm — Sacred text comparison powered by TypeSafe AI</p>
            <p className="mt-1">Quran • Talmud • Torah • Old Testament • New Testament</p>
          </div>
        </footer>

        {/* Recommendation Panel (slide-in) */}
        {passages.length > 0 && !showComparison && (
          <RecommendationPanel passageId={passages[passages.length - 1].id} />
        )}
      </div>
    </ThemeProvider>
  );
}