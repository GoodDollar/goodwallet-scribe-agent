import { describe, expect, test } from "vitest";

import type { Finding } from "./core/findings.js";
import type { PullRequestCommentClient } from "./github.js";
import { upsertPullRequestComment, writeJobSummary } from "./github.js";
import { renderMarkdownReport } from "./report.js";

const TRUNCATION_NOTICE = "The report was truncated because it exceeded GitHub's comment size limit.";

/** Asserts every renderer-produced code span on the line is opened and closed by the same fence. */
function expectBalancedCodeSpans(body: string): void {
  for (const line of body.split("\n")) {
    const labelled = /^(?:Location|Evidence|Explanation|Suggestion|Source): (.*)$/.exec(line);
    if (!labelled) {
      expect(line).not.toContain("`");
      continue;
    }

    const value = String(labelled[1]);
    const fence = /^`+/.exec(value)?.[0];
    expect(fence, `line has no opening fence: ${line.slice(0, 80)}`).toBeDefined();

    const fenceLength = String(fence).length;
    expect(value.endsWith(String(fence)), `unbalanced code span: ${line.slice(0, 80)}`).toBe(true);
    expect(value.length).toBeGreaterThanOrEqual(fenceLength * 2 + 1);

    const inner = value.slice(fenceLength, value.length - fenceLength);
    const longestInnerRun = [...inner.matchAll(/`+/g)].reduce((longest, match) => Math.max(longest, match[0].length), 0);
    expect(longestInnerRun).toBeLessThan(fenceLength);
  }
}

function createAttackerFinding(index: number): Finding {
  const payload = `![pwn](https://evil.example/x.png) <!-- injected --> \`backticks\` \`\`wider\`\` #${String(index)} `;

  return {
    category: "quality",
    severity: "warning",
    confidence: 0.5,
    evidence: payload + `E${String(index)}`.repeat(400),
    file: `docs/attack-${String(index)}.md`,
    line: index + 1,
    explanation: payload + `X${String(index)}`.repeat(400),
    suggestion: payload + `S${String(index)}`.repeat(400),
    source: "agent",
  };
}

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

  test("truncates an oversized body below the GitHub comment limit with an explicit notice", async () => {
    const bodies: string[] = [];
    const github: PullRequestCommentClient = {
      rest: {
        issues: {
          ...createBaseClient().rest.issues,
          createComment: ({ body }) => {
            bodies.push(body);
            return Promise.resolve({ data: { html_url: "https://example.com/comment/9" } });
          },
        },
      },
    };

    await upsertPullRequestComment({
      github,
      owner: "goodwallet",
      repo: "scribe",
      issueNumber: 3,
      body: "# Report\n" + "finding line\n".repeat(9000),
    });

    expect(bodies).toHaveLength(1);
    const body = String(bodies[0]);
    expect(body.length).toBeLessThanOrEqual(65_536);
    expect(body.length).toBeGreaterThan(65_000);
    expect(body).toContain("<!-- goodwallet-scribe-agent -->");
    expect(body).toContain("# Report");
    expect(body.endsWith("The report was truncated because it exceeded GitHub's comment size limit.")).toBe(true);
  });

  test("truncates an adversarial report only at line boundaries, keeping code spans balanced", async () => {
    const bodies: string[] = [];
    const github: PullRequestCommentClient = {
      rest: {
        issues: {
          ...createBaseClient().rest.issues,
          createComment: ({ body }) => {
            bodies.push(body);
            return Promise.resolve({ data: {} });
          },
        },
      },
    };

    const report = renderMarkdownReport(Array.from({ length: 30 }, (_, index) => createAttackerFinding(index)));
    const untruncated = `<!-- goodwallet-scribe-agent -->\n${report}`;
    expect(untruncated.length).toBeGreaterThan(65_536);

    await upsertPullRequestComment({
      github,
      owner: "goodwallet",
      repo: "scribe",
      issueNumber: 3,
      body: report,
    });

    const body = String(bodies[0]);
    const suffix = `\n\n${TRUNCATION_NOTICE}`;
    const kept = body.slice(0, body.length - suffix.length);

    expect(body.length).toBeLessThanOrEqual(65_536);
    expect(body.endsWith(suffix)).toBe(true);
    expect(body).toContain("<!-- goodwallet-scribe-agent -->");
    expect(body).toContain("# Goodwallet Scribe Report");

    // The kept text must be a whole-line prefix of the untruncated body: no sliced report content.
    expect(untruncated.startsWith(kept)).toBe(true);
    expect(untruncated[kept.length]).toBe("\n");
    expectBalancedCodeSpans(kept);

    // Truncation happened mid-finding, so the cut fell inside what would have been a code span line.
    const droppedLine = untruncated.slice(kept.length + 1).split("\n")[0] ?? "";
    expect(droppedLine).toMatch(/^(?:Evidence|Explanation|Suggestion|Location|Source): /);
    expect(body).not.toContain(droppedLine);
  });

  test("omits a whole line that cannot fit rather than slicing it", async () => {
    const bodies: string[] = [];
    const github: PullRequestCommentClient = {
      rest: {
        issues: {
          ...createBaseClient().rest.issues,
          createComment: ({ body }) => {
            bodies.push(body);
            return Promise.resolve({ data: {} });
          },
        },
      },
    };

    const oversizedLine = `Evidence: \`${"O".repeat(70_000)}\``;

    await upsertPullRequestComment({
      github,
      owner: "goodwallet",
      repo: "scribe",
      issueNumber: 3,
      body: `# Goodwallet Scribe Report\n${oversizedLine}\n`,
    });

    const body = String(bodies[0]);

    expect(body.length).toBeLessThanOrEqual(65_536);
    expect(body).toBe(
      `<!-- goodwallet-scribe-agent -->\n# Goodwallet Scribe Report\n\n${TRUNCATION_NOTICE}`,
    );
    expect(body).not.toContain("OOO");
  });

  test("leaves a body that fits the comment limit untouched", async () => {
    const bodies: string[] = [];
    const github: PullRequestCommentClient = {
      rest: {
        issues: {
          ...createBaseClient().rest.issues,
          createComment: ({ body }) => {
            bodies.push(body);
            return Promise.resolve({ data: {} });
          },
        },
      },
    };

    await upsertPullRequestComment({
      github,
      owner: "goodwallet",
      repo: "scribe",
      issueNumber: 3,
      body: "short report",
    });

    expect(bodies).toEqual(["<!-- goodwallet-scribe-agent -->\nshort report"]);
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
