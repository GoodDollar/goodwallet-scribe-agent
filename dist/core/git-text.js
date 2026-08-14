import { execFileSync } from "node:child_process";
import { normalize, relative, resolve } from "node:path";
export function readGitTextFile(repoRoot, ref, path) {
    const repoPath = toRepoPath(path);
    ensureRepoPath(repoRoot, repoPath);
    try {
        return execFileSync("git", ["show", `${ref}:${repoPath}`], {
            cwd: repoRoot,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        });
    }
    catch {
        return undefined;
    }
}
function ensureRepoPath(repoRoot, path) {
    const resolved = resolve(repoRoot, path);
    const relativePath = relative(repoRoot, resolved);
    if (relativePath.startsWith("..") || relativePath === "") {
        throw new Error(`Path resolves outside the repository: ${path}`);
    }
}
function toRepoPath(path) {
    return normalize(path).replaceAll("\\", "/").replace(/^\.\//, "");
}
