import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { checkLocalLinks } from "./local-links.js";
describe("checkLocalLinks", () => {
    test("reports missing relative local file targets with line evidence", () => {
        const repoRoot = mkdtempSync(join(tmpdir(), "scribe-links-"));
        mkdirSync(join(repoRoot, "docs"), { recursive: true });
        writeFileSync(join(repoRoot, "docs", "guide.md"), "guide\n");
        const findings = checkLocalLinks(repoRoot, [
            {
                path: "README.md",
                content: [
                    "[ok](docs/guide.md)",
                    "[missing](docs/missing.md)",
                    "[nested](./notes/ghost.md#section)",
                    "[web](https://example.com)",
                    "[mail](mailto:test@example.com)",
                    "[hash](#intro)",
                ].join("\n"),
            },
        ]);
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
});
