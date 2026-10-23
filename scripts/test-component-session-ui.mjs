// Local-only, synthetic API timing regression. Never uploads files or calls providers.
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";

const origin = process.env.POWERMATCH_TEST_ORIGIN ?? "http://127.0.0.1:5173";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) throw Error("local-fixture-origin-required");
const componentId = "panasonic-cr2032"; // Built-in fallback exercises opening before API catalog arrival.
const synthetic = { id: componentId, name: "Synthetic session catalog fixture", category: "battery", manufacturer: "LOCAL SYNTHETIC QA", source: "https://example.test/synthetic", description: "Timing fixture only; not manufacturer specifications", parameters: { voltage: 3, capacityMah: 30, minVoltage: 2 }, official: false, verified: false };
const guest = { user: null, emailConfigured: false };
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const checks = [], errors = [];
const contexts = [];
let page;

async function scenario() {
  const context = await browser.newContext({ locale: "en-US", viewport: { width: 1440, height: 1050 } });
  contexts.push(context);
  await context.addInitScript(() => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem("pm-language", "en"); });
  const current = await context.newPage(), sessions = [], catalogs = [];
  current.on("pageerror", error => errors.push(error.message));
  await current.route("https://**", route => route.abort());
  await current.route("**/api/**", route => {
    const pathname = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET") throw Error("mutation-forbidden-in-session-timing-fixture");
    if (pathname === "/api/session") { sessions.push(route); return; }
    if (pathname === "/api/components") { catalogs.push(route); return; }
    if (pathname.endsWith("/specs")) return route.fulfill({ json: { specs: [] } });
    throw Error(`unexpected-local-api:${pathname}`);
  });
  await current.goto(`${origin}/?page=library#component=${componentId}`);
  await expect(current.getByRole("heading", { name: "Components", exact: true })).toBeVisible();
  await expect.poll(() => sessions.length).toBeGreaterThanOrEqual(2);
  await expect.poll(() => catalogs.length).toBeGreaterThanOrEqual(2);
  await expect(current.locator(".component-card").first()).toBeVisible();
  await expect(current.getByRole("dialog")).toHaveCount(0);
  return { current, sessions, catalogs };
}
async function fillDraft(current) {
  const dialog = current.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.locator('input[type="file"]').setInputFiles({ name: "synthetic-session.png", mimeType: "image/png", buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 3]) });
  const capacity = dialog.locator(".component-parameters").getByLabel("Capacity (mAh)", { exact: true });
  await capacity.fill("31"); await capacity.blur();
  const editor = dialog.locator(".spec-evidence-editor");
  await editor.locator("select").selectOption("capacityMah");
  await editor.getByRole("textbox", { name: "Source excerpt", exact: true }).fill("Synthetic session timing draft");
  await editor.getByLabel("Source page (blank if unknown)", { exact: true }).fill("4");
}
async function draftPreserved(current) {
  const dialog = current.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".component-parameters").getByLabel("Capacity (mAh)", { exact: true })).toHaveValue("31");
  await expect(dialog.locator(".spec-evidence-editor").getByRole("textbox", { name: "Source excerpt", exact: true })).toHaveValue("Synthetic session timing draft");
  await expect(dialog.locator(".spec-evidence-editor").getByLabel("Source page (blank if unknown)", { exact: true })).toHaveValue("4");
  assert.equal(await dialog.locator('input[type="file"]').evaluate(input => input.files?.[0]?.name), "synthetic-session.png");
  await expect(dialog.getByRole("button", { name: "Recognize locally", exact: true })).toBeEnabled();
  await expect(dialog.getByRole("button", { name: "Upload spec", exact: true })).toBeDisabled();
}

try {
  const first = await scenario(); page = first.current;
  checks.push("catalog fallback renders while both initial guest session responses are held, without opening deep-linked details");
  const latest = first.sessions.at(-1);
  await latest.fulfill({ json: guest });
  await expect(page.getByRole("dialog")).toBeVisible();
  await fillDraft(page);
  for (const route of first.sessions.slice(0, -1)) await route.fulfill({ json: guest });
  await draftPreserved(page);
  checks.push("late duplicate StrictMode guest response preserves selected file and manual field draft");
  for (const route of first.catalogs) await route.fulfill({ json: { components: [synthetic] } });
  await expect(page.getByRole("dialog")).toContainText(synthetic.name);
  await draftPreserved(page);
  checks.push("late catalog responses reopen the same component without clearing file or manual field inputs");
  await page.screenshot({ path: "tmp/component-session-preserved.png", fullPage: true });

  const failed = await scenario(); page = failed.current;
  for (const route of failed.catalogs) await route.fulfill({ json: { components: [synthetic] } });
  await expect(page.getByRole("heading", { name: synthetic.name, exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  for (const route of failed.sessions) await route.fulfill({ status: 503, json: { error: "synthetic-session-unavailable" } });
  const retry = page.getByRole("button", { name: "Retry identity verification", exact: true });
  await expect(retry).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new HashChangeEvent("hashchange")));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator('.spec-evidence-editor,input[type="file"]')).toHaveCount(0);
  checks.push("failed identity verification and repeated deep-link event leave details/file/editor closed");
  const previousCount = failed.sessions.length;
  await retry.click();
  await expect.poll(() => failed.sessions.length).toBe(previousCount + 1);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await failed.sessions.at(-1).fulfill({ json: guest });
  await expect(page.getByRole("dialog")).toContainText(synthetic.name);
  await fillDraft(page); await draftPreserved(page);
  checks.push("explicit identity retry opens the deep link only after guest confirmation, with stable subsequent draft");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: "passed", localOnly: true, writes: 0, uploads: 0, checks }, null, 2));
} catch (error) {
  if (page) await page.screenshot({ path: "tmp/component-session-failure.png", fullPage: true }).catch(() => {});
  throw error;
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
}
