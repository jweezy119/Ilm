"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";

import { starterConfig } from "../../starter.config";
import {
  buildGoalPayload,
  buildPreferencesPayload,
  getAuthActionView,
  getCollectionLabel,
  getDisplayRows,
  getListView,
  getReaderLoadingView,
  getRouteAccess,
  getUserProfileView,
  type StarterRoute,
} from "@/lib/page-model";
import type { BootstrapPayload, ReaderPayload, SearchItem } from "@/lib/types";

import styles from "./starter-shell.module.css";

type ToastType = "error" | "success";

interface Notice {
  message: string;
  type: ToastType;
}

interface SearchPayload {
  error: string | null;
  navigationItems: SearchItem[];
  query: string;
  verseItems: SearchItem[];
}

interface MutationResult<T = unknown> {
  data?: T;
  deletedId?: string;
  item?: T;
  message?: string;
  ok?: boolean;
  signedOut?: boolean;
}

const navigationItems: Array<{
  href: string;
  key: StarterRoute;
  label: string;
  requiresLogin?: boolean;
}> = [
  { href: "/", key: "home", label: "Home" },
  { href: "/read/1", key: "reader", label: "Reader" },
  { href: "/search", key: "search", label: "Search" },
  { href: "/library", key: "library", label: "Library", requiresLogin: true },
  { href: "/reflect", key: "reflect", label: "Reflect", requiresLogin: true },
  { href: "/goals", key: "goals", label: "Goals", requiresLogin: true },
  { href: "/settings", key: "settings", label: "Settings", requiresLogin: true },
];

const fetchJson = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url, { credentials: "include" });
  const payload = (await response.json().catch(() => ({}))) as T;

  if (!response.ok) {
    throw payload;
  }

  return payload;
};

const mutationRequest = async <T,>(
  url: string,
  method: "DELETE" | "POST",
  body?: Record<string, unknown>,
): Promise<MutationResult<T>> => {
  const response = await fetch(url, {
    body: body ? JSON.stringify(body) : undefined,
    credentials: "include",
    headers: body ? { "content-type": "application/json" } : undefined,
    method,
  });

  const payload = (await response.json().catch(() => ({}))) as MutationResult<T>;

  if (!response.ok) {
    throw payload;
  }

  return payload;
};

const cx = (...classNames: Array<string | false | null | undefined>): string =>
  classNames.filter(Boolean).join(" ");

const createToastId = (): number => Date.now() + Math.floor(Math.random() * 1000);

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) {
      return message;
    }
  }

  return fallback;
};

const getRouteFromPathname = (pathname: string): StarterRoute => {
  if (pathname.startsWith("/read")) {
    return "reader";
  }

  if (pathname.startsWith("/search")) {
    return "search";
  }

  if (pathname.startsWith("/library")) {
    return "library";
  }

  if (pathname.startsWith("/goals")) {
    return "goals";
  }

  if (pathname.startsWith("/reflect")) {
    return "reflect";
  }

  if (pathname.startsWith("/settings")) {
    return "settings";
  }

  return "home";
};

