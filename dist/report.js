export function renderMarkdownReport(findings) {
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
        lines.push("", "## " + String(index + 1) + ". " + finding.severity + " " + finding.category, "Location: " + asCode(finding.file + ":" + String(finding.line)), "Evidence: " + asCode(finding.evidence), "Explanation: " + asCode(finding.explanation), "Suggestion: " + asCode(finding.suggestion), "Source: " + asCode(finding.source));
    });
    return lines.join("\n");
}
function countBySeverity(findings) {
    return findings.reduce((counts, finding) => {
        counts[finding.severity] += 1;
        return counts;
    }, { info: 0, warning: 0, error: 0 });
}
function asCode(value) {
    return "<code>" + escapeCodeContent(value) + "</code>";
}
function escapeCodeContent(value) {
    return normalizeLineEndings(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;")
        .replaceAll("\n", "\\n");
}
function normalizeLineEndings(value) {
    return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}
