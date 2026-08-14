import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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

export function runGit(repoRoot: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
}
