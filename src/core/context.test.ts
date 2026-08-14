import { describe, expect, test } from "vitest";

import { loadConfig } from "./config.js";
import { collectBoundedContexts } from "./context.js";
import type { GitChange } from "./git-changes.js";
import { commitAll, createTempRepo, writeRepoFile } from "./test-helpers.js";

describe("collectBoundedContexts", () => {
  test("collects base/head content and deterministic supporting context", () => {
    const repoRoot = createTempRepo();

    writeRepoFile(repoRoot, "README.md", "root readme\n");
    writeRepoFile(repoRoot, "docs/index.md", "docs index\n");
    writeRepoFile(repoRoot, "docs/guide.md", "guide base\n[spec](../specs/spec.md)\n");
    writeRepoFile(repoRoot, "docs/other.md", "other base\n");
    writeRepoFile(repoRoot, "specs/spec.md", "spec\n");
    writeRepoFile(repoRoot, "src/app.ts", "export const version = 1;\n");
    writeRepoFile(repoRoot, "config/app.json", '{"name":"base"}\n');
    const baseRef = commitAll(repoRoot, "base");

    writeRepoFile(repoRoot, "docs/guide.md", "guide head\n[spec](../specs/spec.md)\n");
    writeRepoFile(repoRoot, "docs/other.md", "other head\n");
    writeRepoFile(repoRoot, "src/app.ts", "export const version = 2;\n");
    writeRepoFile(repoRoot, "config/app.json", '{"name":"head"}\n');
    const headRef = commitAll(repoRoot, "head");

    const primaryDocuments: GitChange[] = [{ status: "modified", path: "docs/guide.md" }];
    const allChanges: GitChange[] = [
      { status: "modified", path: "docs/guide.md" },
      { status: "modified", path: "docs/other.md" },
      { status: "modified", path: "src/app.ts" },
      { status: "modified", path: "config/app.json" },
    ];

    expect(
      collectBoundedContexts({
        repoRoot,
        baseRef,
        headRef,
        primaryDocuments,
        allChanges,
        config: loadConfig(repoRoot),
      }),
    ).toEqual([
      {
        primaryPath: "docs/guide.md",
        documents: [
          { kind: "primary-base", path: "docs/guide.md", content: "guide base\n[spec](../specs/spec.md)\n" },
          { kind: "primary-head", path: "docs/guide.md", content: "guide head\n[spec](../specs/spec.md)\n" },
          { kind: "changed-markdown", path: "docs/other.md", content: "other head\n" },
          { kind: "changed-file", path: "config/app.json", content: '{"name":"head"}\n' },
          { kind: "changed-file", path: "src/app.ts", content: "export const version = 2;\n" },
          { kind: "linked-markdown", path: "specs/spec.md", content: "spec\n" },
          { kind: "nearby-markdown", path: "docs/index.md", content: "docs index\n" },
        ],
        totalFiles: 7,
        totalBytes: 141,
      },
    ]);
  });

  test("skips missing and secret files and applies deterministic budgets", () => {
    const repoRoot = createTempRepo();

    writeRepoFile(repoRoot, "docs/index.md", "docs index\n");
    writeRepoFile(repoRoot, "docs/guide.md", [
      "guide base",
      "[missing](../missing.md)",
      "[secret](../.env.production)",
      "[spec](../specs/spec.md)",
      "",
    ].join("\n"));
    writeRepoFile(repoRoot, "docs/other.md", "other head\n");
    writeRepoFile(repoRoot, "specs/spec.md", "spec\n");
    writeRepoFile(repoRoot, ".env.production", "TOKEN=secret\n");
    writeRepoFile(repoRoot, "src/app.ts", "export const version = 1;\n");
    const baseRef = commitAll(repoRoot, "base");

    writeRepoFile(repoRoot, "docs/guide.md", [
      "guide head",
      "[missing](../missing.md)",
      "[secret](../.env.production)",
      "[spec](../specs/spec.md)",
      "",
    ].join("\n"));
    writeRepoFile(repoRoot, "docs/other.md", "other changed\n");
    writeRepoFile(repoRoot, "src/app.ts", "export const version = 2;\n");
    const headRef = commitAll(repoRoot, "head");

    const contexts = collectBoundedContexts({
      repoRoot,
      baseRef,
      headRef,
      primaryDocuments: [{ status: "modified", path: "docs/guide.md" }],
      allChanges: [
        { status: "modified", path: "docs/guide.md" },
        { status: "modified", path: "docs/other.md" },
        { status: "modified", path: "src/app.ts" },
      ],
      config: {
        ...loadConfig(repoRoot),
        maxFiles: 2,
        maxBytes: 40,
      },
    });

    expect(contexts[0]?.documents.map((document) => `${document.kind}:${document.path}`)).toEqual([
      "primary-base:docs/guide.md",
      "primary-head:docs/guide.md",
      "changed-markdown:docs/other.md",
      "changed-file:src/app.ts",
    ]);
  });

  test("rejects linked paths that resolve outside the repository", () => {
    const repoRoot = createTempRepo();

    writeRepoFile(repoRoot, "docs/guide.md", "guide base\n[outside](../../outside.md)\n");
    const baseRef = commitAll(repoRoot, "base");

    writeRepoFile(repoRoot, "docs/guide.md", "guide head\n[outside](../../outside.md)\n");
    const headRef = commitAll(repoRoot, "head");

    expect(() =>
      collectBoundedContexts({
        repoRoot,
        baseRef,
        headRef,
        primaryDocuments: [{ status: "modified", path: "docs/guide.md" }],
        allChanges: [{ status: "modified", path: "docs/guide.md" }],
        config: loadConfig(repoRoot),
      }),
    ).toThrow(/outside the repository/i);
  });
});
