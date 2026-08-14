import { execFileSync } from "node:child_process";
import { minimatch } from "minimatch";
export function discoverGitChanges(repoRoot, baseRef, headRef) {
    const output = execFileSync("git", ["diff", "--name-status", "--find-renames", baseRef, headRef, "--"], { cwd: repoRoot, encoding: "utf8" });
    return output
        .split(/\r?\n/)
        .filter((line) => line.length > 0)
        .map(parseGitDiffLine)
        .sort((left, right) => left.path.toLowerCase().localeCompare(right.path.toLowerCase()));
}
export function selectPrimaryDocuments(changes, config) {
    return changes.filter((change) => isIncludedMarkdown(change.path, config));
}
function parseGitDiffLine(line) {
    const parts = line.split("\t");
    const statusCode = parts[0];
    if (statusCode?.startsWith("R")) {
        const oldPath = parts[1];
        const path = parts[2];
        if (!oldPath || !path) {
            throw new Error(`Invalid rename diff line: ${line}`);
        }
        return { status: "renamed", path, oldPath };
    }
    const path = parts[1];
    if (!statusCode || !path) {
        throw new Error(`Invalid diff line: ${line}`);
    }
    return {
        status: mapStatus(statusCode),
        path,
    };
}
function mapStatus(statusCode) {
    switch (statusCode) {
        case "A":
            return "added";
        case "M":
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
