import { execFileSync } from "node:child_process";
import { relative, resolve } from "node:path";
import { toRepoPath } from "./repo-paths.js";
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
/**
 * Reports whether a repository-relative path exists as a blob or tree at `ref`,
 * independently of what is currently checked out on disk.
 */
export function gitPathExists(repoRoot, ref, path) {
    const repoPath = toRepoPath(path);
    const objectName = repoPath === "" || repoPath === "." ? `${ref}^{tree}` : `${ref}:${repoPath}`;
    try {
        execFileSync("git", ["cat-file", "-e", objectName], {
            cwd: repoRoot,
            stdio: ["ignore", "ignore", "ignore"],
        });
        return true;
    }
    catch {
        return false;
    }
}
function ensureRepoPath(repoRoot, path) {
    const resolved = resolve(repoRoot, path);
    const relativePath = relative(repoRoot, resolved);
    if (relativePath.startsWith("..") || relativePath === "") {
        throw new Error(`Path resolves outside the repository: ${path}`);
    }
}
