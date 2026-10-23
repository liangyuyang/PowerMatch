import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
const origin = process.env.POWERMATCH_TEST_ORIGIN ?? "http://127.0.0.1:5173";
const browser = await chromium.launch({ headless: true, channel: "msedge" }),
  checks = [],
  errors = [],cspErrors=[];
try {
  const context = await browser.newContext({
    locale: "en-US",
    viewport: { width: 1440, height: 1050 },
  });
  await context.addInitScript(() => {
    localStorage.setItem("pm-language", "en");
    window.__liveOCR = new Set();
    const Native = window.Worker;
    window.Worker = class extends Native {
      constructor(...args) {
        super(...args);
        if (String(args[0]).includes("/ocr-assets/"))
          window.__liveOCR.add(this);
      }
      terminate() {
        window.__liveOCR.delete(this);
        return super.terminate();
      }
    };
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'&&/Content Security Policy|Refused to|Wasm code generation disallowed/i.test(message.text()))cspErrors.push(message.text());});
  const url = origin + "/?page=library#component=powerfilm-ll200-24-75";
  await page.goto(url);
  const dialog = () => page.getByRole("dialog"),
    ocr = () => page.locator(".spec-extraction"),
    file = () => dialog().locator("input[type=file]");
  await expect(ocr()).toBeVisible();
  const fixture = async (capacity) =>
    Buffer.from(
      await page.evaluate(async (capacity) => {
        const c = document.createElement("canvas");
        c.width = 1200;
        c.height = 400;
        const x = c.getContext("2d");
        x.fillStyle = "white";
        x.fillRect(0, 0, c.width, c.height);
        x.fillStyle = "black";
        x.font = "64px Arial";
        x.fillText("Capacity " + capacity + " mAh", 50, 120);
        x.fillText("Rated voltage 3 V", 50, 250);
        return Array.from(
          new Uint8Array(
            await (
              await new Promise((resolve) => c.toBlob(resolve))
            ).arrayBuffer(),
          ),
        );
      }, capacity),
    );
  const a = await fixture(225),
    b = await fixture(450);
  await file().setInputFiles({
    name: "A.png",
    mimeType: "image/png",
    buffer: a,
  });
  await ocr()
    .getByRole("button", { name: "Recognize locally", exact: true })
    .click();
  await expect(
    ocr().getByRole("button", {
      name: "Load candidates for review",
      exact: true,
    }),
  ).toBeEnabled({ timeout: 180000 });
  await expect(ocr()).toContainText("capacityMah: 225 mAh");
  await ocr()
    .getByRole("button", { name: "Load candidates for review", exact: true })
    .click();
  await expect(
    dialog().locator(".post").filter({ hasText: "capacityMah: 225 mAh" }),
  ).toBeVisible();
  console.log(JSON.stringify({stage:'desktop-recognition-passed'}));
  checks.push(
    "Integrated OCR panel recognizes a real local PNG and explicitly loads unverified source candidates into the review form",
  );
  if(new URL(origin).hostname==='127.0.0.1'||new URL(origin).hostname==='localhost') {
  let enter, release;
  const entered = new Promise((resolve) => (enter = resolve)),
    released = new Promise((resolve) => (release = resolve));
  await context.route("**/ocr-assets/**/core/*.wasm.js", async (route) => {
    enter();
    await released;
    try {
      await route.continue();
    } catch {}
  });
  await file().setInputFiles({
    name: "B.png",
    mimeType: "image/png",
    buffer: b,
  });
  await expect(
    ocr().getByRole("button", {
      name: "Load candidates for review",
      exact: true,
    }),
  ).toHaveCount(0);
  await ocr()
    .getByRole("button", { name: "Recognize locally", exact: true })
    .click();
  await Promise.race([entered,new Promise((_,reject)=>setTimeout(()=>reject(Error('WASM route not reached')),30000))]);
  await file().setInputFiles({
    name: "A-again.png",
    mimeType: "image/png",
    buffer: a,
  });
  release();
  await expect(
    ocr().getByRole("button", { name: "Cancel recognition", exact: true }),
  ).toHaveCount(0);
  await expect(
    ocr().getByRole("button", {
      name: "Load candidates for review",
      exact: true,
    }),
  ).toHaveCount(0);
  assert.equal(await page.evaluate(() => window.__liveOCR.size), 0);
  await context.unroute("**/ocr-assets/**/core/*.wasm.js");
  checks.push(
    "Changing the selected file during WASM initialization cancels the old job and never attaches its candidates to the new file",
  );
  let enterClose, releaseClose;
  const enteredClose = new Promise((resolve) => (enterClose = resolve)),
    releasedClose = new Promise((resolve) => (releaseClose = resolve));
  await context.route("**/ocr-assets/**/core/*.wasm.js", async (route) => {
    enterClose();
    await releasedClose;
    try {
      await route.continue();
    } catch {}
  });
  await ocr()
    .getByRole("button", { name: "Recognize locally", exact: true })
    .click();
  await Promise.race([enteredClose,new Promise((_,reject)=>setTimeout(()=>reject(Error('WASM close route not reached')),30000))]);
  await page.keyboard.press("Escape");
  releaseClose();
  await expect(dialog()).toHaveCount(0);
  assert.equal(await page.evaluate(() => window.__liveOCR.size), 0);
  await context.unroute("**/ocr-assets/**/core/*.wasm.js");
  checks.push(
    "Closing the containing modal during startup unmounts OCR and terminates its native worker",
  );
  } else checks.push('Production recognition only; fault-injection/termination acceptance was run against the isolated local build');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url);
  await page.reload();
  await expect(ocr()).toBeVisible();
  await file().setInputFiles({
    name: "mobile.png",
    mimeType: "image/png",
    buffer: a,
  });
  await ocr()
    .getByRole("button", { name: "Recognize locally", exact: true })
    .click();
  await expect(
    ocr().getByRole("button", {
      name: "Load candidates for review",
      exact: true,
    }),
  ).toBeEnabled({ timeout: 180000 });
  assert.ok(
    await ocr().evaluate(
      (element) => element.getBoundingClientRect().right <= innerWidth + 1,
    ),
  );
  checks.push(
    "390px mobile OCR controls, local recognition and candidate review remain usable",
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(cspErrors,[]);
  console.log(JSON.stringify({ checks, errors,cspErrors }, null, 2));
  await context.close();
} finally {
  await browser.close();
}
