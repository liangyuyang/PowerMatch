import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { invoke, modelConfigSchema, registerAI } from "../worker/ai";
import { aiRecoveryStats, recoverExpiredAIInvocations } from "../worker/ai-recovery";
import type { Env } from "../worker/index";
import type { Viewer } from "../src/shared/model";

let sqlite: DatabaseSync;
let env: Env;
const user = { id: "ai-user", employee: true, admin: true, email: "ai-user@zenmeasure.com", name: "AI test" } as unknown as Viewer;
const config = modelConfigSchema.parse({ provider: "deepseek", name: "test", model: "test-model", inputPrice: 2, outputPrice: 8, currency: "USD" });
const row = { id: "model", config_json: JSON.stringify(config), enabled: 1, is_default: 1, health: "ok", checked_at: null, revision: 1 };
const payload = (content = '{"ok":true}') => ({ choices: [{ message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 25 } });
const consume = vi.fn((x: unknown) => x);
function localD1(database: DatabaseSync) {
  return {
    async batch(statements: { run(): Promise<unknown> }[]) { return Promise.all(statements.map(s => s.run())); },
    prepare(sql: string) {
      let args: (string | number | null)[] = [];
      const statement = {
        bind(...values: (string | number | null)[]) { args = values; return statement; },
        async first() { return database.prepare(sql).get(...args) ?? null; },
        async all() { return { results: database.prepare(sql).all(...args), success: true }; },
        async run() { return { success: true, meta: { changes: Number(database.prepare(sql).run(...args).changes) } }; },
      };
      return statement;
    },
  } as unknown as D1Database;
}
const last = () => sqlite.prepare("SELECT * FROM ai_invocations ORDER BY rowid DESC LIMIT 1").get()!;
function authenticatedApp(viewer: Viewer | null) {
  const app = new Hono<{ Bindings: Env; Variables: { user: Viewer | null; guestHash: string } }>();
  app.use("*", async (c, next) => { c.set("user", viewer); await next(); });
  registerAI(app);
  return app;
}
beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  for (const file of ["0001_initial", "0004_ai", "0005_ai_billing", "0006_ai_diagnostics", "0012_ai_recovery", "0013_ai_budgets"])
    sqlite.exec(readFileSync(new URL(`../worker/migrations/${file}.sql`, import.meta.url), "utf8"));
  sqlite.prepare("INSERT INTO users(id,email,display_name) VALUES(?,?,'AI test')").run(user.id, user.email);
  sqlite.prepare("INSERT INTO ai_models(id,config_json,enabled,is_default,health) VALUES('model',?,1,1,'ok')").run(row.config_json);
  sqlite.prepare("UPDATE ai_settings SET settings_json=?").run('{"usdToCny":7}');
  env = { DB: localD1(sqlite), POWERMATCH_AI_DEEPSEEK_KEY: "fake-test-key" } as Env;
  consume.mockClear();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(payload())));
});
afterEach(() => { sqlite.close(); vi.unstubAllGlobals(); });

