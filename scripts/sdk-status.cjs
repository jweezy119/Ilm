#!/usr/bin/env node

const path = require("node:path");
const fs = require("node:fs");

try {
  const entryPath = require.resolve("@quranjs/api", {
    paths: [process.cwd()],
  });

  let current = path.dirname(entryPath);
  let packageJsonPath = null;

  while (current !== path.dirname(current)) {
    const candidate = path.join(current, "package.json");
    if (fs.existsSync(candidate)) {
      const packageJson = JSON.parse(fs.readFileSync(candidate, "utf8"));
      if (packageJson.name === "@quranjs/api") {
        packageJsonPath = candidate;
        break;
      }
    }
    current = path.dirname(current);
  }

  if (!packageJsonPath) {
    throw new Error("Could not locate @quranjs/api package.json.");
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

  console.log("Installed SDK package:");
  console.log(`- version: ${packageJson.version}`);
  console.log(`- path: ${path.dirname(packageJsonPath)}`);
} catch (error) {
  console.error("Unable to resolve @quranjs/api from this project.");
  console.error(String(error.message || error));
  process.exitCode = 1;
}
