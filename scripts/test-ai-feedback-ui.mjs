import { chromium } from "@playwright/test";
import fs from "node:fs";
import assert from "node:assert/strict";
const browser = await chromium.launch({ headless: true, channel: "msedge" });
try {
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    }),
    origin = "http://127.0.0.1:5173";
  await page
    .context()
    .addCookies([
      {
        name: "pm_session",
        value: JSON.parse(
          fs.readFileSync("tmp/test-admin-browser.json", "utf8"),
        ).token,
        url: origin,
      },
    ]);
  await page.addInitScript(() => localStorage.setItem("pm-language", "zh"));
  await page.goto(origin);
  await page.getByRole("button", { name: /管理后台|Admin/ }).click();
  const panel = page.locator(".model-settings-panel");
  await panel.getByRole("heading", { name: "AI 模型设置与计费" }).waitFor();
  await panel.getByText("模型 API、价格与健康检查", { exact: true }).click();
  const diagnostic = panel
    .locator(".ms-diagnostic")
    .filter({ hasText: "此模型没有可用的 API Key" })
    .first();
  await diagnostic.getByText("查看诊断代码与请求信息").click();
  assert.match(await diagnostic.locator("pre").innerText(), /invocationId/);
  assert.match(await diagnostic.locator("pre").innerText(), /"stage": "key"/);
  await diagnostic.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "tmp/ai-diagnostic-desktop.png" });
  await panel.getByRole("button", { name: "＋ 添加模型" }).click();
  const row = panel.locator(".ms-model-row").last();
  await row
    .getByLabel("价格来源", { exact: true })
    .fill("https://api-docs.deepseek.com/zh-cn/quick_start/pricing/");
  await row.getByRole("button", { name: "从链接读取价格" }).click();
  await row
    .getByRole("button", { name: "填入高峰时段" })
    .waitFor({ timeout: 20000 });
  assert.equal(
    await row.getByLabel("输入 / 百万 Token", { exact: true }).inputValue(),
    "",
  );
  await row.getByRole("button", { name: "填入高峰时段" }).click();
  assert.ok(
    Number(
      await row.getByLabel("输入 / 百万 Token", { exact: true }).inputValue(),
    ) > 0,
  );
  assert.equal(
    await row.getByLabel("币种", { exact: true }).inputValue(),
    "CNY",
  );
  const input = await row
    .getByLabel("输入 / 百万 Token", { exact: true })
    .inputValue();
  await row.locator(".ms-price-reader").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "tmp/ai-pricing-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await page.screenshot({ path: "tmp/ai-pricing-mobile.png" });
  await row
    .getByLabel("价格来源", { exact: true })
    .fill("https://example.com/unsupported");
  await row.getByRole("button", { name: "从链接读取价格" }).click();
  await row.getByText("price-source-unsupported", { exact: true }).waitFor();
  assert.equal(
    await row.getByLabel("输入 / 百万 Token", { exact: true }).inputValue(),
    input,
  );
  await row.getByRole("button", { name: "移除未保存项" }).click();
  console.log(
    JSON.stringify({
      result: "passed",
      coverage: [
        "persisted diagnostic code/stage/request",
        "real official pricing fetch",
        "explicit tier fills draft",
        "unsupported source keeps existing price",
        "desktop/mobile",
      ],
      liveAI: false,
    }),
  );
} finally {
  await browser.close();
}
