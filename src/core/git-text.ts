import { execFileSync } from "node:child_process";
import { normalize, relative, resolve } from "node:path";

export function readGitTextFile(repoRoot: string, ref: string, path: string): string | undefined {
  const repoPath = toRepoPath(path);
  ensureRepoPath(repoRoot, repoPath);

  try {
    return execFileSync("git", ["show", `${ref}:${repoPath}`], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return undefined;
  }
}

function ensureRepoPath(repoRoot: string, path: string): void {
  const resolved = resolve(repoRoot, path);
  const relativePath = relative(repoRoot, resolved);

  if (relativePath.startsWith("..") || relativePath === "") {
    throw new Error(`Path resolves outside the repository: ${path}`);
  }
}

function toRepoPath(path: string): string {
  return normalize(path).replaceAll("\\", "/").replace(/^\.\//, "");
}
