import { rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { loadConfig } from "./config.js";
import { discoverGitChanges, resolveMergeBase, selectPrimaryDocuments } from "./git-changes.js";
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

  test("diffs from the merge base so documents changed only on base are not selected", () => {
    const repoRoot = createTempRepo();

    writeRepoFile(repoRoot, "docs/shared.md", "shared\n");
    writeRepoFile(repoRoot, "docs/base-only.md", "base only\n");
    const forkPoint = commitAll(repoRoot, "fork point");

    runGit(repoRoot, ["checkout", "-b", "feature"]);
    writeRepoFile(repoRoot, "docs/shared.md", "shared head\n");
    const headRef = commitAll(repoRoot, "head");

    runGit(repoRoot, ["checkout", "main"]);
    writeRepoFile(repoRoot, "docs/base-only.md", "base only changed on base\n");
    const baseRef = commitAll(repoRoot, "base moved on");

    expect(resolveMergeBase(repoRoot, baseRef, headRef)).toBe(forkPoint);
    expect(discoverGitChanges(repoRoot, baseRef, headRef)).toEqual([
      { status: "modified", path: "docs/shared.md" },
    ]);
  });

  test("returns unquoted non-ascii paths for changes and renames", () => {
    const repoRoot = createTempRepo();

    writeRepoFile(repoRoot, "docs/übersicht.md", "base\n");
    writeRepoFile(repoRoot, "docs/文档.md", "move me\n");
    const baseRef = commitAll(repoRoot, "base");

    writeRepoFile(repoRoot, "docs/übersicht.md", "head\n");
    runGit(repoRoot, ["mv", "docs/文档.md", "docs/文档-新.md"]);
    const headRef = commitAll(repoRoot, "head");

    expect(discoverGitChanges(repoRoot, baseRef, headRef)).toEqual([
      { status: "modified", path: "docs/übersicht.md" },
      { status: "renamed", path: "docs/文档-新.md", oldPath: "docs/文档.md" },
    ]);
  });

  test("maps a typechange to modified", () => {
    const repoRoot = createTempRepo();

    writeRepoFile(repoRoot, "docs/guide.md", "guide\n");
    writeRepoFile(repoRoot, "docs/target.md", "target\n");
    const baseRef = commitAll(repoRoot, "base");

    rmSync(join(repoRoot, "docs/guide.md"));
    symlinkSync("target.md", join(repoRoot, "docs/guide.md"));
    const headRef = commitAll(repoRoot, "head");

    expect(discoverGitChanges(repoRoot, baseRef, headRef)).toEqual([
      { status: "modified", path: "docs/guide.md" },
    ]);
  });

  test("selects only included markdown changes as primary documents", () => {
    const config = loadConfig("/tmp");

    expect(
      selectPrimaryDocuments(
        [
          { status: "modified", path: "README.md" },
          { status: "modified", path: "docs/private/secret.md" },
          { status: "added", path: "src/app.ts" },
          { status: "renamed", path: "docs/guide-renamed.md", oldPath: "docs/guide.md" },
        ],
        {
          ...config,
          exclude: ["docs/private/**"],
        },
      ),
    ).toEqual([
      { status: "modified", path: "README.md" },
      { status: "renamed", path: "docs/guide-renamed.md", oldPath: "docs/guide.md" },
    ]);
  });

  test("excludes deleted and secret-looking markdown from primary documents", () => {
    const config = loadConfig("/tmp");

    expect(
      selectPrimaryDocuments(
        [
          { status: "deleted", path: "docs/removed.md" },
          { status: "modified", path: "docs/secret-rotation.md" },
          { status: "modified", path: "docs/credentials/setup.md" },
          { status: "modified", path: "docs/kept.md" },
        ],
        config,
      ),
    ).toEqual([{ status: "modified", path: "docs/kept.md" }]);
  });
});
