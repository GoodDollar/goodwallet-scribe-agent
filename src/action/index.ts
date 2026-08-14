import { getInput, setFailed, warning } from "@actions/core";
import { context, getOctokit } from "@actions/github";
import { pathToFileURL } from "node:url";

import {
  upsertPullRequestComment,
  writeJobSummary,
  type PullRequestCommentClient,
  type PullRequestCommentResult,
} from "../github.js";
import { runScribeReview, type RunScribeReviewOptions, type ScribeReviewResult } from "../orchestrator.js";
import { renderMarkdownReport } from "../report.js";

export interface ActionContext {
  repo: {
    owner: string;
    repo: string;
  };
  payload: {
    pull_request?: {
      number?: number;
      base?: {
        sha?: string;
      };
      head?: {
        sha?: string;
      };
    };
  };
}

export interface ActionDependencies {
  cwd: string;
  getInput: (name: string) => string;
  setFailed: (message: string) => void;
  warning: (message: string) => void;
  githubContext: ActionContext;
  createGithubClient: (token: string) => PullRequestCommentClient;
  runReview: (options: RunScribeReviewOptions) => Promise<ScribeReviewResult>;
  renderReport: (findings: ScribeReviewResult["findings"]) => string;
  writeSummary: (markdown: string) => Promise<void>;
  upsertComment: (params: {
    github: PullRequestCommentClient;
    owner: string;
    repo: string;
    issueNumber: number;
    body: string;
  }) => Promise<PullRequestCommentResult>;
}

export async function runAction(overrides: Partial<ActionDependencies> = {}): Promise<void> {
  const dependencies = resolveDependencies(overrides);

  try {
    const providerInput = dependencies.getInput("provider").trim();
    const configInput = dependencies.getInput("config").trim();
    const baseInput = dependencies.getInput("base").trim();
    const headInput = dependencies.getInput("head").trim();
    const tokenInput = dependencies.getInput("github-token").trim();
    const pullRequest = dependencies.githubContext.payload.pull_request;
    const baseRef = baseInput || pullRequest?.base?.sha;
    const headRef = headInput || pullRequest?.head?.sha;

    if (!baseRef || !headRef) {
      throw new Error("Unable to determine base and head refs for the review.");
    }

    const reviewOptions: RunScribeReviewOptions = {
      repoRoot: dependencies.cwd,
      baseRef,
      headRef,
      ...(configInput ? { configPath: configInput } : {}),
      ...(providerInput ? { providerName: providerInput } : {}),
    };
    const result = await dependencies.runReview(reviewOptions);
    const report = dependencies.renderReport(result.findings);

    if (result.config.report.summary) {
      await dependencies.writeSummary(report);
    }

    if (result.config.report.comment && pullRequest?.number) {
      const githubClient = dependencies.createGithubClient(tokenInput);
      const commentResult = await dependencies.upsertComment({
        github: githubClient,
        owner: dependencies.githubContext.repo.owner,
        repo: dependencies.githubContext.repo.repo,
        issueNumber: pullRequest.number,
        body: report,
      });

      if (commentResult.warning) {
        dependencies.warning(commentResult.warning);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dependencies.setFailed(message);
  }
}

function resolveDependencies(overrides: Partial<ActionDependencies>): ActionDependencies {
  return {
    cwd: overrides.cwd ?? process.cwd(),
    getInput: overrides.getInput ?? getInput,
    setFailed: overrides.setFailed ?? setFailed,
    warning: overrides.warning ?? warning,
    githubContext: overrides.githubContext ?? {
      repo: context.repo,
      payload: context.payload,
    },
    createGithubClient: overrides.createGithubClient ?? ((token) => getOctokit(token) as PullRequestCommentClient),
    runReview: overrides.runReview ?? runScribeReview,
    renderReport: overrides.renderReport ?? renderMarkdownReport,
    writeSummary: overrides.writeSummary ?? writeJobSummary,
    upsertComment: overrides.upsertComment ?? upsertPullRequestComment,
  };
}

async function main(): Promise<void> {
  await runAction();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
