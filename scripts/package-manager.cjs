/**
 * @typedef {"bun" | "npm" | "pnpm" | "yarn"} PackageManager
 */

/** @type {ReadonlySet<PackageManager>} */
const PACKAGE_MANAGERS = new Set(["bun", "npm", "pnpm", "yarn"]);

/**
 * @param {unknown} value
 * @returns {PackageManager | null}
 */
const normalizePackageManager = (value) => {
  if (!value) {
    return null;
  }

  const normalized = String(value).trim().toLowerCase();
  for (const packageManager of PACKAGE_MANAGERS) {
    if (normalized === packageManager || normalized.startsWith(`${packageManager}/`)) {
      return packageManager;
    }
  }

  return null;
};

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {PackageManager}
 */
const detectPackageManager = (env = process.env) => {
  const explicitPackageManager = env.QURANJS_PACKAGE_MANAGER;
  if (explicitPackageManager) {
    const normalized = normalizePackageManager(explicitPackageManager);
    if (!normalized) {
      throw new Error(
        `Unsupported package manager: ${explicitPackageManager}. Use npm, pnpm, yarn, or bun.`,
      );
    }

    return normalized;
  }

  return (
    normalizePackageManager(env.npm_config_user_agent) ??
    normalizePackageManager(env.npm_execpath) ??
    "npm"
  );
};

/**
 * @param {string} target
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ args: string[]; command: string; packageManager: PackageManager }}
 */
const createInstallCommand = (target, env = process.env) => {
  const packageManager = detectPackageManager(env);

  if (packageManager === "npm") {
    return { args: ["install", target], command: "npm", packageManager };
  }

  return { args: ["add", target], command: packageManager, packageManager };
};

module.exports = {
  createInstallCommand,
  detectPackageManager,
};
