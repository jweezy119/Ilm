#!/usr/bin/env node

const { spawn } = require("node:child_process");

const validCommands = new Set(["dev", "build", "start"]);

const resolvePort = (value) => {
  if (!value) {
    return undefined;
  }

  const trimmed = String(value).trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return undefined;
  }

  return String(parsed);
};

const getCliPort = (argv) => {
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-p" || arg === "--port") {
      return resolvePort(argv[index + 1]);
    }

    if (arg.startsWith("-p=")) {
      return resolvePort(arg.slice(3));
    }

    if (arg.startsWith("--port=")) {
      return resolvePort(arg.slice(7));
    }
  }

  return undefined;
};

const buildNextArgs = ({ argv, env }) => {
  const command = argv[0];
  const userArgs = argv.slice(1);
  const args = ["next", command, ...userArgs];

  if (command !== "dev" && command !== "start") {
    return args;
  }

  const hasCliPort = Boolean(getCliPort(argv));
  const port = hasCliPort ? undefined : resolvePort(env.PORT);
  if (!port) {
    return args;
  }

  args.push("-p", port);
  return args;
};

const getWrapperExitCode = (code) => {
  if (typeof code === "number") {
    return code;
  }

  return 1;
};

const run = () => {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (!command || !validCommands.has(command)) {
    process.stderr.write("Usage: node ./scripts/next-run.cjs <dev|build|start>\n");
    process.exit(1);
  }

  const { loadEnvConfig } = require("@next/env");
  loadEnvConfig(process.cwd());

  const args = buildNextArgs({
    argv,
    env: process.env,
  });

  const nextCliPath = require.resolve("next/dist/bin/next");
  const child = spawn(process.execPath, [nextCliPath, ...args.slice(1)], {
    env: process.env,
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    if (signal && process.platform !== "win32") {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(getWrapperExitCode(code));
  });

  child.on("error", (error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
};

if (require.main === module) {
  run();
}

module.exports = {
  buildNextArgs,
  getCliPort,
  getWrapperExitCode,
  resolvePort,
  run,
};
