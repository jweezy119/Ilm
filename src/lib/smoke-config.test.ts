import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("test/smoke-config.cjs", () => {
  it("works with starter defaults when env vars are absent", () => {
    const scriptPath = resolve(process.cwd(), "test/smoke-config.cjs");

    expect(() =>
      execFileSync(process.execPath, [scriptPath], {
        env: {},
        stdio: "pipe",
      }),
    ).not.toThrow();
  });
});
