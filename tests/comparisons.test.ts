import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { Hono } from "hono";
import { registerComparisons } from "../worker/comparisons";
import { cloneDesign, type Viewer } from "../src/shared/model";
import type { Env } from "../worker/index";
import { comparisonUrl } from "../src/shared/comparisons";
import { readDraft, writeDraft } from "../src/shared/draft";
let sql: DatabaseSync, env: Env;
const employee = { id: "employee", employee: true, admin: false } as Viewer;
const coworker = { id: "coworker", employee: true, admin: false } as Viewer;
const outsider = { id: "outsider", employee: false, admin: false } as Viewer;
function database(): D1Database {
  return {
    prepare(query: string) {
      let args: any[] = [];
      const statement = {
        bind(...values: any[]) {
          args = values;
          return statement;
        },
        async first() {
          return sql.prepare(query).get(...args) ?? null;
        },
        async all() {
          return { results: sql.prepare(query).all(...args), success: true };
        },
        execute() {
          return {
            success: true,
            meta: { changes: Number(sql.prepare(query).run(...args).changes) },
          };
        },
        async run() {
          return statement.execute();
        },
      };
      return statement;
    },
    async batch(statements: any[]) {
      sql.exec("BEGIN");
      try {
        const results = statements.map((s) => s.execute());
        sql.exec("COMMIT");
        return results;
      } catch (e) {
        sql.exec("ROLLBACK");
        throw e;
      }
    },
  } as unknown as D1Database;
}
function app(user: Viewer | null = employee, guestHash = "guest-one") {
  const app = new Hono<{
    Bindings: Env;
    Variables: { user: Viewer | null; guestHash: string };
  }>();
  app.use("*", async (c, next) => {
    c.set("user", user);
    c.set("guestHash", guestHash);
    await next();
  });
  registerComparisons(app);
  return app;
}
const input = (overrides: any = {}) => ({
  requestId: crypto.randomUUID(),
  expectedActor: "employee",
  name: "Test collection",
  scope: "private",
  locked: true,
  snapshots: [
    { design: cloneDesign() },
    { design: { ...cloneDesign(), name: "Alternative" } },
  ],
  ...overrides,
});
async function request(
  data: any,
  user: Viewer | null = employee,
  guest = "guest-one",
) {
  return app(user, guest).request(
    "https://test/api/comparisons",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    },
    env,
  );
}
async function detail(
  id: string,
  user: Viewer | null = employee,
  revision?: number,
  guest = "guest-one",
) {
  return app(user, guest).request(
    "https://test/api/comparisons/" +
      id +
      (revision ? "?revision=" + revision : ""),
    {},
    env,
  );
}
async function create(data = input(), user: Viewer | null = employee) {
  const r = await request(data, user);
  expect(r.status).toBe(200);
  return ((await r.json()) as any).comparison;
}
function source(scope = "private") {
  sql
    .prepare("INSERT INTO cases(id,owner_id,name,scope) VALUES(?,?,?,?)")
    .run("source", "employee", "Original", scope);
  sql
    .prepare(
      "INSERT INTO revisions(id,case_id,number,design_json,engine_version,scope) VALUES(?,?,1,?,?,?)",
    )
    .run(
      "source-revision",
      "source",
      JSON.stringify(cloneDesign()),
      "historic-engine",
      scope,
    );
}
beforeEach(() => {
  sql = new DatabaseSync(":memory:");
  for (const name of readdirSync(
    new URL("../worker/migrations/", import.meta.url),
  )
    .filter((n) => n.endsWith(".sql"))
    .sort())
    sql.exec(
      readFileSync(
        new URL("../worker/migrations/" + name, import.meta.url),
        "utf8",
      ),
    );
  for (const id of ["employee", "coworker", "outsider"])
    sql
      .prepare("INSERT INTO users(id,email,display_name) VALUES(?,?,?)")
      .run(id, id + "@example.test", id);
  env = { DB: database() } as Env;
});
afterEach(() => sql.close());
describe("cloud comparison collections", () => {
  it("binds list and detail reads to the expected actor before querying private data", async () => {
    const saved = await create();
    for (const path of [
      "/api/comparisons?scope=mine",
      "/api/comparisons/" + saved.id,
    ]) {
      const response = await app(coworker).request(
        "https://test" + path,
        { headers: { "X-PowerMatch-Actor": "employee" } },
        env,
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "identity-conflict" });
    }
  });
  it("validates invalid input, session, actor and guest/nonemployee visibility", async () => {
    expect(
      (await request(input({ snapshots: [{ design: cloneDesign() }] }))).status,
    ).toBe(400);
    expect(
      (
        await request(
          input({ snapshots: Array(5).fill({ design: cloneDesign() }) }),
        )
      ).status,
    ).toBe(400);
    expect((await request(input({ locked: "yes" }))).status).toBe(400);
    expect((await request(input({ id: "missing" }))).status).toBe(400);
    expect((await request(input({ expectedActor: "coworker" }))).status).toBe(
      409,
    );
    expect(
      (
        await request(
          input({ expectedActor: "guest", scope: "public" }),
          null,
          "",
        )
      ).status,
    ).toBe(401);
    expect(
      (await request(input({ expectedActor: "guest" }), null)).status,
    ).toBe(403);
    expect(
      (
        await request(
          input({ expectedActor: "outsider", scope: "company" }),
          outsider,
        )
      ).status,
    ).toBe(403);
    const r = await request(
      input({ expectedActor: "guest", scope: "public" }),
      null,
    );
    expect(r.status).toBe(200);
    const c = ((await r.json()) as any).comparison;
    expect(c.canEdit).toBe(true);
    expect((await detail(c.id, null, undefined, "other-guest")).status).toBe(
      200,
    );
    expect(
      (
        await request(
          input({
            id: c.id,
            expectedRevision: 1,
            expectedActor: "guest",
            scope: "public",
          }),
          null,
          "other-guest",
        )
      ).status,
    ).toBe(404);
  });
  it("guards list/detail and historical revision using both current and revision scopes", async () => {
    const privateCase = await create(),
      company = await create(input({ scope: "company" })),
      publicCase = await create(input({ scope: "public" }));
    expect((await detail(privateCase.id, coworker)).status).toBe(404);
    expect((await detail(privateCase.id, null)).status).toBe(404);
    expect((await detail(company.id, coworker)).status).toBe(200);
    expect((await detail(company.id, outsider)).status).toBe(404);
    expect((await detail(publicCase.id, null)).status).toBe(200);
    const mine = await app(null, "unrelated").request(
      "https://test/api/comparisons?scope=mine",
      {},
      env,
    );
    expect(((await mine.json()) as any).comparisons).toHaveLength(0);
    expect(
      (
        await app(outsider).request(
          "https://test/api/comparisons?scope=private",
          {},
          env,
        )
      ).status,
    ).toBe(403);
    expect(
      (await app().request("https://test/api/comparisons?limit=-1", {}, env))
        .status,
    ).toBe(400);
    await create(input({ id: publicCase.id, expectedRevision: 1 }));
    expect((await detail(publicCase.id, null, 1)).status).toBe(404);
    await create(
      input({ id: privateCase.id, expectedRevision: 1, scope: "public" }),
    );
    expect((await detail(privateCase.id, null, 1)).status).toBe(404);
    expect((await detail(privateCase.id, null, 2)).status).toBe(200);
  });
  it("pins actual immutable source JSON and engine, rejects inaccessible or widened references", async () => {
    source("private");
    const body = input({
      snapshots: [
        { design: cloneDesign(), sourceRevision: "source-revision" },
        { design: cloneDesign() },
      ],
    });
    expect((await request({ ...body, scope: "public" })).status).toBe(400);
    expect((await request({ ...body, scope: "company" })).status).toBe(400);
    expect(
      (await request({ ...body, expectedActor: "coworker" }, coworker)).status,
    ).toBe(404);
    const changed = structuredClone(body);
    changed.snapshots[0].design.light.lux = 300;
    expect((await request(changed)).status).toBe(400);
    const saved = await create(body);
    expect(saved.snapshots[0]).toMatchObject({
      engineVersion: "historic-engine",
      provenance: "revision",
      sourceRevision: "source-revision",
      design: cloneDesign(),
    });
    expect(saved.snapshots[1]).toMatchObject({
      provenance: "legacy-unknown",
      sourceRevision: null,
      design: { componentEvidence: {} },
    });
    expect(() =>
      sql.prepare("UPDATE comparison_revisions SET name='tampered'").run(),
    ).toThrow("immutable-comparison-revision");
    expect(() => sql.prepare("DELETE FROM comparison_revisions").run()).toThrow(
      "immutable-comparison-revision",
    );
    sql.prepare("UPDATE cases SET deleted=1 WHERE id=?").run("source");
    expect((await detail(saved.id)).status).toBe(404);
    expect(
      (
        (await (
          await app().request(
            "https://test/api/comparisons?scope=mine",
            {},
            env,
          )
        ).json()) as any
      ).comparisons,
    ).toHaveLength(0);
  });
  it("rechecks a source that becomes private after an initially public copied collection", async () => {
    source("public");
    const saved = await create(
      input({
        scope: "public",
        snapshots: [
          { design: cloneDesign(), sourceRevision: "source-revision" },
          { design: cloneDesign() },
        ],
      }),
    );
    expect((await detail(saved.id, null)).status).toBe(200);
    sql.prepare("UPDATE cases SET scope='private' WHERE id='source'").run();
    expect((await detail(saved.id, null)).status).toBe(404);
    expect((await detail(saved.id)).status).toBe(200);
    expect((await detail(saved.id, coworker)).status).toBe(404);
  });
  it("canonicalizes forged component metadata and rejects mismatched component version IDs", async () => {
    const row = sql
      .prepare(
        "SELECT id,component_id,snapshot_json FROM component_versions LIMIT 1",
      )
      .get() as any;
    const design = cloneDesign();
    design.pv.componentId = row.component_id;
    design.componentVersions = { pv: row.id };
    design.componentEvidence = {
      pv: {
        ...JSON.parse(row.snapshot_json),
        name: "forged",
        versionId: row.id,
        recordedAt: "forged",
        origin: "forged",
      },
    };
    const saved = await create(
      input({ snapshots: [{ design }, { design: cloneDesign() }] }),
    );
    expect(saved.snapshots[0].design.componentEvidence.pv.name).not.toBe(
      "forged",
    );
    expect(saved.snapshots[0].provenance).toBe("versioned-draft");
    design.pv.componentId = "wrong";
    expect(
      (
        await request(
          input({ snapshots: [{ design }, { design: cloneDesign() }] }),
        )
      ).status,
    ).toBe(400);
  });
  it("allows one concurrent writer and binds idempotent retries to original revision and request contents", async () => {
    const body = input(),
      first = await create(body),
      replay = await create(body);
    expect(replay.id).toBe(first.id);
    expect(
      (await request({ ...body, name: "Changed using same request ID" }))
        .status,
    ).toBe(409);
    const left = input({ id: first.id, expectedRevision: 1, name: "Left" }),
      right = input({ id: first.id, expectedRevision: 1, name: "Right" });
    const results = await Promise.all([request(left), request(right)]);
    expect(results.map((x) => x.status).sort()).toEqual([200, 409]);
    const winner = results[0].status === 200 ? left : right;
    const retried = await create(winner);
    expect(retried.revision).toBe(2);
    const third = await create(
      input({
        id: first.id,
        expectedRevision: 2,
        name: "Third",
        locked: false,
      }),
    );
    expect(third.revision).toBe(3);
    const oldRetry = await create(winner);
    expect(oldRetry.revision).toBe(2);
    expect(oldRetry.name).toBe(winner.name);
    expect((await request({ ...winner, expectedRevision: 3 })).status).toBe(
      409,
    );
    const head = ((await (await detail(first.id)).json()) as any).comparison;
    expect(head.revision).toBe(3);
    expect(head.locked).toBe(false);
    expect(
      (sql.prepare("SELECT count(*) n FROM comparison_revisions").get() as any)
        .n,
    ).toBe(3);
  });
  it("persists the original draft association without inheriting URL credentials", () => {
    const draft = {
      design: cloneDesign(),
      snapshots: [cloneDesign()],
      lockConditions: false,
      intendedScope: "private" as const,
      caseContext: null,
      comparisonContext: {
        id: "collection",
        expectedRevision: 2,
        originalScope: "private" as const,
      },
    };
    expect(
      readDraft(writeDraft("employee", draft), "employee")?.comparisonContext,
    ).toEqual(draft.comparisonContext);
    const url = new URL(
      comparisonUrl(
        new URL("https://test/?token=secret&case=old&messages=1#private"),
        "collection",
        2,
      ),
    );
    expect(url.search).toBe(
      "?page=compare&comparison=collection&comparisonRevision=2",
    );
    expect(url.hash).toBe("");
  });
});
