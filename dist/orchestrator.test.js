import { describe, expect, test } from "vitest";
import { commitAll, createFixtureRepo, createTempRepo, writeRepoFile } from "./core/test-helpers.js";
import { runScribeReview } from "./orchestrator.js";
describe("runScribeReview", () => {
    test.each([
        {
            fixture: "clean",
            providerCalls: 1,
            expectedKinds: ["primary-base", "primary-head", "nearby-markdown"],
            expectedFindings: [],
        },
        {
            fixture: "contradiction",
            providerCalls: 1,
            expectedKinds: ["primary-base", "primary-head", "nearby-markdown"],
            expectedFindings: [
                {
                    category: "contradiction",
                    severity: "error",
                    confidence: 0.95,
                    evidence: "Use API keys. vs Use OAuth only.",
                    file: "docs/setup.md",
                    line: 2,
                    explanation: "The changed setup guide conflicts with the nearby repository guidance.",
                    suggestion: "Align both docs to the same authentication flow.",
                    source: "agent",
                },
            ],
        },
        {
            fixture: "stale-reference",
            providerCalls: 1,
            expectedKinds: ["primary-base", "primary-head", "changed-file"],
            expectedFindings: [
                {
                    category: "stale-reference",
                    severity: "warning",
                    confidence: 0.92,
                    evidence: "createLoginSession vs createSession",
                    file: "docs/api.md",
                    line: 2,
                    explanation: "The updated doc still references the pre-rename API name from the changed code.",
                    suggestion: "Rename the documented API call to match the current code.",
                    source: "agent",
                },
            ],
        },
        {
            fixture: "broken-local-link",
            providerCalls: 1,
            expectedKinds: ["primary-base", "primary-head"],
            expectedFindings: [
                {
                    category: "broken-link",
                    severity: "error",
                    confidence: 1,
                    evidence: "../missing.md",
                    file: "docs/guide.md",
                    line: 2,
                    explanation: "The relative link target does not exist in the repository.",
                    suggestion: "Create the file or update the link target.",
                    source: "deterministic",
                },
            ],
        },
        {
            fixture: "no-markdown-change",
            providerCalls: 0,
            expectedKinds: [],
            expectedFindings: [],
        },
    ])("reviews the %s fixture scenario through real git state", async ({ fixture, providerCalls, expectedKinds, expectedFindings }) => {
        const { repoRoot, baseRef, headRef } = createFixtureRepo(fixture);
        let calls = 0;
        const result = await runScribeReview({
            repoRoot,
            baseRef,
            headRef,
            providers: {
                copilot: {
                    review: ({ contexts }) => {
                        calls += 1;
                        return Promise.resolve(createFakeProviderFindings(contexts));
                    },
                },
            },
        });
        expect(calls).toBe(providerCalls);
        expect(result.findings).toEqual(expectedFindings);
        if (expectedKinds.length === 0) {
            expect(result.contexts).toEqual([]);
            expect(result.primaryDocuments).toEqual([]);
            return;
        }
        expect(result.primaryDocuments).toHaveLength(1);
        const kinds = result.contexts[0]?.documents.map((document) => document.kind) ?? [];
        expect(kinds).toEqual(expect.arrayContaining(expectedKinds));
    });
    test("combines deterministic and agent findings for changed markdown", async () => {
        const repoRoot = createTempRepo();
        writeRepoFile(repoRoot, "docs/guide.md", "# Base\n[ok](../README.md)\n");
        writeRepoFile(repoRoot, "README.md", "root\n");
        const baseRef = commitAll(repoRoot, "base");
        writeRepoFile(repoRoot, "docs/guide.md", "# Head\n[missing](../missing.md)\n");
        const headRef = commitAll(repoRoot, "head");
        const calls = [];
        const agentFindings = [
            {
                category: "quality",
                severity: "warning",
                confidence: 0.8,
                evidence: "Heading is vague",
                file: "docs/guide.md",
                line: 1,
                explanation: "The heading does not summarize the document.",
                suggestion: "Rename the heading.",
                source: "agent",
            },
        ];
        const result = await runScribeReview({
            repoRoot,
            baseRef,
            headRef,
            providers: {
                copilot: {
                    review: (request) => {
                        calls.push({ contexts: request.contexts });
                        return Promise.resolve(agentFindings);
                    },
                },
            },
        });
        expect(calls).toHaveLength(1);
        expect(result.findings).toEqual([
            {
                category: "broken-link",
                severity: "error",
                confidence: 1,
                evidence: "../missing.md",
                file: "docs/guide.md",
                line: 2,
                explanation: "The relative link target does not exist in the repository.",
                suggestion: "Create the file or update the link target.",
                source: "deterministic",
            },
            agentFindings[0],
        ]);
        expect(result.primaryDocuments).toHaveLength(1);
        expect(result.contexts).toHaveLength(1);
    });
    test("skips the provider when no markdown files changed", async () => {
        const repoRoot = createTempRepo();
        writeRepoFile(repoRoot, "src/app.ts", "export const version = 1;\n");
        const baseRef = commitAll(repoRoot, "base");
        writeRepoFile(repoRoot, "src/app.ts", "export const version = 2;\n");
        const headRef = commitAll(repoRoot, "head");
        let calls = 0;
        const result = await runScribeReview({
            repoRoot,
            baseRef,
            headRef,
            providers: {
                copilot: {
                    review: () => {
                        calls += 1;
                        return Promise.resolve([]);
                    },
                },
            },
        });
        expect(calls).toBe(0);
        expect(result.findings).toEqual([]);
        expect(result.primaryDocuments).toEqual([]);
    });
    test("still reports broken links from head markdown when context budgets exclude the file", async () => {
        const repoRoot = createTempRepo();
        writeRepoFile(repoRoot, ".scribe.yml", ["maxFiles: 1", "maxBytes: 5", ""].join("\n"));
        writeRepoFile(repoRoot, "docs/guide.md", "base\n");
        const baseRef = commitAll(repoRoot, "base");
        writeRepoFile(repoRoot, "docs/guide.md", "# Oversized\n[missing](../missing.md)\n" + "x".repeat(200));
        const headRef = commitAll(repoRoot, "head");
        const result = await runScribeReview({
            repoRoot,
            baseRef,
            headRef,
            providers: {
                copilot: {
                    review: () => Promise.resolve([]),
                },
            },
        });
        expect(result.contexts).toHaveLength(1);
        expect(result.contexts[0]?.documents.some((document) => document.kind === "primary-head")).toBe(false);
        expect(result.deterministicFindings).toEqual([
            {
                category: "broken-link",
                severity: "error",
                confidence: 1,
                evidence: "../missing.md",
                file: "docs/guide.md",
                line: 2,
                explanation: "The relative link target does not exist in the repository.",
                suggestion: "Create the file or update the link target.",
                source: "deterministic",
            },
        ]);
    });
    test("fails clearly for unsupported providers", async () => {
        const repoRoot = createTempRepo();
        writeRepoFile(repoRoot, ".scribe.yml", "provider: mystery\n");
        writeRepoFile(repoRoot, "docs/guide.md", "base\n");
        const baseRef = commitAll(repoRoot, "base");
        writeRepoFile(repoRoot, "docs/guide.md", "head\n");
        const headRef = commitAll(repoRoot, "head");
        await expect(runScribeReview({
            repoRoot,
            baseRef,
            headRef,
            providers: {},
        })).rejects.toThrow(/unsupported provider: mystery/i);
    });
});
function createFakeProviderFindings(contexts) {
    return contexts.flatMap((context) => {
        const primaryHead = context.documents.find((document) => document.kind === "primary-head");
        if (!primaryHead) {
            return [];
        }
        const nearbyMarkdown = context.documents.find((document) => document.kind === "nearby-markdown");
        if (primaryHead.path === "docs/setup.md"
            && primaryHead.content.includes("Use API keys.")
            && nearbyMarkdown?.content.includes("Use OAuth only.")) {
            return [
                {
                    category: "contradiction",
                    severity: "error",
                    confidence: 0.95,
                    evidence: "Use API keys. vs Use OAuth only.",
                    file: primaryHead.path,
                    line: 2,
                    explanation: "The changed setup guide conflicts with the nearby repository guidance.",
                    suggestion: "Align both docs to the same authentication flow.",
                    source: "agent",
                },
            ];
        }
        const changedFile = context.documents.find((document) => document.kind === "changed-file");
        if (primaryHead.path === "docs/api.md"
            && primaryHead.content.includes("createLoginSession")
            && changedFile?.path === "src/auth.ts"
            && changedFile.content.includes("createSession")) {
            return [
                {
                    category: "stale-reference",
                    severity: "warning",
                    confidence: 0.92,
                    evidence: "createLoginSession vs createSession",
                    file: primaryHead.path,
                    line: 2,
                    explanation: "The updated doc still references the pre-rename API name from the changed code.",
                    suggestion: "Rename the documented API call to match the current code.",
                    source: "agent",
                },
            ];
        }
        return [];
    });
}
