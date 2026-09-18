import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StoredSession } from "@/lib/session/store";

const emptySession = (): StoredSession => ({
  authError: null,
  flashNotice: null,
  oauth: null,
  oidcLogoutIdTokenHint: null,
  userSession: null,
});

const stubRequiredEnv = () => {
  vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
  vi.stubEnv("CLIENT_ID", "client-id");
  vi.stubEnv("CLIENT_SECRET", "client-secret");
  vi.stubEnv("SESSION_SECRET", "session-secret");
};

describe("commitSession", () => {
  beforeEach(() => {
    vi.resetModules();
    stubRequiredEnv();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not store or set a cookie for untouched anonymous sessions", async () => {
    const { commitSession } = await import("@/lib/session");
    const response = NextResponse.json({ ok: true });

    await commitSession(response, {
      hasSessionCookie: false,
      session: emptySession(),
      sessionId: "anonymous-session",
      storeSummary: "memory",
    });

    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("sets a session cookie when session state is present", async () => {
    const { commitSession } = await import("@/lib/session");
    const response = NextResponse.json({ ok: true });

    await commitSession(response, {
      hasSessionCookie: false,
      session: {
        ...emptySession(),
        userSession: { accessToken: "access-token" },
      },
      sessionId: "signed-in-session",
      storeSummary: "memory",
    });

    expect(response.headers.get("set-cookie")).toContain("qf.sid=");
  });

  it("deletes a persisted session and cookie when existing session state becomes empty", async () => {
    const { commitSession } = await import("@/lib/session");
    const { getSessionStore } = await import("@/lib/session/store");
    const response = NextResponse.json({ ok: true });
    const store = getSessionStore();

    await store.set("existing-session", {
      ...emptySession(),
      userSession: { accessToken: "old-token" },
    });

    await commitSession(response, {
      hasSessionCookie: true,
      session: emptySession(),
      sessionId: "existing-session",
      storeSummary: "memory",
    });

    expect(await store.get("existing-session")).toBeNull();
    expect(response.headers.get("set-cookie")).toContain("qf.sid=");
    expect(response.headers.get("set-cookie")).toContain("Expires=");
  });

  it("clears an invalid incoming session cookie when the session is empty", async () => {
    const { commitSession, getSession } = await import("@/lib/session");
    const request = new NextRequest("http://localhost:3000/api/bootstrap", {
      headers: {
        cookie: "qf.sid=stale-or-tampered-cookie",
      },
    });
    const response = NextResponse.json({ ok: true });
    const context = await getSession(request);

    expect(context.hasSessionCookie).toBe(true);

    await commitSession(response, context);

    expect(response.headers.get("set-cookie")).toContain("qf.sid=");
    expect(response.headers.get("set-cookie")).toContain("Expires=");
  });

  it("rotates session ids and deletes the previous persisted session", async () => {
    const { commitSession, rotateSession } = await import("@/lib/session");
    const { getSessionStore } = await import("@/lib/session/store");
    const response = NextResponse.json({ ok: true });
    const store = getSessionStore();
    const session = {
      ...emptySession(),
      userSession: { accessToken: "new-token" },
    };

    await store.set("pre-auth-session", {
      ...emptySession(),
      oauth: {
        codeVerifier: "verifier",
        nonce: "nonce",
        state: "state",
      },
    });

    const context = {
      hasSessionCookie: true,
      session,
      sessionId: "pre-auth-session",
      storeSummary: "memory",
    };

    rotateSession(context);

    expect(context.sessionId).not.toBe("pre-auth-session");

    await commitSession(response, context);

    expect(await store.get("pre-auth-session")).toBeNull();
    expect(await store.get(context.sessionId)).toEqual(session);
    expect(response.headers.get("set-cookie")).toContain("qf.sid=");
  });
});
