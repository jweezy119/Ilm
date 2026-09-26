#!/usr/bin/env node

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const PORT = process.env.SMOKE_PORT || "4315";
const BASE_URL = `http://127.0.0.1:${PORT}`;

const resolveNpmCli = () => {
  if (process.env.npm_execpath && fs.existsSync(process.env.npm_execpath)) {
    return process.env.npm_execpath;
  }

  const bundledNpmCli = path.join(
    path.dirname(process.execPath),
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js",
  );

  return fs.existsSync(bundledNpmCli) ? bundledNpmCli : null;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForServer = async (child) => {
  let exitCode;
  child.on("exit", (code) => {
    exitCode = code;
  });

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (exitCode !== undefined) {
      throw new Error(`Next dev server exited early with code ${exitCode}.`);
    }

    try {
      const response = await fetch(BASE_URL, { redirect: "manual" });
      if (response.status < 500) {
        return;
      }
    } catch (_error) {
      // Keep polling until the dev server binds the port.
    }

    await sleep(500);
  }

  throw new Error("Timed out waiting for Next dev server.");
};

const stopServer = (child) => {
  if (!child.pid) {
    return;
  }

  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch (_error) {
    child.kill("SIGTERM");
  }
};

const waitForExit = async (child) => {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 5_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
};

const safeBodyText = async (response) => {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const payload = await response.json().catch(() => ({}));
    return JSON.stringify(payload);
  }

  return response.text();
};

const run = async () => {
  const npmCli = resolveNpmCli();
  const server = spawn(
    npmCli ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm",
    npmCli
      ? [npmCli, "run", "dev", "--", "-p", PORT]
      : ["run", "dev", "--", "-p", PORT],
    {
      cwd: process.cwd(),
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        APP_BASE_URL: process.env.APP_BASE_URL || BASE_URL,
        CLIENT_ID: process.env.CLIENT_ID || "smoke-client-id",
        CLIENT_SECRET: process.env.CLIENT_SECRET || "smoke-client-secret",
        OAUTH2_BASE_URL: process.env.OAUTH2_BASE_URL || "http://localhost:5444",
        SESSION_SECRET:
          process.env.SESSION_SECRET ||
          "smoke-session-secret-change-me-in-real-envs",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  server.stdout.on("data", (chunk) => process.stdout.write(chunk));
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));

  try {
    await waitForServer(server);

    const homeResponse = await fetch(`${BASE_URL}/`);
    const homeText = await homeResponse.text();
    if (
      !homeResponse.ok ||
      (!homeText.includes("QF Starter") && !homeText.includes("Quran Foundation"))
    ) {
      throw new Error("Home page failed smoke check.");
    }

    const bootstrapResponse = await fetch(`${BASE_URL}/api/bootstrap`);
    if (!bootstrapResponse.ok) {
      const body = await safeBodyText(bootstrapResponse);
      throw new Error(`Bootstrap route failed: ${bootstrapResponse.status} ${body}`);
    }

    const authStartResponse = await fetch(`${BASE_URL}/api/auth/start`, {
      redirect: "manual",
    });

    if (authStartResponse.status !== 302 && authStartResponse.status !== 307) {
      const body = await safeBodyText(authStartResponse);
      throw new Error(`Auth start route failed: ${authStartResponse.status} ${body}`);
    }

    console.log("Smoke route checks passed.");
  } finally {
    stopServer(server);
    await waitForExit(server);
  }
};

run().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
