import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  MAX_COMPARISON_PASSAGES,
  DEFAULT_WEIGHTS as SHARED_DEFAULT_WEIGHTS,
  type Passage,
  type RecommendationWeights,
  type SearchResponse,
  type TextId,
} from '@ilm/shared';
import { api } from '@/lib/api';

const ALL_TEXTS: TextId[] = ['quran', 'torah', 'talmud', 'ot', 'nt'];

// The cap is the API's, not a second one declared here. The two disagreed once
// already, and the symptom was a 400 the UI could not explain.
export const MAX_COMPARISON = MAX_COMPARISON_PASSAGES;

/*
 * The weights are the shared package's, for the same reason the comparison cap is
 * and the same reason it is written here: this file once declared a second copy of
 * them, the copy drifted, and the drift was silent. The settings sliders render the
 * store's values and Save posts them back to the API, so a drifted copy was not
 * cosmetic — a reader who opened settings and pressed save would have written
 * `historical: 0.15` over the API, putting back a dimension that had been
 * deliberately weighted to zero, and the sliders would have shown numbers the
 * engine was not using.
 */
const DEFAULT_WEIGHTS = SHARED_DEFAULT_WEIGHTS;

/** The comparison tray, persisted so a shared link survives a reload. */
interface ComparisonState {
  passageKeys: string[];
  add: (passage: Passage) => void;
  /**
   * Add by key alone. A recommendation row carries a reference and a preview, not a
   * whole passage, so this is how the reader puts a relation into the tray without
   * the caller inventing a Passage object it does not have.
   */
  addKey: (key: string) => void;
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

      addKey: (key) =>
        set((state) => {
          if (state.passageKeys.includes(key)) return state;
          if (state.passageKeys.length >= MAX_COMPARISON) return state;
          return { passageKeys: [...state.passageKeys, key] };
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
  railCollapsed: boolean;
  toggleRail: () => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: 'system',
      setTheme: (theme) => set({ theme }),
      comparisonOpen: false,
      setComparisonOpen: (comparisonOpen) => set({ comparisonOpen }),
      // Persisted because the rail is the one piece of layout a reader sets once
      // and expects to stay set, including across reloads.
      railCollapsed: false,
      toggleRail: () => set((state) => ({ railCollapsed: !state.railCollapsed })),
    }),
    { name: 'ilm-ui' }
  )
);

export { ALL_TEXTS, DEFAULT_WEIGHTS };

/**
 * The library: passages this reader kept.
 *
 * **Not** persisted to localStorage, unlike everything else in this file, and the
 * difference is the point. The other stores are device-local because they are
 * preferences and scratch state — clearing them costs a click. The library is a
 * record of what someone found, and the server is the only copy. A local mirror
 * would drift from it and then contradict it, which is worse than having no mirror
 * at all.
 *
 * So this store holds keys and a loading flag and re-fetches on mount. The
 * identity is an anonymous cookie the API mints on first contact, so a reader who
 * has never saved anything still gets a library, and one that is empty.
 */
interface LibraryState {
  keys: string[];
  loaded: boolean;
  saving: string | null;
  load: () => Promise<void>;
  toggle: (passageKey: string) => Promise<boolean>;
  has: (passageKey: string) => boolean;
}

export const useLibraryStore = create<LibraryState>()((set, get) => ({
  keys: [],
  loaded: false,
  saving: null,

  load: async () => {
    // A failed load is not an error state: the reader can still use the app, and
    // a save button that shows "unavailable" is worse than one that quietly
    // re-tries. `loaded` stays true so the UI does not spin forever.
    try {
      const { keys } = await api.libraryKeys();
      set({ keys, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  toggle: async (passageKey) => {
    const saved = get().keys.includes(passageKey);
    // Optimistic: the button flips immediately and rolls back if the request
    // fails. A save is cheap and usually succeeds, and a button that takes a
    // round trip to acknowledge feels broken.
    set((state) => ({
      saving: passageKey,
      keys: saved ? state.keys.filter((k) => k !== passageKey) : [passageKey, ...state.keys],
    }));

    try {
      if (saved) {
        await api.unsavePassage(passageKey);
        return false;
      }
      await api.savePassage(passageKey);
      return true;
    } catch {
      set((state) => ({ keys: saved ? [passageKey, ...state.keys] : state.keys.filter((k) => k !== passageKey) }));
      return saved;
    } finally {
      set({ saving: null });
    }
  },

  has: (passageKey) => get().keys.includes(passageKey),
}));
