import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { invoke, modelConfigSchema, registerAI } from "../worker/ai";
import { aiBillingSchema } from "../src/shared/ai-config";
import { AI_MAX_OUTPUT_TOKENS, reserveAIUsage } from "../worker/ai-budgets";
import { recoverExpiredAIInvocations } from "../worker/ai-recovery";
import type { Viewer } from "../src/shared/model";
import type { Env } from "../worker/index";

let sqlite: DatabaseSync;
let env: Env;
const user = { id: "original", employee: true, admin: true, email: "original@example.test" } as Viewer;
const config = modelConfigSchema.parse({ provider: "deepseek", name: "Test", model: "test", inputPrice: 2, outputPrice: 8, currency: "CNY" });
const row = { id: "model", config_json: JSON.stringify(config), enabled: 1, is_default: 1, health: "ok", checked_at: null, revision: 1 };
const messages = [{ role: "system", content: "完整的系统指令与元器件目录🧪" }, { role: "user", content: "Context" }];
const reserved = reserveAIUsage(config, messages, 7);
const response = (input: number | null = 100, output: number | null = 20) => Response.json({ choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: input, completion_tokens: output } });
const stored = () => sqlite.prepare("SELECT * FROM ai_invocations ORDER BY rowid DESC LIMIT 1").get()!;
function setBudget(budgets: unknown) {
  sqlite.prepare("UPDATE ai_settings SET settings_json=?,revision=revision+1").run(JSON.stringify(aiBillingSchema.parse({ usdToCny: 7, budgets })));
}
function call(viewer = user, modelRow = row, request?: { requestId: string; requestHash: string }) {
  sqlite.prepare("UPDATE ai_models SET config_json=? WHERE id='model'").run(modelRow.config_json);
  return invoke(env, viewer, modelRow, "design", messages, x => x, request);
}
beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  for (const file of ["0001_initial", "0004_ai", "0005_ai_billing", "0006_ai_diagnostics", "0012_ai_recovery", "0013_ai_budgets"])
    sqlite.exec(readFileSync(new URL(`../worker/migrations/${file}.sql`, import.meta.url), "utf8"));
  for (const id of [user.id, "other"])
    sqlite.prepare("INSERT INTO users(id,email,display_name) VALUES(?,?,?)").run(id, `${id}@example.test`, id);
  sqlite.prepare("INSERT INTO ai_models(id,config_json,enabled,is_default,health) VALUES('model',?,1,1,'ok')").run(row.config_json);
  const db = {
    async batch(statements: { run(): Promise<unknown> }[]) {
      sqlite.exec("BEGIN");
      try { const results = []; for (const s of statements) results.push(await s.run()); sqlite.exec("COMMIT"); return results; }
      catch (e) { sqlite.exec("ROLLBACK"); throw e; }
    },
    prepare(sql: string) {
      let args: (string | number | null)[] = [];
      const statement = {
        bind(...values: (string | number | null)[]) { args = values; return statement; },
        async first() { return sqlite.prepare(sql).get(...args) ?? null; },
        async all() { return { results: sqlite.prepare(sql).all(...args), success: true }; },
        async run() { return { success: true, meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }; },
      };
      return statement;
    },
  } as unknown as D1Database;
  env = { DB: db, POWERMATCH_AI_DEEPSEEK_KEY: "fake-test-key" } as Env;
  vi.stubGlobal("fetch", vi.fn(async () => response()));
});
afterEach(() => { sqlite.close(); vi.unstubAllGlobals(); });

