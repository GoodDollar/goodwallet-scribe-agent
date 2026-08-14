import { dirname, join, relative, resolve } from "node:path";

import { minimatch } from "minimatch";

import type { ScribeConfig } from "./config.js";
import type { GitChange } from "./git-changes.js";
import { readGitTextFile } from "./git-text.js";
import { extractMarkdownLinks, toLocalLinkPath } from "./markdown-links.js";
import { isSecretPath, toRepoPath } from "./repo-paths.js";

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
  return params.primaryDocuments.map((primaryDocument) => collectPrimaryContext(primaryDocument, params));
}

function collectPrimaryContext(primaryDocument: GitChange, params: CollectBoundedContextsParams): PrimaryDocumentContext {
  const primaryPath = primaryDocument.path;
  const basePath = primaryDocument.oldPath ?? primaryDocument.path;
  const baseContent = readGitTextFile(params.repoRoot, params.baseRef, basePath);
  const headContent = readGitTextFile(params.repoRoot, params.headRef, primaryPath);

  let totalFiles = 0;
  let totalBytes = 0;
  const selectedPrimaryDocuments: ContextDocument[] = [];

  for (const primaryCandidate of [
    headContent === undefined ? undefined : { kind: "primary-head" as const, path: primaryPath, content: headContent },
    baseContent === undefined ? undefined : { kind: "primary-base" as const, path: basePath, content: baseContent },
  ]) {
    if (!primaryCandidate) {
      continue;
    }

    const nextFiles = totalFiles + 1;
    const nextBytes = totalBytes + Buffer.byteLength(primaryCandidate.content, "utf8");
    if (nextFiles > params.config.maxFiles || nextBytes > params.config.maxBytes) {
      continue;
    }

    selectedPrimaryDocuments.push(primaryCandidate);
    totalFiles = nextFiles;
    totalBytes = nextBytes;
  }

  if (selectedPrimaryDocuments.length === 0) {
    return {
      primaryPath,
      documents: [],
      totalFiles: 0,
      totalBytes: 0,
    };
  }

  const documents = orderPrimaryDocuments(selectedPrimaryDocuments);
  const seenPaths = new Set([primaryPath, basePath]);
  const candidates = [
    ...getChangedMarkdownCandidates(primaryPath, params),
    ...getChangedFileCandidates(primaryPath, params),
    ...getLinkedMarkdownCandidates(primaryPath, [baseContent, headContent], params),
    ...getNearbyMarkdownCandidates(primaryPath, seenPaths, params),
  ];

  for (const candidate of candidates) {
    if (seenPaths.has(candidate.path) || isSecretPath(candidate.path) || isExcluded(candidate.path, params.config)) {
      continue;
    }

    const nextFiles = totalFiles + 1;
    if (nextFiles > params.config.maxFiles) {
      break;
    }

    const nextBytes = totalBytes + Buffer.byteLength(candidate.content, "utf8");
    if (nextBytes > params.config.maxBytes) {
      continue;
    }

    seenPaths.add(candidate.path);
    documents.push(candidate);
    totalFiles = nextFiles;
    totalBytes = nextBytes;
  }

  return {
    primaryPath,
    documents,
    totalFiles,
    totalBytes,
  };
}


function orderPrimaryDocuments(documents: ContextDocument[]): ContextDocument[] {
  return [...documents].sort((left, right) => primaryDocumentOrder(left.kind) - primaryDocumentOrder(right.kind));
}

function primaryDocumentOrder(kind: ContextDocumentKind): number {
  switch (kind) {
    case "primary-base":
      return 0;
    case "primary-head":
      return 1;
    default:
      return 2;
  }
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
  contents: Array<string | undefined>,
  params: CollectBoundedContextsParams,
): ContextDocument[] {
  const linkedPaths = new Set<string>();

  for (const currentContent of contents) {
    if (!currentContent) {
      continue;
    }

    for (const link of extractMarkdownLinks(currentContent)) {
      const targetPath = toLocalLinkPath(link.destination);
      if (!targetPath || !isMarkdown(targetPath)) {
        continue;
      }

      const resolved = tryResolveRepoPath(params.repoRoot, dirname(primaryPath), targetPath);
      if (resolved === undefined) {
        continue;
      }

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

function getNearbyMarkdownCandidates(
  primaryPath: string,
  excludedPaths: Set<string>,
  params: CollectBoundedContextsParams,
): ContextDocument[] {
  const primaryDirectory = dirname(primaryPath);
  const directories = [primaryDirectory];

  for (let currentDirectory = primaryDirectory; currentDirectory !== "."; ) {
    currentDirectory = dirname(currentDirectory);
    directories.push(currentDirectory);
  }

  for (const directory of directories) {
    for (const filename of ["README.md", "index.md"]) {
      const path = toRepoPath(directory === "." ? filename : join(directory, filename));
      if (excludedPaths.has(path)) {
        continue;
      }

      const content = readExistingGitFile(params.repoRoot, path, params.headRef, params.baseRef);
      if (content !== undefined) {
        return [{ kind: "nearby-markdown", path, content }];
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
  return readGitTextFile(repoRoot, preferredRef, path) ?? readGitTextFile(repoRoot, fallbackRef, path);
}

/** Resolves a link target inside the repository, or returns `undefined` when it escapes `repoRoot`. */
function tryResolveRepoPath(repoRoot: string, basePath: string, targetPath: string): string | undefined {
  const resolved = resolve(repoRoot, basePath, targetPath);
  const relativePath = relative(repoRoot, resolved);

  if (relativePath.length === 0 || relativePath.startsWith("..")) {
    return undefined;
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
