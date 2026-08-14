import { z } from "zod";

export const findingSchema = z
  .object({
    category: z.enum(["contradiction", "stale-reference", "broken-link", "quality", "duplicate"]),
    severity: z.enum(["info", "warning", "error"]),
    confidence: z.number().min(0).max(1),
    evidence: z.string().min(1),
    file: z.string().min(1),
    line: z.number().int().positive(),
    explanation: z.string().min(1),
    suggestion: z.string().min(1),
    source: z.enum(["deterministic", "agent"]),
  })
  .strict();

export type Finding = z.infer<typeof findingSchema>;

const findingsResponseSchema = z
  .object({
    findings: z.array(findingSchema),
  })
  .strict();

export type FindingsResponse = z.infer<typeof findingsResponseSchema>;

export function parseProviderFindingsResponse(responseText: string): FindingsResponse {
  const jsonText = unwrapJsonFence(responseText.trim());
  const parsed = JSON.parse(jsonText) as unknown;
  return findingsResponseSchema.parse(parsed);
}

function unwrapJsonFence(text: string): string {
  const match = text.match(/^```json\s*([\s\S]*?)\s*```$/);
  return match?.[1] ?? text;
}
