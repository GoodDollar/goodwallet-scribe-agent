import { describe, expect, test } from "vitest";

import type { Finding } from "./core/findings.js";
import { commitAll, createTempRepo, writeRepoFile } from "./core/test-helpers.js";
import { runScribeReview } from "./orchestrator.js";

describe("runScribeReview", () => {
  test("combines deterministic and agent findings for changed markdown", async () => {
    const repoRoot = createTempRepo();
    writeRepoFile(repoRoot, "docs/guide.md", "# Base\n[ok](../README.md)\n");
    writeRepoFile(repoRoot, "README.md", "root\n");
    const baseRef = commitAll(repoRoot, "base");

    writeRepoFile(repoRoot, "docs/guide.md", "# Head\n[missing](../missing.md)\n");
    const headRef = commitAll(repoRoot, "head");

    const calls: Array<{ contexts: unknown }> = [];
    const agentFindings: Finding[] = [
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

    await expect(
      runScribeReview({
        repoRoot,
        baseRef,
        headRef,
        providers: {},
      }),
    ).rejects.toThrow(/unsupported provider: mystery/i);
  });
});
