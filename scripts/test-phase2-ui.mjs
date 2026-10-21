import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { CATALOG } from "../src/shared/catalog.ts";
const origin = "http://127.0.0.1:5173";
const { token } = JSON.parse(
  fs.readFileSync("tmp/test-admin-browser.json", "utf8"),
);
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const checks = [];
try {
  const ctx = await browser.newContext({
    locale: "zh-CN",
    viewport: { width: 1440, height: 1050 },
  });
  await ctx.addCookies([{ name: "pm_session", value: token, url: origin }]);
  const page = await ctx.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const ready = () =>
    expect(
      page.getByRole("button", { name: "保存版本", exact: true }),
    ).toBeEnabled();
  const nav = (name) =>
    page.getByRole("navigation").getByRole("button", { name, exact: true });
  const dialog = () => page.getByRole("dialog");
  await page.goto(origin);
  await expect(page.locator("nav button")).toHaveCount(6);
  if (
    (await page
      .getByRole("combobox", { name: "Language", exact: true })
      .inputValue()) !== "zh"
  ) {
    const preferenceSaved = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/preferences") &&
        r.request().method() === "PATCH",
    );
    await page
      .getByRole("combobox", { name: "Language", exact: true })
      .selectOption("zh");
    await preferenceSaved;
  }
  await ready();
  await page.locator(".design-bar input").fill("Keep navigation draft");
  await nav("元器件库").click();
  await page.goBack();
  await expect(page.locator(".design-bar input")).toHaveValue(
    "Keep navigation draft",
  );
  await page.goForward();
  await expect(
    page.getByRole("heading", { name: "元器件库", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator("nav button")).toHaveCount(6);
  await expect(
    page.getByRole("heading", { name: "元器件库", exact: true }),
  ).toBeVisible();
  checks.push(
    "page URLs, reload, browser back/forward preserve workbench draft",
  );

  const add = page.getByRole("button", { name: "新增元器件", exact: true });
  await add.click();
  await dialog().getByLabel("类别").selectOption("pv");
  await dialog().getByLabel("元器件名称", { exact: true }).fill("自定义室内光伏模块");
  const field = () =>
    dialog().getByLabel("参考照度下功率密度 (µW/cm²)", { exact: true });
  await field().fill("4.21160011658409");
  await field().blur();
  await expect(field()).toHaveValue("4.21");
  await dialog().getByText("高级：其他参数 / JSON", { exact: true }).click();
  const json = () => dialog().getByLabel("JSON", { exact: true });
  const source = JSON.parse(await json().inputValue());
  assert.equal(source.densityUwCm2, 4.21160011658409);
  assert.equal(source.voltage, undefined);
  await json().fill(
    JSON.stringify({ ...source, customNote: "preserve this", voltage: null }),
  );
  await field().fill("5.125");
  await field().blur();
  assert.equal(
    JSON.parse(await json().inputValue()).customNote,
    "preserve this",
  );
  await json().fill("{broken");
  await expect(dialog().getByRole("alert")).toContainText("参数格式无效");
  await expect(
    dialog().getByRole("button", { name: "保存元器件", exact: true }),
  ).toBeDisabled();
  await json().fill(
    JSON.stringify({ ...source, customNote: "preserve this", voltage: null }),
  );
  for (const close of ["escape", "button", "backdrop"]) {
    if (close === "escape") await page.keyboard.press("Escape");
    else if (close === "button")
      await dialog()
        .getByRole("button", { name: "Close", exact: true })
        .click();
    else await page.locator(".backdrop").click({ position: { x: 5, y: 5 } });
    await expect(dialog()).toHaveCount(0);
    await expect(add).toBeFocused();
    await add.click();
    await expect(field()).toHaveValue("4.21");
  }
  await page.screenshot({ path: "tmp/phase2-parameters.png" });
  await page.keyboard.press("Escape");
  checks.push(
    "structured fields preserve precision, unknown and advanced keys; invalid JSON blocks submit; all close methods retain inputs and restore focus",
  );

  // A saved case must never remain the save destination after editing a comparison snapshot.
  await nav("设计工作台").click();
  const save = async () => {
    await page.getByRole("button", { name: "保存版本", exact: true }).click();
    const done = page.waitForResponse(
      (r) => r.url().endsWith("/api/cases") && r.request().method() === "POST",
    );
    await dialog()
      .getByRole("button", { name: "保存版本", exact: true })
      .click();
    const response = await done;
    assert.equal(response.status(), 200);
    await expect(dialog()).toHaveCount(0);
    return {
      body: await response.json(),
      sent: response.request().postDataJSON(),
    };
  };
  const saved = await save();
  await nav("方案对比").click();
  await page
    .getByRole("button", { name: "作为副本继续设计", exact: true })
    .first()
    .click();
  await expect(page.locator(".design-bar .badge").last()).toHaveText("DRAFT");
  const copy = await save();
  assert.notEqual(copy.body.id, saved.body.id);
  assert.equal(copy.sent.id, undefined);
  assert.equal(copy.sent.scope, "private");
  checks.push(
    "editing a comparison snapshot creates a private independent case",
  );

  const link = `${origin}/?page=hall&case=${saved.body.id}&revision=${saved.body.revisionId}`;
  await page.locator(".design-bar input").fill("Keep before opening share");
  await page.goto(link);
  await expect(dialog()).toContainText("请先保存");
  await page.keyboard.press("Escape");
  await nav("设计工作台").click();
  await expect(page.locator(".design-bar input")).toHaveValue(
    "Keep before opening share",
  );
  await page.goto(link);
  await dialog()
    .getByRole("button", { name: "打开链接中的案例", exact: true })
    .click();
  await expect(page.locator(".design-bar input")).toHaveValue(
    "Keep navigation draft",
  );
  const guest = await browser.newPage({ locale: "zh-CN" });
  await guest.goto(link);
  await guest
    .getByRole("dialog")
    .getByRole("button", { name: "打开链接中的案例", exact: true })
    .click();
  await expect(guest.getByRole("dialog")).toContainText("not-found");
  await guest.close();
  checks.push(
    "revision deep links require an explicit open; dismiss preserves draft; private links deny guests",
  );

  await page.route("**/api/components", (r) =>
    r.fulfill({ json: { components: CATALOG } }),
  );
  await page.goto(origin + "/?page=library");
  await expect(page.locator(".component-card")).toHaveCount(24);
  await page.getByRole("button", { name: "加载更多", exact: true }).click();
  await expect(page.locator(".component-card")).toHaveCount(CATALOG.length);
  await page.getByRole("textbox", { name: "搜索型号、厂家…" }).fill("LL200");
  await expect(page.locator(".component-card")).toHaveCount(1);
  await page
    .locator(".component-card")
    .getByRole("button", { name: "查看资料", exact: true })
    .click();
  await expect(dialog().locator(".parameter-table")).toContainText(
    "4.21 µW/cm²",
  );
  await page.keyboard.press("Escape");
  checks.push(
    "component library renders 24 cards then loads more; search covers the complete catalog",
  );

  // Delay the first scope; the later scope must win even if its predecessor returns last.
  await page.route("**/api/cases?*", async (route) => {
    const url = new URL(route.request().url());
    const scope = url.searchParams.get("scope");
    const more = url.searchParams.has("cursor");
    if (scope === "company") await new Promise((r) => setTimeout(r, 300));
    try {
      await route.fulfill({
        json: {
          cases: [
            {
              id: `${scope}-${more ? 2 : 1}`,
              name: `${scope}-${more ? 2 : 1}`,
              scope: scope === "mine" ? "public" : scope,
              latest_revision: 1,
              official: 0,
              updated_at: "2026-10-21",
            },
          ],
          nextCursor: more ? null : "next",
        },
      });
    } catch {
      /* request may have been aborted */
    }
  });
  await nav("公开大厅").click();
  await page.getByRole("button", { name: "公司分享", exact: true }).click();
  await page.getByRole("button", { name: "仅自己", exact: true }).click();
  await expect(page.locator(".cards h2")).toHaveText("private-1");
  await page.getByRole("button", { name: "加载更多", exact: true }).click();
  await expect(page.locator(".cards h2")).toHaveText([
    "private-1",
    "private-2",
  ]);
  checks.push(
    "scope races cannot reveal stale cards; case pagination appends without replacing the list",
  );

  await nav("设计工作台").click();
  await page
    .getByRole("combobox", { name: "Language", exact: true })
    .selectOption("ja");
  await page
    .getByRole("button", { name: / · 情報$/ })
    .first()
    .click();
  await expect(page.locator(".component-popover")).toContainText("部品の詳細");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await page.screenshot({ path: "tmp/phase2-mobile.png", fullPage: true });
  assert.deepEqual(errors, []);
  checks.push(
    "Japanese component popover, mobile reflow and no browser exceptions",
  );
  console.log(
    JSON.stringify({
      result: "passed",
      checks,
      productionWrites: 0,
      realAI: false,
    }),
  );
} finally {
  await browser.close();
}
