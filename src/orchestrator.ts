import { loadConfig, type ScribeConfig } from "./core/config.js";
import { collectBoundedContexts, type PrimaryDocumentContext } from "./core/context.js";
import type { Finding } from "./core/findings.js";
import { discoverGitChanges, resolveMergeBase, selectPrimaryDocuments, type GitChange } from "./core/git-changes.js";
import { readGitTextFile } from "./core/git-text.js";
import { checkLocalLinks, type MarkdownDocument } from "./core/local-links.js";
import { createCopilotCliProvider } from "./providers/copilot.js";
import type { Provider } from "./providers/index.js";

export interface RunScribeReviewOptions {
  repoRoot: string;
  baseRef: string;
  headRef: string;
  configPath?: string;
  providerName?: string;
  providers?: Record<string, Provider>;
}

export interface ScribeReviewResult {
  config: ScribeConfig;
  providerName: string;
  changes: GitChange[];
  primaryDocuments: GitChange[];
  contexts: PrimaryDocumentContext[];
  deterministicFindings: Finding[];
  agentFindings: Finding[];
  findings: Finding[];
}

export async function runScribeReview(options: RunScribeReviewOptions): Promise<ScribeReviewResult> {
  const config = loadConfig(
    options.repoRoot,
    options.configPath ? { configPath: options.configPath } : {},
  );
  const providerName = options.providerName ?? config.provider;
  const mergeBase = resolveMergeBase(options.repoRoot, options.baseRef, options.headRef);
  const changes = discoverGitChanges(options.repoRoot, mergeBase, options.headRef);
  const primaryDocuments = selectPrimaryDocuments(changes, config);
  const contexts = collectBoundedContexts({
    repoRoot: options.repoRoot,
    baseRef: mergeBase,
    headRef: options.headRef,
    primaryDocuments,
    allChanges: changes,
    config,
  });
  const deterministicFindings = checkLocalLinks({
    repoRoot: options.repoRoot,
    headRef: options.headRef,
    documents: readPrimaryHeadDocuments(options.repoRoot, options.headRef, primaryDocuments),
  });

  if (primaryDocuments.length === 0) {
    return {
      config,
      providerName,
      changes,
      primaryDocuments,
      contexts,
      deterministicFindings,
      agentFindings: [],
      findings: deterministicFindings,
    };
  }

  const provider = resolveProvider(providerName, options.providers, options.repoRoot);
  const agentFindings = await provider.review({ contexts });

  return {
    config,
    providerName,
    changes,
    primaryDocuments,
    contexts,
    deterministicFindings,
    agentFindings,
    findings: [...deterministicFindings, ...agentFindings],
  };
}

function resolveProvider(
  providerName: string,
  providers: Record<string, Provider> | undefined,
  repoRoot: string,
): Provider {
  const configuredProvider = providers?.[providerName];
  if (configuredProvider) {
    return configuredProvider;
  }

  if (providerName === "copilot") {
    return createCopilotCliProvider({ cwd: repoRoot });
  }

  throw new Error(`Unsupported provider: ${providerName}`);
}

function readPrimaryHeadDocuments(repoRoot: string, headRef: string, primaryDocuments: GitChange[]): MarkdownDocument[] {
  const documents: MarkdownDocument[] = [];

  for (const primaryDocument of primaryDocuments) {
    const content = readGitTextFile(repoRoot, headRef, primaryDocument.path);
    if (content !== undefined) {
      documents.push({ path: primaryDocument.path, content });
    }
  }

  return documents;
}
