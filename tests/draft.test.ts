import { describe, expect, it } from "vitest";
import { cloneDesign } from "../src/shared/model";
import { checkDraftAccess, defaultDraftScope, draftKey, readDraft, writeDraft, type DraftCaseContext, type LocalDraft } from "../src/shared/draft";

const context: DraftCaseContext = { caseId: "case-1", expectedRevision: 3, parentRevision: "revision-3", intent: "edit", originalScope: "private" };
const draft = (): LocalDraft => ({ design: cloneDesign(), snapshots: [], lockConditions: true, intendedScope: "private", caseContext: context });
const server = { id: "case-1", latest_revision: 3, canEdit: true, scope: "private" as const };

describe("local draft recovery", () => {
  it("restores a design and comparisons only for their owner", () => {
    const design = cloneDesign();
    design.name = "unfinished Tiny design";
    const raw = writeDraft("user-1", { ...draft(), design, snapshots: [cloneDesign()], lockConditions: false });
    expect(readDraft(raw, "user-1")?.design.name).toBe(design.name);
    expect(readDraft(raw, "user-1")?.lockConditions).toBe(false);
    expect(readDraft(raw, "user-2")).toBeNull();
    expect(draftKey("guest")).not.toBe(draftKey("user-1"));
  });
  it("does not restore malformed or invalid electrical designs", () => {
    expect(readDraft("{", "guest")).toBeNull();
    const bad = JSON.parse(writeDraft("guest", draft()));
    bad.design.load.voltage = -2;
    expect(readDraft(JSON.stringify(bad), "guest")).toBeNull();
  });
  it("keeps case identity, revision, parent and explicit intended visibility", () => {
    const restored = readDraft(writeDraft("user-1", { ...draft(), intendedScope: "public" }), "user-1", "private")!;
    expect(restored.caseContext).toEqual(context);
    expect(restored.intendedScope).toBe("public");
    expect(restored.legacy).toBe(false);
    expect(readDraft(writeDraft("user-1", draft()), "guest")).toBeNull();
  });
  it("defaults employee creations/copies to personal space and guest/external to public", () => {
    expect(defaultDraftScope(true)).toBe("private");
    expect(defaultDraftScope(false)).toBe("public");
    expect(defaultDraftScope()).toBe("public");
  });
  it("migrates legacy designs without inventing a case association", () => {
    const raw = JSON.stringify({ version: 1, owner: "user-1", design: cloneDesign(), snapshots: [], lockConditions: false });
    const restored = readDraft(raw, "user-1", "private")!;
    expect(restored.caseContext).toBeNull();
    expect(restored.intendedScope).toBe("private");
    expect(restored.legacy).toBe(true);
    expect(JSON.parse(writeDraft("user-1", restored)).version).toBe(2);
  });
  it.each([
    { expectedRevision: 0 }, { expectedRevision: 1.2 }, { caseId: "" },
    { parentRevision: 42 }, { intent: "publish" }, { originalScope: "team" },
  ])("rejects malformed saved case metadata: %j", (invalid) => {
    const raw = JSON.parse(writeDraft("user-1", draft()));
    raw.caseContext = { ...raw.caseContext, ...invalid };
    expect(readDraft(JSON.stringify(raw), "user-1")).toBeNull();
  });
  it("rejects missing or invalid v2 intended visibility rather than guessing public", () => {
    const raw = JSON.parse(writeDraft("user-1", draft()));
    delete raw.intendedScope;
    expect(readDraft(JSON.stringify(raw), "user-1")).toBeNull();
    raw.intendedScope = "team";
    expect(readDraft(JSON.stringify(raw), "user-1")).toBeNull();
  });
  it("requires live case permission, identity, original scope, revision and parent", () => {
    expect(checkDraftAccess(context, server, [{ id: "revision-3" }])).toBe("ready");
    expect(checkDraftAccess(context, { ...server, id: "another-case" }, [{ id: "revision-3" }])).toBe("forbidden");
    expect(checkDraftAccess(context, { ...server, canEdit: false }, [{ id: "revision-3" }])).toBe("forbidden");
    expect(checkDraftAccess(context, { ...server, scope: "company" }, [{ id: "revision-3" }])).toBe("scope-changed");
    expect(checkDraftAccess(context, { ...server, latest_revision: 4 }, [{ id: "revision-3" }])).toBe("conflict");
    expect(context.expectedRevision).toBe(3);
    expect(checkDraftAccess(context, server, [])).toBe("parent-missing");
  });
  it("copies may retain a readable old parent without claiming edit permission", () => {
    const copied = { ...context, intent: "copy" as const };
    expect(checkDraftAccess(copied, { ...server, canEdit: false, latest_revision: 5 }, [{ id: "revision-3" }])).toBe("ready");
    expect(checkDraftAccess(copied, { ...server, canEdit: false, latest_revision: 5 }, [])).toBe("parent-missing");
  });
});
