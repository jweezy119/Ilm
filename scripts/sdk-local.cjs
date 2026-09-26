#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createInstallCommand } = require("./package-manager.cjs");

const providedPath = process.argv[2];

if (!providedPath) {
  console.error("Usage: npm run sdk:local -- /absolute/path/to/api-js/packages/api");
  process.exit(1);
}

const resolvedPath = path.resolve(process.cwd(), providedPath);
const packageJsonPath = path.join(resolvedPath, "package.json");

if (!fs.existsSync(packageJsonPath)) {
  console.error(`No package.json found at: ${packageJsonPath}`);
  process.exit(1);
}

const localPackage = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

if (localPackage.name !== "@quranjs/api") {
  console.error(
    `Expected package name @quranjs/api, found ${localPackage.name || "unknown"}.`,
  );
  process.exit(1);
}

console.log(`Installing local SDK from ${resolvedPath}`);

const install = createInstallCommand(resolvedPath);
const result = spawnSync(install.command, install.args, {
  cwd: process.cwd(),
  stdio: "inherit",
});

if (result.status !== 0) {
  process.exit(result.status || 1);
}

console.log("Local SDK installed successfully.");
