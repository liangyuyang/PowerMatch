import type { Hono } from "hono";
import { z } from "zod";
import type { Env } from "./index";
import type { Viewer } from "../src/shared/model";
import {
  modelConfigSchema,
  runtimeIdentity,
  secretTarget,
  planUnitEstimate,
  type AIConfig,
} from "../src/shared/ai-config";
import { readPrices } from "./ai-pricing";
import { sealSecret } from "./ai-secrets";
type App = Hono<{
  Bindings: Env;
  Variables: { user: Viewer | null; guestHash: string };
}>;
type Row = {
  id: string;
  config_json: string;
  enabled: number;
  is_default: number;
  health: string;
  checked_at: string | null;
  revision: number;
};
const err = (error: string, status = 400) =>
  new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
export const usageSql = `WITH periods(period,label,start) AS (
 SELECT 'day',date('now','+8 hours'),datetime('now','+8 hours','start of day','-8 hours')
 UNION ALL SELECT 'week',date('now','+8 hours',printf('-%d days',(CAST(strftime('%w','now','+8 hours') AS INTEGER)+6)%7)),datetime('now','+8 hours','start of day',printf('-%d days',(CAST(strftime('%w','now','+8 hours') AS INTEGER)+6)%7),'-8 hours')
 UNION ALL SELECT 'total','90 days',datetime('now','+8 hours','start of day','-89 days','-8 hours')
 ) SELECT p.period,p.label,a.model_id,a.model_name,a.provider,a.user_id,u.display_name AS caller,u.email,a.purpose,a.currency,
 COUNT(*) AS calls,SUM(a.status='ok') AS successes,SUM(a.status='failed') AS failures,SUM(a.status='pending') AS pending,
 SUM(COALESCE(a.input_tokens,0)) AS input_tokens,SUM(COALESCE(a.output_tokens,0)) AS output_tokens,
 SUM(a.input_tokens IS NULL OR a.output_tokens IS NULL) AS unknown_usage,
 SUM(COALESCE(a.estimated_cost,0)) AS native_cost,SUM(a.estimated_cost IS NULL) AS unknown_native,
 SUM(COALESCE(a.cost_cny,0)) AS cost_cny,SUM(a.cost_cny IS NULL) AS unknown_cost,MAX(a.created_at) AS latest
 FROM periods p JOIN ai_invocations a ON a.created_at>=p.start JOIN users u ON u.id=a.user_id
 GROUP BY p.period,p.label,a.model_id,a.model_name,a.provider,a.user_id,u.display_name,u.email,a.purpose,a.currency
 ORDER BY p.period,cost_cny DESC,latest DESC`;