describe("application AI budget admission and reconciliation", () => {
  it("keeps defaults disabled and validates invalid limits", async () => {
    expect(aiBillingSchema.parse({ usdToCny: null }).budgets.globalDay).toEqual({ tokens: null, cny: null });
    for (const invalid of [{ tokens: -1 }, { tokens: 1.5 }, { cny: -0.1 }, { cny: Infinity }])
      expect(aiBillingSchema.safeParse({ usdToCny: null, budgets: { globalDay: invalid } }).success).toBe(false);
    expect((await call()).status).toBe(200);
    expect(stored()).toMatchObject({ budget_tokens: 120, budget_cny: 0.00036, user_id: "original", reserved_output_tokens: AI_MAX_OUTPUT_TOKENS });
    expect(reserved.input).toBeGreaterThan(new TextEncoder().encode(JSON.stringify(messages)).length);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)).max_tokens).toBe(AI_MAX_OUTPUT_TOKENS);
  });
  it("allows only one concurrent last-slot reservation and reconciles actual usage", async () => {
    setBudget({ globalDay: { tokens: reserved.tokens } });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.stubGlobal("fetch", vi.fn(async () => { await gate; return response(); }));
    const calls = [call(), call({ ...user, id: "other" })];
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(stored().budget_tokens).toBe(reserved.tokens);
    release();
    expect((await Promise.all(calls)).map(r => r.status).sort()).toEqual([200, 429]);
    expect(stored().budget_tokens).toBe(120);
  });
  it.each(["globalDay", "globalMonth", "userDay", "userMonth"])("enforces CNY and zero token bounds for %s", async scope => {
    setBudget({ [scope]: { cny: reserved.cny! - 0.000001 } });
    expect((await call()).status).toBe(429);
    setBudget({ [scope]: { tokens: 0 } });
    expect((await call()).status).toBe(429);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("scopes each-user bounds separately while preserving global bounds", async () => {
    setBudget({ userMonth: { tokens: reserved.tokens + 119 }, globalMonth: { tokens: 2 * reserved.tokens + 239 } });
    await call();
    expect((await call()).status).toBe(429);
    expect((await call({ ...user, id: "other" })).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("uses Beijing day/month boundaries independently", async () => {
    await call();
    sqlite.prepare("UPDATE ai_invocations SET created_at=datetime('now','+8 hours','start of day','-8 hours','-1 second'),budget_tokens=999999").run();
    setBudget({ globalDay: { tokens: reserved.tokens } });
    expect((await call()).status).toBe(200);
    sqlite.prepare("UPDATE ai_invocations SET created_at=datetime('now','+8 hours','start of month','-8 hours','-1 second'),budget_tokens=999999").run();
    setBudget({ globalMonth: { tokens: reserved.tokens } });
    expect((await call()).status).toBe(200);
  });
  it.each(["plan", "missing-price", "missing-fx"])("blocks unknown monetary reservation for %s without calling a provider", async kind => {
    setBudget({ globalDay: { cny: 100 } });
    const cfg = { ...config, ...(kind === "plan" ? { billingMode: "plan", planFee: 99 } : kind === "missing-price" ? { inputPrice: null } : { currency: "USD" }) };
    if (kind === "missing-fx") sqlite.prepare("UPDATE ai_settings SET settings_json=json_set(settings_json,'$.usdToCny',NULL)").run();
    expect((await call(user, { ...row, config_json: JSON.stringify(cfg) })).error).toBe("ai-budget-pricing-required");
    expect(fetch).not.toHaveBeenCalled();
    expect(stored()).toBeUndefined();
  });
  it("lets Token Plan use token-only protection, without a per-call fee", async () => {
    setBudget({ globalDay: { tokens: reserved.tokens } });
    expect((await call(user, { ...row, config_json: JSON.stringify({ ...config, billingMode: "plan", planFee: 99 }) })).status).toBe(200);
    expect(stored()).toMatchObject({ budget_tokens: 120, budget_cny: null, estimated_cost: null });
  });
  it("keeps unknown post-request usage reserved, including expiry and late usage reconciliation", async () => {
    setBudget({ globalDay: { tokens: reserved.tokens, cny: reserved.cny } });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.stubGlobal("fetch", vi.fn(async () => { await gate; return response(500, null); }));
    const attempt = call();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    sqlite.prepare("UPDATE ai_invocations SET lease_expires_at=datetime('now','-1 second')").run();
    await recoverExpiredAIInvocations(env.DB);
    expect((await call()).status).toBe(429);
    expect(stored()).toMatchObject({ budget_tokens: reserved.tokens, budget_cny: reserved.cny, user_id: user.id });
    release(); expect((await attempt).status).toBe(409);
    expect(stored()).toMatchObject({ status: "failed", budget_tokens: 500 + AI_MAX_OUTPUT_TOKENS, budget_cny: (500 * 2 + AI_MAX_OUTPUT_TOKENS * 8) / 1e6, user_id: user.id });
  });
  it.each(["input", "output"])("retains cost of known %s above reservation with the other component unknown", async part => {
    setBudget({ globalDay: { cny: 1 } });
    vi.stubGlobal("fetch", vi.fn(async () => response(part === "input" ? 1000000 : null, part === "output" ? 1000000 : null)));
    expect((await call()).status).toBe(200);
    const expected = part === "input" ? (1000000 * 2 + reserved.output * 8) / 1e6 : (reserved.input * 2 + 1000000 * 8) / 1e6;
    expect(stored()).toMatchObject({ cost_cny: null, estimated_cost: null });
    expect(stored().budget_cny).toBeCloseTo(expected, 9);
    expect((await call()).status).toBe(429);
  });
  it("retains estimates on network failure and releases only proven pre-request failure", async () => {
    setBudget({ globalDay: { tokens: reserved.tokens } });
    vi.stubGlobal("fetch", vi.fn(async () => { throw Error("connection dropped"); }));
    expect((await call()).status).toBe(502);
    expect(stored().budget_tokens).toBe(reserved.tokens);
    expect((await call()).status).toBe(429);
    sqlite.prepare("DELETE FROM ai_invocations").run();
    delete env.POWERMATCH_AI_DEEPSEEK_KEY;
    expect((await call()).error).toBe("missing-key");
    expect(stored()).toMatchObject({ budget_tokens: 0, budget_cny: 0, request_started_at: null });
  });
  it("blocks unknown legacy history and retains known billable usage for failed proposals", async () => {
    sqlite.prepare("INSERT INTO ai_invocations(id,user_id,model_id,model_name,provider,purpose,status) VALUES('legacy',?,'m','m','deepseek','design','failed')").run(user.id);
    setBudget({ globalDay: { tokens: reserved.tokens * 2 } });
    expect((await call()).status).toBe(429);
    sqlite.prepare("DELETE FROM ai_invocations").run();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ choices: [{ message: { content: "bad json" } }], usage: { prompt_tokens: 100, completion_tokens: 20 } })));
    expect((await call()).status).toBe(502);
    expect(stored()).toMatchObject({ status: "failed", budget_tokens: 120, budget_cny: 0.00036, user_id: user.id });
  });
  it("never repeats same request ID or moves its charge to another caller", async () => {
    setBudget({ globalDay: { tokens: reserved.tokens * 2 } });
    const id = { requestId: "same-request-12345", requestHash: "a" };
    await call(user, row, id);
    expect((await call(user, row, id)).error).toBe("ai-result-unavailable");
    expect((await call(user, row, { ...id, requestHash: "b" })).error).toBe("ai-request-id-conflict");
    expect(fetch).toHaveBeenCalledOnce();
    expect(stored().user_id).toBe("original");
  });
  it("rejects stale model revisions, prices and disabled selection before provider admission", async () => {
    for (const update of ["revision=revision+1", "config_json=json_set(config_json,'$.inputPrice',999)", "enabled=0"]) {
      sqlite.prepare("UPDATE ai_models SET config_json=?,revision=1,enabled=1 WHERE id='model'").run(row.config_json);
      sqlite.exec(`UPDATE ai_models SET ${update} WHERE id='model'`);
      expect((await invoke(env, user, row, "design", messages, x => x)).error).toBe("config-conflict");
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(stored()).toBeUndefined();
  });
  it("restricts configuration writes to admins and preserves optimistic revision checks", async () => {
    const app = new Hono<{ Bindings: Env; Variables: { user: Viewer | null; guestHash: string } }>();
    let viewer: Viewer | null = { ...user, admin: false };
    app.use("*", async (c, next) => { c.set("user", viewer); await next(); }); registerAI(app);
    const revision = Number(sqlite.prepare("SELECT revision FROM ai_settings").get()!.revision);
    const payload = { revision, billing: aiBillingSchema.parse({ usdToCny: null, budgets: { globalDay: { tokens: 5 } } }), models: [{ id: row.id, config, enabled: true, isDefault: false, revision: 1 }] };
    const request = () => app.request("https://test/api/admin/ai/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }, env);
    expect((await request()).status).toBe(403);
    viewer = user;
    expect((await request()).status).toBe(200);
    expect((await request()).status).toBe(409);
    expect(JSON.parse(String(sqlite.prepare("SELECT settings_json FROM ai_settings").get()!.settings_json)).budgets.globalDay.tokens).toBe(5);
    expect(fetch).not.toHaveBeenCalled();
  });
});
