import { describe, expect, test } from "vitest";

import type { PullRequestCommentClient } from "./github.js";
import { upsertPullRequestComment, writeJobSummary } from "./github.js";

function createBaseClient(): PullRequestCommentClient {
  return {
    rest: {
      issues: {
        listComments: () => Promise.resolve({ data: [] }),
        updateComment: () => Promise.resolve({ data: {} }),
        createComment: () => Promise.resolve({ data: {} }),
      },
    },
  };
}

describe("writeJobSummary", () => {
  test("writes the markdown report through the summary writer", async () => {
    const calls: string[] = [];
    const writer = {
      addRaw(markdown: string) {
        calls.push(markdown);
        return this;
      },
      write: () => {
        calls.push("written");
        return Promise.resolve();
      },
    };

    await writeJobSummary("# Report", writer);

    expect(calls).toEqual(["# Report", "written"]);
  });
});

describe("upsertPullRequestComment", () => {
  test("updates a marker comment found on a later comments page", async () => {
    const pages: number[] = [];
    const events: string[] = [];
    const github: PullRequestCommentClient = {
      rest: {
        issues: {
          ...createBaseClient().rest.issues,
          listComments: ({ page, per_page }) => {
            pages.push(page);
            expect(per_page).toBe(100);
            if (page === 1) {
              return Promise.resolve({
                data: Array.from({ length: 100 }, (_, index) => ({ id: index + 1, body: "comment " + String(index + 1) })),
              });
            }

            if (page === 2) {
              return Promise.resolve({
                data: [
                  { id: 201, body: "<!-- goodwallet-scribe-agent -->\nold", user: { type: "User" } },
                ],
              });
            }

            return Promise.resolve({ data: [] });
          },
          updateComment: ({ body }) => {
            events.push(body);
            return Promise.resolve({ data: { html_url: "https://example.com/comment/201" } });
          },
          createComment: () => Promise.reject(new Error("should not create")),
        },
      },
    };

    const result = await upsertPullRequestComment({
      github,
      owner: "goodwallet",
      repo: "scribe",
      issueNumber: 3,
      body: "fresh report",
    });

    expect(pages).toEqual([1, 2]);
    expect(events).toHaveLength(1);
    expect(result).toEqual({
      mode: "comment",
      warning: undefined,
      url: "https://example.com/comment/201",
    });
  });

  test("updates an existing marker comment regardless of user type", async () => {
    const events: string[] = [];
    const github: PullRequestCommentClient = {
      rest: {
        issues: {
          ...createBaseClient().rest.issues,
          listComments: () => Promise.resolve({
            data: [
              { id: 7, body: "<!-- goodwallet-scribe-agent -->\nold" },
            ],
          }),
          updateComment: ({ body }) => {
            events.push(body);
            return Promise.resolve({ data: { html_url: "https://example.com/comment/7" } });
          },
          createComment: () => Promise.reject(new Error("should not create")),
        },
      },
    };

    const result = await upsertPullRequestComment({
      github,
      owner: "goodwallet",
      repo: "scribe",
      issueNumber: 3,
      body: "fresh report",
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toContain("<!-- goodwallet-scribe-agent -->");
    expect(events[0]).toContain("fresh report");
    expect(result).toEqual({
      mode: "comment",
      warning: undefined,
      url: "https://example.com/comment/7",
    });
  });

  test("returns a summary-only fallback on comment permission errors", async () => {
    const github: PullRequestCommentClient = {
      rest: {
        issues: {
          ...createBaseClient().rest.issues,
          createComment: () => {
            const error = new Error("forbidden") as Error & { status?: number };
            error.status = 403;
            return Promise.reject(error);
          },
        },
      },
    };

    const result = await upsertPullRequestComment({
      github,
      owner: "goodwallet",
      repo: "scribe",
      issueNumber: 3,
      body: "fresh report",
    });

    expect(result.mode).toBe("summary-only");
    expect(result.warning).toMatch(/403/i);
  });

  test("rethrows non-permission API failures", async () => {
    const github: PullRequestCommentClient = {
      rest: {
        issues: {
          ...createBaseClient().rest.issues,
          listComments: () => {
            const error = new Error("boom") as Error & { status?: number };
            error.status = 500;
            return Promise.reject(error);
          },
        },
      },
    };

    await expect(
      upsertPullRequestComment({
        github,
        owner: "goodwallet",
        repo: "scribe",
        issueNumber: 3,
        body: "fresh report",
      }),
    ).rejects.toThrow(/boom/i);
  });
});
