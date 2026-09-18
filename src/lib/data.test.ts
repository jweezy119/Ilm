import { describe, expect, it, vi } from "vitest";

import {
  buildReaderUrlFromKey,
  ensureUserScope,
  getGrantedScopes,
  loadReaderData,
  loadSearchData,
  parsePositiveInteger,
  parseVerseKey,
} from "@/lib/data";

const sdkMocks = vi.hoisted(() => ({
  serverClient: undefined as unknown,
}));

vi.mock("@/lib/env", () => ({
  getConfig: () => ({
    defaultReaderChapter: 1,
    translationIds: [131],
  }),
}));

vi.mock("@/lib/sdk", () => ({
  createClients: async () => ({
    serverClient: sdkMocks.serverClient,
  }),
  getSearchModeQuick: () => "quick",
}));

describe("buildReaderUrlFromKey", () => {
  it("builds chapter url from chapter key", () => {
    expect(buildReaderUrlFromKey("2")).toBe("/read/2");
  });

  it("builds chapter url from verse key", () => {
    expect(buildReaderUrlFromKey("2:255")).toBe("/read/2");
  });

  it("builds chapter url from verse range key", () => {
    expect(buildReaderUrlFromKey("2:1-5")).toBe("/read/2");
  });

  it("returns null for invalid keys", () => {
    expect(buildReaderUrlFromKey("bad-value")).toBeNull();
  });
});

describe("getGrantedScopes", () => {
  it("parses string scopes", () => {
    expect(
      getGrantedScopes({
        userSession: { scope: "openid offline_access note" },
      }),
    ).toEqual(["openid", "offline_access", "note"]);
  });

  it("parses array scopes", () => {
    expect(
      getGrantedScopes({
        userSession: { scopes: ["user", "bookmark"] },
      }),
    ).toEqual(["user", "bookmark"]);
  });
});

describe("ensureUserScope", () => {
  it("accepts documented goal and preference scopes", () => {
    const session = {
      userSession: { scope: "openid offline_access goal preference" },
    } as never;

    expect(ensureUserScope(session, "goal")).toEqual({ ok: true });
    expect(ensureUserScope(session, "preference")).toEqual({ ok: true });
  });

  it("returns a scope-specific gate when a documented scope is missing", () => {
    expect(
      ensureUserScope(
        {
          userSession: { scope: "openid offline_access goal" },
        } as never,
        "preference",
      ),
    ).toEqual({
      gatingMessage: "Requires the `preference` scope.",
      message: "This action requires the `preference` scope.",
      ok: false,
      signedOut: false,
      status: 403,
    });
  });
});

describe("loadReaderData", () => {
  it("loads every verse page for a chapter", async () => {
    const byChapter = vi.fn(async (_chapterId: string, query: { page: number }) => {
      const start = (query.page - 1) * 50;
      const count = query.page === 1 ? 50 : 10;

      return Array.from({ length: count }, (_value, index) => ({
        id: start + index + 1,
        textUthmani: `Verse ${start + index + 1}`,
        translations: [{ resourceId: 131, text: `Translation ${start + index + 1}` }],
        verseKey: `2:${start + index + 1}`,
        verseNumber: start + index + 1,
      }));
    });

    sdkMocks.serverClient = {
      content: {
        v4: {
          chapters: {
            get: vi.fn(async () => ({
              id: 2,
              nameSimple: "Al-Baqarah",
              versesCount: 60,
            })),
          },
          verses: {
            byChapter,
          },
        },
      },
    };

    const data = await loadReaderData({} as never, "2");

    expect(byChapter).toHaveBeenCalledTimes(2);
    expect(byChapter).toHaveBeenNthCalledWith(
      1,
      "2",
      expect.objectContaining({ page: 1, perPage: 50 }),
    );
    expect(byChapter).toHaveBeenNthCalledWith(
      2,
      "2",
      expect.objectContaining({ page: 2, perPage: 50 }),
    );
    expect(data.verses).toHaveLength(60);
    expect(data.verses[59]).toMatchObject({
      translationText: "Translation 60",
      verseKey: "2:60",
    });
  });

  it("loads reader metadata from wrapped chapter responses", async () => {
    const byChapter = vi.fn(async () => [
      {
        id: 1,
        textUthmani: "Verse 1",
        translations: [{ resourceId: 131, text: "Translation 1" }],
        verseKey: "2:1",
        verseNumber: 1,
      },
    ]);

    sdkMocks.serverClient = {
      content: {
        v4: {
          chapters: {
            get: vi.fn(async () => ({
              chapter: {
                id: 2,
                nameSimple: "Al-Baqarah",
                versesCount: 1,
              },
            })),
          },
          verses: {
            byChapter,
          },
        },
      },
    };

    const data = await loadReaderData({} as never, "2");

    expect(byChapter).toHaveBeenCalledTimes(1);
    expect(data.chapter).toMatchObject({
      id: 2,
      nameSimple: "Al-Baqarah",
      versesCount: 1,
    });
  });
});

describe("loadSearchData", () => {
  it("keeps Arabic Quran text separate from the search snippet", async () => {
    sdkMocks.serverClient = {
      search: {
        v1: {
          query: vi.fn(async () => ({
            result: {
              navigation: [],
              verses: [
                {
                  key: "1:1",
                  text: "All praise is for Allah.",
                  textUthmani: "ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَـٰلَمِينَ",
                },
              ],
            },
          })),
        },
      },
    };

    const result = await loadSearchData({} as never, "praise");

    expect(result.verseItems[0]).toMatchObject({
      arabicText: "ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَـٰلَمِينَ",
      readerUrl: "/read/1",
      text: "All praise is for Allah.",
      verseKey: "1:1",
    });
  });
});

describe("parsePositiveInteger", () => {
  it("accepts positive values", () => {
    expect(parsePositiveInteger("2")).toBe(2);
  });

  it("rejects invalid values", () => {
    expect(parsePositiveInteger("0")).toBeNull();
    expect(parsePositiveInteger("-4")).toBeNull();
    expect(parsePositiveInteger("x")).toBeNull();
  });

  it("rejects partially numeric values", () => {
    expect(parsePositiveInteger("2abc")).toBeNull();
    expect(parsePositiveInteger("3.5")).toBeNull();
  });
});

describe("parseVerseKey", () => {
  it("accepts chapter:verse format", () => {
    expect(parseVerseKey("1:7")).toBe("1:7");
  });

  it("rejects malformed values", () => {
    expect(parseVerseKey("1-7")).toBeNull();
    expect(parseVerseKey("chapter:1")).toBeNull();
  });
});
