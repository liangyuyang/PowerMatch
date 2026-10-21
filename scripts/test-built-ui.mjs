import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";

// Exercise the production asset build through local Wrangler, including _headers.
const browser = await chromium.launch({ headless: true, channel: "msedge" });
try {
  const page = await browser.newPage({ locale: "zh-CN", viewport: { width: 1440, height: 1050 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => window.__cspViolations.push({ directive: event.violatedDirective, blocked: event.blockedURI, source: event.sourceFile, sample: event.sample }));
    window.print = () => {};
  });
  const response = await page.goto("http://127.0.0.1:8787");
  assert.match(response.headers()["content-security-policy"], /script-src 'self';/);
  await expect(page.getByRole("button", { name: "保存版本", exact: true })).toBeEnabled();
  await expect(page.locator(".recharts-surface").first()).toBeVisible();
  await page.getByRole("button", { name: "AI 设计助手", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "导出 PDF", exact: true }).click();
  await expect(page.locator(".print-report")).toContainText("Engine 0.1.1");
  await expect(page.locator(".print-report")).not.toContainText("4.211600");
  await expect(page.locator(".print-report")).toContainText("25 nA");
  assert.equal(await page.locator(".report-logo").evaluate((img) => img.naturalWidth > 0), true);
  await page.emulateMedia({ media: "print" });
  await page.pdf({ path: "tmp/phase1-local/report.pdf", format: "A4", printBackground: true });
  await page.emulateMedia({ media: "screen" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: "tmp/phase1-local/built-mobile.png", fullPage: true });
  assert.deepEqual(await page.evaluate(() => window.__cspViolations), []);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: "passed", checks: ["production asset CSP", "chart and AI lazy chunks", "branded print PDF", "mobile layout", "no CSP violations or page errors"], liveAI: false }));
} finally { await browser.close(); }
