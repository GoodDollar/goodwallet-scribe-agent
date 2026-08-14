import type { Finding } from "./core/findings.js";

export function renderMarkdownReport(findings: Finding[]): string {
  const counts = countBySeverity(findings);
  const lines = [
    "# Goodwallet Scribe Report",
    "",
    "Total findings: " + String(findings.length),
    "Errors: " + String(counts.error),
    "Warnings: " + String(counts.warning),
    "Info: " + String(counts.info),
  ];

  if (findings.length === 0) {
    lines.push("", "No advisory findings.");
    return lines.join("\n");
  }

  findings.forEach((finding, index) => {
    lines.push(
      "",
      "## " + String(index + 1) + ". " + finding.severity + " " + finding.category,
      "Location: " + asCode(finding.file + ":" + String(finding.line)),
      "Evidence: " + asCode(finding.evidence),
      "Explanation: " + asCode(finding.explanation),
      "Suggestion: " + asCode(finding.suggestion),
      "Source: " + asCode(finding.source),
    );
  });

  return lines.join("\n");
}

function countBySeverity(findings: Finding[]): Record<Finding["severity"], number> {
  return findings.reduce<Record<Finding["severity"], number>>(
    (counts, finding) => {
      counts[finding.severity] += 1;
      return counts;
    },
    { info: 0, warning: 0, error: 0 },
  );
}

/**
 * Wraps a value in a CommonMark code span whose fence is longer than any backtick run inside it,
 * so attacker-influenced text can never escape into Markdown or HTML in the rendered report.
 */
function asCode(value: string): string {
  const text = normalizeLineEndings(value).replaceAll("\n", "\\n");
  const fence = "`".repeat(longestBacktickRun(text) + 1);
  const padding = needsPadding(text) ? " " : "";

  return fence + padding + text + padding + fence;
}

function longestBacktickRun(text: string): number {
  return [...text.matchAll(/`+/g)].reduce((longest, match) => Math.max(longest, match[0].length), 0);
}

/** A code span whose content touches a backtick or space at either edge needs literal padding. */
function needsPadding(text: string): boolean {
  return /^[` ]/.test(text) || /[` ]$/.test(text);
}

function normalizeLineEndings(value: string): string {
  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}
