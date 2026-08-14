import { describe, expect, test } from "vitest";
import { runAction } from "./index.js";
function createReviewResult() {
    return {
        config: {
            include: ["**/*.md"],
            exclude: [],
            maxFiles: 30,
            maxBytes: 200000,
            provider: "copilot",
            report: {
                summary: true,
                comment: true,
            },
        },
        providerName: "copilot",
        changes: [],
        primaryDocuments: [],
        contexts: [],
        deterministicFindings: [],
        agentFindings: [],
        findings: [
            {
                category: "quality",
                severity: "warning",
                confidence: 0.5,
                evidence: "Vague title",
                file: "docs/guide.md",
                line: 1,
                explanation: "The title is too generic.",
                suggestion: "Use a specific heading.",
                source: "agent",
            },
        ],
    };
}
function createGithubClient() {
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
describe("runAction", () => {
    test("infers refs and PR number from pull_request payload and reports advisory findings", async () => {
        const events = [];
        const calls = [];
        const githubClient = createGithubClient();
        await runAction({
            cwd: "/repo",
            getInput: (name) => ({
                provider: "",
                config: "",
                base: "",
                head: "",
                "github-token": "secret-token",
            })[name] ?? "",
            setFailed: (message) => {
                events.push(`failed:${message}`);
            },
            warning: (message) => {
                events.push(`warning:${message}`);
            },
            githubContext: {
                repo: { owner: "goodwallet", repo: "scribe" },
                payload: {
                    pull_request: {
                        number: 14,
                        base: { sha: "base-sha" },
                        head: { sha: "head-sha" },
                    },
                },
            },
            createGithubClient: (token) => {
                calls.push({ token });
                return githubClient;
            },
            runReview: (options) => {
                calls.push(options);
                return Promise.resolve(createReviewResult());
            },
            renderReport: () => "# Report\n",
            writeSummary: (markdown) => {
                events.push(`summary:${markdown}`);
                return Promise.resolve();
            },
            upsertComment: (params) => {
                calls.push(params);
                return Promise.resolve({ mode: "comment", warning: undefined, url: "https://example.com/comment/1" });
            },
        });
        expect(events).toEqual(["summary:# Report\n"]);
        expect(calls).toEqual([
            {
                repoRoot: "/repo",
                baseRef: "base-sha",
                headRef: "head-sha",
            },
            { token: "secret-token" },
            {
                github: githubClient,
                owner: "goodwallet",
                repo: "scribe",
                issueNumber: 14,
                body: "# Report\n",
            },
        ]);
    });
    test("calls setFailed for technical errors only", async () => {
        const failures = [];
        await runAction({
            cwd: "/repo",
            getInput: (name) => ({ base: "base-sha", head: "head-sha" })[name] ?? "",
            setFailed: (message) => {
                failures.push(message);
            },
            warning: () => { },
            githubContext: {
                repo: { owner: "goodwallet", repo: "scribe" },
                payload: {},
            },
            createGithubClient: () => createGithubClient(),
            runReview: () => Promise.reject(new Error("copilot unavailable")),
            renderReport: () => "unused",
            writeSummary: () => Promise.resolve(),
            upsertComment: () => Promise.resolve({ mode: "comment", warning: undefined, url: undefined }),
        });
        expect(failures).toEqual(["copilot unavailable"]);
    });
});
