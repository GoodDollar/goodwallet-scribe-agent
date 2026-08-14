import { loadConfig } from "./core/config.js";
import { collectBoundedContexts } from "./core/context.js";
import { discoverGitChanges, resolveMergeBase, selectPrimaryDocuments } from "./core/git-changes.js";
import { readGitTextFile } from "./core/git-text.js";
import { checkLocalLinks } from "./core/local-links.js";
import { createCopilotCliProvider } from "./providers/copilot.js";
export async function runScribeReview(options) {
    const config = loadConfig(options.repoRoot, options.configPath ? { configPath: options.configPath } : {});
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
function resolveProvider(providerName, providers, repoRoot) {
    const configuredProvider = providers?.[providerName];
    if (configuredProvider) {
        return configuredProvider;
    }
    if (providerName === "copilot") {
        return createCopilotCliProvider({ cwd: repoRoot });
    }
    throw new Error(`Unsupported provider: ${providerName}`);
}
function readPrimaryHeadDocuments(repoRoot, headRef, primaryDocuments) {
    const documents = [];
    for (const primaryDocument of primaryDocuments) {
        const content = readGitTextFile(repoRoot, headRef, primaryDocument.path);
        if (content !== undefined) {
            documents.push({ path: primaryDocument.path, content });
        }
    }
    return documents;
}
