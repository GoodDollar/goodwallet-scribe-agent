import { execFileSync } from "node:child_process";
import { dirname, join, normalize, relative, resolve } from "node:path";

import { minimatch } from "minimatch";

import type { ScribeConfig } from "./config.js";
import type { GitChange } from "./git-changes.js";

const LINK_PATTERN = /\[[^\]]+\]\(([^)]+)\)/g;

export type ContextDocumentKind =
  | "primary-base"
  | "primary-head"
  | "changed-markdown"
  | "changed-file"
  | "linked-markdown"
  | "nearby-markdown";

export interface ContextDocument {
  kind: ContextDocumentKind;
  path: string;
  content: string;
}

export interface PrimaryDocumentContext {
  primaryPath: string;
  documents: ContextDocument[];
  totalFiles: number;
  totalBytes: number;
}

export interface CollectBoundedContextsParams {
  repoRoot: string;
  baseRef: string;
  headRef: string;
  primaryDocuments: GitChange[];
  allChanges: GitChange[];
  config: ScribeConfig;
}

export function collectBoundedContexts(params: CollectBoundedContextsParams): PrimaryDocumentContext[] {
  return params.primaryDocuments.map((primaryDocument) =>
    collectPrimaryContext(primaryDocument.path, params),
  );
}

function collectPrimaryContext(primaryPath: string, params: CollectBoundedContextsParams): PrimaryDocumentContext {
  const documents: ContextDocument[] = [];
  const baseContent = readGitFile(params.repoRoot, params.baseRef, primaryPath);
  const headContent = readGitFile(params.repoRoot, params.headRef, primaryPath);

  if (baseContent !== undefined) {
    documents.push({ kind: "primary-base", path: primaryPath, content: baseContent });
  }

  if (headContent !== undefined) {
    documents.push({ kind: "primary-head", path: primaryPath, content: headContent });
  }

  const seenPaths = new Set([primaryPath]);
  let supplementalFiles = 0;
  let supplementalBytes = 0;

  const candidates = [
    ...getChangedMarkdownCandidates(primaryPath, params),
    ...getChangedFileCandidates(primaryPath, params),
    ...getLinkedMarkdownCandidates(primaryPath, headContent ?? baseContent, params),
    ...getNearbyMarkdownCandidates(primaryPath, params),
  ];

  for (const candidate of candidates) {
    if (seenPaths.has(candidate.path) || isSecretPath(candidate.path) || isExcluded(candidate.path, params.config)) {
      continue;
    }

    if (supplementalFiles >= params.config.maxFiles) {
      break;
    }

    const nextBytes = supplementalBytes + candidate.content.length;
    if (nextBytes > params.config.maxBytes) {
      continue;
    }

    seenPaths.add(candidate.path);
    documents.push(candidate);
    supplementalFiles += 1;
    supplementalBytes = nextBytes;
  }

  return {
    primaryPath,
    documents,
    totalFiles: documents.length,
    totalBytes: documents.reduce((sum, document) => sum + document.content.length, 0),
  };
}