export default function StarterShell() {
  const params = useParams<{ chapterId?: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const route = useMemo(() => getRouteFromPathname(pathname), [pathname]);
  const activeChapterId = route === "reader" ? params?.chapterId ?? "1" : "1";

  const {
    data,
    error: bootstrapError,
    isLoading,
    mutate,
  } = useSWR<BootstrapPayload>("/api/bootstrap", fetchJson, {
    revalidateOnFocus: false,
  });

  const [notice, setNotice] = useState<Notice | null>(null);
  const [searchInput, setSearchInput] = useState("mercy");
  const [searchQuery, setSearchQuery] = useState("");
  const [readerChapter, setReaderChapter] = useState(activeChapterId);
  const [noteVerseKey, setNoteVerseKey] = useState("1:1");
  const [noteBody, setNoteBody] = useState("");
  const [bookmarkChapter, setBookmarkChapter] = useState("1");
  const [bookmarkVerse, setBookmarkVerse] = useState("1");
  const [collectionName, setCollectionName] = useState("");
  const [reflectionVerseKey, setReflectionVerseKey] = useState("1:1");
  const [reflectionBody, setReflectionBody] = useState("");
  const [goalCategory, setGoalCategory] = useState("QURAN");
  const [goalPeriod, setGoalPeriod] = useState("daily");
  const [goalTargetAmount, setGoalTargetAmount] = useState("2");
  const [goalType, setGoalType] = useState("PAGES");
  const [preferenceFontSize, setPreferenceFontSize] = useState("3");
  const [preferenceMushafLines, setPreferenceMushafLines] = useState("15");
  const [preferenceReciter, setPreferenceReciter] = useState("7");

  const authAction = getAuthActionView(data ?? null);
  const routeAccess = getRouteAccess(route, data ?? null);
  const profileView = getUserProfileView(data ?? null);
  const notesView = getListView("note", data?.notes);
  const bookmarksView = getListView("bookmark", data?.bookmarks);
  const collectionsView = getListView("collection", data?.collections);
  const goalRows = getDisplayRows(data?.goals?.data);
  const preferenceRows = getDisplayRows(data?.preferences?.data);
  const userInfoRows = getDisplayRows(data?.userInfo?.data);
  const idTokenRows = getDisplayRows(data?.idTokenSummary);
  const quranReflectProfileRows = getDisplayRows(data?.quranReflect?.profile.data);

  const {
    data: searchData,
    error: searchError,
    isLoading: isSearchLoading,
  } = useSWR<SearchPayload>(
    route === "search" && searchQuery
      ? `/api/search?query=${encodeURIComponent(searchQuery)}`
      : null,
    fetchJson,
    { keepPreviousData: true, revalidateOnFocus: false },
  );

  const {
    data: readerData,
    error: readerError,
    isLoading: isReaderLoading,
    isValidating: isReaderValidating,
  } = useSWR<ReaderPayload>(
    route === "reader"
      ? `/api/reader/${encodeURIComponent(activeChapterId || "1")}`
      : null,
    fetchJson,
    { keepPreviousData: true, revalidateOnFocus: false },
  );

  const readerView = getReaderLoadingView({
    hasError: Boolean(readerError),
    hasReaderResult: Boolean(readerData),
    isLoading: isReaderLoading || isReaderValidating,
  });

  useEffect(() => {
    setReaderChapter(activeChapterId);
  }, [activeChapterId]);

  useEffect(() => {
    if (data?.flashNotice?.message) {
      pushNotice(data.flashNotice.message, data.flashNotice.type);
    }
  }, [data?.flashNotice?.message, data?.flashNotice?.type]);

  useEffect(() => {
    if (data?.authError) {
      pushNotice(data.authError, "error");
    }
  }, [data?.authError]);

  const pushNotice = (message: string, type: ToastType = "success") => {
    setNotice({ message, type });
    const id = createToastId();
    window.setTimeout(() => {
      setNotice((current) =>
        current?.message === message && current.type === type ? null : current,
      );
    }, 4500 + (id % 500));
  };

  const requireSession = (): boolean => {
    if (data?.isLoggedIn) {
      return true;
    }

    pushNotice("Sign in first.", "error");
    return false;
  };

  const submitJson = async <T,>(
    url: string,
    method: "DELETE" | "POST",
    body?: Record<string, unknown>,
  ): Promise<MutationResult<T> | null> => {
    pushNotice("Saving...", "success");

    try {
      const response = await mutationRequest<T>(url, method, body);
      pushNotice(response.message ?? "Saved.", "success");
      await mutate();
      return response;
    } catch (error) {
      const payload = error as MutationResult;
      if (payload.signedOut) {
        await mutate();
      }

      pushNotice(
        payload.message ?? getErrorMessage(error, "Request failed."),
        "error",
      );
      return null;
    }
  };

  const refreshUserSession = async () => {
    if (!requireSession()) {
      return;
    }

    await submitJson("/api/session/refresh", "POST");
  };

  const runSearch = () => {
    const nextQuery = searchInput.trim();
    if (!nextQuery) {
      setSearchQuery("");
      return;
    }

    setSearchQuery(nextQuery);
  };

  const openReaderChapter = () => {
    const normalizedChapter = readerChapter.trim() || "1";
    router.push(`/read/${encodeURIComponent(normalizedChapter)}`, { scroll: false });
  };

  const createNote = async () => {
    if (!requireSession()) {
      return;
    }

    const saved = await submitJson("/api/notes", "POST", {
      body: noteBody,
      verseKey: noteVerseKey,
    });

    if (saved) {
      setNoteBody("");
    }
  };

  const deleteNote = async (noteId: string | null) => {
    if (!noteId) {
      pushNotice("This note does not have an id to delete.", "error");
      return;
    }

    await submitJson(`/api/notes/${encodeURIComponent(noteId)}`, "DELETE");
  };

  const createBookmark = async () => {
    if (!requireSession()) {
      return;
    }

    await submitJson("/api/bookmarks", "POST", {
      chapterNumber: bookmarkChapter,
      verseNumber: bookmarkVerse,
    });
  };

  const deleteBookmark = async (bookmarkId: string | null) => {
    if (!bookmarkId) {
      pushNotice("This bookmark does not have an id to delete.", "error");
      return;
    }

    await submitJson(`/api/bookmarks/${encodeURIComponent(bookmarkId)}`, "DELETE");
  };

  const createCollection = async () => {
    if (!requireSession()) {
      return;
    }

    const saved = await submitJson("/api/collections", "POST", {
      name: collectionName,
    });

    if (saved) {
      setCollectionName("");
    }
  };

  const deleteCollection = async (collectionId: string | null) => {
    if (!collectionId) {
      pushNotice("This collection does not have an id to delete.", "error");
      return;
    }

    await submitJson(`/api/collections/${encodeURIComponent(collectionId)}`, "DELETE");
  };

  const createReflection = async () => {
    if (!requireSession()) {
      return;
    }

    const saved = await submitJson("/api/reflections", "POST", {
      body: reflectionBody,
      verseKey: reflectionVerseKey,
    });

    if (saved) {
      setReflectionBody("");
    }
  };

  const submitGoalPayload = async () => {
    if (!requireSession()) {
      return;
    }

    const payload = buildGoalPayload({
      category: goalCategory,
      period: goalPeriod,
      targetAmount: goalTargetAmount,
      type: goalType,
    });

    if (!payload) {
      pushNotice("Enter a valid goal before saving.", "error");
      return;
    }

    await submitJson("/api/goals", "POST", { payload });
  };

  const submitPreferencesPayload = async () => {
    if (!requireSession()) {
      return;
    }

    const payload = buildPreferencesPayload({
      fontSize: preferenceFontSize,
      mushafLines: preferenceMushafLines,
      reciter: preferenceReciter,
    });

    if (!payload) {
      pushNotice("Enter valid preference values before saving.", "error");
      return;
    }

    await submitJson("/api/preferences", "POST", { payload });
  };

//  const renderHome = () => (
//    <>
//      <section className={cx(styles.panel, styles["hero-panel"])}>
//        <p className={styles.eyebrow}>Quran Foundation starter</p>
//        <h1>Build a full Quran app with SDK-powered auth and user features.</h1>
//        <p>
//          A route-level Next.js starter for OAuth2 login, reader content, search,
//          notes, bookmarks, collections, QuranReflect, goals, and preferences.
//        </p>
//        <div className={styles["hero-actions"]}>
//          <Link className={cx(styles["primary-action"], styles.inline)} href="/read/1" scroll={false}>
//            Open reader
//          </Link>
//          <Link className={cx(styles["secondary-action"], styles.inline)} href="/search">
//            Search Quran
//          </Link>
//          {!data?.isLoggedIn ? (
//            <a className={cx(styles["secondary-action"], styles.inline)} href="/api/auth/start">
//              Login for user APIs
//            </a>
//          ) : null}
//        </div>
//      </section>
//
//      <section className={styles["overview-grid"]}>
//        <Link className={styles["feature-link"]} href="/read/1" scroll={false}>
//          <span>Reader</span>
//          <strong>{data?.contentPreview?.items?.[0]?.nameSimple ?? "Chapter 1"}</strong>
//          <small>Server-side content API through the app token.</small>
//        </Link>
//        <Link className={styles["feature-link"]} href="/search">
//          <span>Search</span>
//          <strong>Find chapters and verses</strong>
//          <small>Backend search proxy keeps SDK credentials server-side.</small>
//        </Link>
//        <Link className={styles["feature-link"]} href="/library">
//          <span>Library</span>
//          <strong>
//            {data?.isLoggedIn
//              ? `${notesView.count} notes · ${bookmarksView.count} bookmarks`
//              : "Notes, bookmarks, and collections"}
//          </strong>
//          <small>
//            {data?.isLoggedIn
//              ? `${collectionsView.count} collections available.`
//              : "Login required for user library APIs."}
//          </small>
//        </Link>
//        <Link className={styles["feature-link"]} href="/reflect">
//          <span>QuranReflect</span>
//          <strong>
//            {data?.isLoggedIn
//              ? profileView.facts[0]?.value ?? "Profile and feed"
//              : "Profile and reflections"}
//          </strong>
//          <small>
//            {data?.isLoggedIn
//              ? "Profile, feed, and post APIs are ready."
//              : "Login required for user profile and posting."}
//          </small>
//        </Link>
//      </section>
//    </>
//  );
//
  const renderReader = () => (
    <>
      <section className={cx(styles.panel, styles["hero-panel"], styles.compact)}>
        <p className={styles.eyebrow}>Reader</p>
        <h1>Read a chapter.</h1>
        <p>Content loads through the backend app-token path.</p>
        <div className={styles["inline-form"]}>
          <input
            aria-label="Chapter number"
            inputMode="numeric"
            onChange={(event) => setReaderChapter(event.target.value)}
            value={readerChapter}
          />
          <button className={styles["primary-button"]} onClick={openReaderChapter} type="button">
            Open chapter
          </button>
        </div>
      </section>

      {data?.contentPreview?.items?.length ? (
        <div className={styles["chapter-strip"]} aria-label="Chapter shortcuts">
          {data.contentPreview.items.map((chapter) => (
            <Link key={chapter.id} href={chapter.readerUrl} scroll={false}>
              {chapter.id}. {chapter.nameSimple}
            </Link>
          ))}
        </div>
      ) : null}

      <section className={cx(styles.panel, styles["reader-panel"])}>
        {readerView.showInitialLoading ? (
          <div className={styles["reader-placeholder"]}>
            <p>Loading chapter...</p>
          </div>
        ) : null}

        {readerView.showError ? (
          <p className={styles["error-text"]}>
            {getErrorMessage(readerError, "Reader data failed to load.")}
          </p>
        ) : null}

        {readerView.showReaderContent && readerData ? (
          <>
            <header className={styles["section-header"]}>
              <div>
                <p className={styles.eyebrow}>Chapter {readerData.chapter.id}</p>
                <h2>{readerData.chapter.nameSimple}</h2>
                <p>{readerData.chapter.translatedName ?? "Quran chapter"}</p>
              </div>
              <div className={styles["reader-heading-side"]}>
                {readerView.showLoadingBadge ? (
                  <span className={styles["loading-pill"]}>Loading next chapter...</span>
                ) : null}
                {readerData.chapter.nameArabic ? (
                  <strong className={styles["arabic-title"]}>{readerData.chapter.nameArabic}</strong>
                ) : null}
              </div>
            </header>
            <div className={styles["verse-list"]}>
              {readerData.verses.map((verse) => (
                <article className={styles["verse-row"]} key={verse.id}>
                  <span>{verse.verseKey ?? "Verse"}</span>
                  <p className={styles["arabic-text"]}>{verse.arabicText}</p>
                  <p>{verse.translationText ?? "No translation in this response."}</p>
                </article>
              ))}
            </div>
          </>
        ) : null}
      </section>
    </>
  );

  const renderSearch = () => (
    <>
      <section className={cx(styles.panel, styles["hero-panel"], styles.compact)}>
        <p className={styles.eyebrow}>Search</p>
        <h1>Search Quran content.</h1>
        <p>Search uses the server SDK path so app credentials stay outside browser JavaScript.</p>
        <div className={styles["inline-form"]}>
          <input
            aria-label="Search query"
            onChange={(event) => setSearchInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                runSearch();
              }
            }}
            placeholder="Search mercy, guidance, patience..."
            type="search"
            value={searchInput}
          />
          <button className={styles["primary-button"]} onClick={runSearch} type="button">
            Run search
          </button>
        </div>
      </section>

      <section className={styles.panel}>
        <header className={styles["section-header"]}>
          <div>
            <p className={styles.eyebrow}>Results</p>
            <h2>{searchData?.query ? `Showing results for ${searchData.query}` : "Run a query to begin."}</h2>
          </div>
        </header>
        {isSearchLoading ? <p>Searching...</p> : null}
        {searchError ? (
          <p className={styles["error-text"]}>{getErrorMessage(searchError, "Search failed.")}</p>
        ) : null}
        {searchData?.error ? <p className={styles["error-text"]}>{searchData.error}</p> : null}
        {searchData && !searchData.error ? (
          <div className={styles["results-grid"]}>
            <div>
              <h3>Navigation</h3>
              {searchData.navigationItems.length ? (
                searchData.navigationItems.map((item, index) => (
                  <Link
                    className={styles["result-row"]}
                    href={item.readerUrl ?? "/read/1"}
                    key={`${item.label ?? "result"}-${index}`}
                    scroll={false}
                  >
                    <strong>{item.label ?? "Result"}</strong>
                    <span>{item.subtitle ?? "Open in reader"}</span>
                  </Link>
                ))
              ) : (
                <p className={styles.muted}>No navigation results.</p>
              )}
            </div>
            <div>
              <h3>Verses</h3>
              {searchData.verseItems.length ? (
                searchData.verseItems.map((item, index) => (
                  <Link
                    className={styles["result-row"]}
                    href={item.readerUrl ?? "/read/1"}
                    key={`${item.verseKey ?? "verse"}-${index}`}
                    scroll={false}
                  >
                    <strong>{item.verseKey ?? "Verse"}</strong>
                    {item.arabicText ? (
                      <span className={styles["search-arabic"]}>{item.arabicText}</span>
                    ) : null}
                    <span>{item.text ?? "Open result in reader"}</span>
                  </Link>
                ))
              ) : (
                <p className={styles.muted}>No verse results.</p>
              )}
            </div>
          </div>
        ) : null}
      </section>
    </>
  );

  const renderLibrary = () => (
    <>
      <section className={cx(styles.panel, styles["hero-panel"], styles.compact)}>
        <p className={styles.eyebrow}>Library</p>
        <h1>Manage notes, bookmarks, and collections.</h1>
        <p>User library APIs use the logged-in token on the server.</p>
      </section>

      <section className={cx(styles["workspace-grid"], styles.three)}>
        <article className={cx(styles.panel, styles["tool-panel"])}>
          <h2>Notes</h2>
          <p className={styles.muted}>{notesView.message}</p>
          <input
            onChange={(event) => setNoteVerseKey(event.target.value)}
            placeholder="Verse key (e.g. 2:255)"
            value={noteVerseKey}
          />
          <textarea
            onChange={(event) => setNoteBody(event.target.value)}
            placeholder="Write a short note."
            value={noteBody}
          />
          <button className={styles["primary-button"]} onClick={() => void createNote()} type="button">
            Save note
          </button>
          {data?.notes?.gatingMessage ? <p className={styles.muted}>{data.notes.gatingMessage}</p> : null}
          {data?.notes?.error ? <p className={styles["error-text"]}>{data.notes.error}</p> : null}
          <div className={styles.stack}>
            {(data?.notes?.items ?? []).map((note) => (
              <div className={styles["item-row"]} key={note.id ?? `${note.body}-${note.ranges[0]}`}>
                <div>
                  <strong>{note.ranges[0] ?? "Verse range"}</strong>
                  <p>{note.body}</p>
                </div>
                <button
                  className={styles["danger-button"]}
                  disabled={!note.id}
                  onClick={() => void deleteNote(note.id)}
                  type="button"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </article>

        <article className={cx(styles.panel, styles["tool-panel"])}>
          <h2>Bookmarks</h2>
          <p className={styles.muted}>{bookmarksView.message}</p>
          <input
            inputMode="numeric"
            onChange={(event) => setBookmarkChapter(event.target.value)}
            placeholder="Chapter number"
            value={bookmarkChapter}
          />
          <input
            inputMode="numeric"
            onChange={(event) => setBookmarkVerse(event.target.value)}
            placeholder="Verse number"
            value={bookmarkVerse}
          />
          <button className={styles["primary-button"]} onClick={() => void createBookmark()} type="button">
            Save bookmark
          </button>
          {data?.bookmarks?.gatingMessage ? <p className={styles.muted}>{data.bookmarks.gatingMessage}</p> : null}
          {data?.bookmarks?.error ? <p className={styles["error-text"]}>{data.bookmarks.error}</p> : null}
          <div className={styles.stack}>
            {(data?.bookmarks?.items ?? []).map((bookmark) => (
              <div className={styles["item-row"]} key={bookmark.id ?? bookmark.verseKey}>
                <Link href={bookmark.readerUrl ?? "/read/1"} scroll={false}>
                  {bookmark.verseKey} · {bookmark.type}
                </Link>
                <button
                  className={styles["danger-button"]}
                  disabled={!bookmark.id}
                  onClick={() => void deleteBookmark(bookmark.id)}
                  type="button"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </article>

        <article className={cx(styles.panel, styles["tool-panel"])}>
          <h2>Collections</h2>
          <p className={styles.muted}>{collectionsView.message}</p>
          <input
            onChange={(event) => setCollectionName(event.target.value)}
            placeholder="Collection name"
            value={collectionName}
          />
          <button className={styles["primary-button"]} onClick={() => void createCollection()} type="button">
            Save collection
          </button>
          {data?.collections?.gatingMessage ? <p className={styles.muted}>{data.collections.gatingMessage}</p> : null}
          {data?.collections?.error ? <p className={styles["error-text"]}>{data.collections.error}</p> : null}
          <div className={styles.stack}>
            {(data?.collections?.items ?? []).map((collection) => (
              <div className={styles["item-row"]} key={collection.id ?? collection.name}>
                <div>
                  <strong>{collection.name}</strong>
                  <p>{getCollectionLabel(collection)}</p>
                </div>
                <button
                  className={styles["danger-button"]}
                  disabled={!collection.id}
                  onClick={() => void deleteCollection(collection.id)}
                  type="button"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </article>
      </section>
    </>
  );

  const renderReflect = () => (
    <>
      <section className={cx(styles.panel, styles["hero-panel"], styles.compact)}>
        <p className={styles.eyebrow}>QuranReflect</p>
        <h1>Profile, feed, and reflection posting.</h1>
        <p>Reflection APIs use the logged-in Quran Foundation user session.</p>
      </section>

      <section className={cx(styles["workspace-grid"], styles.two)}>
        <article className={cx(styles.panel, styles["tool-panel"])}>
          <h2>Create reflection</h2>
          <input
            onChange={(event) => setReflectionVerseKey(event.target.value)}
            placeholder="Verse key (e.g. 1:1)"
            value={reflectionVerseKey}
          />
          <textarea
            onChange={(event) => setReflectionBody(event.target.value)}
            placeholder="Write a short reflection."
            value={reflectionBody}
          />
          <button className={styles["primary-button"]} onClick={() => void createReflection()} type="button">
            Post reflection
          </button>
        </article>
        <article className={cx(styles.panel, styles["tool-panel"])}>
          <h2>User profile</h2>
          {profileView.message ? (
            <p className={profileView.kind === "error" ? styles["error-text"] : styles.muted}>
              {profileView.message}
            </p>
          ) : null}
          {profileView.facts.map((fact) => (
            <div className={styles["fact-row"]} key={fact.label}>
              <span>{fact.label}</span>
              <strong>{fact.value}</strong>
            </div>
          ))}
        </article>
      </section>

      <section className={styles.panel}>
        <header className={styles["section-header"]}>
          <div>
            <p className={styles.eyebrow}>Feed preview</p>
            <h2>Recent QuranReflect posts</h2>
          </div>
        </header>
        {data?.quranReflect?.feed.error ? (
          <p className={styles["error-text"]}>{data.quranReflect.feed.error}</p>
        ) : (
          <div className={styles.stack}>
            {(data?.quranReflect?.feed.items ?? []).length ? (
              (data?.quranReflect?.feed.items ?? []).map((post) => (
                <article className={styles["feed-row"]} key={post.id ?? `${post.authorName}-${post.body}`}>
                  <header>
                    <strong>{post.authorName}</strong>
                    <small>{post.likesCount} likes · {post.commentsCount} comments</small>
                  </header>
                  <p>{post.body}</p>
                  {post.referenceLabel && post.readerUrl ? (
                    <Link href={post.readerUrl} scroll={false}>{post.referenceLabel}</Link>
                  ) : null}
                </article>
              ))
            ) : (
              <p className={styles.muted}>No feed items returned for this session.</p>
            )}
          </div>
        )}
      </section>
    </>
  );

  const renderGoals = () => (
    <>
      <section className={cx(styles.panel, styles["hero-panel"], styles.compact)}>
        <p className={styles.eyebrow}>Goals</p>
        <h1>Manage reading goals and preferences.</h1>
        <p>Set common Quran reading targets and reader preferences without editing raw API JSON.</p>
      </section>

      <section className={cx(styles["workspace-grid"], styles.two)}>
        <article className={cx(styles.panel, styles["tool-panel"])}>
          <div className={styles["section-header"]}>
            <div>
              <p className={styles.eyebrow}>Reading goal</p>
              <h2>Daily target</h2>
            </div>
            <span className={styles["scope-pill"]}>goal scope</span>
          </div>
          {data?.goals?.gatingMessage ? <p className={styles.muted}>{data.goals.gatingMessage}</p> : null}
          {data?.goals?.error ? <p className={styles["error-text"]}>{data.goals.error}</p> : null}

          <div className={styles["summary-box"]}>
            <h3>Current goal</h3>
            {goalRows.length ? (
              goalRows.map((row) => (
                <div className={styles["fact-row"]} key={row.label}>
                  <span>{row.label}</span>
                  <strong>{row.value}</strong>
                </div>
              ))
            ) : (
              <p className={styles.muted}>No current goal was returned for this session.</p>
            )}
          </div>

          <div className={styles["form-grid"]}>
            <label>
              Category
              <select onChange={(event) => setGoalCategory(event.target.value)} value={goalCategory}>
                <option value="QURAN">Quran</option>
                <option value="READING">Reading</option>
                <option value="MEMORIZATION">Memorization</option>
              </select>
            </label>
            <label>
              Period
              <select onChange={(event) => setGoalPeriod(event.target.value)} value={goalPeriod}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
            <label>
              Target amount
              <input
                inputMode="numeric"
                min="1"
                onChange={(event) => setGoalTargetAmount(event.target.value)}
                type="number"
                value={goalTargetAmount}
              />
            </label>
            <label>
              Target type
              <select onChange={(event) => setGoalType(event.target.value)} value={goalType}>
                <option value="PAGES">Pages</option>
                <option value="AYAH">Ayat</option>
                <option value="MINUTES">Minutes</option>
              </select>
            </label>
          </div>
          <button className={styles["primary-button"]} onClick={() => void submitGoalPayload()} type="button">
            Save reading goal
          </button>
        </article>

        <article className={cx(styles.panel, styles["tool-panel"])}>
          <div className={styles["section-header"]}>
            <div>
              <p className={styles.eyebrow}>Reader setup</p>
              <h2>Preferences</h2>
            </div>
            <span className={styles["scope-pill"]}>preference scope</span>
          </div>
          {data?.preferences?.gatingMessage ? <p className={styles.muted}>{data.preferences.gatingMessage}</p> : null}
          {data?.preferences?.error ? <p className={styles["error-text"]}>{data.preferences.error}</p> : null}

          <div className={styles["summary-box"]}>
            <h3>Current preferences</h3>
            {preferenceRows.length ? (
              preferenceRows.map((row) => (
                <div className={styles["fact-row"]} key={row.label}>
                  <span>{row.label}</span>
                  <strong>{row.value}</strong>
                </div>
              ))
            ) : (
              <p className={styles.muted}>No saved preferences were returned for this session.</p>
            )}
          </div>

          <div className={styles["form-grid"]}>
            <label>
              Font size
              <input
                inputMode="numeric"
                min="1"
                onChange={(event) => setPreferenceFontSize(event.target.value)}
                type="number"
                value={preferenceFontSize}
              />
            </label>
            <label>
              Mushaf lines
              <select
                onChange={(event) => setPreferenceMushafLines(event.target.value)}
                value={preferenceMushafLines}
              >
                <option value="15">15 lines</option>
                <option value="16">16 lines</option>
              </select>
            </label>
            <label>
              Reciter ID
              <input
                inputMode="numeric"
                min="1"
                onChange={(event) => setPreferenceReciter(event.target.value)}
                type="number"
                value={preferenceReciter}
              />
            </label>
          </div>
          <button className={styles["primary-button"]} onClick={() => void submitPreferencesPayload()} type="button">
            Save preferences
          </button>
        </article>
      </section>
    </>
  );

  const renderSettings = () => (
    <>
      <section className={cx(styles.panel, styles["hero-panel"], styles.compact)}>
        <p className={styles.eyebrow}>Settings</p>
        <h1>Session and SDK diagnostics.</h1>
        <p>Verify the active user session, granted scopes, and profile data without exposing raw payloads.</p>
      </section>

      <section className={cx(styles["workspace-grid"], styles.two)}>
        <article className={cx(styles.panel, styles["tool-panel"])}>
          <h2>Session facts</h2>
          {(data?.sessionFacts ?? []).map((fact) => (
            <div className={styles["fact-row"]} key={fact.label}>
              <span>{fact.label}</span>
              <strong>{fact.value}</strong>
            </div>
          ))}
          <div className={styles["fact-row"]}>
            <span>Session store</span>
            <strong>{data?.sessionStoreSummary}</strong>
          </div>
          <div className={styles["scope-list"]} aria-label="Granted scopes">
            {(data?.grantedScopes ?? []).length ? (
              (data?.grantedScopes ?? []).map((scope) => (
                <span className={styles["scope-pill"]} key={scope}>{scope}</span>
              ))
            ) : (
              <span className={cx(styles["scope-pill"], styles["muted-scope"])}>No scopes granted</span>
            )}
          </div>
        </article>
        <article className={cx(styles.panel, styles["tool-panel"])}>
          <h2>OIDC userinfo</h2>
          {data?.userInfo?.error ? (
            <p className={styles["error-text"]}>{data.userInfo.error}</p>
          ) : userInfoRows.length ? (
            userInfoRows.map((row) => (
              <div className={styles["fact-row"]} key={row.label}>
                <span>{row.label}</span>
                <strong>{row.value}</strong>
              </div>
            ))
          ) : (
            <p className={styles.muted}>No userinfo response is available.</p>
          )}
        </article>
        <article className={cx(styles.panel, styles["tool-panel"])}>
          <h2>ID token summary</h2>
          {idTokenRows.length ? (
            idTokenRows.map((row) => (
              <div className={styles["fact-row"]} key={row.label}>
                <span>{row.label}</span>
                <strong>{row.value}</strong>
              </div>
            ))
          ) : (
            <p className={styles.muted}>No ID token summary is available.</p>
          )}
        </article>
        <article className={cx(styles.panel, styles["tool-panel"])}>
          <h2>QuranReflect profile</h2>
          {data?.quranReflect?.profile.error ? (
            <p className={styles["error-text"]}>{data.quranReflect.profile.error}</p>
          ) : quranReflectProfileRows.length ? (
            quranReflectProfileRows.map((row) => (
              <div className={styles["fact-row"]} key={row.label}>
                <span>{row.label}</span>
                <strong>{row.value}</strong>
              </div>
            ))
          ) : (
            <p className={styles.muted}>No QuranReflect profile response is available.</p>
          )}
        </article>
      </section>
    </>
  );

  const renderContent = () => {
    if (bootstrapError && !data) {
      return (
        <section className={cx(styles.panel, styles["hero-panel"])}>
          <p className={styles.eyebrow}>Starter data</p>
          <h1>Workspace failed to load.</h1>
          <p>{getErrorMessage(bootstrapError, "Starter data could not load.")}</p>
          <button className={styles["primary-button"]} onClick={() => void mutate()} type="button">
            Retry
          </button>
        </section>
      );
    }

    if (isLoading && !data) {
      return (
        <section className={cx(styles.panel, styles["hero-panel"])}>
          <p className={styles.eyebrow}>Starter data</p>
          <h1>Loading Quran Foundation workspace...</h1>
          <p>Fetching session, content preview, and feature status from the backend.</p>
        </section>
      );
    }

    if (!routeAccess.canAccess) {
      return (
        <section className={cx(styles.panel, styles["hero-panel"], styles["access-panel"])}>
          <p className={styles.eyebrow}>Authentication required</p>
          <h1>Sign in required.</h1>
          <p>{routeAccess.message}</p>
          <a className={cx(styles["primary-action"], styles.inline)} href="/api/auth/start">
            Login with Quran Foundation
          </a>
        </section>
      );
    }

    if (route === "reader") {
      return renderReader();
    }

    if (route === "search") {
      return renderSearch();
    }

    if (route === "library") {
      return renderLibrary();
    }

    if (route === "reflect") {
      return renderReflect();
    }

    if (route === "goals") {
      return renderGoals();
    }

    if (route === "settings") {
      return renderSettings();
    }

    return renderReader();
  };

  return (
    <main className={styles.workspace}>
      <aside className={styles.sidebar} aria-label="Starter navigation">
        <Link className={styles.brand} href="/">
          <span className={styles["brand-mark"]}>ق</span>
          <span>
            <strong>{starterConfig.app.name}</strong>
            <small>SDK production template</small>
          </span>
        </Link>

        <nav className={styles.nav} aria-label="Primary navigation">
          {navigationItems.map((item) => (
            <Link
              aria-label={
                item.requiresLogin && !data?.isLoggedIn
                  ? `${item.label}, login required`
                  : item.label
              }
              className={cx(styles["nav-link"], route === item.key && styles.active)}
              href={item.href}
              key={item.key}
              scroll={item.key === "reader" ? false : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <section className={styles["session-panel"]} aria-label="Authentication status">
          <p className={styles.eyebrow}>Session</p>
          {isLoading && !data ? (
            <p>Checking session...</p>
          ) : (
            <>
              <p className={styles["session-state"]}>{data?.isLoggedIn ? "Signed in" : "Signed out"}</p>
              {data?.sessionFacts?.[0] ? <small>{data.sessionFacts[0].value}</small> : null}
              <div className={styles["sidebar-actions"]}>
                {authAction.showLogin ? (
                  <a className={styles["primary-action"]} href="/api/auth/start">
                    Login with Quran Foundation
                  </a>
                ) : null}
                {authAction.showRefresh ? (
                  <button className={styles["secondary-action"]} onClick={() => void refreshUserSession()} type="button">
                    Refresh session
                  </button>
                ) : null}
                {authAction.showLogout ? (
                  <a className={styles["secondary-action"]} href="/api/auth/logout">
                    Logout
                  </a>
                ) : null}
              </div>
            </>
          )}
        </section>
      </aside>

      <section className={styles["content-shell"]}>
        {notice ? (
          <div className={cx(styles.notice, notice.type === "error" ? styles.error : styles.success)}>
            {notice.message}
          </div>
        ) : null}
        {renderContent()}
      </section>
    </main>
  );
}
