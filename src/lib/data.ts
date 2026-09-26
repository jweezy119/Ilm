import "server-only";

import { DEFAULT_BOOKMARK_MUSHAF, DEFAULT_FEED_QUERY, LIST_PREVIEW_LIMIT, SESSION_EXPIRED_MESSAGE } from "@/lib/constants";
import { getConfig } from "@/lib/env";
import { decodeJwt } from "@/lib/oauth";
import type { StoredSession } from "@/lib/session/store";
import { createClients, getSearchModeQuick } from "@/lib/sdk";
import type {
  BookmarkItem,
  BootstrapPayload,
  CollectionItem,
  ContentPreviewItem,
  FactItem,
  FeedItem,
  NoteItem,
  ReaderPayload,
  SearchItem,
} from "@/lib/types";

type JsonObject = Record<string, unknown>;

const READER_PAGE_SIZE = 50;

const asObject = (value: unknown): JsonObject => {
  if (!value || typeof value !== "object") {
    return {};
  }

  return value as JsonObject;
};

const asString = (value: unknown, fallback = ""): string => {
  if (typeof value === "string") {
    return value;
  }

  if (value === null || value === undefined) {
    return fallback;
  }

  return String(value);
};

const asNullableString = (value: unknown): string | null => {
  if (typeof value === "string") {
    return value;
  }

  if (value === null || value === undefined) {
    return null;
  }

  return String(value);
};

const asNullableNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const asNullableObject = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  return value as Record<string, unknown>;
};

