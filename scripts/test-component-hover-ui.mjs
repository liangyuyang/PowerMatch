import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const browser = await chromium.launch({ headless: true, channel: "msedge" });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1050 },
  });
  await page.addInitScript(() => localStorage.setItem("pm-language", "zh"));
  await page.goto("http://127.0.0.1:5173");
  await page.locator(".app-version").waitFor();
  assert.match(
    await page.locator(".app-version").innerText(),
    /V0\.1\.\d+ · \d{4}\.\d{1,2}\.\d{1,2}/,
  );
  const density = page
    .locator("label")
    .filter({ hasText: "参考光照下功率密度" })
    .locator("input");
  assert.equal(await density.inputValue(), "4.21");
  await density.focus();
  assert.ok((await density.inputValue()).length > 5);
  await page.getByRole("heading", { name: "光照环境", exact: true }).click();
  assert.equal(await density.inputValue(), "4.21");
  const angle = page.getByRole("combobox", { name: "光线照向板面的角度" }),
    start = page
      .locator("label")
      .filter({ hasText: "开灯时间" })
      .locator("input");
  const a = await angle.boundingBox(),
    s = await start.boundingBox();
  assert.ok(Math.abs(a.y - s.y) < 2);
  assert.ok(a.width > s.width * 1.9);
  const first = page.locator(".component-hover").first(),
    node = first.locator(".component-node");
  await node.hover();
  await first.locator(".component-popover").waitFor();
  await first.getByRole("link", { name: "查看元器件详情 →" }).hover();
  assert.equal(await first.locator(".component-popover").count(), 1);
  await page.keyboard.press("Escape");
  assert.equal(await first.locator(".component-popover").count(), 0);
  assert.equal(await node.evaluate((e) => e === document.activeElement), true);
  await page.mouse.move(0, 0);
  await node.hover();
  await first.getByRole("button", { name: "关闭元器件气泡" }).click();
  assert.equal(await first.locator(".component-popover").count(), 0);
  await page.mouse.move(0, 0);
  await node.hover();
  await page.getByRole("heading", { name: "设计工作台", exact: true }).click();
  assert.equal(await page.locator(".component-popover").count(), 0);
  await node.hover();
  await first.getByRole("link", { name: "查看元器件详情 →" }).click();
  await page.getByRole("dialog").waitFor();
  assert.match(page.url(), /#component=powerfilm/);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "设计工作台", exact: true }).click();
  assert.equal(await density.inputValue(), "4.21");
  await page.screenshot({ path: "tmp/polish-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".component-info-trigger").first().click();
  await page.locator(".component-popover").first().waitFor();
  await page.getByRole("button", { name: "关闭元器件气泡" }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await page
      .locator(".flow-arrow")
      .first()
      .evaluate((e) => getComputedStyle(e).animationName),
    "none",
  );
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await page.screenshot({ path: "tmp/polish-mobile.png", fullPage: true });
  console.log(
    JSON.stringify({
      result: "passed",
      checks: [
        "version date",
        "rounded display with full precision retained",
        "angle alignment and width",
        "hover link reachable",
        "Escape/close/click-away/focus",
        "detail navigation/draft preservation",
        "mobile width",
      ],
    }),
  );
} finally {
  await browser.close();
}
