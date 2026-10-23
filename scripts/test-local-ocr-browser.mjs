import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const origin = process.env.POWERMATCH_TEST_ORIGIN ?? "http://127.0.0.1:5173";
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const checks = [],
  requests = [],
  errors = [];
try {
  const context = await browser.newContext({
      viewport: { width: 1200, height: 900 },
    }),
    page = await context.newPage();
  page.on("request", (request) => requests.push(request.url()));
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  const result = await page.evaluate(async () => {
    const { createLocalOCRTask } = await import("/src/spec-ocr.ts");
    const canvas = document.createElement("canvas");
    canvas.width = 1400;
    canvas.height = 500;
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, 1400, 500);
    context.fillStyle = "black";
    context.font = "54px Arial";
    window.__ocrFixtureCanvas = canvas;
    [
      "Rated voltage 3 V",
      "Capacity 225 mAh",
      "Quiescent current 25 uA",
    ].forEach((text, i) => context.fillText(text, 50, 100 + i * 120));
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    const task = createLocalOCRTask(
      new File([blob], "ocr-fixture.png", { type: "image/png" }),
      { language: "eng+chi_sim" },
    );
    return task.promise;
  });
  assert.ok(
    result.fields.some(
      (field) => field.parameter === "capacityMah" && field.value === 225,
    ),
  );
  assert.ok(
    result.fields.some(
      (field) => field.parameter === "voltage" && field.value === 3,
    ),
  );
  assert.ok(
    result.fields.every(
      (field) => field.method === "local-ocr" && field.page === 1,
    ),
  );
  assert.ok(
    requests.some(
      (url) =>
        url.includes("/ocr-assets/") && url.includes("chi_sim.traineddata.gz"),
    ),
  );
  assert.ok(
    requests
      .filter((url) => url.includes("/ocr-assets/"))
      .every((url) => new URL(url).origin === origin),
  );
  checks.push(
    "Real browser Tesseract 7 recognizes a synthetic PNG with English+Chinese local language assets and preserves source excerpts/units",
  );
  const pdfResult = await page.evaluate(async () => {
    const { createLocalOCRTask } = await import("/src/spec-ocr.ts"),
      canvas = window.__ocrFixtureCanvas;
    const jpeg = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.95),
      ),
      image = new Uint8Array(await jpeg.arrayBuffer()),
      encoder = new TextEncoder(),
      parts = [encoder.encode("%PDF-1.4\n")],
      offsets = [0];
    const append = (value) =>
        parts.push(typeof value === "string" ? encoder.encode(value) : value),
      length = () => parts.reduce((sum, part) => sum + part.length, 0);
    const object = (number, body) => {
      offsets[number] = length();
      append(number + " 0 obj\n");
      append(body);
      append("\nendobj\n");
    };
    object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
    object(
      3,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 700 250] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>",
    );
    offsets[4] = length();
    append(
      "4 0 obj\n<< /Type /XObject /Subtype /Image /Width 1400 /Height 500 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " +
        image.length +
        " >>\nstream\n",
    );
    append(image);
    append("\nendstream\nendobj\n");
    const content = "q 700 0 0 250 0 0 cm /Im0 Do Q";
    object(
      5,
      "<< /Length " +
        content.length +
        " >>\nstream\n" +
        content +
        "\nendstream",
    );
    const start = length();
    append("xref\n0 6\n0000000000 65535 f \n");
    for (let i = 1; i <= 5; i++)
      append(String(offsets[i]).padStart(10, "0") + " 00000 n \n");
    append(
      "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" + start + "\n%%EOF",
    );
    const file = new File(parts, "synthetic-scanned.pdf", {
      type: "application/pdf",
    });
    return createLocalOCRTask(file, { language: "eng", page: 1 }).promise;
  });
  assert.equal(pdfResult.totalPages, 1);
  assert.equal(pdfResult.page, 1);
  assert.ok(
    pdfResult.fields.some(
      (field) => field.parameter === "capacityMah" && field.value === 225,
    ),
  );
  checks.push(
    "Real bundled PDF.js renders one scanned-PDF page locally, then OCR finds the same 225 mAh candidate without a CDN worker",
  );
  await page.evaluate(() => {
    window.__ocrLiveWorkers = new Set();
    window.__ocrTerminated = 0;
    const Native = window.Worker;
    window.Worker = class extends Native {
      constructor(...args) {
        super(...args);
        if (String(args[0]).includes("/ocr-assets/"))
          window.__ocrLiveWorkers.add(this);
      }
      terminate() {
        if (window.__ocrLiveWorkers.delete(this)) window.__ocrTerminated++;
        return super.terminate();
      }
    };
  });
  let enteredResolve, releaseResolve;
  const entered = new Promise((resolve) => (enteredResolve = resolve)),
    release = new Promise((resolve) => (releaseResolve = resolve));
  await context.route("**/ocr-assets/**/core/*.wasm.js", async (route) => {
    enteredResolve();
    await release;
    try {
      await route.continue();
    } catch {}
  });
  const cancelled = page.evaluate(async () => {
    const { createLocalOCRTask } = await import("/src/spec-ocr.ts");
    const c = document.createElement("canvas");
    c.width = 200;
    c.height = 100;
    const b = await new Promise((resolve) => c.toBlob(resolve));
    window.__cancelOCR = createLocalOCRTask(
      new File([b], "cancel.png", { type: "image/png" }),
      { language: "eng" },
    );
    try {
      await window.__cancelOCR.promise;
      return "unexpected-success";
    } catch (error) {
      return error.name;
    }
  });
  await entered;
  await page.evaluate(() => window.__cancelOCR.cancel());
  releaseResolve();
  assert.equal(await cancelled, "AbortError");
  assert.equal(await page.evaluate(() => window.__ocrLiveWorkers.size), 0);
  assert.equal(await page.evaluate(() => window.__ocrTerminated), 1);
  checks.push(
    "Cancelling during delayed real WASM initialization terminates the captured native worker and settles AbortError without an orphan",
  );
  await context.unroute("**/ocr-assets/**/core/*.wasm.js");
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        checks,
        confidence: result.confidence,
        candidates: result.fields,
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
