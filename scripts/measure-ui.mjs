import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
// Repeatable local laboratory samples, not field CWV/INP or production load testing.
const origin = process.env.POWERMATCH_TEST_ORIGIN ?? "http://127.0.0.1:8787";
const output = process.argv[2] ?? "tmp/phase2-performance.json";
if (!/^tmp\/[a-z0-9-]+\.json$/.test(output))
  throw new Error("Use a local tmp/*.json output");
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const samples = [];
try {
  for (const mobile of [false, true])
    for (let repeat = 0; repeat < 3; repeat++) {
      const context = await browser.newContext({
        locale: "zh-CN",
        viewport: mobile
          ? { width: 390, height: 844 }
          : { width: 1440, height: 1050 },
      });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      if (mobile) await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      await page.addInitScript(() => {
        window.__perf = { lcp: 0, cls: 0, longTasks: [] };
        new PerformanceObserver((l) =>
          l.getEntries().forEach((e) => (window.__perf.lcp = e.startTime)),
        ).observe({ type: "largest-contentful-paint", buffered: true });
        new PerformanceObserver((l) =>
          l
            .getEntries()
            .filter((e) => !e.hadRecentInput)
            .forEach((e) => (window.__perf.cls += e.value)),
        ).observe({ type: "layout-shift", buffered: true });
        new PerformanceObserver((l) =>
          l
            .getEntries()
            .forEach((e) => window.__perf.longTasks.push(e.duration)),
        ).observe({ type: "longtask", buffered: true });
      });
      for (const cache of ["cold", "warm"]) {
        const start = Date.now();
        await page.goto(origin);
        await expect(
          page.getByRole("button", { name: "保存版本", exact: true }),
        ).toBeEnabled();
        await page.locator(".chart").first().scrollIntoViewIfNeeded();
        await expect(page.locator(".recharts-surface").first()).toBeVisible();
        const readyMs = Date.now() - start;
        if (cache === "cold")
          await page
            .getByRole("main")
            .getByRole("button", { name: "方案对比", exact: true })
            .click();
        else
          await page
            .getByRole("navigation")
            .getByRole("button", { name: "方案对比", exact: true })
            .click();
        await expect(page.locator(".compare-card")).toHaveCount(4);
        // Chart mounting is viewport driven; exercise every card explicitly.
        for (const chart of await page.locator(".compare-card .chart").all()) {
          await chart.scrollIntoViewIfNeeded();
          await expect(chart.locator(".recharts-wrapper")).toHaveCount(1);
        }
        await expect(page.getByRole("button", {name: "导出 PDF", exact: true})).toBeEnabled();
        await page
          .getByRole("button", { name: "设计工作台", exact: true })
          .first()
          .click();
        const horizon = page.getByLabel("仿真天数", { exact: false });
        // Select by known field label; fail loudly if the UI changes.
        await expect(horizon).toHaveCount(1);
        await horizon.fill("30");
        await horizon.blur();
        const change = Date.now();
        await horizon.fill("365");
        await horizon.blur();
        await page.evaluate(
          () =>
            new Promise((r) =>
              requestAnimationFrame(() => requestAnimationFrame(r)),
            ),
        );
        const longSimulationPaintMs = Date.now() - change;
        await expect(page.getByRole("button", {name: "保存版本", exact: true})).toBeEnabled();
        const longSimulationReadyMs = Date.now() - change;
        const metrics = await page.evaluate(() => ({
          ...window.__perf,
          fcp:
            performance.getEntriesByName("first-contentful-paint")[0]
              ?.startTime ?? null,
          scriptBytes: performance
            .getEntriesByType("resource")
            .filter((r) => r.name.endsWith(".js"))
            .reduce((n, r) => n + r.encodedBodySize, 0),
        }));
        samples.push({
          mobile,
          cpuSlowdown: mobile ? 4 : 1,
          repeat,
          cache,
          readyMs,
          longSimulationPaintMs,
          longSimulationReadyMs,
          ...metrics,
        });
      }
      await context.close();
    }
  fs.mkdirSync("tmp", { recursive: true });
  fs.writeFileSync(
    output,
    JSON.stringify(
      {
        environment:
          "Home PC / Edge headless / local Workers assets; CPU slowdown is not a physical phone",
        samples,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ output, samples: samples.length }));
} finally {
  await browser.close();
}
