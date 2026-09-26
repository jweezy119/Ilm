import { describe, expect, it } from "vitest";

import { buildLogoutUrl, createPkcePair, decodeJwt } from "@/lib/oauth";

describe("createPkcePair", () => {
  it("creates verifier/challenge", () => {
    const pair = createPkcePair();
    expect(pair.verifier.length).toBeGreaterThan(20);
    expect(pair.challenge.length).toBeGreaterThan(20);
  });
});

describe("decodeJwt", () => {
  it("decodes a valid JWT payload", () => {
    const payload = Buffer.from(
      JSON.stringify({ sub: "user-1", email: "test@example.com" }),
    )
      .toString("base64url");
    const token = `header.${payload}.signature`;

    expect(decodeJwt(token)).toEqual({
      email: "test@example.com",
      sub: "user-1",
    });
  });

  it("returns null for invalid token", () => {
    expect(decodeJwt("bad-token")).toBeNull();
  });
});

describe("buildLogoutUrl", () => {
  it("includes post logout redirect when id token is available", () => {
    const url = buildLogoutUrl({
      idToken: "token",
      oauth2BaseUrl: "http://localhost:5444",
      postLogoutRedirectUri: "http://localhost:3005/callback",
      state: "state-1",
    });

    const parsed = new URL(url);
    expect(parsed.searchParams.get("id_token_hint")).toBe("token");
    expect(parsed.searchParams.get("post_logout_redirect_uri")).toBe(
      "http://localhost:3005/callback",
    );
    expect(parsed.searchParams.get("state")).toBe("state-1");
  });

  it("keeps provider logout and redirect when id token is missing", () => {
    const url = buildLogoutUrl({
      idToken: null,
      oauth2BaseUrl: "http://localhost:5444",
      postLogoutRedirectUri: "http://localhost:3005/callback",
      state: "state-1",
    });

    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/oauth2/sessions/logout");
    expect(parsed.searchParams.has("id_token_hint")).toBe(false);
    expect(parsed.searchParams.get("post_logout_redirect_uri")).toBe(
      "http://localhost:3005/callback",
    );
    expect(parsed.searchParams.get("state")).toBe("state-1");
  });
});
