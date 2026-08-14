import { execFileSync } from "node:child_process";
import { minimatch } from "minimatch";
import { isSecretPath } from "./repo-paths.js";
/**
 * Resolves the commit a pull request actually branched from, so a diff never reports
 * files that only changed on the base branch after the fork point.
 */
export function resolveMergeBase(repoRoot, baseRef, headRef) {
    try {
        const output = execFileSync("git", ["merge-base", baseRef, headRef], {
            cwd: repoRoot,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        }).trim();
        return output || baseRef;
    }
    catch {
        return baseRef;
    }
}
export function discoverGitChanges(repoRoot, baseRef, headRef) {
    const mergeBase = resolveMergeBase(repoRoot, baseRef, headRef);
    const output = execFileSync("git", ["diff", "--name-status", "--find-renames", "-z", mergeBase, headRef, "--"], { cwd: repoRoot, encoding: "utf8" });
    return parseNulDiffOutput(output).sort((left, right) => left.path.toLowerCase().localeCompare(right.path.toLowerCase()));
}
export function selectPrimaryDocuments(changes, config) {
    return changes.filter((change) => change.status !== "deleted"
        && !isSecretPath(change.path)
        && isIncludedMarkdown(change.path, config));
}
/**
 * Parses `git diff --name-status -z` records. NUL delimiters keep non-ASCII paths intact
 * regardless of the repository's `core.quotePath` setting.
 */
function parseNulDiffOutput(output) {
    const fields = output.split("\0").filter((field) => field.length > 0);
    const changes = [];
    for (let index = 0; index < fields.length;) {
        const statusCode = fields[index];
        if (!statusCode) {
            throw new Error("Invalid git diff record: missing status");
        }
        if (statusCode.startsWith("R")) {
            const oldPath = fields[index + 1];
            const path = fields[index + 2];
            if (!oldPath || !path) {
                throw new Error(`Invalid git rename record: ${statusCode}`);
            }
            changes.push({ status: "renamed", path, oldPath });
            index += 3;
            continue;
        }
        const path = fields[index + 1];
        if (!path) {
            throw new Error(`Invalid git diff record: ${statusCode}`);
        }
        changes.push({ status: mapStatus(statusCode), path });
        index += 2;
    }
    return changes;
}
function mapStatus(statusCode) {
    switch (statusCode) {
        case "A":
            return "added";
        case "M":
        case "T":
            return "modified";
        case "D":
            return "deleted";
        default:
            throw new Error(`Unsupported git status: ${statusCode}`);
    }
}
function isIncludedMarkdown(path, config) {
    if (!path.toLowerCase().endsWith(".md")) {
        return false;
    }
    const included = config.include.some((pattern) => minimatch(path, pattern, { dot: true }));
    const excluded = config.exclude.some((pattern) => minimatch(path, pattern, { dot: true }));
    return included && !excluded;
}
