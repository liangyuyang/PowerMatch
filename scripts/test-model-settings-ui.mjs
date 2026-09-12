import { chromium } from "@playwright/test";
import fs from "node:fs";
import assert from "node:assert/strict";
const browser = await chromium.launch({ headless: true, channel: "msedge" });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const origin = "http://127.0.0.1:5173";
  await page.context().addCookies([
    {
      name: "pm_session",
      value: JSON.parse(fs.readFileSync("tmp/test-admin-browser.json", "utf8"))
        .token,
      url: origin,
    },
  ]);
  await page.addInitScript(() => localStorage.setItem("pm-language", "zh"));
  await page.goto(origin);
  await page.getByRole("button", { name: /管理后台|Admin/ }).click();
  const panel = page.locator(".model-settings-panel");
  await panel.getByRole("heading", { name: "AI 模型设置与计费" }).waitFor();
  assert.equal(await panel.getByText(/ASR/).count(), 0);
  await panel.getByText("模型 API、价格与健康检查", { exact: true }).click();
  await panel.getByLabel("新增模型提供商").selectOption("gemini");
  await panel.getByRole("button", { name: "＋ 添加模型" }).click();
  const row = panel.locator(".ms-model-row").last();
  assert.equal(
    await row
      .getByLabel("Base URL · API 基础地址", { exact: true })
      .inputValue(),
    "https://generativelanguage.googleapis.com/v1beta/openai",
  );
  await row.getByLabel("显示名称", { exact: true }).fill("未保存草稿");
  await row.locator('label').filter({hasText:'计费方式'}).locator('select').selectOption("plan");
  await row.locator('label').filter({hasText:'套餐价格'}).locator('input').fill("99");
  await row.locator('label').filter({hasText:'套餐周期'}).locator('select').selectOption("month");
  assert.match(
    await row.getByText(/99 CNY\/月/).innerText(),
    /预算示例/,
  );
  const available = panel.locator(".ms-state-available").first();
  if (await available.count())
    assert.equal(
      await available.evaluate((e) => getComputedStyle(e).fontWeight),
      "800",
    );
  await panel.getByRole("button", { name: "刷新统计", exact: true }).click();
  assert.equal(
    await row.getByLabel("显示名称", { exact: true }).inputValue(),
    "未保存草稿",
  );
  await panel.getByRole("button", { name: "重新读取", exact: true }).click();
  await panel.getByRole("button", { name: "保留当前输入" }).click();
  assert.equal(
    await row.getByLabel("显示名称", { exact: true }).inputValue(),
    "未保存草稿",
  );
  await page.getByRole("button", { name: "设计工作台", exact: true }).click();
  await page.getByRole("button", { name: /管理后台|Admin/ }).click();
  assert.equal(
    await row.getByLabel("显示名称", { exact: true }).inputValue(),
    "未保存草稿",
  );
  await row.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "tmp/model-settings-fields-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await row.scrollIntoViewIfNeeded();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await page.screenshot({ path: "tmp/model-settings-fields-mobile.png" });
  await row.getByRole("button", { name: "移除未保存项" }).click();
  await panel.getByText("运维自检与后台任务", { exact: true }).click();
  await panel.getByRole("button", { name: "刷新自检", exact: true }).click();
  await panel.getByText("基础服务", { exact: true }).waitFor();
  console.log(
    JSON.stringify({
      result: "passed",
      checks: [
        "no ASR",
        "provider autofill",
        "draft survives stats refresh/reload cancel/navigation",
        "expanded desktop/mobile",
        "real local diagnostics",
        "distinct availability typography",
        "structured monthly plan price and estimate",
      ],
    }),
  );
} finally {
  await browser.close();
}
