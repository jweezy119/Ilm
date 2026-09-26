import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { SearchResult, Passage } from '@ilm/shared';

interface SearchState {
  results: SearchResult[];
  recentSearches: string[];
  setResults: (results: SearchResult[]) => void;
  clearResults: () => void;
  addRecentSearch: (query: string) => void;
  clearRecentSearches: () => void;
}

export const useSearchStore = create<SearchState>()(
  persist(
    (set) => ({
      results: [],
      recentSearches: [],
      setResults: (results) => set({ results }),
      clearResults: () => set({ results: [] }),
      addRecentSearch: (query) =>
        set((state) => ({
          recentSearches: [query, ...state.recentSearches.filter((q) => q !== query)].slice(0, 20),
        })),
      clearRecentSearches: () => set({ recentSearches: [] }),
    }),
    { name: 'ilm-search-store' }
  )
);

interface ComparisonState {
  passages: Passage[];
  addPassage: (passage: Passage) => void;
  removePassage: (passageId: string) => void;
  clearPassages: () => void;
  reorderPassages: (fromIndex: number, toIndex: number) => void;
}

export const useComparisonStore = create<ComparisonState>()(
  persist(
    (set) => ({
      passages: [],
      addPassage: (passage) =>
        set((state) => {
          if (state.passages.find((p) => p.id === passage.id)) return state;
          if (state.passages.length >= 5) return state;
          return { passages: [...state.passages, passage] };
        }),
      removePassage: (passageId) =>
        set((state) => ({
          passages: state.passages.filter((p) => p.id !== passageId),
        })),
      clearPassages: () => set({ passages: [] }),
      reorderPassages: (fromIndex, toIndex) =>
        set((state) => {
          const newPassages = [...state.passages];
          const [removed] = newPassages.splice(fromIndex, 1);
          newPassages.splice(toIndex, 0, removed);
          return { passages: newPassages };
        }),
    }),
    { name: 'ilm-comparison-store' }
  )
);

interface UIState {
  sidebarOpen: boolean;
  theme: 'light' | 'dark' | 'system';
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarOpen: false,
      theme: 'system',
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setTheme: (theme) => set({ theme }),
    }),
    { name: 'ilm-ui-store' }
  )
);

interface RecommendationWeights {
  thematic: number;
  linguistic: number;
  historical: number;
  narrative: number;
  theological: number;
}

interface SettingsState {
  weights: RecommendationWeights;
  preferredTexts: string[];
  preferredTranslation: Record<string, string>;
  setWeights: (weights: Partial<RecommendationWeights>) => void;
  setPreferredTexts: (texts: string[]) => void;
  setPreferredTranslation: (textId: string, translationId: string) => void;
  resetWeights: () => void;
}

const DEFAULT_WEIGHTS: RecommendationWeights = {
  thematic: 0.3,
  linguistic: 0.2,
  historical: 0.15,
  narrative: 0.15,
  theological: 0.2,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      weights: DEFAULT_WEIGHTS,
      preferredTexts: [],
      preferredTranslation: {},
      setWeights: (weights) =>
        set((state) => ({ weights: { ...state.weights, ...weights } })),
      setPreferredTexts: (texts) => set({ preferredTexts: texts }),
      setPreferredTranslation: (textId, translationId) =>
        set((state) => ({
          preferredTranslation: { ...state.preferredTranslation, [textId]: translationId },
        })),
      resetWeights: () => set({ weights: DEFAULT_WEIGHTS }),
    }),
    { name: 'ilm-settings-store' }
  )
);