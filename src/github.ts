import { summary } from "@actions/core";

const COMMENT_MARKER = "<!-- goodwallet-scribe-agent -->";
const COMMENTS_PAGE_SIZE = 100;
const MAX_COMMENT_BODY_LENGTH = 65_536;
const TRUNCATION_NOTICE = "\n\nThe report was truncated because it exceeded GitHub's comment size limit.";

export interface SummaryWriter {
  addRaw(markdown: string): SummaryWriter;
  write(): Promise<unknown>;
}

export interface PullRequestCommentClient {
  rest: {
    issues: {
      listComments(params: {
        owner: string;
        repo: string;
        issue_number: number;
        per_page: number;
        page: number;
      }): Promise<{
        data: Array<{
          id: number;
          body?: string | null;
          user?: {
            type?: string;
          };
        }>;
      }>;
      updateComment(params: {
        owner: string;
        repo: string;
        comment_id: number;
        body: string;
      }): Promise<{ data: { html_url?: string } }>;
      createComment(params: {
        owner: string;
        repo: string;
        issue_number: number;
        body: string;
      }): Promise<{ data: { html_url?: string } }>;
    };
  };
}

export interface UpsertPullRequestCommentParams {
  github: PullRequestCommentClient;
  owner: string;
  repo: string;
  issueNumber: number;
  body: string;
}

export interface PullRequestCommentResult {
  mode: "comment" | "summary-only";
  warning: string | undefined;
  url: string | undefined;
}

export async function writeJobSummary(markdown: string, writer: SummaryWriter = summary): Promise<void> {
  writer.addRaw(markdown);
  await writer.write();
}

export async function upsertPullRequestComment(
  params: UpsertPullRequestCommentParams,
): Promise<PullRequestCommentResult> {
  const commentBody = capCommentBody(`${COMMENT_MARKER}\n${params.body}`);

  try {
    const existingComment = await findExistingMarkerComment(params);

    if (existingComment) {
      const response = await params.github.rest.issues.updateComment({
        owner: params.owner,
        repo: params.repo,
        comment_id: existingComment.id,
        body: commentBody,
      });

      return {
        mode: "comment",
        warning: undefined,
        url: response.data.html_url,
      };
    }

    const response = await params.github.rest.issues.createComment({
      owner: params.owner,
      repo: params.repo,
      issue_number: params.issueNumber,
      body: commentBody,
    });

    return {
      mode: "comment",
      warning: undefined,
      url: response.data.html_url,
    };
  } catch (error) {
    const status = getErrorStatus(error);
    if (status === 403 || status === 404) {
      return {
        mode: "summary-only",
        warning: `PR comment skipped because the GitHub API returned ${String(status)}.`,
        url: undefined,
      };
    }

    throw error;
  }
}

/**
 * Keeps the comment within GitHub's body limit, replacing the dropped tail with a visible notice.
 *
 * Truncation happens only at complete line boundaries. The report renders each finding value as a
 * one-line code span, so cutting mid-line could leave an unbalanced span and let attacker-influenced
 * text escape into Markdown; a line that does not fit whole is dropped entirely instead of sliced.
 */
function capCommentBody(body: string): string {
  if (body.length <= MAX_COMMENT_BODY_LENGTH) {
    return body;
  }

  const budget = MAX_COMMENT_BODY_LENGTH - TRUNCATION_NOTICE.length;
  let kept = "";

  for (const line of body.split("\n")) {
    const candidate = kept.length === 0 ? line : `${kept}\n${line}`;
    if (candidate.length > budget) {
      break;
    }

    kept = candidate;
  }

  return kept + TRUNCATION_NOTICE;
}

async function findExistingMarkerComment(
  params: UpsertPullRequestCommentParams,
): Promise<{ id: number } | undefined> {
  for (let page = 1; ; page += 1) {
    const response = await params.github.rest.issues.listComments({
      owner: params.owner,
      repo: params.repo,
      issue_number: params.issueNumber,
      per_page: COMMENTS_PAGE_SIZE,
      page,
    });
    const existingComment = response.data.find((comment) => comment.body?.includes(COMMENT_MARKER));

    if (existingComment) {
      return { id: existingComment.id };
    }

    if (response.data.length < COMMENTS_PAGE_SIZE) {
      return undefined;
    }
  }
}

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error === "object" && error && "status" in error && typeof error.status === "number") {
    return error.status;
  }

  return undefined;
}
