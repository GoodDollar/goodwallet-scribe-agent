import { describe, expect, test } from "vitest";
import { renderMarkdownReport } from "./report.js";
const findings = [
    {
        category: "broken-link",
        severity: "error",
        confidence: 1,
        evidence: "docs/`missing`.md\r\n![pwn](x) <!-- injected -->",
        file: "docs/guide.md",
        line: 4,
        explanation: "Broken <!-- comment --> \"quote\" and 'apostrophe' link",
        suggestion: "Point to <docs/fixed.md> and avoid [`inline`](javascript:alert(1))",
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
        expect(report).toContain("Location: <code>docs/guide.md:4</code>");
        expect(report).toContain("Source: <code>agent</code>");
    });
    test("escapes backticks markdown html and CRLF inside code wrappers", () => {
        const report = renderMarkdownReport(findings);
        expect(report).toContain("Evidence: <code>docs/`missing`.md\\n![pwn](x) &lt;!-- injected --&gt;</code>");
        expect(report).toContain("Explanation: <code>Broken &lt;!-- comment --&gt; &quot;quote&quot; and &#39;apostrophe&#39; link</code>");
        expect(report).toContain("Suggestion: <code>Point to &lt;docs/fixed.md&gt; and avoid [`inline`](javascript:alert(1))</code>");
        expect(report).not.toContain("\r");
        expect(report).not.toContain("<!-- injected -->");
        expect(report).not.toContain("\n![pwn](x)\n");
    });
    test("renders a stable no-findings report", () => {
        expect(renderMarkdownReport([])).toContain("No advisory findings.");
    });
});
