import { summary } from "@actions/core";
const COMMENT_MARKER = "<!-- goodwallet-scribe-agent -->";
const COMMENTS_PAGE_SIZE = 100;
export async function writeJobSummary(markdown, writer = summary) {
    writer.addRaw(markdown);
    await writer.write();
}
export async function upsertPullRequestComment(params) {
    const commentBody = `${COMMENT_MARKER}\n${params.body}`;
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
    }
    catch (error) {
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
async function findExistingMarkerComment(params) {
    for (let page = 1;; page += 1) {
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
function getErrorStatus(error) {
    if (typeof error === "object" && error && "status" in error && typeof error.status === "number") {
        return error.status;
    }
    return undefined;
}
