import { describe, expect, it } from "vitest";

describe("scripts/package-manager.cjs", () => {
  it("uses npm install for npm projects", async () => {
    const packageManager = await import("../../scripts/package-manager.cjs");

    expect(
      packageManager.createInstallCommand("@quranjs/api@latest", {
        npm_config_user_agent: "npm/10.0.0 node/v22.0.0",
      }),
    ).toEqual({
      args: ["install", "@quranjs/api@latest"],
      command: "npm",
      packageManager: "npm",
    });
  });

  it("uses add for non-npm package managers", async () => {
    const packageManager = await import("../../scripts/package-manager.cjs");

    expect(
      packageManager.createInstallCommand("@quranjs/api@latest", {
        QURANJS_PACKAGE_MANAGER: "pnpm",
      }),
    ).toEqual({
      args: ["add", "@quranjs/api@latest"],
      command: "pnpm",
      packageManager: "pnpm",
    });
  });
});
