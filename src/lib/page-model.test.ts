import { describe, expect, it } from "vitest";

import {
  getAuthActionView,
  getCollectionLabel,
  getDisplayRows,
  getListView,
  getReaderLoadingView,
  buildGoalPayload,
  buildPreferencesPayload,
  getRouteAccess,
  getUserProfileView,
} from "@/lib/page-model";
import type { BootstrapPayload } from "@/lib/types";

const signedInPayload = {
  authError: null,
  bookmarks: {
    error: null,
    gatingMessage: null,
    items: [
      {
        id: "bookmark-1",
        readerUrl: "/read/1",
        type: "ayah",
        verseKey: "1:1",
      },
    ],
  },
  collections: {
    error: null,
    gatingMessage: null,
    items: [
      {
        id: "collection-1",
        name: "Daily reading",
        updatedAt: "2026-05-23T00:00:00.000Z",
      },
    ],
  },
  contentPreview: {
    error: null,
    items: [],
    previewReaderUrl: "/read/1",
  },
  flashNotice: null,
  goals: {
    data: null,
    error: null,
    gatingMessage: "Requires the `goal` scope.",
  },
  grantedScopes: ["openid", "user", "note", "bookmark", "collection"],
  idTokenSummary: null,
  isLoggedIn: true,
  notes: {
    error: null,
    gatingMessage: null,
    items: [
      {
        body: "Remember this ayah.",
        id: "note-1",
        ranges: ["1:1-1:1"],
      },
      {
        body: "Second note.",
        id: "note-2",
        ranges: ["1:2-1:2"],
      },
    ],
  },
  preferences: {
    data: null,
    error: null,
    gatingMessage: "Requires the `preference` scope.",
  },
  quranReflect: {
    feed: {
      error: null,
      gatingMessage: null,
      items: [],
    },
    profile: {
      data: { username: "osama_sayed" },
      error: null,
      facts: [
        { label: "Username", value: "osama_sayed" },
        { label: "Display name", value: "Osama Sayed" },
      ],
      gatingMessage: null,
    },
  },
  sessionFacts: [{ label: "Signed in as", value: "osama@quran.com" }],
  sessionStoreSummary: "redis",
  userInfo: {
    data: { email: "osama@quran.com", sub: "user-1" },
    error: null,
    facts: [
      { label: "Subject", value: "user-1" },
      { label: "Email", value: "osama@quran.com" },
    ],
    gatingMessage: null,
  },
} satisfies BootstrapPayload;

const signedOutPayload = {
  ...signedInPayload,
  bookmarks: { error: null, gatingMessage: null, items: [] },
  collections: { error: null, gatingMessage: null, items: [] },
  goals: { data: null, error: null, gatingMessage: null },
  grantedScopes: [],
  idTokenSummary: null,
  isLoggedIn: false,
  notes: { error: null, gatingMessage: null, items: [] },
  preferences: { data: null, error: null, gatingMessage: null },
  quranReflect: {
    feed: { error: null, gatingMessage: null, items: [] },
    profile: { data: null, error: null, facts: [], gatingMessage: null },
  },
  sessionFacts: [],
  userInfo: { data: null, error: null, facts: [], gatingMessage: null },
} satisfies BootstrapPayload;

describe("getAuthActionView", () => {
  it("shows login only while signed out and logout only while signed in", () => {
    expect(getAuthActionView(signedOutPayload)).toEqual({
      showLogin: true,
      showLogout: false,
      showRefresh: false,
    });

    expect(getAuthActionView(signedInPayload)).toEqual({
      showLogin: false,
      showLogout: true,
      showRefresh: true,
    });
  });
});

describe("getRouteAccess", () => {
  it("gates user-only workspaces while signed out", () => {
    expect(getRouteAccess("goals", signedOutPayload)).toEqual({
      canAccess: false,
      message: "Sign in to manage goals, preferences, and other user data.",
      requiresLogin: true,
    });
  });

  it("keeps reader and search available without a user session", () => {
    expect(getRouteAccess("reader", signedOutPayload).canAccess).toBe(true);
    expect(getRouteAccess("search", signedOutPayload).canAccess).toBe(true);
  });
});

describe("getReaderLoadingView", () => {
  it("keeps existing reader content visible while another chapter loads", () => {
    expect(
      getReaderLoadingView({
        hasError: false,
        hasReaderResult: true,
        isLoading: true,
      }),
    ).toEqual({
      showError: false,
      showInitialLoading: false,
      showLoadingBadge: true,
      showReaderContent: true,
    });
  });

  it("uses a stable initial loading state before the first chapter response", () => {
    expect(
      getReaderLoadingView({
        hasError: false,
        hasReaderResult: false,
        isLoading: true,
      }).showInitialLoading,
    ).toBe(true);
  });
});

describe("goal and preference payload builders", () => {
  it("builds a typed goal payload from form fields", () => {
    expect(
      buildGoalPayload({
        category: "QURAN",
        period: "daily",
        targetAmount: "3",
        type: "PAGES",
      }),
    ).toEqual({
      category: "QURAN",
      period: "daily",
      targetAmount: 3,
      type: "PAGES",
    });
  });

  it("rejects invalid goal targets", () => {
    expect(
      buildGoalPayload({
        category: "QURAN",
        period: "daily",
        targetAmount: "0",
        type: "PAGES",
      }),
    ).toBeNull();
  });

  it("builds a typed preferences payload from form fields", () => {
    expect(
      buildPreferencesPayload({
        fontSize: "4",
        mushafLines: "15",
        reciter: "7",
      }),
    ).toEqual({
      fontSize: 4,
      mushafLines: 15,
      reciter: 7,
    });
  });
});

describe("getDisplayRows", () => {
  it("formats API objects as readable rows instead of raw JSON", () => {
    expect(
      getDisplayRows({
        emailVerified: true,
        fontSize: 3,
        refreshToken: null,
        user_name: "osama",
      }),
    ).toEqual([
      { label: "Email verified", value: "Yes" },
      { label: "Font size", value: "3" },
      { label: "Refresh token", value: "Unavailable" },
      { label: "User name", value: "osama" },
    ]);
  });
});

describe("getUserProfileView", () => {
  it("uses signed-in profile facts instead of the logged-out placeholder", () => {
    const view = getUserProfileView(signedInPayload);

    expect(view.kind).toBe("ready");
    expect(view.message).toBeNull();
    expect(view.facts).toEqual(signedInPayload.quranReflect.profile.facts);
    expect(view.facts.map((fact) => fact.value)).toContain("osama_sayed");
  });
});

describe("getListView", () => {
  it("shows usable user feature counts when API slices are loaded", () => {
    expect(getListView("note", signedInPayload.notes)).toMatchObject({
      count: 2,
      kind: "ready",
      message: "2 notes available.",
    });
    expect(getListView("bookmark", signedInPayload.bookmarks)).toMatchObject({
      count: 1,
      kind: "ready",
      message: "1 bookmark available.",
    });
    expect(
      getListView("collection", signedInPayload.collections),
    ).toMatchObject({
      count: 1,
      kind: "ready",
      message: "1 collection available.",
    });
  });
});

describe("getCollectionLabel", () => {
  it("formats collection timestamps for display", () => {
    expect(getCollectionLabel(signedInPayload.collections.items[0])).toBe(
      "Updated 2026-05-23T00:00:00.000Z",
    );
  });
});
