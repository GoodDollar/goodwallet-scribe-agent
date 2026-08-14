import { describe, expect, test } from "vitest";
import { runCli } from "./cli.js";
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
        findings: [],
    };
}
describe("runCli", () => {
    test("renders the markdown report to stdout and exits zero for advisory findings", async () => {
        const stdout = [];
        const stderr = [];
        const calls = [];
        const exitCode = await runCli(["--base", "origin/main", "--head", "HEAD", "--config", "config/scribe.yml", "--provider", "copilot"], {
            cwd: "/repo",
            writeStdout: (value) => {
                stdout.push(value);
            },
            writeStderr: (value) => {
                stderr.push(value);
            },
            runReview: (options) => {
                calls.push(options);
                return Promise.resolve({
                    ...createReviewResult(),
                    findings: [
                        {
                            category: "quality",
                            severity: "warning",
                            confidence: 0.6,
                            evidence: "Vague heading",
                            file: "docs/guide.md",
                            line: 1,
                            explanation: "The title is too generic.",
                            suggestion: "Rename the heading.",
                            source: "agent",
                        },
                    ],
                });
            },
            renderReport: () => "# Report\n",
        });
        expect(exitCode).toBe(0);
        expect(stdout.join("")).toBe("# Report\n");
        expect(stderr).toEqual([]);
        expect(calls).toEqual([
            {
                repoRoot: "/repo",
                baseRef: "origin/main",
                headRef: "HEAD",
                configPath: "config/scribe.yml",
                providerName: "copilot",
            },
        ]);
    });
    test("returns a nonzero exit code for technical errors", async () => {
        const stderr = [];
        const exitCode = await runCli(["--base", "origin/main", "--head", "HEAD"], {
            cwd: "/repo",
            writeStdout: () => { },
            writeStderr: (value) => {
                stderr.push(value);
            },
            runReview: () => Promise.reject(new Error("config exploded")),
            renderReport: () => "unused",
        });
        expect(exitCode).toBe(1);
        expect(stderr.join("")).toMatch(/config exploded/i);
    });
});
