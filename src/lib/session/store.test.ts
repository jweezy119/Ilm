import { afterEach, describe, expect, it, vi } from "vitest";

import { SESSION_TTL_MS } from "@/lib/constants";
import {
  createSignedSessionId,
  MemorySessionStore,
  parseSignedSessionId,
} from "@/lib/session/store";

describe("MemorySessionStore", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("prunes expired sessions before writing a new session", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const store = new MemorySessionStore();
    const cache = (
      store as unknown as {
        cache: Map<string, unknown>;
      }
    ).cache;

    await store.set("expired-session", {
      userSession: { sub: "expired-user" },
    });

    vi.setSystemTime(Date.now() + SESSION_TTL_MS + 1);

    await store.set("fresh-session", {
      userSession: { sub: "fresh-user" },
    });

    expect(cache.has("expired-session")).toBe(false);
    expect(cache.has("fresh-session")).toBe(true);
    expect(cache.size).toBe(1);
  });
});

describe("signed session ids", () => {
  it("verifies signed session ids and rejects tampered signatures", () => {
    const signed = createSignedSessionId("session-1", "secret");
    const [, signature] = signed.split(".");
    const tamperedSignature = `${signature[0] === "0" ? "1" : "0"}${signature.slice(
      1,
    )}`;

    expect(parseSignedSessionId(signed, "secret")).toBe("session-1");
    expect(
      parseSignedSessionId(`session-1.${tamperedSignature}`, "secret"),
    ).toBeNull();
    expect(parseSignedSessionId("session-1.not-hex", "secret")).toBeNull();
    expect(parseSignedSessionId(`${signed}.extra`, "secret")).toBeNull();
  });
});
