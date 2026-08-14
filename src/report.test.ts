import { describe, expect, test } from "vitest";

import type { Finding } from "./core/findings.js";
import { renderMarkdownReport } from "./report.js";

function createFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    category: "broken-link",
    severity: "error",
    confidence: 1,
    evidence: "docs/missing.md",
    file: "docs/guide.md",
    line: 4,
    explanation: "The link target is missing.",
    suggestion: "Fix the link.",
    source: "deterministic",
    ...overrides,
  };
}

const findings: Finding[] = [
  createFinding({
    evidence: "docs/`missing`.md\r\n![pwn](x) <!-- injected -->",
    explanation: "Broken ``` fenced ``` <b>html</b> and [link](https://example.com)",
    suggestion: "`wrapped in backticks`",
  }),
  createFinding({
    category: "quality",
    severity: "warning",
    confidence: 0.6,
    evidence: "Vague title",
    file: "README.md",
    line: 2,
    explanation: "Heading is too generic.",
    suggestion: "Use a more specific title.",
    source: "agent",
  }),
];

describe("renderMarkdownReport", () => {
  test("renders stable markdown with summary counts and finding details", () => {
    const report = renderMarkdownReport(findings);

    expect(report).toContain("# Goodwallet Scribe Report");
    expect(report).toContain("Total findings: 2");
    expect(report).toContain("Errors: 1");
    expect(report).toContain("Warnings: 1");
    expect(report).toContain("Info: 0");
    expect(report).toContain("## 1. error broken-link");
    expect(report).toContain("Location: `docs/guide.md:4`");
    expect(report).toContain("Source: `agent`");
  });

  test("wraps adversarial values in backtick code spans longer than any inner run", () => {
    const report = renderMarkdownReport(findings);

    expect(report).toContain("Evidence: ``docs/`missing`.md\\n![pwn](x) <!-- injected -->``");
    expect(report).toContain(
      "Explanation: ````Broken ``` fenced ``` <b>html</b> and [link](https://example.com)````",
    );
    expect(report).toContain("Suggestion: `` `wrapped in backticks` ``");
    expect(report).not.toContain("<code>");
    expect(report).not.toContain("\r");
    expect(report).not.toContain("\n![pwn](x)");
  });

  test.each([
    { value: "```", expected: "```` ``` ````" },
    { value: "`", expected: "`` ` ``" },
    { value: "a`b``c```d", expected: "````a`b``c```d````" },
    { value: " padded ", expected: "`  padded  `" },
    { value: "plain text", expected: "`plain text`" },
    { value: "line\r\nbreak\rand\nmore", expected: "`line\\nbreak\\nand\\nmore`" },
  ])("renders %o as a safe code span", ({ value, expected }) => {
    expect(renderMarkdownReport([createFinding({ evidence: value })])).toContain(`Evidence: ${expected}`);
  });

  test("renders a stable no-findings report", () => {
    expect(renderMarkdownReport([])).toContain("No advisory findings.");
  });
});