function getChangedMarkdownCandidates(
  primaryPath: string,
  params: CollectBoundedContextsParams,
): ContextDocument[] {
  return params.allChanges
    .filter((change) => change.path !== primaryPath && isMarkdown(change.path) && isIncluded(change.path, params.config))
    .flatMap((change) => {
      const content = readExistingGitFile(params.repoRoot, change.path, params.headRef, params.baseRef);
      return content === undefined
        ? []
        : [{ kind: "changed-markdown" as const, path: change.path, content }];
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

function getChangedFileCandidates(primaryPath: string, params: CollectBoundedContextsParams): ContextDocument[] {
  return params.allChanges
    .filter((change) => change.path !== primaryPath && !isMarkdown(change.path))
    .flatMap((change) => {
      const content = readExistingGitFile(params.repoRoot, change.path, params.headRef, params.baseRef);
      return content === undefined
        ? []
        : [{ kind: "changed-file" as const, path: change.path, content }];
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

function getLinkedMarkdownCandidates(
  primaryPath: string,
  currentContent: string | undefined,
  params: CollectBoundedContextsParams,
): ContextDocument[] {
  if (!currentContent) {
    return [];
  }

  const linkedPaths = new Set<string>();

  for (const line of currentContent.split(/\r?\n/)) {
    for (const match of line.matchAll(LINK_PATTERN)) {
      const target = match[1]?.trim();
      if (!target || shouldIgnoreLinkTarget(target)) {
        continue;
      }

      const targetPath = target.split("#", 1)[0] ?? target;
      if (!isMarkdown(targetPath)) {
        continue;
      }

      const resolved = resolveRepoPath(params.repoRoot, dirname(primaryPath), targetPath);
      const normalizedPath = toRepoPath(relative(params.repoRoot, resolved));
      if (isSecretPath(normalizedPath)) {
        continue;
      }

      const content = readExistingGitFile(params.repoRoot, normalizedPath, params.headRef, params.baseRef);
      if (content === undefined) {
        continue;
      }

      linkedPaths.add(normalizedPath);
    }
  }

  return [...linkedPaths]
    .sort((left, right) => left.localeCompare(right))
    .flatMap((path) => {
      const content = readExistingGitFile(params.repoRoot, path, params.headRef, params.baseRef);
      return content === undefined
        ? []
        : [{ kind: "linked-markdown" as const, path, content }];
    });
}

function getNearbyMarkdownCandidates(primaryPath: string, params: CollectBoundedContextsParams): ContextDocument[] {
  const primaryDirectory = dirname(primaryPath);
  const directories = [primaryDirectory];

  for (let currentDirectory = primaryDirectory; currentDirectory !== "."; ) {
    currentDirectory = dirname(currentDirectory);
    directories.push(currentDirectory);
  }

  for (const directory of directories) {
    for (const filename of ["README.md", "index.md"]) {
      const path = directory === "." ? filename : join(directory, filename);
      const content = readExistingGitFile(params.repoRoot, path, params.headRef, params.baseRef);
      if (content !== undefined) {
        return [{ kind: "nearby-markdown", path: toRepoPath(path), content }];
      }
    }
  }

  return [];
}

function readExistingGitFile(
  repoRoot: string,
  path: string,
  preferredRef: string,
  fallbackRef: string,
): string | undefined {
  return readGitFile(repoRoot, preferredRef, path) ?? readGitFile(repoRoot, fallbackRef, path);
}

function readGitFile(repoRoot: string, ref: string, path: string): string | undefined {
  const repoPath = toRepoPath(path);
  resolveRepoPath(repoRoot, ".", repoPath);

  try {
    return execFileSync("git", ["show", `${ref}:${repoPath}`], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return undefined;
  }
}

function resolveRepoPath(repoRoot: string, basePath: string, targetPath: string): string {
  const resolved = resolve(repoRoot, basePath, targetPath);
  const relativePath = relative(repoRoot, resolved);

  if (relativePath.startsWith("..") || relativePath === "") {
    if (relativePath === "") {
      return resolved;
    }
    throw new Error(`Path resolves outside the repository: ${targetPath}`);
  }

  return resolved;
}

function isIncluded(path: string, config: ScribeConfig): boolean {
  return config.include.some((pattern) => minimatch(path, pattern, { dot: true }));
}

function isExcluded(path: string, config: ScribeConfig): boolean {
  return config.exclude.some((pattern) => minimatch(path, pattern, { dot: true }));
}

function isMarkdown(path: string): boolean {
  return path.toLowerCase().endsWith(".md");
}

function shouldIgnoreLinkTarget(target: string): boolean {
  return (
    target.startsWith("#")
    || target.startsWith("http://")
    || target.startsWith("https://")
    || target.startsWith("mailto:")
  );
}

function isSecretPath(path: string): boolean {
  const normalizedPath = toRepoPath(path).toLowerCase();
  const fileName = normalizedPath.split("/").at(-1) ?? normalizedPath;

  return (
    fileName.startsWith(".env")
    || fileName.endsWith(".key")
    || fileName.endsWith(".pem")
    || fileName.endsWith(".p12")
    || fileName.endsWith(".pfx")
    || normalizedPath.includes("credential")
    || normalizedPath.includes("secret")
  );
}

function toRepoPath(path: string): string {
  return normalize(path).replaceAll("\\", "/").replace(/^\.\//, "");
}
