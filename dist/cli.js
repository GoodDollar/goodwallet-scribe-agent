#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { runScribeReview } from "./orchestrator.js";
import { renderMarkdownReport } from "./report.js";
export async function runCli(argv, dependencies = {}) {
    const resolvedDependencies = {
        cwd: dependencies.cwd ?? process.cwd(),
        writeStdout: dependencies.writeStdout ?? ((value) => process.stdout.write(value)),
        writeStderr: dependencies.writeStderr ?? ((value) => process.stderr.write(value)),
        runReview: dependencies.runReview ?? runScribeReview,
        renderReport: dependencies.renderReport ?? renderMarkdownReport,
    };
    try {
        const parsed = parseArgs(argv);
        const reviewOptions = {
            repoRoot: resolvedDependencies.cwd,
            baseRef: parsed.baseRef,
            headRef: parsed.headRef,
            ...(parsed.configPath ? { configPath: parsed.configPath } : {}),
            ...(parsed.providerName ? { providerName: parsed.providerName } : {}),
        };
        const result = await resolvedDependencies.runReview(reviewOptions);
        const report = resolvedDependencies.renderReport(result.findings);
        resolvedDependencies.writeStdout(report);
        return 0;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        resolvedDependencies.writeStderr(`${message}\n`);
        return 1;
    }
}
function parseArgs(argv) {
    let baseRef;
    let headRef;
    let configPath;
    let providerName;
    for (let index = 0; index < argv.length; index += 1) {
        const current = argv[index];
        if (!current) {
            continue;
        }
        const next = argv[index + 1];
        switch (current) {
            case "--base":
                baseRef = requireValue(current, next);
                index += 1;
                break;
            case "--head":
                headRef = requireValue(current, next);
                index += 1;
                break;
            case "--config":
                configPath = requireValue(current, next);
                index += 1;
                break;
            case "--provider":
                providerName = requireValue(current, next);
                index += 1;
                break;
            default:
                throw new Error(`Unknown CLI argument: ${current}`);
        }
    }
    if (!baseRef || !headRef) {
        throw new Error("Both --base and --head are required.");
    }
    return {
        baseRef,
        headRef,
        ...(configPath ? { configPath } : {}),
        ...(providerName ? { providerName } : {}),
    };
}
function requireValue(flag, value) {
    if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${flag}`);
    }
    return value;
}
async function main() {
    process.exitCode = await runCli(process.argv.slice(2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    void main();
}
