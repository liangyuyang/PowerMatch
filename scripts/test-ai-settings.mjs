// Local-only integration checks. Fake keys are never sent to a provider.
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { modelConfigSchema } from "../src/shared/ai-config.ts";
const base = "http://127.0.0.1:8787";
const { token } = JSON.parse(
  fs.readFileSync("tmp/test-admin-browser.json", "utf8"),
);
let checks = 0;
async function api(path, body, status = 200, auth = true) {
  const r = await fetch(base + "/api/admin/ai" + path, {
    method: body ? "POST" : "GET",
    headers: {
      Origin: "http://127.0.0.1:5173",
      ...(auth ? { Cookie: `pm_session=${token}` } : {}),
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const x = await r.json();
  assert.equal(r.status, status, JSON.stringify(x));
  checks++;
  return x;
}
function payload(s) {
  return {
    revision: s.revision,
    billing: s.billing,
    models: s.models.map((m) => ({
      id: m.id,
      config: modelConfigSchema.parse(
        Object.fromEntries(
          [
            "provider",
            "name",
            "model",
            "baseUrl",
            "inputPrice",
            "outputPrice",
            "requestPrice",
            "currency",
            "billingMode",
            "priceSource",
            "priceNote",
          ].map((k) => [k, m[k]]),
        ),
      ),
      revision: m.revision,
      enabled: m.enabled,
      isDefault: m.isDefault,
      apiKey: "",
    })),
  };
}
function sql(query) {
  fs.writeFileSync("tmp/test-ai-settings.sql", query);
  execFileSync(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js",
      "d1",
      "execute",
      "powermatch-db",
      "--local",
      "--file=tmp/test-ai-settings.sql",
    ],
    {
      stdio: "pipe",
      env: {
        ...process.env,
        WRANGLER_LOG_PATH: "tmp/test-settings-wrangler.log",
      },
    },
  );
}
for (const path of ["/usage", "/diagnostics"])
  await api(path, undefined, 403, false);
await api("/settings", {}, 403, false);
await api("/default", {}, 403, false);
let state = await api("");
assert.ok(state.keyEntryReady);
const id = "billing-test-" + Date.now(),
  key = "fake-test-only-never-send";
let p = payload(state);
p.models.push({
  id,
  config: modelConfigSchema.parse({
    provider: "deepseek",
    name: "计费测试",
    model: "not-a-real-model",
    inputPrice: null,
    outputPrice: null,
    currency: "USD",
  }),
  revision: 0,
  enabled: true,
  isDefault: false,
  apiKey: key,
});
await api("/settings", p);
state = await api("");
assert.equal(state.models.find((m) => m.id === id).keyConfigured, true);
assert.ok(!JSON.stringify(state).includes(key));
checks += 2;
assert.ok(
  !(await (await fetch(base + "/api/ai/models")).json()).models.some(
    (m) => m.id === id,
  ),
);
checks++;
await api("/settings", p, 409);
let unchanged = await api("");
assert.equal(unchanged.revision, state.revision);
checks++;
p = payload(state);
p.billing.usdToCny = 7;
p.models.find((m) => m.id === id).config.name = "改名保留密钥";
await api("/settings", p);
state = await api("");
assert.equal(state.models.find((m) => m.id === id).keyConfigured, true);
checks++;
p = payload(state);
p.models.find((m) => m.id === id).config.baseUrl =
  "https://api.deepseek.com/v1";
await api("/settings", p);
state = await api("");
assert.equal(state.models.find((m) => m.id === id).keyConfigured, false);
checks++;
await api("/default", { id, revision: state.revision }, 400);
// 120 records exceed old 100-row display cap; no provider requests.
sql(
  `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<120) INSERT INTO ai_invocations(id,user_id,model_id,model_name,provider,purpose,input_tokens,output_tokens,estimated_cost,cost_cny,currency,status) SELECT '${id}-'||x,'test-admin','${id}','billing-fixture','deepseek','design',10,5,CASE WHEN x=120 THEN NULL ELSE 1 END,CASE WHEN x=120 THEN NULL ELSE 7 END,'USD','ok' FROM n;`,
);
const usage = await api("/usage");
for (const period of ["day", "week", "total"]) {
  const r = usage.rows.find((r) => r.model_id === id && r.period === period);
  assert.equal(r.calls, 120);
  assert.equal(r.cost_cny, 833);
  assert.equal(r.unknown_cost, 1);
  checks += 3;
}
const diagnostics = await api("/diagnostics");
assert.equal(diagnostics.database, true);
assert.ok(Array.isArray(diagnostics.recent));
checks += 2;
sql(
  `DELETE FROM ai_invocations WHERE model_id='${id}';DELETE FROM ai_model_secrets WHERE model_id='${id}';DELETE FROM ai_models WHERE id='${id}';`,
);
console.log(
  JSON.stringify({
    result: "passed",
    checks,
    scope:
      "local batch CAS, per-model key preservation/destination isolation, authorization, full aggregate, diagnostics",
    liveAI: false,
  }),
);
