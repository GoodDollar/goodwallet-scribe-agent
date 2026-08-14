import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { loadConfig } from "./config.js";
describe("loadConfig", () => {
    test("returns defaults when .scribe.yml is missing", () => {
        const repoRoot = mkdtempSync(join(tmpdir(), "scribe-config-"));
        expect(loadConfig(repoRoot)).toEqual({
            include: ["**/*.md"],
            exclude: [
                "node_modules/**",
                "dist/**",
                "vendor/**",
                "coverage/**",
                ".git/**",
            ],
            maxFiles: 30,
            maxBytes: 200000,
            provider: "copilot",
            report: {
                summary: true,
                comment: true,
            },
        });
    });
    test("merges supported values from .scribe.yml", () => {
        const repoRoot = mkdtempSync(join(tmpdir(), "scribe-config-"));
        writeFileSync(join(repoRoot, ".scribe.yml"), [
            "include:",
            "  - docs/**/*.md",
            "exclude:",
            "  - archived/**",
            "maxFiles: 12",
            "maxBytes: 4096",
            "provider: local-ai",
            "report:",
            "  summary: false",
            "  comment: true",
            "",
        ].join("\n"));
        expect(loadConfig(repoRoot)).toEqual({
            include: ["docs/**/*.md"],
            exclude: ["archived/**"],
            maxFiles: 12,
            maxBytes: 4096,
            provider: "local-ai",
            report: {
                summary: false,
                comment: true,
            },
        });
    });
    test("loads configuration from an explicit path", () => {
        const repoRoot = mkdtempSync(join(tmpdir(), "scribe-config-"));
        const configPath = join(repoRoot, "config", "scribe.yml");
        mkdirSync(join(repoRoot, "config"), { recursive: true });
        writeFileSync(configPath, ["maxFiles: 7", "provider: copilot", ""].join("\n"));
        expect(loadConfig(repoRoot, { configPath: "config/scribe.yml" })).toMatchObject({
            maxFiles: 7,
            provider: "copilot",
        });
    });
    test("rejects unknown top-level keys", () => {
        const repoRoot = mkdtempSync(join(tmpdir(), "scribe-config-"));
        writeFileSync(join(repoRoot, ".scribe.yml"), "mystery: true\n");
        expect(() => loadConfig(repoRoot)).toThrow(/unknown config key: mystery/i);
    });
    test("rejects non-positive budgets with helpful errors", () => {
        const repoRoot = mkdtempSync(join(tmpdir(), "scribe-config-"));
        writeFileSync(join(repoRoot, ".scribe.yml"), ["maxFiles: 0", "maxBytes: -1", ""].join("\n"));
        expect(() => loadConfig(repoRoot)).toThrow(/maxFiles.*positive integer/i);
    });
});
