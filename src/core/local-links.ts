import { existsSync } from "node:fs";
import { dirname, isAbsolute, normalize, relative, resolve } from "node:path";

import type { Finding } from "./findings.js";

export interface MarkdownDocument {
  path: string;
  content: string;
}

const LINK_PATTERN = /\[[^\]]+\]\(([^)]+)\)/g;

export function checkLocalLinks(repoRoot: string, documents: MarkdownDocument[]): Finding[] {
  const findings: Finding[] = [];

  for (const document of documents) {
    const lines = document.content.split(/\r?\n/);

    for (const [index, line] of lines.entries()) {
      for (const match of line.matchAll(LINK_PATTERN)) {
        const rawTarget = match[1]?.trim();
        if (!rawTarget || shouldIgnoreTarget(rawTarget)) {
          continue;
        }

        const targetPath = rawTarget.split("#", 1)[0] ?? rawTarget;
        const resolved = resolve(repoRoot, dirname(document.path), targetPath);
        const relativePath = normalize(relative(repoRoot, resolved));

        if (relativePath.startsWith("..") || !existsSync(resolved)) {
          findings.push({
            category: "broken-link",
            severity: "error",
            confidence: 1,
            evidence: normalize(targetPath).replace(/^\.\//, ""),
            file: document.path,
            line: index + 1,
            explanation: "The relative link target does not exist in the repository.",
            suggestion: "Create the file or update the link target.",
            source: "deterministic",
          });
        }
      }
    }
  }

  return findings;
}

function shouldIgnoreTarget(target: string): boolean {
  return (
    target.startsWith("#")
    || target.startsWith("http://")
    || target.startsWith("https://")
    || target.startsWith("mailto:")
    || isAbsolute(target)
  );
}
