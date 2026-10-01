import { describe, expect, it } from "vitest";
import { cloneDesign } from "../src/shared/model";
import { draftKey, readDraft, writeDraft } from "../src/shared/draft";

describe("local draft recovery", () => {
  it("restores a design and comparisons only for their owner", () => {
    const design = cloneDesign();
    design.name = "unfinished Tiny design";
    const raw = writeDraft("user-1", { design, snapshots: [cloneDesign()], lockConditions: false });
    expect(readDraft(raw, "user-1")?.design.name).toBe(design.name);
    expect(readDraft(raw, "user-1")?.lockConditions).toBe(false);
    expect(readDraft(raw, "user-2")).toBeNull();
    expect(draftKey("guest")).not.toBe(draftKey("user-1"));
  });
  it("does not restore malformed or invalid electrical designs", () => {
    expect(readDraft("{", "guest")).toBeNull();
    const bad = JSON.parse(writeDraft("guest", { design: cloneDesign(), snapshots: [], lockConditions: true }));
    bad.design.load.voltage = -2;
    expect(readDraft(JSON.stringify(bad), "guest")).toBeNull();
  });
});
