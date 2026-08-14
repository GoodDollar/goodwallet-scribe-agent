import { loadConfig, type ScribeConfig } from "./core/config.js";
import { collectBoundedContexts, type PrimaryDocumentContext } from "./core/context.js";
import type { Finding } from "./core/findings.js";
import { discoverGitChanges, selectPrimaryDocuments, type GitChange } from "./core/git-changes.js";
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
  const changes = discoverGitChanges(options.repoRoot, options.baseRef, options.headRef);
  const primaryDocuments = selectPrimaryDocuments(changes, config);
  const contexts = collectBoundedContexts({
    repoRoot: options.repoRoot,
    baseRef: options.baseRef,
    headRef: options.headRef,
    primaryDocuments,
    allChanges: changes,
    config,
  });
  const deterministicFindings = checkLocalLinks(options.repoRoot, collectPrimaryHeadDocuments(contexts));

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
  const availableProviders: Record<string, Provider> = {
    copilot: createCopilotCliProvider({ cwd: repoRoot }),
    ...providers,
  };
  const provider = availableProviders[providerName];

  if (!provider) {
    throw new Error(`Unsupported provider: ${providerName}`);
  }

  return provider;
}

function collectPrimaryHeadDocuments(contexts: PrimaryDocumentContext[]): MarkdownDocument[] {
  const documents: MarkdownDocument[] = [];

  for (const context of contexts) {
    for (const document of context.documents) {
      if (document.kind === "primary-head") {
        documents.push({ path: document.path, content: document.content });
      }
    }
  }

  return documents;
}
