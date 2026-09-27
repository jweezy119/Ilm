import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Passage, RecommendationWeights, SearchResponse, TextId } from '@ilm/shared';

const ALL_TEXTS: TextId[] = ['quran', 'torah', 'talmud', 'ot', 'nt'];
export const MAX_COMPARISON = 5;

const DEFAULT_WEIGHTS: RecommendationWeights = {
  thematic: 0.3,
  linguistic: 0.2,
  historical: 0.15,
  narrative: 0.15,
  theological: 0.2,
};

/** The comparison tray, persisted so a shared link survives a reload. */
interface ComparisonState {
  passageKeys: string[];
  add: (passage: Passage) => void;
  remove: (key: string) => void;
  toggle: (passage: Passage) => void;
  clear: () => void;
  reorder: (from: number, to: number) => void;
  has: (key: string) => boolean;
}

export const useComparisonStore = create<ComparisonState>()(
  persist(
    (set, get) => ({
      passageKeys: [],

      add: (passage) =>
        set((state) => {
          if (state.passageKeys.includes(passage.passageKey)) return state;
          if (state.passageKeys.length >= MAX_COMPARISON) return state;
          return { passageKeys: [...state.passageKeys, passage.passageKey] };
        }),

      remove: (key) => set((state) => ({ passageKeys: state.passageKeys.filter((k) => k !== key) })),

      toggle: (passage) => {
        const { passageKeys, add, remove } = get();
        if (passageKeys.includes(passage.passageKey)) remove(passage.passageKey);
        else add(passage);
      },

      clear: () => set({ passageKeys: [] }),

      reorder: (from, to) =>
        set((state) => {
          const next = [...state.passageKeys];
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved);
          return { passageKeys: next };
        }),

      has: (key) => get().passageKeys.includes(key),
    }),
    { name: 'ilm-comparison' }
  )
);

/** Last search, so the results page can be restored on navigation. */
interface SearchState {
  query: string;
  response: SearchResponse | null;
  activeTexts: TextId[];
  recent: string[];
  setQuery: (query: string) => void;
  setResponse: (response: SearchResponse | null) => void;
  toggleText: (textId: TextId) => void;
  clear: () => void;
  remember: (query: string) => void;
  clearRecent: () => void;
}

export const useSearchStore = create<SearchState>()(
  persist(
    (set) => ({
      query: '',
      response: null,
      activeTexts: ALL_TEXTS,
      recent: [],

      setQuery: (query) => set({ query }),
      setResponse: (response) => set({ response }),

      toggleText: (textId) =>
        set((state) => {
          const next = state.activeTexts.includes(textId)
            ? state.activeTexts.filter((t) => t !== textId)
            : [...state.activeTexts, textId];
          // Never let the filter empty out, or the UI looks broken.
          return { activeTexts: next.length > 0 ? next : state.activeTexts };
        }),

      clear: () => set({ response: null, query: '' }),

      remember: (query) =>
        set((state) => ({
          recent: [query, ...state.recent.filter((q) => q !== query)].slice(0, 12),
        })),

      clearRecent: () => set({ recent: [] }),
    }),
    { name: 'ilm-search' }
  )
);

/** Recommendation weights, kept in sync with the API per user. */
interface SettingsState {
  weights: RecommendationWeights;
  setWeights: (weights: Partial<RecommendationWeights>) => void;
  resetWeights: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      weights: DEFAULT_WEIGHTS,
      setWeights: (weights) => set((state) => ({ weights: { ...state.weights, ...weights } })),
      resetWeights: () => set({ weights: DEFAULT_WEIGHTS }),
    }),
    { name: 'ilm-settings' }
  )
);

/** Light/dark, applied to <html> by the theme provider. */
type ThemeMode = 'light' | 'dark' | 'system';

interface UiState {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  comparisonOpen: boolean;
  setComparisonOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: 'system',
      setTheme: (theme) => set({ theme }),
      comparisonOpen: false,
      setComparisonOpen: (comparisonOpen) => set({ comparisonOpen }),
    }),
    { name: 'ilm-ui' }
  )
);

export { ALL_TEXTS, DEFAULT_WEIGHTS };
