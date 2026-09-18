import { describe, expect, it } from "vitest";

describe("scripts/next-run.cjs", () => {
  it("uses CLI -p value over PORT env for dev command", async () => {
    const nextRun = await import("../../scripts/next-run.cjs");
    const result = nextRun.buildNextArgs({
      argv: ["dev", "-p", "4315"],
      env: { PORT: "3000" },
    });

    expect(result).toEqual(["next", "dev", "-p", "4315"]);
  });

  it("falls back to PORT env when CLI port is missing", async () => {
    const nextRun = await import("../../scripts/next-run.cjs");
    const result = nextRun.buildNextArgs({
      argv: ["start"],
      env: { PORT: "3000" },
    });

    expect(result).toEqual(["next", "start", "-p", "3000"]);
  });

  it("preserves forwarded Next.js CLI flags", async () => {
    const nextRun = await import("../../scripts/next-run.cjs");

    expect(
      nextRun.buildNextArgs({
        argv: ["dev", "--hostname", "0.0.0.0", "--turbo"],
        env: { PORT: "3000" },
      }),
    ).toEqual([
      "next",
      "dev",
      "--hostname",
      "0.0.0.0",
      "--turbo",
      "-p",
      "3000",
    ]);

    expect(
      nextRun.buildNextArgs({
        argv: ["build", "--profile"],
        env: { PORT: "3000" },
      }),
    ).toEqual(["next", "build", "--profile"]);
  });

  it("does not treat signal exits as successful", async () => {
    const nextRun = await import("../../scripts/next-run.cjs");

    expect(nextRun.getWrapperExitCode(null)).toBe(1);
  });
});
