import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";
import { z } from "zod";

const reportSchema = z
  .object({
    summary: z.boolean().optional(),
    comment: z.boolean().optional(),
  })
  .strict();

const rawConfigSchema = z
  .object({
    include: z.array(z.string()).optional(),
    exclude: z.array(z.string()).optional(),
    maxFiles: z.number().int().positive("maxFiles must be a positive integer").optional(),
    maxBytes: z.number().int().positive("maxBytes must be a positive integer").optional(),
    provider: z.string().min(1, "provider must not be empty").optional(),
    report: reportSchema.optional(),
  })
  .strict();

export interface ScribeConfig {
  include: string[];
  exclude: string[];
  maxFiles: number;
  maxBytes: number;
  provider: string;
  report: {
    summary: boolean;
    comment: boolean;
  };
}

const DEFAULT_CONFIG: ScribeConfig = {
  include: ["**/*.md"],
  exclude: ["node_modules/**", "dist/**", "vendor/**", "coverage/**", ".git/**"],
  maxFiles: 30,
  maxBytes: 200000,
  provider: "copilot",
  report: {
    summary: true,
    comment: true,
  },
};

export function loadConfig(repoRoot: string): ScribeConfig {
  const configPath = join(repoRoot, ".scribe.yml");

  if (!existsSync(configPath)) {
    return structuredClone(DEFAULT_CONFIG);
  }

  const parsed = parseYaml(readFileSync(configPath, "utf8")) as unknown;
  const result = rawConfigSchema.safeParse(parsed ?? {});

  if (!result.success) {
    throw new Error(formatConfigError(result.error.issues));
  }

  return {
    include: result.data.include ?? DEFAULT_CONFIG.include,
    exclude: result.data.exclude ?? DEFAULT_CONFIG.exclude,
    maxFiles: result.data.maxFiles ?? DEFAULT_CONFIG.maxFiles,
    maxBytes: result.data.maxBytes ?? DEFAULT_CONFIG.maxBytes,
    provider: result.data.provider ?? DEFAULT_CONFIG.provider,
    report: {
      summary: result.data.report?.summary ?? DEFAULT_CONFIG.report.summary,
      comment: result.data.report?.comment ?? DEFAULT_CONFIG.report.comment,
    },
  };
}

function formatConfigError(issues: z.core.$ZodIssue[]): string {
  return issues
    .map((issue) => {
      if (issue.code == "unrecognized_keys") {
        const key = issue.keys[0] ?? "<unknown>";
        return `Unknown config key: ${key}`;
      }

      const path = issue.path.join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}
