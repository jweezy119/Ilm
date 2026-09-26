import { describe, expect, it } from "vitest";

import { parseTranslationIds } from "@/lib/env";

describe("parseTranslationIds", () => {
  it("uses the default translation when value is missing", () => {
    expect(parseTranslationIds(undefined)).toEqual([131]);
  });

  it("parses comma-separated numeric ids", () => {
    expect(parseTranslationIds("131,20, 149 ")).toEqual([131, 20, 149]);
  });

  it("ignores invalid translation values", () => {
    expect(parseTranslationIds("abc,-1,0, 7")).toEqual([7]);
  });

  it("falls back to default when all values are invalid", () => {
    expect(parseTranslationIds("a,b,0")).toEqual([131]);
  });
});
