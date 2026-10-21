import { z } from "zod";
import { designSchema, type Design, type Scope } from "./model";

const scopeSchema = z.enum(["public", "company", "private"]);
const contextSchema = z.object({
  caseId: z.string().min(1).max(100),
  expectedRevision: z.number().int().positive(),
  parentRevision: z.string().min(1).max(100).nullable(),
  intent: z.enum(["edit", "copy"]),
  originalScope: scopeSchema,
});
export type DraftCaseContext = z.infer<typeof contextSchema>;

export interface LocalDraft {
  design: Design;
  snapshots: Design[];
  lockConditions: boolean;
  intendedScope: Scope;
  caseContext: DraftCaseContext | null;
  legacy?: boolean;
}

export const defaultDraftScope = (employee = false): Scope => employee ? "private" : "public";

export function draftKey(owner: string) {
  return `powermatch-draft-v1:${owner}`;
}

export function readDraft(raw: string | null, owner: string, fallbackScope: Scope = "public"): LocalDraft | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (![1, 2].includes(data.version) || data.owner !== owner || !Array.isArray(data.snapshots)) return null;
    const design = designSchema.safeParse(data.design);
    const snapshots = data.snapshots.slice(-3).map((item: unknown) => designSchema.safeParse(item));
    const scope = scopeSchema.safeParse(data.version === 1 ? fallbackScope : data.intendedScope);
    const context = data.version === 1 || data.caseContext === null
      ? null : contextSchema.safeParse(data.caseContext);
    if (!design.success || !scope.success || context && !context.success || snapshots.some((item: { success: boolean }) => !item.success)) return null;
    return {
      design: design.data,
      snapshots: snapshots.map((item: { data: Design }) => item.data),
      lockConditions: data.lockConditions !== false,
      intendedScope: scope.data,
      caseContext: context?.success ? context.data : null,
      legacy: data.version === 1,
    };
  } catch {
    return null;
  }
}

export function writeDraft(owner: string, { legacy: _legacy, ...draft }: LocalDraft) {
  return JSON.stringify({ version: 2, owner, ...draft });
}

export type DraftAccess = "ready" | "forbidden" | "conflict" | "scope-changed" | "parent-missing";
// Keep the saved expected revision: replacing it would silently overwrite newer work.
export function checkDraftAccess(context: DraftCaseContext, server: {
  id: string; canEdit: boolean; latest_revision: number; scope: Scope;
}, revisions: { id: string }[]): DraftAccess {
  if (server.id !== context.caseId || context.intent === "edit" && !server.canEdit) return "forbidden";
  if (server.scope !== context.originalScope) return "scope-changed";
  if (context.intent === "edit" && server.latest_revision !== context.expectedRevision) return "conflict";
  if (context.parentRevision && !revisions.some((revision) => revision.id === context.parentRevision)) return "parent-missing";
  return "ready";
}
