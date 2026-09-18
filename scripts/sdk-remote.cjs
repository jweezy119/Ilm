#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const { createInstallCommand } = require("./package-manager.cjs");

const requestedVersion = process.argv[2] || "latest";
const target = `@quranjs/api@${requestedVersion}`;

console.log(`Installing ${target} from npm...`);

const install = createInstallCommand(target);
const result = spawnSync(install.command, install.args, {
  cwd: process.cwd(),
  stdio: "inherit",
});

if (result.status !== 0) {
  process.exit(result.status || 1);
}

console.log(`Installed ${target}.`);
