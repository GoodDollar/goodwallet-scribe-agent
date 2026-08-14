import { describe, expect, test } from "vitest";
import { loadConfig } from "./config.js";
import { collectBoundedContexts } from "./context.js";
import { commitAll, createTempRepo, runGit, writeRepoFile } from "./test-helpers.js";
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
        const primaryDocuments = [{ status: "modified", path: "docs/guide.md" }];
        const allChanges = [
            { status: "modified", path: "docs/guide.md" },
            { status: "modified", path: "docs/other.md" },
            { status: "modified", path: "src/app.ts" },
            { status: "modified", path: "config/app.json" },
        ];
        expect(collectBoundedContexts({
            repoRoot,
            baseRef,
            headRef,
            primaryDocuments,
            allChanges,
            config: loadConfig(repoRoot),
        })).toEqual([
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
    test("reads renamed primary base content from oldPath", () => {
        const repoRoot = createTempRepo();
        writeRepoFile(repoRoot, "docs/guide-old.md", "guide base\n");
        const baseRef = commitAll(repoRoot, "base");
        runGit(repoRoot, ["mv", "docs/guide-old.md", "docs/guide-new.md"]);
        writeRepoFile(repoRoot, "docs/guide-new.md", "guide head\n");
        const headRef = commitAll(repoRoot, "head");
        expect(collectBoundedContexts({
            repoRoot,
            baseRef,
            headRef,
            primaryDocuments: [{ status: "renamed", path: "docs/guide-new.md", oldPath: "docs/guide-old.md" }],
            allChanges: [{ status: "renamed", path: "docs/guide-new.md", oldPath: "docs/guide-old.md" }],
            config: loadConfig(repoRoot),
        })).toEqual([
            {
                primaryPath: "docs/guide-new.md",
                documents: [
                    { kind: "primary-base", path: "docs/guide-old.md", content: "guide base\n" },
                    { kind: "primary-head", path: "docs/guide-new.md", content: "guide head\n" },
                ],
                totalFiles: 2,
                totalBytes: 22,
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
        expect(contexts).toEqual([
            {
                primaryPath: "docs/guide.md",
                documents: [],
                totalFiles: 0,
                totalBytes: 0,
            },
        ]);
    });
    test("applies maxFiles to the entire bundle with primary head priority", () => {
        const repoRoot = createTempRepo();
        writeRepoFile(repoRoot, "docs/guide.md", "guide base\n");
        writeRepoFile(repoRoot, "docs/other.md", "other doc\n");
        const baseRef = commitAll(repoRoot, "base");
        writeRepoFile(repoRoot, "docs/guide.md", "guide head\n");
        writeRepoFile(repoRoot, "docs/other.md", "other changed\n");
        const headRef = commitAll(repoRoot, "head");
        expect(collectBoundedContexts({
            repoRoot,
            baseRef,
            headRef,
            primaryDocuments: [{ status: "modified", path: "docs/guide.md" }],
            allChanges: [
                { status: "modified", path: "docs/guide.md" },
                { status: "modified", path: "docs/other.md" },
            ],
            config: {
                ...loadConfig(repoRoot),
                maxFiles: 1,
                maxBytes: 1000,
            },
        })).toEqual([
            {
                primaryPath: "docs/guide.md",
                documents: [{ kind: "primary-head", path: "docs/guide.md", content: "guide head\n" }],
                totalFiles: 1,
                totalBytes: 11,
            },
        ]);
    });
    test("returns an empty bundle when neither primary revision fits the budgets", () => {
        const repoRoot = createTempRepo();
        writeRepoFile(repoRoot, "docs/guide.md", "guide base\n");
        const baseRef = commitAll(repoRoot, "base");
        writeRepoFile(repoRoot, "docs/guide.md", "guide head\n");
        const headRef = commitAll(repoRoot, "head");
        expect(collectBoundedContexts({
            repoRoot,
            baseRef,
            headRef,
            primaryDocuments: [{ status: "modified", path: "docs/guide.md" }],
            allChanges: [{ status: "modified", path: "docs/guide.md" }],
            config: {
                ...loadConfig(repoRoot),
                maxFiles: 2,
                maxBytes: 5,
            },
        })).toEqual([
            {
                primaryPath: "docs/guide.md",
                documents: [],
                totalFiles: 0,
                totalBytes: 0,
            },
        ]);
    });
    test("unions linked markdown targets from base and head revisions", () => {
        const repoRoot = createTempRepo();
        writeRepoFile(repoRoot, "docs/guide.md", "[base](../specs/base.md)\n");
        writeRepoFile(repoRoot, "specs/base.md", "base spec\n");
        writeRepoFile(repoRoot, "specs/head.md", "head spec\n");
        const baseRef = commitAll(repoRoot, "base");
        writeRepoFile(repoRoot, "docs/guide.md", "[head](../specs/head.md)\n");
        const headRef = commitAll(repoRoot, "head");
        expect(collectBoundedContexts({
            repoRoot,
            baseRef,
            headRef,
            primaryDocuments: [{ status: "modified", path: "docs/guide.md" }],
            allChanges: [{ status: "modified", path: "docs/guide.md" }],
            config: loadConfig(repoRoot),
        })).toEqual([
            {
                primaryPath: "docs/guide.md",
                documents: [
                    { kind: "primary-base", path: "docs/guide.md", content: "[base](../specs/base.md)\n" },
                    { kind: "primary-head", path: "docs/guide.md", content: "[head](../specs/head.md)\n" },
                    { kind: "linked-markdown", path: "specs/base.md", content: "base spec\n" },
                    { kind: "linked-markdown", path: "specs/head.md", content: "head spec\n" },
                ],
                totalFiles: 4,
                totalBytes: 70,
            },
        ]);
    });
    test("rejects linked paths that resolve outside the repository", () => {
        const repoRoot = createTempRepo();
        writeRepoFile(repoRoot, "docs/guide.md", "guide base\n[outside](../../outside.md)\n");
        const baseRef = commitAll(repoRoot, "base");
        writeRepoFile(repoRoot, "docs/guide.md", "guide head\n[outside](../../outside.md)\n");
        const headRef = commitAll(repoRoot, "head");
        expect(() => collectBoundedContexts({
            repoRoot,
            baseRef,
            headRef,
            primaryDocuments: [{ status: "modified", path: "docs/guide.md" }],
            allChanges: [{ status: "modified", path: "docs/guide.md" }],
            config: loadConfig(repoRoot),
        })).toThrow(/outside the repository/i);
    });
});
