import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { CATALOG } from "../src/shared/catalog.ts";

const origin = process.env.POWERMATCH_TEST_ORIGIN ?? "http://127.0.0.1:5173";
const browser = await chromium.launch({headless: true, channel: "msedge"});
const checks = [], errors = [];
try {
  const context = await browser.newContext({locale: "en-US", viewport: {width: 1440, height: 1050}});
  await context.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const body = path === "/api/session" ? {user: null, emailConfigured: false}
      : path === "/api/components" ? {components: CATALOG} : {};
    await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify(body)});
  });
  await context.addInitScript(() => {
    localStorage.setItem("pm-language", "en");
    const NativeWorker = window.Worker;
    window.__backgroundTest = {delay: 0, fail: false, posted: 0, created: 0, terminated: 0};
    window.Worker = class extends NativeWorker {
      constructor(...args) { super(...args); ++window.__backgroundTest.created; }
      postMessage(...args) {
        ++window.__backgroundTest.posted;
        if (window.__backgroundTest.fail) throw new Error("synthetic-worker-failure");
        const delay = window.__backgroundTest.delay;
        if (delay) setTimeout(() => { try { super.postMessage(...args); } catch {} }, delay);
        else super.postMessage(...args);
      }
      terminate() { ++window.__backgroundTest.terminated; super.terminate(); }
    };
    window.print = () => { window.__printed = true; };
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin);
  const save = page.getByRole("button", {name: "Save revision", exact: true});
  const report = page.getByRole("button", {name: "Export PDF", exact: true});
  const json = page.getByRole("button", {name: "JSON", exact: true});
  const ai = page.getByRole("button", {name: "AI assistant", exact: true});
  const horizon = page.locator("label.field").filter({hasText: "Simulation days"}).locator("input");
  await expect(save).toBeEnabled();
  assert.ok(await page.evaluate(() => window.__backgroundTest.created >= 1));
  checks.push("Real module worker settles under development React StrictMode");
  await page.evaluate(() => { window.__backgroundTest.delay = 450; });
  await horizon.fill("180");
  await expect(page.locator('[data-calculation="pending"]')).toBeVisible();
  await expect(save).toBeDisabled();
  await expect(report).toBeDisabled();
  await expect(json).toBeDisabled();
  await expect(ai).toBeDisabled();
  await expect(page.locator(".hero-metric").first()).not.toContainText("≥ 720 h");
  await page.waitForTimeout(110);
  await horizon.fill("365");
  await expect(save).toBeEnabled();
  await expect(page.locator('[data-calculation="pending"]')).toHaveCount(0);
  assert.ok(await page.evaluate(() => window.__backgroundTest.terminated >= 1));
  checks.push("Rapid A to B edits cancel obsolete work; current save, PDF, JSON and AI remain fenced until B is ready");

  const downloaded = page.waitForEvent("download");
  await json.click();
  const download = await downloaded;
  const text = await new Promise(async (resolve, reject) => {
    const stream = await download.createReadStream(), chunks = [];
    stream.on("data", chunk => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString()));
    stream.on("error", reject);
  });
  const design = JSON.parse(text).design;
  assert.equal(design.horizonDays, 365);
  const expected = await page.evaluate(async design => { const {calculate} = await import("/src/shared/engine.ts"); const result = calculate(design); return {runtimeHours: result.runtimeHours}; }, design);
  const runtime = expected.runtimeHours === null ? `≥ ${design.horizonDays * 24} h` : `${Number(expected.runtimeHours.toFixed(2))} h`;
  await expect(page.locator(".hero-metric").first()).toContainText(runtime);
  checks.push("Exported inputs match the finished 365-day result and unchanged deterministic engine");

  const posted = await page.evaluate(() => window.__backgroundTest.posted);
  await page.locator(".design-bar input").fill("Metadata-only title");
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.__backgroundTest.posted), posted);
  await horizon.fill("180");
  await expect(save).toBeEnabled();
  await page.evaluate(() => { window.__backgroundTest.delay = 0; window.__backgroundTest.fail = true; });
  await horizon.fill("179");
  await expect(page.locator('[data-calculation="error"]')).toBeVisible();
  await expect(save).toBeDisabled();
  await expect(report).toBeDisabled();
  await page.evaluate(() => { window.__backgroundTest.fail = false; });
  await page.getByRole("button", {name: "Retry calculation", exact: true}).click();
  await expect(save).toBeEnabled();
  checks.push("Metadata edits reuse cached results; worker failure preserves inputs, settles error and supports retry");

  await page.getByRole("navigation").getByRole("button", {name: "Compare", exact: true}).click();
  await expect(report).toBeEnabled();
  await expect(page.locator(".compare-card")).toHaveCount(3);
  await report.click();
  await expect(page.locator(".print-report .parameter-table").nth(1).locator("tbody tr")).toHaveCount(3);
  const frozen = await page.locator(".print-report").innerText();
  await page.getByRole("navigation").getByRole("button", {name: "Workbench", exact: true}).click();
  await page.locator(".design-bar input").fill("Edited after print snapshot");
  await horizon.fill("10");
  assert.equal(await page.locator(".print-report").innerText(), frozen);
  checks.push("Comparison print includes three complete results and freezes design/conditions/evidence across later draft edits");
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await page.getByRole("navigation").getByRole("button", {name: "Components", exact: true}).click();
  await page.locator("input.search").fill("LIC 1F");
  await page.locator(".component-card").filter({hasText: "LIC 1F"}).getByRole("button", {name: "Use in design", exact: true}).click();
  await expect(save).toBeEnabled();
  await expect(page.locator(".energy-flow")).toContainText("assumed-lic-1f");
  checks.push("Bundled catalog LIC without version metadata remains a valid calculable/saveable design after template merge");
  assert.deepEqual(errors, []);
  fs.mkdirSync("tmp", {recursive: true});
  fs.writeFileSync("tmp/background-calculation-browser.json", JSON.stringify({origin, checks, errors}, null, 2));
  console.log(JSON.stringify({checks, errors}, null, 2));
} finally { await browser.close(); }