const toArray = (value: unknown, keys: string[] = []): JsonObject[] => {
  if (Array.isArray(value)) {
    return value.map(asObject);
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  for (const key of keys) {
    const nested = (value as Record<string, unknown>)[key];
    if (Array.isArray(nested)) {
      return nested.map(asObject);
    }
  }

  return [];
};

const formatError = (error: unknown): string => String((error as Error)?.message ?? error);

const containsArabic = (value: string | null): boolean =>
  Boolean(value && /[\u0600-\u06ff]/.test(value));

const formatTimestamp = (value: unknown): string | null => {
  if (!value) {
    return null;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  const milliseconds = numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const getTranslationText = (
  translations: unknown,
  preferredResourceId: number,
): string | null => {
  const items = Array.isArray(translations) ? translations : [];
  if (items.length === 0) {
    return null;
  }

  const preferred = items.find((item) => {
    const translation = asObject(item);
    const resourceId = asNullableNumber(translation.resourceId);
    const text = asNullableString(translation.text);
    return resourceId === preferredResourceId && Boolean(text);
  });

  if (preferred) {
    const translation = asObject(preferred);
    const text = asNullableString(translation.text);
    if (text) {
      return text;
    }
  }

  const firstWithText = items.find((item) =>
    Boolean(asNullableString(asObject(item).text)),
  );

  if (!firstWithText) {
    return null;
  }

  return asNullableString(asObject(firstWithText).text);
};

export const buildReaderUrlFromKey = (key: string | null | undefined): string | null => {
  const normalized = String(key ?? "").trim();
  if (!normalized) {
    return null;
  }

  if (/^\d+$/.test(normalized)) {
    return `/read/${normalized}`;
  }

  if (/^\d+:\d+(?:-\d+)?$/.test(normalized)) {
    return `/read/${normalized.split(":")[0]}`;
  }

  return null;
};

export const getGrantedScopes = (session: StoredSession): string[] => {
  const userSession = session.userSession ?? {};
  const rawScopes =
    userSession.scope ??
    userSession.scopes ??
    userSession.grantedScopes ??
    [];

  if (Array.isArray(rawScopes)) {
    return rawScopes.filter(Boolean);
  }

  if (typeof rawScopes !== "string") {
    return [];
  }

  return rawScopes
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
};

const hasScope = (grantedScopes: string[], scope: string): boolean =>
  grantedScopes.includes(scope);

const summarizeIdToken = (idToken: unknown): Record<string, unknown> | null => {
  if (typeof idToken !== "string") {
    return null;
  }

  const payload = decodeJwt(idToken);
  if (!payload) {
    return null;
  }

  return {
    audience: payload.aud,
    email: payload.email ?? null,
    expiresAt: payload.exp ?? null,
    firstName: payload.first_name ?? null,
    issuedAt: payload.iat ?? null,
    issuer: payload.iss ?? null,
    lastName: payload.last_name ?? null,
    sessionId: payload.sid ?? null,
    subject: payload.sub ?? null,
  };
};

const buildSessionFacts = (
  userSession: Record<string, unknown>,
  grantedScopes: string[],
  idTokenSummary: Record<string, unknown> | null,
): FactItem[] => {
  const subject =
    String(idTokenSummary?.email ?? idTokenSummary?.subject ?? "Unknown user");

  return [
    {
      label: "Signed in as",
      value: subject,
    },
    {
      label: "Granted scopes",
      value: `${grantedScopes.length}`,
    },
    {
      label: "Refresh token",
      value: userSession.refreshToken ? "Available" : "Missing",
    },
    {
      label: "Expires at",
      value: formatTimestamp(userSession.expiresAt) ?? "Unknown",
    },
  ];
};

const buildUserInfoFacts = (userInfo: Record<string, unknown> | null): FactItem[] => {
  if (!userInfo) {
    return [];
  }

  return [
    { label: "Subject", value: String(userInfo.sub ?? "Unavailable") },
    { label: "Email", value: String(userInfo.email ?? "Unavailable") },
    { label: "Issuer", value: String(userInfo.iss ?? "Unavailable") },
  ];
};

const buildProfileFacts = (profile: Record<string, unknown> | null): FactItem[] => {
  if (!profile) {
    return [];
  }

  const displayName = [profile.firstName, profile.lastName]
    .filter(Boolean)
    .join(" ");

  return [
    { label: "Username", value: String(profile.username ?? "Unavailable") },
    { label: "Display name", value: displayName || "Unavailable" },
    { label: "Posts", value: `${Number(profile.postsCount ?? 0)}` },
    { label: "Followers", value: `${Number(profile.followersCount ?? 0)}` },
  ];
};

const normalizeNoteItem = (note: unknown): NoteItem => {
  const entry = asObject(note);

  return {
    body: asString(entry.body),
    id: asNullableString(entry.id),
    ranges: Array.isArray(entry.ranges)
      ? entry.ranges.map((value) => asString(value)).filter(Boolean)
      : [],
  };
};

const normalizeBookmarkItem = (bookmark: unknown): BookmarkItem => {
  const entry = asObject(bookmark);
  const chapterKey = asNullableString(entry.key);
  const verseNumber = asNullableString(entry.verseNumber);
  const verseKey =
    chapterKey && verseNumber ? `${chapterKey}:${verseNumber}` : chapterKey ?? "?";

  return {
    id: asNullableString(entry.id),
    readerUrl: buildReaderUrlFromKey(verseKey),
    type: asString(entry.type, "ayah"),
    verseKey,
  };
};

const normalizeCollectionItem = (collection: unknown): CollectionItem => {
  const entry = asObject(collection);

  return {
    id: asNullableString(entry.id),
    name: asString(entry.name, "Untitled collection"),
    updatedAt: asNullableString(entry.updatedAt),
  };
};

const normalizeFeedItem = (post: unknown): FeedItem => {
  const entry = asObject(post);
  const references = Array.isArray(entry.references) ? entry.references : [];
  const firstReference = asObject(references[0]);
  const chapterId = asNullableString(firstReference.chapterId);
  const fromVerse = asNullableString(firstReference.from);
  const toVerse = asNullableString(firstReference.to);

  const referenceLabel = chapterId
    ? `${chapterId}:${fromVerse ?? "?"}${
        toVerse && toVerse !== fromVerse
          ? `-${toVerse}`
          : ""
      }`
    : null;

  const author = asObject(entry.author);

  return {
    authorName: asString(author.displayName ?? author.username, "QuranReflect author"),
    body: asString(entry.body),
    commentsCount: Number(asNullableNumber(entry.commentsCount) ?? 0),
    id: asNullableString(entry.id),
    likesCount: Number(asNullableNumber(entry.likesCount) ?? 0),
    readerUrl: buildReaderUrlFromKey(referenceLabel),
    referenceLabel,
  };
};

const normalizeSearchResults = (response: unknown, query: string) => {
  const result = asObject(asObject(response).result);

  const navigationItems: SearchItem[] = toArray(result.navigation).map((item) => ({
    label: asString(item.name ?? item.key, "Search result"),
    readerUrl: buildReaderUrlFromKey(asNullableString(item.key)),
    subtitle: asNullableString(item.arabic ?? item.result_type),
  }));

  const verseItems: SearchItem[] = toArray(result.verses).map((item) => {
    const text = asNullableString(item.text);
    const arabicText =
      asNullableString(
        item.textUthmani ??
          item.text_uthmani ??
          item.textUthmaniSimple ??
          item.textImlaei ??
          item.text_imlaei ??
          item.arabicText ??
          item.arabic,
      ) ?? (containsArabic(text) ? text : null);
    const verseKey = asNullableString(item.key ?? item.verseKey);

    return {
      arabicText,
      readerUrl: buildReaderUrlFromKey(verseKey),
      text:
        text ??
        (arabicText ? null : `Open ${asString(verseKey, "this result")} in the reader`) ??
        undefined,
      verseKey,
    };
  });

  return {
    error: null,
    navigationItems,
    query,
    verseItems,
  };
};

const createEmptySlice = (gatingMessage: string | null = null) => ({
  error: null,
  gatingMessage,
  items: [],
});

const createScopeGate = (scope: string): string => `Requires the \`${scope}\` scope.`;

const loadSafely = async (loader: () => Promise<unknown>) => {
  try {
    return {
      data: await loader(),
      error: null,
    };
  } catch (error) {
    return {
      data: null,
      error: formatError(error),
    };
  }
};

const didSdkClearSession = (
  initialUserSession: Record<string, unknown> | null | undefined,
  session: StoredSession,
): boolean => Boolean(initialUserSession && !session.userSession);

const normalizeNotes = (response: unknown): NoteItem[] =>
  toArray(response, ["data", "items", "rows"]).slice(0, LIST_PREVIEW_LIMIT).map(normalizeNoteItem);

const normalizeBookmarks = (response: unknown): BookmarkItem[] =>
  toArray(response, ["data", "items", "rows"]).slice(0, LIST_PREVIEW_LIMIT).map(normalizeBookmarkItem);

const normalizeCollections = (response: unknown): CollectionItem[] =>
  toArray(response, ["data", "items", "rows"]).slice(0, LIST_PREVIEW_LIMIT).map(normalizeCollectionItem);

const normalizeFeedItems = (response: unknown): FeedItem[] =>
  toArray(response, ["data", "items", "rows"]).slice(0, LIST_PREVIEW_LIMIT).map(normalizeFeedItem);

export const loadContentPreviewData = async (
  session: StoredSession,
): Promise<{ error: string | null; items: ContentPreviewItem[]; previewReaderUrl: string }> => {
  const config = getConfig();
  const { serverClient } = await createClients(session);

  const payload: {
    error: string | null;
    items: ContentPreviewItem[];
    previewReaderUrl: string;
  } = {
    error: null,
    items: [] as ContentPreviewItem[],
    previewReaderUrl: `/read/${config.defaultReaderChapter}`,
  };

  try {
    const chapters = await serverClient.content.v4.chapters.list();
    const items = toArray(chapters, ["data", "chapters"]).slice(0, 6);

    payload.items = items.map((chapter) => ({
      id: Number(asNullableNumber(chapter.id) ?? 0),
      nameArabic: asNullableString(chapter.nameArabic),
      nameSimple: asString(chapter.nameSimple, `Chapter ${asString(chapter.id)}`),
      readerUrl: `/read/${asString(chapter.id)}`,
      translatedName: asNullableString(asObject(chapter.translatedName).name),
      versesCount: asNullableNumber(chapter.versesCount),
    }));

    if (payload.items[0]?.readerUrl) {
      payload.previewReaderUrl = payload.items[0].readerUrl;
    }
  } catch (error) {
    payload.error = formatError(error);
  }

  return payload;
};

export const loadSearchData = async (
  session: StoredSession,
  query: string | null,
): Promise<{ error: string | null; navigationItems: SearchItem[]; query: string; verseItems: SearchItem[] }> => {
  const normalizedQuery = String(query ?? "").trim();

  if (!normalizedQuery) {
    return {
      error: null,
      navigationItems: [],
      query: "",
      verseItems: [],
    };
  }

  const { serverClient } = await createClients(session);
  const mode = await getSearchModeQuick();

  try {
    const response = await serverClient.search.v1.query({
      mode,
      query: normalizedQuery,
    });

    return normalizeSearchResults(response, normalizedQuery);
  } catch (error) {
    return {
      error: formatError(error),
      navigationItems: [],
      query: normalizedQuery,
      verseItems: [],
    };
  }
};

export const loadReaderData = async (
  session: StoredSession,
  chapterId: string,
): Promise<ReaderPayload> => {
  const config = getConfig();
  const { serverClient } = await createClients(session);

  const chapterResponse = await serverClient.content.v4.chapters.get(chapterId);
  const chapterPayload = asObject(chapterResponse);
  const chapter = asObject(chapterPayload.chapter ?? chapterPayload);
  const versesCount = asNullableNumber(chapter.versesCount);
  const totalVersePages = Math.max(
    1,
    versesCount ? Math.ceil(versesCount / READER_PAGE_SIZE) : 1,
  );
  const versePageResponses = await Promise.all(
    Array.from({ length: totalVersePages }, (_value, index) =>
      serverClient.content.v4.verses.byChapter(chapterId, {
        fields: {
          textUthmani: true,
        },
        page: index + 1,
        perPage: READER_PAGE_SIZE,
        translations: config.translationIds,
        words: false,
      }),
    ),
  );

  const verses = versePageResponses
    .flatMap((response) => toArray(response, ["data", "verses"]))
    .map((verse) => ({
      arabicText: asString(verse.textUthmani),
      id: asString(
        verse.id ?? verse.verseKey ?? `${chapterId}-${asString(verse.verseNumber, "verse")}`,
      ),
      translationText: getTranslationText(verse.translations, config.translationIds[0]),
      verseKey: asNullableString(verse.verseKey),
      verseNumber: asNullableNumber(verse.verseNumber),
    }));

  return {
    chapter: {
      id: Number(asNullableNumber(chapter.id) ?? Number(chapterId)),
      nameArabic: asNullableString(chapter.nameArabic),
      nameSimple: asString(chapter.nameSimple, `Chapter ${chapterId}`),
      translatedName: asNullableString(asObject(chapter.translatedName).name),
      versesCount,
    },
    translationIds: config.translationIds,
    verses,
  };
};

const createSignedOutBootstrap = ({
  authError,
  contentPreview,
  flashNotice,
  sessionStoreSummary,
}: {
  authError: string | null;
  contentPreview: BootstrapPayload["contentPreview"];
  flashNotice: BootstrapPayload["flashNotice"];
  sessionStoreSummary: string;
}): BootstrapPayload => ({
  authError,
  bookmarks: createEmptySlice(),
  collections: createEmptySlice(),
  contentPreview,
  flashNotice,
  goals: {
    data: null,
    error: null,
    gatingMessage: null,
  },
  grantedScopes: [],
  idTokenSummary: null,
  isLoggedIn: false,
  notes: createEmptySlice(),
  preferences: {
    data: null,
    error: null,
    gatingMessage: null,
  },
  quranReflect: {
    feed: createEmptySlice(),
    profile: {
      data: null,
      error: null,
      facts: [],
      gatingMessage: null,
    },
  },
  sessionFacts: [],
  sessionStoreSummary,
  userInfo: {
    data: null,
    error: null,
    facts: [],
    gatingMessage: null,
  },
});

export const loadBootstrapData = async (
  session: StoredSession,
  sessionStoreSummary: string,
): Promise<BootstrapPayload> => {
  const contentPreview = await loadContentPreviewData(session);
  const authError = session.authError ?? null;
  const flashNotice = session.flashNotice ?? null;
  session.authError = null;
  session.flashNotice = null;

  const initialUserSession = session.userSession;
  if (!initialUserSession) {
    return createSignedOutBootstrap({
      authError,
      contentPreview,
      flashNotice,
      sessionStoreSummary,
    });
  }

  const grantedScopes = getGrantedScopes(session);
  const { serverClient } = await createClients(session);

  const [
    userInfoResult,
    notesResult,
    bookmarksResult,
    collectionsResult,
    goalsResult,
    preferencesResult,
    profileResult,
    feedResult,
  ] = await Promise.all([
    loadSafely(() => serverClient.oauth2.v1.getUserInfo()),
    hasScope(grantedScopes, "note")
      ? loadSafely(() => serverClient.auth.v1.notes.list())
      : Promise.resolve({ data: null, error: null }),
    hasScope(grantedScopes, "bookmark")
      ? loadSafely(() =>
          serverClient.auth.v1.bookmarks.list({
            first: LIST_PREVIEW_LIMIT,
            mushafId: DEFAULT_BOOKMARK_MUSHAF,
            type: "ayah",
          }),
        )
      : Promise.resolve({ data: null, error: null }),
    hasScope(grantedScopes, "collection")
      ? loadSafely(() =>
          serverClient.auth.v1.collections.list({
            first: LIST_PREVIEW_LIMIT,
            sortBy: "recentlyUpdated",
          }),
        )
      : Promise.resolve({ data: null, error: null }),
    hasScope(grantedScopes, "goal")
      ? loadSafely(() => serverClient.auth.v1.goals.getTodaysPlan())
      : Promise.resolve({ data: null, error: null }),
    hasScope(grantedScopes, "preference")
      ? loadSafely(() => serverClient.auth.v1.preferences.get())
      : Promise.resolve({ data: null, error: null }),
    hasScope(grantedScopes, "user")
      ? loadSafely(() => serverClient.quranReflect.v1.users.profile())
      : Promise.resolve({ data: null, error: null }),
    hasScope(grantedScopes, "post")
      ? loadSafely(() => serverClient.quranReflect.v1.posts.feed(DEFAULT_FEED_QUERY))
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (didSdkClearSession(initialUserSession, session)) {
    return createSignedOutBootstrap({
      authError,
      contentPreview,
      flashNotice: {
        message: SESSION_EXPIRED_MESSAGE,
        type: "error",
      },
      sessionStoreSummary,
    });
  }

  const currentSession = (session.userSession ?? initialUserSession) as Record<string, unknown>;
  const currentScopes = getGrantedScopes(session);
  const idTokenSummary = summarizeIdToken(currentSession.idToken);
  const normalizedUserInfo = asNullableObject(userInfoResult.data);
  const normalizedGoals = asNullableObject(goalsResult.data);
  const normalizedPreferences = asNullableObject(preferencesResult.data);
  const normalizedProfile = asNullableObject(profileResult.data);

  return {
    authError,
    bookmarks: hasScope(currentScopes, "bookmark")
      ? {
          error: bookmarksResult.error,
          gatingMessage: null,
          items: normalizeBookmarks(bookmarksResult.data),
        }
      : createEmptySlice(createScopeGate("bookmark")),
    collections: hasScope(currentScopes, "collection")
      ? {
          error: collectionsResult.error,
          gatingMessage: null,
          items: normalizeCollections(collectionsResult.data),
        }
      : createEmptySlice(createScopeGate("collection")),
    contentPreview,
    flashNotice,
    goals: {
      data: normalizedGoals,
      error: goalsResult.error,
      gatingMessage: hasScope(currentScopes, "goal") ? null : createScopeGate("goal"),
    },
    grantedScopes: currentScopes,
    idTokenSummary,
    isLoggedIn: true,
    notes: hasScope(currentScopes, "note")
      ? {
          error: notesResult.error,
          gatingMessage: null,
          items: normalizeNotes(notesResult.data),
        }
      : createEmptySlice(createScopeGate("note")),
    preferences: {
      data: normalizedPreferences,
      error: preferencesResult.error,
      gatingMessage: hasScope(currentScopes, "preference") ? null : createScopeGate("preference"),
    },
    quranReflect: {
      feed: hasScope(currentScopes, "post")
        ? {
            error: feedResult.error,
            gatingMessage: null,
            items: normalizeFeedItems(feedResult.data),
          }
        : createEmptySlice(createScopeGate("post")),
      profile: {
        data: normalizedProfile,
        error: profileResult.error,
        facts: buildProfileFacts(normalizedProfile),
        gatingMessage: hasScope(currentScopes, "user") ? null : createScopeGate("user"),
      },
    },
    sessionFacts: buildSessionFacts(currentSession, currentScopes, idTokenSummary),
    sessionStoreSummary,
    userInfo: {
      data: normalizedUserInfo,
      error: userInfoResult.error,
      facts: buildUserInfoFacts(normalizedUserInfo),
      gatingMessage: null,
    },
  };
};

export const runUserAction = async <T>(
  session: StoredSession,
  action: (serverClient: import("@/lib/sdk").ServerClient) => Promise<T>,
): Promise<{ data: T | null; error: string | null; sessionExpired: boolean }> => {
  const initialUserSession = session.userSession;
  const { serverClient } = await createClients(session);

  try {
    return {
      data: await action(serverClient),
      error: null,
      sessionExpired: false,
    };
  } catch (error) {
    if (didSdkClearSession(initialUserSession, session)) {
      return {
        data: null,
        error: SESSION_EXPIRED_MESSAGE,
        sessionExpired: true,
      };
    }

    return {
      data: null,
      error: formatError(error),
      sessionExpired: false,
    };
  }
};

export const ensureUserScope = (
  session: StoredSession,
  scope: string,
):
  | { ok: true }
  | {
      gatingMessage?: string | null;
      message: string;
      ok: false;
      signedOut: boolean;
      status: number;
    } => {
  if (!session.userSession) {
    return {
      message: "Sign in first to use user-session actions.",
      ok: false,
      signedOut: true,
      status: 401,
    };
  }

  const grantedScopes = getGrantedScopes(session);
  if (!hasScope(grantedScopes, scope)) {
    return {
      gatingMessage: createScopeGate(scope),
      message: `This action requires the \`${scope}\` scope.`,
      ok: false,
      signedOut: false,
      status: 403,
    };
  }

  return {
    ok: true,
  };
};

export const parsePositiveInteger = (value: unknown): number | null => {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!/^[1-9]\d*$/.test(normalized)) {
    return null;
  }

  const parsed = Number(normalized);

  if (!Number.isSafeInteger(parsed)) {
    return null;
  }

  return parsed;
};

export const parseVerseKey = (value: unknown): string | null => {
  const trimmed = String(value ?? "").trim();

  if (!/^\d+:\d+$/.test(trimmed)) {
    return null;
  }

  return trimmed;
};

export const normalizeMutationPayload = {
  bookmark: normalizeBookmarkItem,
  collection: normalizeCollectionItem,
  note: normalizeNoteItem,
};
