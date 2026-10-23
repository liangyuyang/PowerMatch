import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const origin = process.env.POWERMATCH_TEST_ORIGIN ?? "http://127.0.0.1:5173";
const browser = await chromium.launch({ headless: true, channel: "msedge" }),
  checks = [],
  errors = [],
  requests = [];
try {
  const context = await browser.newContext(),
    page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  context.on("request", (request) => {
    if (request.url().includes("/ocr-assets/")) requests.push(request.url());
  });
  await page.goto(origin);
  const output = await page.evaluate(async () => {
    const { createLocalOCRTask } = await import("/src/spec-ocr.ts");
    const c = document.createElement("canvas");
    c.width = 1200;
    c.height = 400;
    const x = c.getContext("2d");
    x.fillStyle = "white";
    x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = "black";
    x.font = "64px Arial";
    x.fillText("Capacity 225 mAh", 50, 120);
    x.fillText("Rated voltage 3 V", 50, 250);
    window.__downloadPNG = await new Promise((resolve) => c.toBlob(resolve));
    window.__downloadWorkerStarts = [];
    const Native = window.Worker;
    window.Worker = class extends Native {
      constructor(...args) {
        super(...args);
        if (String(args[0]).includes("/ocr-assets/"))
          window.__downloadWorkerStarts.push(performance.now());
      }
    };
    const progress = [];
    const result = await createLocalOCRTask(
      new File([window.__downloadPNG], "download-progress.png", {
        type: "image/png",
      }),
      {
        language: "eng+chi_sim",
        onProgress: (status, value) =>
          progress.push({ status, value, at: performance.now() }),
      },
    ).promise;
    return { result, progress, workerStarts: window.__downloadWorkerStarts };
  });
  assert.ok(
    output.result.fields.some(
      (field) => field.parameter === "capacityMah" && field.value === 225,
    ),
  );
  const download = output.progress.filter((event) =>
    event.status.startsWith("Downloading OCR language data"),
  );
  assert.ok(download.length > 3);
  assert.ok(download.some((event) => event.value > 0 && event.value < 1));
  assert.ok(
    download.every(
      (event) =>
        event.status.includes("eng:") &&
        event.status.includes("chi_sim:") &&
        event.status.includes(" MB"),
    ),
  );
  assert.ok(output.workerStarts[0] >= download.at(-1).at);
  assert.ok(requests.every((url) => new URL(url).origin === origin));
  checks.push(
    "Real English+Chinese language downloads emit incremental byte/MB progress before starting the OCR worker; actual PNG225mAh is recognized",
  );
  let enter, release;
  const entered = new Promise((resolve) => (enter = resolve)),
    released = new Promise((resolve) => (release = resolve));
  await context.route(
    "**/ocr-assets/**/lang/*.traineddata.gz",
    async (route) => {
      enter();
      await released;
      try {
        await route.continue();
      } catch {}
    },
  );
  const cancelled = page.evaluate(async () => {
    const { createLocalOCRTask } = await import("/src/spec-ocr.ts");
    window.__downloadCancel = createLocalOCRTask(
      new File([window.__downloadPNG], "cancel-before-worker.png", {
        type: "image/png",
      }),
      { language: "eng+chi_sim" },
    );
    try {
      await window.__downloadCancel.promise;
      return "unexpected-success";
    } catch (error) {
      return error.name;
    }
  });
  await entered;
  await page.evaluate(() => window.__downloadCancel.cancel());
  release();
  assert.equal(await cancelled, "AbortError");
  assert.equal(
    await page.evaluate(() => window.__downloadWorkerStarts.length),
    1,
  );
  checks.push(
    "Cancelling while language downloads await response settles AbortError and creates no additional OCR worker",
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        checks,
        progressEvents: download.length,
        firstProgress: download[0].status,
        lastProgress: download.at(-1).status,
        errors,
      },
      null,
      2,
    ),
  );
  await context.close();
} finally {
  await browser.close();
}
