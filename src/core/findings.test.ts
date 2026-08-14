import { describe, expect, test } from "vitest";

import { parseProviderFindingsResponse } from "./findings.js";

describe("parseProviderFindingsResponse", () => {
  test("parses a JSON object with findings", () => {
    const parsed = parseProviderFindingsResponse(JSON.stringify({
      findings: [
        {
          category: "quality",
          severity: "warning",
          confidence: 0.9,
          evidence: "Heading is vague",
          file: "docs/guide.md",
          line: 12,
          explanation: "The heading does not describe the section well.",
          suggestion: "Rename it to summarize the section content.",
          source: "agent",
        },
      ],
    }));

    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0]?.category).toBe("quality");
  });

  test("parses a fenced JSON object with findings", () => {
    const parsed = parseProviderFindingsResponse([
      "```json",
      JSON.stringify({
        findings: [
          {
            category: "broken-link",
            severity: "error",
            confidence: 1,
            evidence: "Linked file does not exist",
            file: "README.md",
            line: 4,
            explanation: "The relative link points to a missing markdown file.",
            suggestion: "Fix or remove the broken link.",
            source: "deterministic",
          },
        ],
      }),
      "```",
    ].join("\n"));

    expect(parsed.findings[0]?.source).toBe("deterministic");
  });

  test("rejects malformed findings and extra fields", () => {
    const badResponse = JSON.stringify({
      findings: [
        {
          category: "quality",
          severity: "warning",
          confidence: 2,
          evidence: "Too confident",
          file: "README.md",
          line: 0,
          explanation: "Confidence and line are invalid.",
          suggestion: "Use valid values.",
          source: "agent",
          extra: true,
        },
      ],
    });

    expect(() => parseProviderFindingsResponse(badResponse)).toThrow(/confidence|line|extra/i);
  });
});
