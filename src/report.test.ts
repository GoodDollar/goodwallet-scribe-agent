import { describe, expect, test } from "vitest";

import type { Finding } from "./core/findings.js";
import { renderMarkdownReport } from "./report.js";

const findings: Finding[] = [
  {
    category: "broken-link",
    severity: "error",
    confidence: 1,
    evidence: "docs/missing.md\n# injected heading",
    file: "docs/guide.md",
    line: 4,
    explanation: "Broken <!-- comment --> link",
    suggestion: "Point to <docs/fixed.md>",
    source: "deterministic",
  },
  {
    category: "quality",
    severity: "warning",
    confidence: 0.6,
    evidence: "Vague title",
    file: "README.md",
    line: 2,
    explanation: "Heading is too generic.",
    suggestion: "Use a more specific title.",
    source: "agent",
  },
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
    expect(report).toContain("Evidence: `docs/missing.md\\n# injected heading`");
    expect(report).toContain("Suggestion: `Point to &lt;docs/fixed.md&gt;`");
    expect(report).toContain("Source: `agent`");
  });

  test("escapes untrusted content so it cannot inject markdown structure or html", () => {
    const report = renderMarkdownReport(findings);

    expect(report).not.toContain("<!-- comment -->");
    expect(report).not.toContain("\n# injected heading\n");
    expect(report).toContain("&lt;!-- comment --&gt;");
  });

  test("renders a stable no-findings report", () => {
    expect(renderMarkdownReport([])).toContain("No advisory findings.");
  });
});
