#!/usr/bin/env node
/* global console, process */
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const repoRoot = resolve(import.meta.dirname, "..");
const distDir = join(repoRoot, "dist");
const cliPath = join(distDir, "cli.js");
const tscCliPath = require.resolve("typescript/bin/tsc");
const nccCliPath = require.resolve("@vercel/ncc/dist/ncc/cli.js");

try {
  rmSync(distDir, { recursive: true, force: true });
  runNodeTool(tscCliPath, ["-p", "tsconfig.build.json"]);
  runNodeTool(nccCliPath, ["build", "src/action/index.ts", "-o", "dist/action"]);
  ensureCliExecutable();
} catch (error) {
  if (error instanceof Error) {
    console.error(error.message);
  }
  process.exit(typeof error === "object" && error !== null && "status" in error && typeof error.status === "number"
    ? error.status
    : 1);
}

function runNodeTool(scriptPath, args) {
  execFileSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    stdio: "inherit",
  });
}

function ensureCliExecutable() {
  if (!existsSync(cliPath)) {
    throw new Error(`Expected build artifact is missing: ${cliPath}`);
  }

  if (process.platform !== "win32") {
    chmodSync(cliPath, 0o755);
  }
}
