import { dirname, join, relative, resolve } from "node:path";
import { minimatch } from "minimatch";
import { readGitTextFile } from "./git-text.js";
import { extractMarkdownLinks, toLocalLinkPath } from "./markdown-links.js";
import { isSecretPath, toRepoPath } from "./repo-paths.js";
export function collectBoundedContexts(params) {
    return params.primaryDocuments.map((primaryDocument) => collectPrimaryContext(primaryDocument, params));
}
function collectPrimaryContext(primaryDocument, params) {
    const primaryPath = primaryDocument.path;
    const basePath = primaryDocument.oldPath ?? primaryDocument.path;
    const baseContent = readGitTextFile(params.repoRoot, params.baseRef, basePath);
    const headContent = readGitTextFile(params.repoRoot, params.headRef, primaryPath);
    let totalFiles = 0;
    let totalBytes = 0;
    const selectedPrimaryDocuments = [];
    for (const primaryCandidate of [
        headContent === undefined ? undefined : { kind: "primary-head", path: primaryPath, content: headContent },
        baseContent === undefined ? undefined : { kind: "primary-base", path: basePath, content: baseContent },
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
function orderPrimaryDocuments(documents) {
    return [...documents].sort((left, right) => primaryDocumentOrder(left.kind) - primaryDocumentOrder(right.kind));
}
function primaryDocumentOrder(kind) {
    switch (kind) {
        case "primary-base":
            return 0;
        case "primary-head":
            return 1;
        default:
            return 2;
    }
}
function getChangedMarkdownCandidates(primaryPath, params) {
    return params.allChanges
        .filter((change) => change.path !== primaryPath && isMarkdown(change.path) && isIncluded(change.path, params.config))
        .flatMap((change) => {
        const content = readExistingGitFile(params.repoRoot, change.path, params.headRef, params.baseRef);
        return content === undefined
            ? []
            : [{ kind: "changed-markdown", path: change.path, content }];
    })
        .sort((left, right) => left.path.localeCompare(right.path));
}
function getChangedFileCandidates(primaryPath, params) {
    return params.allChanges
        .filter((change) => change.path !== primaryPath && !isMarkdown(change.path))
        .flatMap((change) => {
        const content = readExistingGitFile(params.repoRoot, change.path, params.headRef, params.baseRef);
        return content === undefined
            ? []
            : [{ kind: "changed-file", path: change.path, content }];
    })
        .sort((left, right) => left.path.localeCompare(right.path));
}
function getLinkedMarkdownCandidates(primaryPath, contents, params) {
    const linkedPaths = new Set();
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
            : [{ kind: "linked-markdown", path, content }];
    });
}
function getNearbyMarkdownCandidates(primaryPath, excludedPaths, params) {
    const primaryDirectory = dirname(primaryPath);
    const directories = [primaryDirectory];
    for (let currentDirectory = primaryDirectory; currentDirectory !== ".";) {
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
function readExistingGitFile(repoRoot, path, preferredRef, fallbackRef) {
    return readGitTextFile(repoRoot, preferredRef, path) ?? readGitTextFile(repoRoot, fallbackRef, path);
}
/** Resolves a link target inside the repository, or returns `undefined` when it escapes `repoRoot`. */
function tryResolveRepoPath(repoRoot, basePath, targetPath) {
    const resolved = resolve(repoRoot, basePath, targetPath);
    const relativePath = relative(repoRoot, resolved);
    if (relativePath.length === 0 || relativePath.startsWith("..")) {
        return undefined;
    }
    return resolved;
}
function isIncluded(path, config) {
    return config.include.some((pattern) => minimatch(path, pattern, { dot: true }));
}
function isExcluded(path, config) {
    return config.exclude.some((pattern) => minimatch(path, pattern, { dot: true }));
}
function isMarkdown(path) {
    return path.toLowerCase().endsWith(".md");
}
