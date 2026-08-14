import { describe, expect, test } from "vitest";
import { loadConfig } from "./config.js";
import { discoverGitChanges, selectPrimaryDocuments } from "./git-changes.js";
import { commitAll, createTempRepo, runGit, writeRepoFile } from "./test-helpers.js";
describe("discoverGitChanges", () => {
    test("returns stable statuses and old paths for renames", () => {
        const repoRoot = createTempRepo();
        writeRepoFile(repoRoot, "README.md", "# Base\n");
        writeRepoFile(repoRoot, "docs/guide.md", "guide\n");
        writeRepoFile(repoRoot, "src/app.ts", "export const value = 1;\n");
        const baseRef = commitAll(repoRoot, "base");
        writeRepoFile(repoRoot, "README.md", "# Head\n");
        runGit(repoRoot, ["mv", "docs/guide.md", "docs/guide-renamed.md"]);
        writeRepoFile(repoRoot, "src/app.ts", "export const value = 2;\n");
        writeRepoFile(repoRoot, "docs/new.md", "new\n");
        const headRef = commitAll(repoRoot, "head");
        expect(discoverGitChanges(repoRoot, baseRef, headRef)).toEqual([
            { status: "renamed", path: "docs/guide-renamed.md", oldPath: "docs/guide.md" },
            { status: "added", path: "docs/new.md" },
            { status: "modified", path: "README.md" },
            { status: "modified", path: "src/app.ts" },
        ]);
    });
    test("selects only included markdown changes as primary documents", () => {
        const config = loadConfig("/tmp");
        expect(selectPrimaryDocuments([
            { status: "modified", path: "README.md" },
            { status: "modified", path: "docs/private/secret.md" },
            { status: "added", path: "src/app.ts" },
            { status: "renamed", path: "docs/guide-renamed.md", oldPath: "docs/guide.md" },
        ], {
            ...config,
            exclude: ["docs/private/**"],
        })).toEqual([
            { status: "modified", path: "README.md" },
            { status: "renamed", path: "docs/guide-renamed.md", oldPath: "docs/guide.md" },
        ]);
    });
});
