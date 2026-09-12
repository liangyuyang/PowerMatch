import fs from "node:fs";
import assert from "node:assert/strict";
import { DEFAULT_DESIGN } from "../src/shared/model.ts";
const origin = "https://powermatch.zenmeasure.space";
const checks = [];
for (const path of [
  "/",
  "/api/health",
  "/api/cases?scope=public",
  "/api/components",
  "/api/admin",
  "/api/ai/models",
  "/api/admin/ai",
  "/api/admin/ai/usage",
  "/api/admin/ai/diagnostics",
  "/assets/zenmeasure-blue.png",
  "/assets/MOT-U125-body-white.png",
  "/assets/MHO-C404-body-white.png",
]) {
  const r = await fetch(origin + path);
  assert.equal(r.status, path.startsWith("/api/admin") ? 403 : 200, path);
  const entry = { path, status: r.status };
  if (path === "/api/health") {
    const x = await r.json();
    assert.equal(x.emailConfigured, true);
    entry.emailConfigured = x.emailConfigured;
  }
  if (path === "/api/cases?scope=public") {
    const x = await r.json();
    assert.ok(x.cases.some((c) => c.id === "tiny-demo"));
    entry.count = x.cases.length;
  }
  if (path === "/api/components") {
    const x = await r.json();
    assert.ok(x.components.length >= 35);
    entry.count = x.components.length;
  }
  checks.push(entry);
}
const d = structuredClone(DEFAULT_DESIGN);
d.mode = "battery";
d.storage.capacityMah = 1;
const r = await fetch(origin + "/api/calculate", {
  method: "POST",
  headers: { Origin: origin, "Content-Type": "application/json" },
  body: JSON.stringify(d),
});
assert.equal(r.status, 200, "production calculation");
const result = await r.json();
assert.ok(
  Math.abs(
    result.runtimeHours - 1000 / (result.averageUa + d.regulation.iqUa),
  ) < 0.001,
);
checks.push({
  path: "/api/calculate",
  status: r.status,
  averageUa: result.averageUa,
  runtimeHours: result.runtimeHours,
});
const report = {
  checkedAt: new Date().toISOString(),
  origin,
  result: "passed",
  checks,
  mail: "Provider accepted; user separately confirmed successful login and admin access. No email sent by this script.",
};
fs.writeFileSync(
  "docs/production-smoke.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report));
