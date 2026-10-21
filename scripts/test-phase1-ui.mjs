// Local-only browser acceptance with synthetic sessions from test-api.mjs.
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { changeMode, cloneDesign } from "../src/shared/model.ts";

const origin = "http://127.0.0.1:5173";
const apiOrigin = "http://127.0.0.1:8787";
const { token } = JSON.parse(fs.readFileSync("tmp/test-admin-browser.json", "utf8"));
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const checks = [];
const contexts = [];
async function context(signedIn = false) {
  const ctx = await browser.newContext({ locale: "zh-CN", viewport: { width: 1440, height: 1050 } });
  contexts.push(ctx);
  if (signedIn) await ctx.addCookies([{ name: "pm_session", value: token, url: origin }]);
  return ctx;
}
const nameInput = (page) => page.locator(".design-bar input");
const saveTrigger = (page) => page.getByRole("button", { name: "保存版本", exact: true }).first();
async function ready(page) { await expect(saveTrigger(page)).toBeEnabled(); }
async function save(page) {
  await saveTrigger(page).click();
  const response = page.waitForResponse((r) => r.url().endsWith("/api/cases") && r.request().method() === "POST");
  await page.getByRole("dialog").getByRole("button", { name: "保存版本", exact: true }).click();
  const result = await response;
  assert.equal(result.status(), 200);
  assert.equal(result.request().postDataJSON().expectedActor, "test-admin");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  return result.json();
}
async function api(path, body) {
  const res = await fetch(apiOrigin + path, {
    method: body ? "POST" : "GET",
    headers: { Origin: origin, Cookie: `pm_session=${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  assert.equal(res.status, 200);
  return res.json();
}
try {
  const guest = await (await context()).newPage();
  await guest.goto(origin); await ready(guest);
  await expect(guest.locator(".design-bar .badge").first()).toHaveText("公开大厅");
  checks.push("guest default remains public");

  const ctx = await context(true), page = await ctx.newPage();
  await page.goto(origin); await ready(page);
  await expect(page.locator(".design-bar .badge").first()).toHaveText("仅自己");
  await nameInput(page).fill("Phase1 browser draft");
  await saveTrigger(page).click();
  await expect(page.getByRole("dialog").getByLabel("保存到")).toHaveValue("private");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(saveTrigger(page)).toBeFocused();
  await expect(nameInput(page)).toHaveValue("Phase1 browser draft");
  const saved = await save(page);
  await nameInput(page).fill("Unsaved name must survive reload");
  await page.reload(); await ready(page);
  await expect(nameInput(page)).toHaveValue("Unsaved name must survive reload");
  await expect(page.locator(".design-bar .badge").last()).toHaveText("v1");
  const revised = await save(page);
  assert.equal(revised.id, saved.id); assert.equal(revised.number, 2);
  checks.push("employee private default; Escape/focus; reload preserves case and revision");

  // A newer revision from another tab cannot silently replace this draft.
  await nameInput(page).fill("Keep this local conflict");
  const record = await api(`/api/cases/${saved.id}`);
  await api("/api/cases", { id: saved.id, expectedActor: "test-admin", expectedRevision: 2,
    parentRevision: revised.revisionId, name: "Server revision", scope: "private", design: record.revisions[0].design });
  await page.reload(); await ready(page);
  await expect(page.getByText(/案例已有更新。保留了本机输入/)).toBeVisible();
  await expect(nameInput(page)).toHaveValue("Keep this local conflict");
  await saveTrigger(page).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "保存版本", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "保留输入，另存副本", exact: true }).click();
  const copy = await save(page);
  assert.notEqual(copy.id, saved.id);
  const copied = await api(`/api/cases/${copy.id}`);
  assert.equal(copied.case.scope, "private");
  assert.equal(copied.revisions[0].parent_revision, null);
  checks.push("revision conflict preserves input; independent private copy");

  // Saved cases must remain blocked if permissions cannot be checked.
  await nameInput(page).fill("Offline draft preserved");
  await page.route(`**/api/cases/${copy.id}`, (route) => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"test-unavailable"}' }));
  await page.reload(); await ready(page);
  await expect(page.getByText(/暂时无法核实案例。输入及关联已保留/)).toBeVisible();
  await expect(nameInput(page)).toHaveValue("Offline draft preserved");
  await page.unroute(`**/api/cases/${copy.id}`);
  await page.getByRole("button", { name: "重新核实", exact: true }).click();
  await expect(page.getByText(/暂时无法核实案例。输入及关联已保留/)).toHaveCount(0);
  checks.push("case verification failure preserves draft and recovers on retry");

  // A stale tab cannot publish an employee draft using the guest cookie.
  await ctx.clearCookies();
  let caseWrites = 0;
  const watch = (request) => { if (request.url().endsWith("/api/cases") && request.method() === "POST") caseWrites++; };
  page.on("request", watch);
  await saveTrigger(page).click();
  await page.getByRole("dialog").getByRole("button", { name: "保存版本", exact: true }).click();
  await expect(page.getByText(/登录身份或权限已改变/)).toBeVisible();
  assert.equal(caseWrites, 0);
  assert.ok(await page.evaluate(() => sessionStorage.getItem("powermatch-draft-v1:test-admin")?.includes("Offline draft preserved")));
  checks.push("stale authenticated tab never writes as guest and retains original draft");

  const failure = await (await context(true)).newPage();
  await failure.route("**/api/session", (route) => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"test-session-failure"}' }));
  await failure.goto(origin);
  await expect(failure.getByRole("button", { name: "重试身份核实" })).toBeVisible();
  await expect(saveTrigger(failure)).toBeDisabled();
  assert.equal(await nameInput(failure).evaluate((el) => !!el.closest("[inert]")), true);
  await failure.unroute("**/api/session");
  await failure.getByRole("button", { name: "重试身份核实" }).click();
  await ready(failure);
  await expect(failure.locator(".design-bar .badge").first()).toHaveText("仅自己");
  checks.push("initial session failure cannot become public guest; retry restores private default");

  // Model regression must be reflected in the screen and the printable report.
  const energyCtx = await context(), energy = await energyCtx.newPage();
  const design = changeMode(cloneDesign(), "hybrid"); design.horizonDays = 1;
  await energy.addInitScript((d) => {
    localStorage.setItem("powermatch-draft-v1:guest", JSON.stringify({ version: 2, owner: "guest", design: d,
      snapshots: [], lockConditions: true, intendedScope: "public", caseContext: null }));
    window.print = () => {};
  }, design);
  await energy.goto(origin); await ready(energy);
  await expect(energy.locator(".mobile-summary")).toContainText("尚不足以判断");
  await energy.getByRole("button", { name: "导出 PDF", exact: true }).click();
  await expect(energy.locator(".print-report")).toContainText("尚不足以判断");
  await expect(energy.locator(".print-report")).toContainText("Engine 0.1.1");
  await energy.screenshot({ path: "tmp/phase1-local/dark-coverage.png", fullPage: true });
  checks.push("one-day simulation remains unproven for 62h in UI and print");
  console.log(JSON.stringify({ result: "passed", checks, realAccounts: false, emailsSent: 0, liveAI: false }));
} finally { await browser.close(); }