describe("provider accounting survives failed content", () => {
  it.each(["invalid-json", "truncated", "missing", "schema"])("persists usage and prices for %s", async kind => {
    const response = payload(kind === "invalid-json" ? "not json" : '{"ok":true}');
    if (kind === "truncated") Object.assign(response.choices[0], { finish_reason: "length" });
    if (kind === "missing") Object.assign(response.choices[0].message, { content: null });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(response)));
    const result = await invoke(env, user, row, "design", [], kind === "schema" ? () => { throw Error("invalid-schema"); } : consume);
    expect(result.status).toBe(502);
    const stored = last();
    expect(stored.status).toBe("failed");
    expect(stored.user_id).toBe(user.id);
    expect(stored.input_tokens).toBe(100);
    expect(stored.output_tokens).toBe(25);
    expect(stored.estimated_cost).toBeCloseTo(0.0004);
    expect(stored.cost_cny).toBeCloseTo(0.0028);
    expect(JSON.parse(String(stored.price_snapshot))).toMatchObject({ inputPrice: 2, outputPrice: 8, usdToCny: 7 });
    expect(stored.completed_at).toBeTruthy();
    if (kind !== "schema") expect(consume).not.toHaveBeenCalled();
  });
  it.each(["http", "business"])("keeps known usage on %s rejection", async kind => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...payload(), ...(kind === "business" ? { base_resp: { status_code: 1001, status_msg: "rejected" } } : {}) }, { status: kind === "http" ? 429 : 200 })));
    expect((await invoke(env, user, row, "design", [], consume)).status).toBe(502);
    expect(last().input_tokens).toBe(100);
    expect(last().estimated_cost).toBeCloseTo(0.0004);
  });
  it("keeps missing usage and Token Plan cost unknown, with immutable invocation price snapshot", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("broken envelope")));
    await invoke(env, user, row, "design", [], consume);
    expect(last().input_tokens).toBeNull(); expect(last().estimated_cost).toBeNull(); expect(last().cost_cny).toBeNull();
    expect(last().price_snapshot).toBeTruthy();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(payload())));
    const planRow = { ...row, config_json: JSON.stringify({ ...config, billingMode: "plan", planFee: 99 }) };
    sqlite.prepare("UPDATE ai_models SET config_json=? WHERE id='model'").run(planRow.config_json);
    await invoke(env, user, planRow, "design", [], consume);
    expect(last().input_tokens).toBe(100); expect(last().estimated_cost).toBeNull(); expect(last().cost_cny).toBeNull();
    expect(JSON.parse(String(last().price_snapshot))).toMatchObject({ billingMode: "plan", planFee: 99 });
  });
  it("logs a missing-key failure without inventing zero/request charges", async () => {
    env.POWERMATCH_AI_DEEPSEEK_KEY = undefined;
    const requestRow = { ...row, config_json: JSON.stringify({ ...config, billingMode: "request", requestPrice: 1 }) };
    sqlite.prepare("UPDATE ai_models SET config_json=? WHERE id='model'").run(requestRow.config_json);
    const result = await invoke(env, user, requestRow, "health", [], consume);
    expect(result.status).toBe(503); expect(last().estimated_cost).toBeNull(); expect(last().price_snapshot).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("leases and bounded reservations", () => {
  it("recovers only expired pending calls without retry or replacing attribution/accounting", async () => {
    sqlite.prepare("INSERT INTO ai_invocations(id,user_id,model_id,model_name,provider,purpose,lease_expires_at,input_tokens,output_tokens,estimated_cost,price_snapshot) VALUES('expired',?,'m','m','deepseek','design',datetime('now','-1 second'),100,25,0.4,'snapshot')").run(user.id);
    sqlite.prepare("INSERT INTO ai_invocations(id,user_id,model_id,model_name,provider,purpose,lease_expires_at) VALUES('live',?,'m','m','deepseek','health',datetime('now','+1 minute'))").run(user.id);
    const result = await recoverExpiredAIInvocations(env.DB);
    expect(result.recovered).toBe(1); expect(result.automaticRetry).toBe(false);
    expect((await recoverExpiredAIInvocations(env.DB)).recovered).toBe(0);
    const stored = sqlite.prepare("SELECT * FROM ai_invocations WHERE id='expired'").get()!;
    expect(stored).toMatchObject({ status: "failed", user_id: user.id, input_tokens: 100, output_tokens: 25, estimated_cost: 0.4, price_snapshot: "snapshot", recovery_state: "closed-without-retry" });
    expect(await aiRecoveryStats(env.DB)).toMatchObject({ active: 1, recovered: 1, failures_with_known_usage: 1 });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("fences late business completion while preserving the late known accounting", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.stubGlobal("fetch", vi.fn(async () => { await gate; return Response.json(payload()); }));
    const call = invoke(env, user, row, "design", [], consume);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    sqlite.prepare("UPDATE ai_invocations SET lease_expires_at=datetime('now','-1 second')").run();
    expect((await recoverExpiredAIInvocations(env.DB)).recovered).toBe(1);
    release();
    expect((await call).status).toBe(409);
    expect(last()).toMatchObject({ status: "failed", error_code: "ai-lease-expired", recovery_state: "closed-without-retry", input_tokens: 100, output_tokens: 25 });
    expect(last().estimated_cost).toBeCloseTo(0.0004);
    expect(consume).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("reserves no more than two simultaneous calls per user", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.stubGlobal("fetch", vi.fn(async () => { await gate; return Response.json(payload()); }));
    const calls = [invoke(env, user, row, "design", [], consume), invoke(env, user, row, "health", [], consume)];
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect((await invoke(env, user, row, "health", [], consume)).status).toBe(429);
    expect(sqlite.prepare("SELECT COUNT(*) count FROM ai_invocations").get()!.count).toBe(2);
    release(); await Promise.all(calls);
  });
  it("reserves no more than twenty simultaneous calls globally", async () => {
    for (let i = 0; i < 20; i++) {
      sqlite.prepare("INSERT INTO users(id,email,display_name) VALUES(?,?,'Other')").run(`other-${i}`, `other-${i}@zenmeasure.com`);
      sqlite.prepare("INSERT INTO ai_invocations(id,user_id,model_id,model_name,provider,purpose,lease_expires_at) VALUES(?,?,'m','m','deepseek','design',datetime('now','+1 minute'))").run(`global-${i}`, `other-${i}`);
    }
    expect((await invoke(env, user, row, "health", [], consume)).status).toBe(429);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not mark a model unhealthy when its health-check lease is recovered", async () => {
    sqlite.prepare("UPDATE ai_models SET checked_at='prior-check',latency_ms=8 WHERE id='model'").run();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.stubGlobal("fetch", vi.fn(async () => { await gate; return Response.json(payload()); }));
    const response = authenticatedApp(user).request("https://example.test/api/admin/ai/model/check", { method: "POST" }, env);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    sqlite.prepare("UPDATE ai_invocations SET lease_expires_at=datetime('now','-1 second')").run();
    await recoverExpiredAIInvocations(env.DB);
    release();
    expect((await response).status).toBe(409);
    expect(sqlite.prepare("SELECT health,checked_at,latency_ms FROM ai_models").get()).toMatchObject({ health: "ok", checked_at: "prior-check", latency_ms: 8 });
    expect(last()).toMatchObject({ status: "failed", input_tokens: 100 });
  });
});

describe("request idempotency", () => {
  const request = { requestId: "request-1234567890", requestHash: "hash-of-content" };
  it("keeps pending/finished retries and changed fingerprints from calling the provider again", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.stubGlobal("fetch", vi.fn(async () => { await gate; return Response.json(payload()); }));
    const original = invoke(env, user, row, "design", [], consume, request);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect((await invoke(env, user, row, "design", [], consume, request)).error).toBe("ai-request-in-progress");
    expect((await invoke(env, user, row, "design", [], consume, { ...request, requestHash: "changed" })).error).toBe("ai-request-id-conflict");
    expect((await invoke(env, user, row, "health", [], consume, request)).error).toBe("ai-request-id-conflict");
    release(); expect((await original).status).toBe(200);
    expect((await invoke(env, user, row, "design", [], consume, request)).error).toBe("ai-result-unavailable");
    expect(fetch).toHaveBeenCalledOnce();
    expect(sqlite.prepare("SELECT COUNT(*) count FROM ai_invocations").get()!.count).toBe(1);
  });
  it("scopes request IDs to the original user and never reissues recovered requests", async () => {
    await invoke(env, user, row, "design", [], consume, request);
    sqlite.prepare("UPDATE ai_invocations SET status='failed',recovery_state='closed-without-retry'").run();
    expect((await invoke(env, user, row, "design", [], consume, request)).error).toBe("ai-result-unavailable");
    const other = { ...user, id: "other" };
    sqlite.prepare("INSERT INTO users(id,email,display_name) VALUES('other','other@zenmeasure.com','Other')").run();
    expect((await invoke(env, other, row, "design", [], consume, request)).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("protects recovery endpoints with the admin scope", async () => {
    for (const viewer of [null, { ...user, admin: false }])
      for (const method of ["GET", "POST"])
        expect((await authenticatedApp(viewer).request("https://example.test/api/admin/ai/recovery", { method }, env)).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("reports recovery stats and audits the administrator without provider calls", async () => {
    const app = authenticatedApp(user);
    const response = await app.request("https://example.test/api/admin/ai/recovery", { method: "POST" }, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ recovered: 0, automaticRetry: false, stats: { pending: 0, recovered: 0 } });
    expect(sqlite.prepare("SELECT actor_id,action FROM audit").get()).toMatchObject({ actor_id: user.id, action: "ai-recovery" });
    const stats = await app.request("https://example.test/api/admin/ai/recovery", {}, env);
    expect(await stats.json()).toMatchObject({ automaticRetry: false, stats: { recovered_unknown_usage: 0 } });
    expect(fetch).not.toHaveBeenCalled();
  });
});
