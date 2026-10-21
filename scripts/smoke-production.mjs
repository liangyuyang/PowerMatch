import fs from "node:fs";
import assert from "node:assert/strict";
import { DEFAULT_DESIGN } from "../src/shared/model.ts";
const origin = "https://powermatch.zenmeasure.space";
const checks = [];
const expectedVersion = JSON.parse(fs.readFileSync("dist/version.json", "utf8"));
function checkHeaders(response, api = false) {
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(response.headers.get("content-security-policy") || "", /script-src 'self';/);
  if (api) assert.equal(response.headers.get("cache-control"), "no-store");
}
for (const path of [
  "/",
  "/version.json",
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
  "/assets/MOT-U125-body-proportional.png",
  "/assets/MHO-C404-body-white.png",
]) {
  const r = await fetch(origin + path);
  assert.equal(r.status, path.startsWith("/api/admin") ? 403 : 200, path);
  const entry = { path, status: r.status };
  checkHeaders(r, path.startsWith("/api/"));
  entry.securityHeaders = true;
  if (path === "/version.json") {
    const actual = await r.json();
    assert.deepEqual(actual, expectedVersion, "production version must match this build");
    entry.version = actual;
  }
  if (path === "/api/health") {
    const x = await r.json();
    assert.equal(x.emailConfigured, true);
    assert.equal(x.version, "0.1.1");
    entry.engineVersion = x.version;
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
checkHeaders(r, true);
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
const direct = structuredClone(d);
direct.device = "custom";
direct.path = "direct";
direct.load = { ...direct.load, voltage: 3, minVoltage: 2.5, maxVoltage: 4 };
direct.regulation.iqUa = 100;
const directResponse = await fetch(origin + "/api/calculate", {
  method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
  body: JSON.stringify(direct),
});
assert.equal(directResponse.status, 200);
const directResult = await directResponse.json();
assert.equal(directResult.status, "conditional");
assert.ok(Math.abs(directResult.batteryEstimateHours - 1000 / directResult.averageUa) < 0.001);
checks.push({ path: "/api/calculate", directIgnoresAbsentRegulator: true });
for (const probe of [
  { headers: {}, body: "{}", expected: 403, error: "origin-not-allowed" },
  { headers: { Origin: origin }, body: "x".repeat(128 * 1024 + 1), expected: 413, error: "request-too-large" },
]) {
  const response = await fetch(origin + "/api/calculate", {
    method: "POST", headers: { "Content-Type": "application/json", ...probe.headers }, body: probe.body,
  });
  assert.equal(response.status, probe.expected);
  checkHeaders(response, true);
  assert.equal((await response.json()).error, probe.error);
  checks.push({ path: "/api/calculate", status: probe.expected, error: probe.error, securityHeaders: true });
}
const report = {
  checkedAt: new Date().toISOString(),
  origin,
  result: "passed",
  checks,
  scope: "Anonymous read-only endpoints and bounded non-persistent calculation probes; no signed-in or real-provider acceptance in this run.",
  emailsSent: 0,
  liveAICalls: 0,
};
fs.writeFileSync(
  "docs/production-smoke.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report));
