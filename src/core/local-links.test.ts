import { rmSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { checkLocalLinks } from "./local-links.js";
import { commitAll, createTempRepo, writeRepoFile } from "./test-helpers.js";

describe("checkLocalLinks", () => {
  test("reports missing relative local file targets with line evidence", () => {
    const repoRoot = createTempRepo();
    writeRepoFile(repoRoot, "docs/guide.md", "guide\n");
    const headRef = commitAll(repoRoot, "base");

    const findings = checkLocalLinks({
      repoRoot,
      headRef,
      documents: [
        {
          path: "README.md",
          content: [
            "[ok](docs/guide.md)",
            "[missing](docs/missing.md)",
            "[nested](./notes/ghost.md#section)",
            "[web](https://example.com)",
            "[mail](mailto:test@example.com)",
            "[hash](#intro)",
            "[tree](docs)",
          ].join("\n"),
        },
      ],
    });

    expect(findings).toEqual([
      {
        category: "broken-link",
        severity: "error",
        confidence: 1,
        evidence: "docs/missing.md",
        file: "README.md",
        line: 2,
        explanation: "The relative link target does not exist in the repository.",
        suggestion: "Create the file or update the link target.",
        source: "deterministic",
      },
      {
        category: "broken-link",
        severity: "error",
        confidence: 1,
        evidence: "notes/ghost.md",
        file: "README.md",
        line: 3,
        explanation: "The relative link target does not exist in the repository.",
        suggestion: "Create the file or update the link target.",
        source: "deterministic",
      },
    ]);
  });

  test("resolves targets at headRef even when the checked-out tree differs", () => {
    const repoRoot = createTempRepo();
    writeRepoFile(repoRoot, "docs/guide.md", "guide\n");
    writeRepoFile(repoRoot, "README.md", "readme\n");
    const headRef = commitAll(repoRoot, "reviewed head");

    rmSync(join(repoRoot, "docs/guide.md"));
    writeRepoFile(repoRoot, "docs/later.md", "added after the reviewed head\n");
    commitAll(repoRoot, "checked out tree moves on");

    const findings = checkLocalLinks({
      repoRoot,
      headRef,
      documents: [
        {
          path: "README.md",
          content: ["[gone on disk](docs/guide.md)", "[only on disk](docs/later.md)"].join("\n"),
        },
      ],
    });

    expect(findings).toEqual([
      {
        category: "broken-link",
        severity: "error",
        confidence: 1,
        evidence: "docs/later.md",
        file: "README.md",
        line: 2,
        explanation: "The relative link target does not exist in the repository.",
        suggestion: "Create the file or update the link target.",
        source: "deterministic",
      },
    ]);
  });

  test("reports targets outside the repository instead of throwing", () => {
    const repoRoot = createTempRepo();
    writeRepoFile(repoRoot, "docs/guide.md", "guide\n");
    const headRef = commitAll(repoRoot, "base");

    const findings = checkLocalLinks({
      repoRoot,
      headRef,
      documents: [{ path: "docs/guide.md", content: "[outside](../../outside.md)\n" }],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ category: "broken-link", file: "docs/guide.md", line: 1 });
  });

  test("does not check link syntax shown inside inline code spans", () => {
    const repoRoot = createTempRepo();
    writeRepoFile(repoRoot, "docs/security.md", "security\n");
    const headRef = commitAll(repoRoot, "base");

    const findings = checkLocalLinks({
      repoRoot,
      headRef,
      documents: [
        {
          path: "README.md",
          content: [
            "See [`docs/security.md`](docs/security.md) for the threat model.",
            "Write `[label](docs/example-target.md)` to add a relative link.",
            "A wider fence also hides ``[label](docs/wide-example.md)`` from the checker.",
            "Both `[one](docs/a.md)` and `[two](docs/b.md)` are documentation, not links.",
            "But [this one](docs/really-missing.md) is a real link.",
            "` unmatched run leaves [this real link](docs/also-missing.md) alone.",
          ].join("\n"),
        },
      ],
    });

    expect(findings.map((finding) => ({ evidence: finding.evidence, line: finding.line }))).toEqual([
      { evidence: "docs/really-missing.md", line: 5 },
      { evidence: "docs/also-missing.md", line: 6 },
    ]);
  });

  test("understands titles, bracketed and percent-encoded targets, and fenced code", () => {
    const repoRoot = createTempRepo();
    writeRepoFile(repoRoot, "docs/with space.md", "spaced\n");
    writeRepoFile(repoRoot, "docs/übersicht.md", "encoded\n");
    const headRef = commitAll(repoRoot, "base");

    const findings = checkLocalLinks({
      repoRoot,
      headRef,
      documents: [
        {
          path: "README.md",
          content: [
            '[spaced](<docs/with space.md> "Title")',
            "[encoded](docs/%C3%BCbersicht.md)",
            "```",
            "[fenced](docs/never-checked.md)",
            "```",
            '[broken](docs/gone.md "Title")',
          ].join("\n"),
        },
      ],
    });

    expect(findings).toEqual([
      {
        category: "broken-link",
        severity: "error",
        confidence: 1,
        evidence: "docs/gone.md",
        file: "README.md",
        line: 6,
        explanation: "The relative link target does not exist in the repository.",
        suggestion: "Create the file or update the link target.",
        source: "deterministic",
      },
    ]);
  });
});
