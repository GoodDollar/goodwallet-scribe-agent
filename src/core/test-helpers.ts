import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export function createTempRepo(): string {
  const repoRoot = mkdtempSync(join(tmpdir(), "scribe-repo-"));
  runGit(repoRoot, ["init", "--initial-branch=main"]);
  return repoRoot;
}

export function writeRepoFile(repoRoot: string, relativePath: string, content: string): void {
  const filePath = join(repoRoot, relativePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

export function commitAll(repoRoot: string, message: string): string {
  runGit(repoRoot, ["add", "."]);
  runGit(repoRoot, ["-c", "user.name=Test User", "-c", "user.email=test@example.com", "commit", "-m", message]);
  return runGit(repoRoot, ["rev-parse", "HEAD"]);
}

export function createFixtureRepo(fixtureName: string): { repoRoot: string; baseRef: string; headRef: string } {
  const repoRoot = createTempRepo();
  writeFixtureState(repoRoot, fixtureName, "base");
  const baseRef = commitAll(repoRoot, "base");
  writeFixtureState(repoRoot, fixtureName, "head");
  const headRef = commitAll(repoRoot, "head");
  return { repoRoot, baseRef, headRef };
}

export function readFixtureText(relativePath: string): string {
  return readFileSync(resolveFixturePath(relativePath), "utf8");
}

export function runGit(repoRoot: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
}

function writeFixtureState(repoRoot: string, fixtureName: string, state: "base" | "head"): void {
  clearRepoWorkingTree(repoRoot);
  const sourceDirectory = resolveFixturePath(join(fixtureName, state));
  if (!existsSync(sourceDirectory)) {
    throw new Error(`Missing fixture state: ${fixtureName}/${state}`);
  }

  cpSync(sourceDirectory, repoRoot, { recursive: true });
}

function clearRepoWorkingTree(repoRoot: string): void {
  for (const entry of readdirSync(repoRoot)) {
    if (entry === ".git") {
      continue;
    }

    rmSync(join(repoRoot, entry), { recursive: true, force: true });
  }
}

function resolveFixturePath(relativePath: string): string {
  return join(import.meta.dirname, "..", "..", "fixtures", relativePath);
}
