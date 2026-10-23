import { z } from "zod";
import { designSchema, type Scope } from "./model";

export const comparisonSnapshotSchema = z.object({
  design: designSchema,
  sourceRevision: z.string().min(1).max(100).nullable().optional(),
});
export const comparisonWriteSchema = z
  .object({
    id: z.string().min(1).max(100).optional(),
    expectedRevision: z.number().int().positive().optional(),
    expectedActor: z.string().min(1).max(100),
    requestId: z.string().uuid(),
    name: z.string().trim().min(1).max(100),
    scope: z.enum(["private", "company", "public"]),
    locked: z.boolean(),
    snapshots: z.array(comparisonSnapshotSchema).min(2).max(4),
  })
  .refine(
    (x) => !!x.id === !!x.expectedRevision,
    "comparison-revision-required",
  );
export type ComparisonSnapshot = z.infer<typeof comparisonSnapshotSchema> & {
  engineVersion?: string;
  provenance?: "revision" | "versioned-draft" | "legacy-unknown";
};
export const comparisonContextSchema = z.object({
  id: z.string().min(1).max(100),
  expectedRevision: z.number().int().positive(),
  originalScope: z.enum(["private", "company", "public"]),
});
export type ComparisonContext = z.infer<typeof comparisonContextSchema>;
export interface ComparisonDetail {
  id: string;
  name: string;
  scope: Scope;
  latest_revision: number;
  revision: number;
  canEdit: boolean;
  locked: boolean;
  snapshots: ComparisonSnapshot[];
  created_at: string;
}
// Sort object keys for stable comparisons independent of JSON property order.
export function comparisonFingerprint(value: unknown): string {
  if (Array.isArray(value))
    return "[" + value.map(comparisonFingerprint).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + comparisonFingerprint(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value) ?? "null";
}
export function comparisonUrl(url: URL, id: string, revision?: number) {
  const next = new URL(url.origin + url.pathname);
  next.searchParams.set("page", "compare");
  next.searchParams.set("comparison", id);
  if (revision) next.searchParams.set("comparisonRevision", String(revision));
  return next.href;
}
