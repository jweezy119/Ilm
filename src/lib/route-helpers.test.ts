import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stubRequiredEnv = () => {
  vi.stubEnv("APP_BASE_URL", "https://starter.example.com");
  vi.stubEnv("CLIENT_ID", "client-id");
  vi.stubEnv("CLIENT_SECRET", "client-secret");
  vi.stubEnv("SESSION_SECRET", "session-secret");
};

describe("route helpers", () => {
  beforeEach(() => {
    vi.resetModules();
    stubRequiredEnv();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds app redirects from the configured app origin", async () => {
    const { getAppUrl, getCallbackUrl } = await import("@/lib/route-helpers");

    expect(getAppUrl("/")).toBe("https://starter.example.com/");
    expect(getCallbackUrl()).toBe("https://starter.example.com/callback");
  });
});
