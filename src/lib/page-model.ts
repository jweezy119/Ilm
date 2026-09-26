import type { CollectionItem, FactItem, ListSlice } from "@/lib/types";

export type ViewKind = "blocked" | "empty" | "error" | "ready";
export type StarterRoute =
  | "goals"
  | "home"
  | "library"
  | "reader"
  | "reflect"
  | "search"
  
  | "settings";

export interface AuthActionView {
  showLogin: boolean;
  showLogout: boolean;
  showRefresh: boolean;
}

export interface RouteAccess {
  canAccess: boolean;
  message: string | null;
  requiresLogin: boolean;
}

export interface ReaderLoadingViewInput {
  hasError: boolean;
  hasReaderResult: boolean;
  isLoading: boolean;
}

export interface ReaderLoadingView {
  showError: boolean;
  showInitialLoading: boolean;
  showLoadingBadge: boolean;
  showReaderContent: boolean;
}

export interface ProfileView {
  facts: FactItem[];
  kind: ViewKind;
  message: string | null;
  source: "quran-reflect" | "userinfo" | null;
}

export interface ListView {
  count: number;
  kind: ViewKind;
  message: string;
}

export interface DisplayRow {
  label: string;
  value: string;
}

export interface GoalFormState {
  category: string;
  period: string;
  targetAmount: number | string;
  type: string;
}

export interface PreferencesFormState {
  fontSize: number | string;
  mushafLines: number | string;
  reciter: number | string;
}

interface ProfilePayload {
  isLoggedIn?: boolean;
  quranReflect?: {
    profile?: {
      error?: string | null;
      facts?: FactItem[];
      gatingMessage?: string | null;
    };
  };
  userInfo?: {
    error?: string | null;
    facts?: FactItem[];
    gatingMessage?: string | null;
  };
}

interface AuthPayload {
  isLoggedIn?: boolean;
}

const pluralize = (count: number, singular: string): string =>
  count === 1 ? singular : `${singular}s`;

const parsePositiveNumber = (value: number | string): number | null => {
  const parsed =
    typeof value === "number" ? value : Number.parseInt(String(value), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const toTitleCase = (value: string): string =>
  value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/^./, (first) => first.toUpperCase());

const formatDisplayValue = (value: unknown): string => {
  if (value === null || value === undefined || value === "") {
    return "Unavailable";
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (Array.isArray(value)) {
    return value.length ? value.map(formatDisplayValue).join(", ") : "None";
  }

  if (typeof value === "object") {
    return `${Object.keys(value as Record<string, unknown>).length} fields`;
  }

  return String(value);
};

const userOnlyRoutes = new Set<StarterRoute>([
  "goals",
  "library",
  "reflect",
  "settings",
]);

export const getAuthActionView = (data: AuthPayload | null): AuthActionView => {
  const isLoggedIn = Boolean(data?.isLoggedIn);

  return {
    showLogin: !isLoggedIn,
    showLogout: isLoggedIn,
    showRefresh: isLoggedIn,
  };
};

export const getRouteAccess = (
  route: StarterRoute,
  data: AuthPayload | null,
): RouteAccess => {
  const requiresLogin = userOnlyRoutes.has(route);
  const canAccess = !requiresLogin || Boolean(data?.isLoggedIn);

  return {
    canAccess,
    message: canAccess
      ? null
      : "Sign in to manage goals, preferences, and other user data.",
    requiresLogin,
  };
};

export const getReaderLoadingView = ({
  hasError,
  hasReaderResult,
  isLoading,
}: ReaderLoadingViewInput): ReaderLoadingView => ({
  showError: hasError && !hasReaderResult,
  showInitialLoading: isLoading && !hasReaderResult,
  showLoadingBadge: isLoading && hasReaderResult,
  showReaderContent: hasReaderResult,
});

export const buildGoalPayload = (
  form: GoalFormState,
): Record<string, unknown> | null => {
  const targetAmount = parsePositiveNumber(form.targetAmount);
  const category = form.category.trim();
  const period = form.period.trim();
  const type = form.type.trim();

  if (!category || !period || !targetAmount || !type) {
    return null;
  }

  return {
    category,
    period,
    targetAmount,
    type,
  };
};

export const buildPreferencesPayload = (
  form: PreferencesFormState,
): Record<string, unknown> | null => {
  const fontSize = parsePositiveNumber(form.fontSize);
  const mushafLines = parsePositiveNumber(form.mushafLines);
  const reciter = parsePositiveNumber(form.reciter);

  if (!fontSize || !mushafLines || !reciter) {
    return null;
  }

  return {
    fontSize,
    mushafLines,
    reciter,
  };
};

export const getDisplayRows = (
  value: Record<string, unknown> | null | undefined,
): DisplayRow[] =>
  Object.entries(value ?? {}).map(([key, rowValue]) => ({
    label: toTitleCase(key),
    value: formatDisplayValue(rowValue),
  }));

export const getUserProfileView = (
  data: ProfilePayload | null,
): ProfileView => {
  if (!data?.isLoggedIn) {
    return {
      facts: [],
      kind: "blocked",
      message: "Available after login.",
      source: null,
    };
  }

  const profile = data.quranReflect?.profile;
  if (profile?.gatingMessage) {
    return {
      facts: [],
      kind: "blocked",
      message: profile.gatingMessage,
      source: "quran-reflect",
    };
  }

  if (profile?.error) {
    return {
      facts: [],
      kind: "error",
      message: profile.error,
      source: "quran-reflect",
    };
  }

  if (profile?.facts?.length) {
    return {
      facts: profile.facts,
      kind: "ready",
      message: null,
      source: "quran-reflect",
    };
  }

  const userInfo = data.userInfo;
  if (userInfo?.gatingMessage) {
    return {
      facts: [],
      kind: "blocked",
      message: userInfo.gatingMessage,
      source: "userinfo",
    };
  }

  if (userInfo?.error) {
    return {
      facts: [],
      kind: "error",
      message: userInfo.error,
      source: "userinfo",
    };
  }

  if (userInfo?.facts?.length) {
    return {
      facts: userInfo.facts,
      kind: "ready",
      message: null,
      source: "userinfo",
    };
  }

  return {
    facts: [],
    kind: "empty",
    message: "Signed in, but no profile fields were returned.",
    source: null,
  };
};

export const getListView = <T>(
  singular: string,
  slice: ListSlice<T> | undefined,
): ListView => {
  if (slice?.gatingMessage) {
    return {
      count: 0,
      kind: "blocked",
      message: slice.gatingMessage,
    };
  }

  if (slice?.error) {
    return {
      count: 0,
      kind: "error",
      message: slice.error,
    };
  }

  const count = slice?.items.length ?? 0;
  return {
    count,
    kind: "ready",
    message: `${count} ${pluralize(count, singular)} available.`,
  };
};

export const getCollectionLabel = (collection: CollectionItem): string => {
  if (!collection.updatedAt) {
    return "Recently updated";
  }

  return `Updated ${collection.updatedAt}`;
};
