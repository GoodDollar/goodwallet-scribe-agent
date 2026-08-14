import { dirname, isAbsolute, relative, resolve } from "node:path";

import type { Finding } from "./findings.js";
import { gitPathExists } from "./git-text.js";
import { extractMarkdownLinks, toLocalLinkPath } from "./markdown-links.js";
import { toRepoPath } from "./repo-paths.js";

export interface MarkdownDocument {
  path: string;
  content: string;
}

export interface CheckLocalLinksParams {
  repoRoot: string;
  /** Revision the link targets are resolved against, rather than the checked-out working tree. */
  headRef: string;
  documents: MarkdownDocument[];
}

export function checkLocalLinks(params: CheckLocalLinksParams): Finding[] {
  const findings: Finding[] = [];

  for (const document of params.documents) {
    for (const link of extractMarkdownLinks(document.content)) {
      const targetPath = toLocalLinkPath(link.destination);
      if (!targetPath || isAbsolute(targetPath)) {
        continue;
      }

      const repoPath = toContainedRepoPath(params.repoRoot, dirname(document.path), targetPath);
      if (repoPath !== undefined && gitPathExists(params.repoRoot, params.headRef, repoPath)) {
        continue;
      }

      findings.push({
        category: "broken-link",
        severity: "error",
        confidence: 1,
        evidence: toRepoPath(targetPath),
        file: document.path,
        line: link.line,
        explanation: "The relative link target does not exist in the repository.",
        suggestion: "Create the file or update the link target.",
        source: "deterministic",
      });
    }
  }

  return findings;
}

/** Returns the repository-relative path, or `undefined` when the target escapes `repoRoot`. */
function toContainedRepoPath(repoRoot: string, documentDirectory: string, targetPath: string): string | undefined {
  const resolved = resolve(repoRoot, documentDirectory, targetPath);
  const relativePath = relative(repoRoot, resolved);

  if (relativePath.startsWith("..")) {
    return undefined;
  }

  return toRepoPath(relativePath === "" ? "." : relativePath);
}
