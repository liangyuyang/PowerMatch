import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { app, type Env } from "../worker/index";
import { hash } from "../worker/security";
import { pinComponentEvidence } from "../worker/component-evidence";
import { changeMode, cloneDesign, type Component } from "../src/shared/model";
import { selectComponent } from "../src/shared/assistant";
import { fieldEvidenceSchema, validateFieldEvidence, type FieldEvidence } from "../src/shared/spec-evidence";
import { extractCandidates } from "../src/shared/spec-parser";
import { getDocumentProxy } from "unpdf";

vi.mock("unpdf", () => ({ getDocumentProxy: vi.fn() }));

let sqlite: DatabaseSync, env: Env, cookie: string;
let objects: Map<string, ArrayBuffer>;
const origin = "https://powermatch.zenmeasure.space";
const fileBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 42]);
const parameters = (capacityMah = 30) => ({ voltage: 1.5, capacityMah, minVoltage: 1.2 });
function field(capacityMah = 30, patch: Partial<FieldEvidence> = {}): FieldEvidence {
  return { parameter: "capacityMah", value: capacityMah, unit: "mAh", page: 2,
    excerpt: "Unverified fixture claim: capacity 30 mAh", conditions: "Fixture condition, not a measured result",
    method: "manual", ...patch };
}
function localD1(): D1Database {
  return {
    prepare(sql: string) {
      let args: (string | number | null)[] = [];
      const statement = {
        bind(...values: (string | number | null)[]) { args = values; return statement; },
        async first() { return sqlite.prepare(sql).get(...args) ?? null; },
        async all() { return { success: true, results: sqlite.prepare(sql).all(...args) }; },
        execute() { const result = sqlite.prepare(sql).run(...args); return { success: true, meta: { changes: Number(result.changes) } }; },
        async run() { return statement.execute(); },
      };
      return statement;
    },
    async batch(statements: { execute(): unknown }[]) {
      sqlite.exec("BEGIN");
      try { const results = statements.map(statement => statement.execute()); sqlite.exec("COMMIT"); return results; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  } as unknown as D1Database;
}
function request(path: string, data?: unknown) {
  return app.request(origin + path, { method: data ? "POST" : "GET", headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" }, body: data ? JSON.stringify(data) : undefined }, env);
}
async function parts(): Promise<Component[]> { return ((await (await request("/api/components")).json()) as { components: Component[] }).components; }
async function createPart() {
  const response = await request("/api/components", { name: "Evidence fixture cell", category: "battery", manufacturer: "Fixture", source: "https://example.test/spec", description: "Isolated unverified fixture", parameters: parameters(25) });
  expect(response.status).toBe(200);
  const { id } = await response.json() as { id: string };
  return (await parts()).find(component => component.id === id)!;
}
function upload(part: Component, evidence: unknown = [field()], proposed: unknown = parameters()) {
  const form = new FormData();
  form.set("parameters", JSON.stringify(proposed));
  form.set("fieldEvidence", JSON.stringify(evidence));
  // Only signature bytes: no real source text exists in this fixture. A file
  // digest proves byte identity, never that a claimed excerpt is truthful.
  form.set("file", new File([fileBytes], "unverified-fixture.png", { type: "image/png" }));
  return app.request(origin + "/api/components/" + part.id + "/specs", { method: "POST", headers: { Origin: origin, Cookie: cookie }, body: form }, env);
}
function review(spec: string, part: Component, value: number, evidence: unknown, revision = 0) {
  return request("/api/specs/" + spec + "/review", { action: "adopt", note: "Explicit fixture review; not source truth validation", parameters: parameters(value), fieldEvidence: evidence, expectedRevision: revision, expectedComponentVersion: part.version_id });
}
beforeEach(async () => {
  sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync(new URL("../worker/migrations/", import.meta.url)).filter(file => file.endsWith(".sql")).sort())
    sqlite.exec(readFileSync(new URL(`../worker/migrations/${file}`, import.meta.url), "utf8"));
  sqlite.prepare("INSERT INTO users(id,email,display_name) VALUES('employee','fixture@zenmeasure.com','Fixture')").run();
  sqlite.prepare("INSERT INTO sessions VALUES(?,?,?)").run(await hash("field-evidence-session"), "employee", Math.floor(Date.now() / 1000) + 3600);
  cookie = "pm_session=field-evidence-session";
  objects = new Map();
  env = { DB: localD1(), APP_ORIGIN: origin, ENVIRONMENT: "production", SPECS: {
    async put(key: string, value: ArrayBuffer) { objects.set(key, value); },
    async delete(key: string) { objects.delete(key); },
    async get(key: string) { return objects.has(key) ? { body: objects.get(key) } : null; },
  } } as unknown as Env;
  vi.stubGlobal("fetch", vi.fn(async () => { throw Error("external request forbidden in isolated evidence fixture"); }));
});
afterEach(() => { sqlite.close(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("source candidate normalization and page provenance", () => {
  it.each([
    ["quiescent current 25 nA", "iqUa", 0.025, "µA"],
    ["quiescent current 0.2 mA", "iqUa", 200, "µA"],
    ["leakage current 50 nA", "leakUa", 0.05, "µA"],
    ["leakage current 0.1 mA", "leakUa", 100, "µA"],
    ["nominal voltage 1500 mV", "voltage", 1.5, "V"],
    ["capacity 0.03 Ah", "capacityMah", 30, "mAh"],
    ["capacitor 25 mF", "farads", 0.025, "F"],
    ["capacitor 25 µF", "farads", 0.000025, "F"],
    ["capacitor 25 μF", "farads", 0.000025, "F"],
    ["capacitor 25 uF", "farads", 0.000025, "F"],
  ] as const)("normalizes %s into canonical calculator units", (text, parameter, value, unit) => {
    const candidates = extractCandidates(text, 7, "local-ocr");
    const candidate = candidates.find(item => item.parameter === parameter)!;
    expect(candidate).toBeDefined();
    expect(candidate.value).toBeCloseTo(value, 9);
    expect(candidate).toMatchObject({ unit, page: 7, method: "local-ocr", conditions: "" });
    expect(candidate.excerpt).toContain(text);
    expect(validateFieldEvidence([candidate], { [parameter]: candidate.value })).toEqual([candidate]);
  });
  it("preserves absent page metadata and caps each extraction at 80 candidates", () => {
    expect(extractCandidates("3 V")[0]).toMatchObject({ page: null, method: "pdf-text", value: 3, unit: "V" });
    const candidates = extractCandidates(Array.from({ length: 120 }, (_, i) => `${i + 1} mAh`).join("\n"), 4);
    expect(candidates).toHaveLength(80);
    expect(candidates[79]).toMatchObject({ value: 80, page: 4, unit: "mAh" });
  });
  it.each(["quiescent current 20 NA", "quiescent current 20 MA", "quiescent current -20 nA", "nominal voltage -3 V", "capacity −200 mAh", "quiescent current .5 mA", "voltage 1,500 mV", "capacity 0,03 Ah", "quiescent current 1e3 mA", "capacity 20 MAh"])("does not turn unsupported casing, numeric syntax or negative source values into positive candidates: %s", text => {
    expect(extractCandidates(text)).toEqual([]);
  });

  function mockDocument(pages: string[]) {
    const cleanup = vi.fn(), destroy = vi.fn();
    const getPage = vi.fn(async (page: number) => ({ getTextContent: async () => ({ items: [{ str: pages[page - 1] }] }), cleanup }));
    vi.mocked(getDocumentProxy).mockResolvedValue({ numPages: pages.length, getPage, loadingTask: { destroy } } as any);
    return { getPage, cleanup, destroy };
  }
  function extractPDF() {
    const form = new FormData();
    form.set("file", new File(["%PDF-1.7\nIsolated fixture"], "fixture.pdf", { type: "application/pdf" }));
    return app.request(origin + "/api/specs/extract", { method: "POST", headers: { Origin: origin, Cookie: cookie }, body: form }, env);
  }
  it("retains actual source page numbers across an extracted PDF and cleans parser resources", async () => {
    const pdf = mockDocument(["capacity 0.03 Ah", "quiescent current 25 nA"]);
    const response = await extractPDF();
    expect(response.status).toBe(200);
    const result = await response.json() as any;
    expect(result).toMatchObject({ pages: 2, ocrRequired: false });
    expect(result.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ parameter: "capacityMah", value: 30, unit: "mAh", page: 1, method: "pdf-text" }),
      expect.objectContaining({ parameter: "iqUa", value: 0.025, unit: "µA", page: 2, method: "pdf-text" }),
    ]));
    expect(pdf.cleanup).toHaveBeenCalledTimes(2);
    expect(pdf.destroy).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("caps all PDF pages together at 80 candidates and never reads further pages", async () => {
    const pdf = mockDocument(["1 mAh ".repeat(60), "2 mAh ".repeat(60), "3 mAh"]);
    const response = await extractPDF();
    expect(response.status).toBe(200);
    const result = await response.json() as any;
    expect(result.candidates).toHaveLength(80);
    expect(result.candidates.filter((field: any) => field.page === 1)).toHaveLength(60);
    expect(result.candidates.filter((field: any) => field.page === 2)).toHaveLength(20);
    expect(pdf.getPage).toHaveBeenCalledTimes(2);
    expect(pdf.destroy).toHaveBeenCalledOnce();
  });
  it("rejects an oversized page count and destroys the parser without reading pages", async () => {
    const pdf = mockDocument(Array.from({ length: 21 }, () => "1 V"));
    expect((await extractPDF()).status).toBe(400);
    expect(pdf.getPage).not.toHaveBeenCalled();
    expect(pdf.destroy).toHaveBeenCalledOnce();
  });
});

describe("field evidence validation", () => {
  it("preserves source page, method, conditions and canonical values without certifying excerpt truth", () => {
    const claim = field(30, { excerpt: "Unverified arbitrary text; digest is not content authentication" });
    expect(validateFieldEvidence([claim], parameters())).toEqual([claim]);
    expect(validateFieldEvidence(undefined, parameters())).toEqual([]);
    expect(validateFieldEvidence([field(30, { page: null, method: "local-ocr" })], parameters())[0].page).toBeNull();
  });
  it.each([
    [field(31)], [field(30, { value: "30" })], [field(30, { parameter: "unknownField" })],
    [field(), field()], [field(30, { unit: "Ah" })],
  ])("rejects duplicate, missing, different or unconverted values/units", (...evidence) => {
    expect(() => validateFieldEvidence(evidence, parameters())).toThrow();
  });
  it.each([0, -1, 1.5, 10001])("rejects invalid source page %s", page => {
    expect(fieldEvidenceSchema.safeParse(field(30, { page })).success).toBe(false);
  });
});

describe("immutable upload, review and design field evidence", () => {
  it("stores original upload fields and only binds the file digest to submitted bytes", async () => {
    const part = await createPart();
    const response = await upload(part);
    expect(response.status).toBe(200);
    const { id } = await response.json() as { id: string };
    const original = sqlite.prepare("SELECT * FROM specs WHERE id=?").get(id)!;
    expect(JSON.parse(String(original.field_evidence_json))).toEqual([field()]);
    expect(JSON.parse(String(original.proposed_json))).toEqual(parameters());
    expect(original.sha256).toBe(await hash(fileBytes.buffer));
    expect(original.status).toBe("submitted");
    // The same unverified fixture bytes and manual claim cannot automatically
    // mark a component as reviewed/adopted merely because SHA-256 is present.
    expect((await parts()).find(component => component.id === part.id)?.verified).toBeFalsy();
    expect(original.review_revision).toBe(0);
    expect(objects.size).toBe(1);
    expect(() => sqlite.prepare("UPDATE specs SET field_evidence_json='[]' WHERE id=?").run(id)).toThrow("immutable-original-spec");
    expect(() => sqlite.prepare("UPDATE specs SET proposed_json='{}' WHERE id=?").run(id)).toThrow("immutable-original-spec");
    const list = await (await request("/api/components/" + part.id + "/specs")).json() as any;
    expect(JSON.parse(list.specs[0].field_evidence_json)).toEqual([field()]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["value", "unit"])("rejects mismatched upload %s before storing a file or Spec row", async kind => {
    const part = await createPart();
    const evidence = kind === "value" ? field(31) : field(30, { unit: "Ah" });
    expect((await upload(part, [evidence])).status).toBe(400);
    expect(sqlite.prepare("SELECT COUNT(*) count FROM specs").get()!.count).toBe(0);
    expect(objects.size).toBe(0);
  });

  it.each(["value", "unit"])("rejects mismatched review %s without appending or moving the component head", async kind => {
    const part = await createPart();
    const { id } = await (await upload(part)).json() as { id: string };
    const evidence = kind === "value" ? field(999) : field(32, { unit: "Ah" });
    expect((await review(id, part, 32, [evidence])).status).toBe(400);
    expect(sqlite.prepare("SELECT COUNT(*) count FROM spec_reviews").get()!.count).toBe(0);
    expect(sqlite.prepare("SELECT review_revision FROM specs WHERE id=?").get(id)!.review_revision).toBe(0);
    expect((await parts()).find(component => component.id === part.id)?.version_id).toBe(part.version_id);
  });

  it("keeps original fields and every reviewed snapshot through adoption, repinning and case persistence", async () => {
    const part = await createPart();
    const { id } = await (await upload(part)).json() as { id: string };
    const original = sqlite.prepare("SELECT proposed_json,field_evidence_json,sha256 FROM specs WHERE id=?").get(id)!;
    const reviewed = field(32, { excerpt: "Reviewed fixture claim: 32 mAh", page: 3, conditions: "Reviewer-entered conditions" });
    expect((await review(id, part, 32, [reviewed])).status).toBe(200);
    const adopted = (await parts()).find(component => component.id === part.id)!;
    const selected = selectComponent(changeMode(cloneDesign(), "battery"), adopted);
    const pinned = await pinComponentEvidence(env.DB, selected);
    expect(pinned.componentEvidence!.storage!.fieldEvidence).toEqual([reviewed]);
    expect(pinned.componentEvidence!.storage!.specSha256).toBe(original.sha256);
    expect(pinned.componentEvidence!.storage!.reviewRevision).toBe(1);
    const later = field(35, { excerpt: "Later reviewer-entered fixture", method: "local-ocr", page: 4 });
    expect((await review(id, adopted, 35, [later], 1)).status).toBe(200);
    expect(sqlite.prepare("SELECT proposed_json,field_evidence_json,sha256 FROM specs WHERE id=?").get(id)).toEqual(original);
    const reviews = (await (await request("/api/specs/" + id + "/reviews")).json() as any).reviews;
    expect(reviews.map((row: any) => row.revision)).toEqual([2, 1]);
    expect(JSON.parse(reviews[1].field_evidence_json)).toEqual([reviewed]);
    expect(JSON.parse(reviews[0].field_evidence_json)).toEqual([later]);
    expect(() => sqlite.prepare("UPDATE spec_reviews SET field_evidence_json='[]'").run()).toThrow("immutable-spec-review");
    expect((await pinComponentEvidence(env.DB, pinned)).componentEvidence!.storage!.fieldEvidence).toEqual([reviewed]);
    const current = (await parts()).find(component => component.id === part.id)!;
    const modern = await pinComponentEvidence(env.DB, selectComponent(pinned, current));
    expect(modern.componentEvidence!.storage!.fieldEvidence).toEqual([later]);
    expect(modern.componentEvidence!.storage!.parameters.capacityMah).toBe(35);
    // Pinning must replace client evidence, including a valid-shaped forgery.
    pinned.componentEvidence!.storage!.fieldEvidence = [field(32, { excerpt: "forged client evidence" })];
    const saved = await request("/api/cases", { name: pinned.name, scope: "private", design: pinned });
    expect(saved.status).toBe(200);
    const savedId = (await saved.json() as { id: string }).id;
    const detail = await (await request("/api/cases/" + savedId)).json() as any;
    expect(detail.revisions[0].design.componentEvidence.storage.fieldEvidence).toEqual([reviewed]);
    expect(detail.revisions[0].design.componentEvidence.storage.parameters.capacityMah).toBe(32);
    expect(fetch).not.toHaveBeenCalled();
  });
});
