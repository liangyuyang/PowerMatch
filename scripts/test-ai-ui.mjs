import { chromium } from "@playwright/test";
import fs from "node:fs";
import assert from "node:assert/strict";
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const origin = "http://127.0.0.1:5173";
const { token } = JSON.parse(
  fs.readFileSync("tmp/test-admin-browser.json", "utf8"),
);
await page
  .context()
  .addCookies([{ name: "pm_session", value: token, url: origin }]);
await page.addInitScript(() => localStorage.setItem("pm-language", "zh"));
await page.goto(origin);
await page.getByRole("button", { name: "AI 设计助手", exact: true }).click();
await page.getByLabel("设计需求").fill("保留耗电参数，帮我比较");
await page.keyboard.press("Escape");
assert.equal(await page.getByRole("dialog").count(), 0);
assert.equal(
  await page
    .getByRole("button", { name: "AI 设计助手", exact: true })
    .evaluate((e) => e === document.activeElement),
  true,
);
await page.getByRole("button", { name: "AI 设计助手", exact: true }).click();
assert.equal(
  await page.getByLabel("设计需求").inputValue(),
  "保留耗电参数，帮我比较",
);
await page.locator(".backdrop").click({ position: { x: 4, y: 4 } });
assert.equal(await page.getByRole("dialog").count(), 0);
await page.getByRole("button", { name: "AI 设计助手", exact: true }).click();
await page.getByRole("button", { name: "Close", exact: true }).click();
await page.locator(".component-node").first().click();
await page.getByLabel("搜索元器件").fill("OPV");
await page.screenshot({ path: "tmp/ai-component-picker.png" });
await page.keyboard.press("Escape");
await page.locator(".component-node").first().click();
assert.equal(await page.getByLabel("搜索元器件").inputValue(), "OPV");
await page.getByRole("button", { name: "Close", exact: true }).click();
await page.getByRole("button", { name: /管理后台|Admin/ }).click();
await page.getByRole("heading", { name: "AI 模型与调用" }).waitFor();
await page.screenshot({ path: "tmp/ai-admin-desktop.png", fullPage: true });
await page.setViewportSize({ width: 390, height: 844 });
assert.ok(
  await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  ),
  "mobile overflow",
);
await page.screenshot({ path: "tmp/ai-admin-mobile.png", fullPage: true });
// Mock provider-facing UI boundary only. No real model/API acceptance is claimed.
await page.route("**/api/ai/models", (r) =>
  r.fulfill({
    json: {
      models: [
        {
          id: "fixture",
          name: "UI test",
          provider: "deepseek",
          isDefault: true,
        },
      ],
    },
  }),
);
await page.getByRole("button", { name: /工作台|Workbench/ }).click();
await page.getByRole("button", { name: "AI 设计助手", exact: true }).click();
await page.getByRole("button", { name: "刷新", exact: true }).click();
await page.screenshot({ path: "tmp/ai-assistant-mobile.png", fullPage: true });
await page.setViewportSize({ width: 1440, height: 1000 });
await page.route("**/api/ai/assist", async (route) => {
  const request = route.request().postDataJSON(),
    design = structuredClone(request.design);
  design.mode = "battery";
  const result = {
    status: "conditional",
    runtimeHours: 720,
    darkHours: 720,
    missing: [],
    errors: [],
    warnings: ["conditional-model"],
  };
  await route.fulfill({
    json: {
      design,
      proposal: {
        explanation: "UI fixture: battery comparison",
        assumptions: [],
        actions: [],
      },
      changes: [
        { path: "mode", before: request.design.mode, after: "battery" },
      ],
      sources: [],
      before: { ...result, status: "incomplete" },
      result,
      model: "UI fixture",
      usage: { input: 10, output: 5, cost: null },
    },
  });
});
await page.getByLabel("设计需求").fill("Compare battery");
await page.getByRole("button", { name: "发送", exact: true }).click();
await page.getByRole("button", { name: "应用到草稿", exact: true }).waitFor();
await page.screenshot({ path: "tmp/ai-assistant-desktop.png" });
await page.getByRole("button", { name: "应用到草稿", exact: true }).click();
await page.getByRole("button", { name: "撤销 AI 调整", exact: true }).click();
await page.getByRole("button", { name: "AI 设计助手", exact: true }).click();
await page.getByLabel("设计需求").fill("Compare battery again");
await page.getByRole("button", { name: "发送", exact: true }).click();
await page.getByRole("button", { name: "复制为对比方案", exact: true }).click();
assert.ok((await page.locator(".compare-card").count()) >= 2);
await browser.close();
console.log(
  JSON.stringify({
    result: "passed",
    coverage: [
      "assistant close/Escape/backdrop/focus/draft",
      "clickable component selector",
      "admin desktop/mobile",
      "mocked AI apply/undo/compare",
    ],
    liveAI: false,
  }),
);
