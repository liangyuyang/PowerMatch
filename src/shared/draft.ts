import { designSchema, type Design } from "./model";

export interface LocalDraft {
  design: Design;
  snapshots: Design[];
  lockConditions: boolean;
}

export function draftKey(owner: string) {
  return `powermatch-draft-v1:${owner}`;
}

export function readDraft(raw: string | null, owner: string): LocalDraft | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (data.version !== 1 || data.owner !== owner || !Array.isArray(data.snapshots)) return null;
    const design = designSchema.safeParse(data.design);
    const snapshots = data.snapshots.slice(-3).map((item: unknown) => designSchema.safeParse(item));
    if (!design.success || snapshots.some((item: { success: boolean }) => !item.success)) return null;
    return {
      design: design.data,
      snapshots: snapshots.map((item: { data: Design }) => item.data),
      lockConditions: data.lockConditions !== false,
    };
  } catch {
    return null;
  }
}

export function writeDraft(owner: string, draft: LocalDraft) {
  return JSON.stringify({ version: 1, owner, ...draft });
}