export function registerAIAdmin(
  app: App,
  keyFor: (
    env: Env,
    config: AIConfig,
    id?: string,
  ) => Promise<string | undefined>,
) {
  app.post("/api/admin/ai/prices", async (c) => {
    if (!c.get("user")?.admin) return err("admin-required", 403);
    const data = z
      .object({
        provider: z.string().max(40),
        model: z.string().max(120),
        source: z.string().url().max(2000),
      })
      .strict()
      .parse(await c.req.json());
    try {
      return c.json(await readPrices(data.provider, data.model, data.source));
    } catch (e) {
      const code =
        e instanceof Error && /^price-[a-z0-9-]+$/.test(e.message)
          ? e.message
          : "price-fetch-failed";
      return err(code, 422);
    }
  });
  app.post("/api/admin/ai/settings", async (c) => {
    const user = c.get("user");
    if (!user?.admin) return err("admin-required", 403);
    const payload = z
      .object({
        revision: z.number().int().min(0),
        billing: z
          .object({
            usdToCny: z.number().finite().min(0.01).max(100).nullable(),
          })
          .strict(),
        models: z
          .array(
            z
              .object({
                id: z.string().regex(/^[a-z0-9-]{1,60}$/),
                config: modelConfigSchema,
                enabled: z.boolean(),
                isDefault: z.boolean(),
                revision: z.number().int().min(0),
                apiKey: z.string().trim().max(4096).default(""),
              })
              .strict(),
          )
          .max(40),
      })
      .strict()
      .parse(await c.req.json());
    if (
      new Set(payload.models.map((m) => m.id)).size !== payload.models.length ||
      payload.models.filter((m) => m.isDefault).length > 1
    )
      return err("invalid-model-selection");
    const rows = await c.env.DB.prepare("SELECT * FROM ai_models").all<Row>();
    if (rows.results.some((r) => !payload.models.some((m) => m.id === r.id)))
      return err("model-list-incomplete", 409);
    const statements = [
      c.env.DB.prepare(
        "UPDATE ai_settings SET settings_json=CASE WHEN revision=? THEN ? ELSE 'invalid-json' END,revision=revision+1 WHERE id=1",
      ).bind(payload.revision, JSON.stringify(payload.billing)),
      c.env.DB.prepare("UPDATE ai_models SET is_default=0 WHERE is_default=1"),
    ];
    for (const model of payload.models) {
      const old = rows.results.find((r) => r.id === model.id);
      if ((old?.revision ?? 0) !== model.revision)
        return err("config-conflict", 409);
      if (
        model.apiKey &&
        (model.apiKey.length < 10 || !c.env.POWERMATCH_AI_ENCRYPTION_KEY)
      )
        return err("key-storage-not-configured");
      const sameRuntime =
        !!old &&
        runtimeIdentity(
          modelConfigSchema.parse(JSON.parse(old.config_json)),
        ) === runtimeIdentity(model.config) &&
        !model.apiKey;
      const health = sameRuntime ? old!.health : "unchecked";
      if (
        model.isDefault &&
        (!model.enabled ||
          health !== "ok" ||
          !(await keyFor(c.env, model.config, model.id)))
      )
        return err("health-check-required");
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO ai_models(id,config_json,enabled,is_default,health,checked_at,revision) VALUES(?,?,?,?,?,?,1)
    ON CONFLICT(id) DO UPDATE SET config_json=excluded.config_json,enabled=excluded.enabled,is_default=excluded.is_default,health=excluded.health,checked_at=excluded.checked_at,diagnostic_json=CASE WHEN ? THEN diagnostic_json ELSE NULL END,latency_ms=CASE WHEN ? THEN latency_ms ELSE NULL END,revision=revision+1`,
        ).bind(
          model.id,
          JSON.stringify(model.config),
          +model.enabled,
          +model.isDefault,
          health,
          sameRuntime ? old!.checked_at : null,
          +sameRuntime,
          +sameRuntime,
        ),
      );
      if (model.apiKey) {
        const target = secretTarget(model.config),
          sealed = await sealSecret(
            c.env.POWERMATCH_AI_ENCRYPTION_KEY!,
            model.apiKey,
            `model:${model.id}|${target}`,
          );
        statements.push(
          c.env.DB.prepare(
            "INSERT INTO ai_model_secrets(model_id,target,iv,ciphertext) VALUES(?,?,?,?) ON CONFLICT(model_id) DO UPDATE SET target=excluded.target,iv=excluded.iv,ciphertext=excluded.ciphertext,updated_at=CURRENT_TIMESTAMP",
          ).bind(model.id, target, sealed.iv, sealed.ciphertext),
        );
      }
    }
    statements.push(
      c.env.DB.prepare(
        "INSERT INTO audit(id,actor_id,action,target_id,detail) VALUES(?,?,?,?,?)",
      ).bind(
        crypto.randomUUID(),
        user.id,
        "ai-settings-saved",
        "powermatch",
        `models:${payload.models.length}`,
      ),
    );
    try {
      await c.env.DB.batch(statements);
    } catch (e) {
      if (String(e).includes("CHECK constraint"))
        return err("config-conflict", 409);
      throw e;
    }
    return c.json({ ok: true });
  });
  app.post("/api/admin/ai/default", async (c) => {
    const user = c.get("user");
    if (!user?.admin) return err("admin-required", 403);
    const data = z
      .object({ id: z.string().max(60), revision: z.number().int().min(0) })
      .strict()
      .parse(await c.req.json());
    const row = await c.env.DB.prepare("SELECT * FROM ai_models WHERE id=?")
      .bind(data.id)
      .first<Row>();
    if (
      !row?.enabled ||
      row.health !== "ok" ||
      !(await keyFor(
        c.env,
        modelConfigSchema.parse(JSON.parse(row.config_json)),
        row.id,
      ))
    )
      return err("health-check-required");
    try {
      await c.env.DB.batch([
        c.env.DB.prepare(
          "UPDATE ai_settings SET settings_json=CASE WHEN revision=? THEN settings_json ELSE 'invalid-json' END,revision=revision+1 WHERE id=1",
        ).bind(data.revision),
        c.env.DB.prepare(
          "UPDATE ai_models SET is_default=0 WHERE is_default=1",
        ),
        c.env.DB.prepare(
          "UPDATE ai_models SET is_default=1,revision=revision+1 WHERE id=?",
        ).bind(data.id),
        c.env.DB.prepare(
          "INSERT INTO audit(id,actor_id,action,target_id) VALUES(?,?,?,?)",
        ).bind(crypto.randomUUID(), user.id, "ai-default", data.id),
      ]);
    } catch (e) {
      if (String(e).includes("CHECK constraint"))
        return err("config-conflict", 409);
      throw e;
    }
    return c.json({ ok: true });
  });
  app.get("/api/admin/ai/usage", async (c) => {
    if (!c.get("user")?.admin) return err("admin-required", 403);
    const rows = await c.env.DB.prepare(usageSql).all();
    const models = await c.env.DB.prepare(
      "SELECT id,config_json FROM ai_models",
    ).all<{ id: string; config_json: string }>();
    const settings = await c.env.DB.prepare(
      "SELECT settings_json FROM ai_settings WHERE id=1",
    ).first<{ settings_json: string }>();
    const usdToCny: number | null = JSON.parse(
      settings!.settings_json,
    ).usdToCny;
    const now = new Date(),
      beijing = new Date(now.getTime() + 8 * 3600000),
      year = beijing.getUTCFullYear(),
      month = beijing.getUTCMonth(),
      day = beijing.getUTCDate();
    const monthDays = new Date(Date.UTC(year, month + 1, 0)).getUTCDate(),
      yearDays = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86400000;
    const dayFraction =
      (beijing.getUTCHours() * 3600 +
        beijing.getUTCMinutes() * 60 +
        beijing.getUTCSeconds()) /
      86400;
    const starts = {
      month: new Date(Date.UTC(year, month, 1) - 8 * 3600000)
        .toISOString()
        .slice(0, 19)
        .replace("T", " "),
      year: new Date(Date.UTC(year, 0, 1) - 8 * 3600000)
        .toISOString()
        .slice(0, 19)
        .replace("T", " "),
    };
    const elapsed = {
      month: Math.max((day - 1 + dayFraction) / monthDays, 1 / monthDays),
      year: Math.max(
        ((Date.UTC(year, month, day) - Date.UTC(year, 0, 1)) / 86400000 +
          dayFraction) /
          yearDays,
        1 / yearDays,
      ),
    };
    const plan = new Map<string, Record<string, unknown>>();
    for (const row of models.results) {
      const cfg = modelConfigSchema.parse(JSON.parse(row.config_json));
      if (cfg.billingMode !== "plan" || cfg.planFee === null) continue;
      const count = await c.env.DB.prepare(
        "SELECT COUNT(*) count FROM ai_invocations WHERE model_id=? AND created_at>=?",
      )
        .bind(row.id, starts[cfg.planPeriod])
        .first<{ count: number }>();
      const calls = count?.count ?? 0,
        { projectedCalls: projected, unitCost: unit } = planUnitEstimate(
          cfg.planFee,
          calls,
          elapsed[cfg.planPeriod],
        );
      plan.set(row.id, {
        plan_fee: cfg.planFee,
        plan_period: cfg.planPeriod,
        plan_cycle_calls: calls,
        plan_projected_calls: projected,
        plan_cost_per_call: unit,
        plan_cost_per_call_cny:
          unit === null
            ? null
            : cfg.currency === "CNY"
              ? unit
              : usdToCny === null
                ? null
                : unit * usdToCny,
      });
    }
    return c.json({
      rows: rows.results.map((row: any) => ({
        ...row,
        ...(plan.get(row.model_id) ?? {}),
      })),
      checkedAt: new Date().toISOString(),
      timezone: "Asia/Shanghai",
    });
  });
  app.get("/api/admin/ai/diagnostics", async (c) => {
    if (!c.get("user")?.admin) return err("admin-required", 403);
    let storage = false;
    try {
      await c.env.SPECS.list({ limit: 1 });
      storage = true;
    } catch {
      /* Report status only, no provider payload. */
    }
    const ai = await c.env.DB.prepare(
      "SELECT COUNT(*) calls,SUM(status='failed') failures,SUM(status='pending') pending,SUM(status='pending' AND created_at<datetime('now','-5 minutes')) stale FROM ai_invocations WHERE created_at>=datetime('now','-90 days')",
    ).first();
    const mail = await c.env.DB.prepare(
      "SELECT state,COUNT(*) count FROM mail_outbox GROUP BY state",
    ).all();
    const recent = await c.env.DB.prepare(
      `SELECT a.id,a.purpose AS type,a.status,a.error_code,a.diagnostic_json,a.latency_ms,a.created_at AS updated_at,u.display_name AS caller,u.email FROM ai_invocations a JOIN users u ON u.id=a.user_id
    UNION ALL SELECT m.id,'mail',m.state,m.error_code,NULL,NULL,m.created_at,u.display_name,u.email FROM mail_outbox m LEFT JOIN users u ON u.id=m.user_id ORDER BY updated_at DESC LIMIT 100`,
    ).all();
    return c.json({
      checkedAt: new Date().toISOString(),
      worker: true,
      database: true,
      storage,
      encryption: !!c.env.POWERMATCH_AI_ENCRYPTION_KEY,
      email: !!c.env.RESEND_API_KEY,
      ai,
      mail: mail.results,
      recent: recent.results,
    });
  });
}
