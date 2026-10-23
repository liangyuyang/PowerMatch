// Local-only browser acceptance. All catalog/spec writes are synthetic fixtures.
import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
import assert from "node:assert/strict";

const origin = process.env.POWERMATCH_TEST_ORIGIN ?? "http://127.0.0.1:5173";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) throw Error("local-fixture-origin-required");
const { token } = JSON.parse(fs.readFileSync(process.env.POWERMATCH_TEST_SESSION ?? "tmp/test-admin-browser.json", "utf8"));
const checks = [], errors = [], name = "Synthetic field QA " + Date.now();
const browser = await chromium.launch({ headless: true, channel: "msedge" });
let page;
try {
  const context = await browser.newContext({ locale: "en-US", viewport: { width: 1440, height: 1050 } });
  await context.addCookies([{ name: "pm_session", value: token, url: origin }]);
  await context.addInitScript(() => { localStorage.clear(); localStorage.setItem("pm-language", "en"); window.print = () => {}; });
  page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.route("https://**", route => route.abort());
  const api = async (path, data) => {
    const response = await context.request.fetch(origin + "/api" + path, { method: data ? "POST" : "GET", headers: { Origin: origin }, data });
    assert.equal(response.status(), 200, `local API ${path}: ${response.status()}`);
    return response.json();
  };
  const fixture = await api("/components", { name, category: "battery", manufacturer: "LOCAL SYNTHETIC QA", source: "https://example.test/synthetic", description: "Synthetic test values; not manufacturer specifications", parameters: { voltage: 3, capacityMah: 30, minVoltage: 2, leakUa: 0, esr: 0 } });
  await page.goto(origin + "/?page=library");
  await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("en");
  await expect(page.getByRole("button", { name: "New component", exact: true })).toBeEnabled();
  await page.locator(".search").fill(name);
  const card = () => page.locator(".component-card").filter({ has: page.getByRole("heading", { name, exact: true }) });
  const open = () => card().getByRole("button", { name: "View details", exact: true });
  const dialog = () => page.getByRole("dialog");
  const editor = () => dialog().locator(".spec-evidence-editor");
  const field = parameter => editor().getByRole("group", { name: new RegExp("^" + parameter + " ·") });
  const file = () => dialog().locator('input[type="file"]');
  const upload = () => dialog().getByRole("button", { name: "Upload spec", exact: true });
  const png = suffix => ({ name: `${suffix}.png`, mimeType: "image/png", buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, suffix === "source-A" ? 1 : 2]) });
  const addField = async parameter => editor().locator("select").selectOption(parameter);
  const fillSource = async (parameter, quote, pageNumber = "2") => {
    await field(parameter).getByLabel("Source page (blank if unknown)", { exact: true }).fill(pageNumber);
    await field(parameter).getByRole("textbox", { name: "Source excerpt", exact: true }).fill(quote);
    await field(parameter).getByLabel("Test conditions (temperature, light, load, etc.)", { exact: true }).fill("Synthetic fixture conditions, not measured");
  };

  await open().click();
  await file().setInputFiles(png("source-A"));
  await addField("capacityMah");
  await fillSource("capacityMah", "Synthetic source-A capacity claim");
  for (const close of [
    () => page.keyboard.press("Escape"),
    () => page.locator(".backdrop").click({ position: { x: 4, y: 4 } }),
    () => dialog().getByRole("button", { name: "Close", exact: true }).click(),
  ]) {
    await close();
    await expect(dialog()).toHaveCount(0);
    await expect(open()).toBeFocused();
    await open().click();
    await expect(field("capacityMah").getByRole("textbox", { name: "Source excerpt", exact: true })).toHaveValue("Synthetic source-A capacity claim");
    await expect(upload()).toBeEnabled();
  }
  checks.push("visible close, Escape and backdrop restore trigger focus and preserve field/file draft");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1050 });
    await dialog().evaluate(element => { element.scrollTop = element.scrollHeight; });
    const close = dialog().getByRole("button", { name: "Close", exact: true });
    await expect(close).toBeVisible();
    const bounds = await close.boundingBox(), viewport = page.viewportSize();
    assert.ok(bounds && viewport && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height,
      `sticky modal close must stay inside the ${width}px viewport at the bottom`);
    const modalPosition = await dialog().evaluate(element => ({ top: element.scrollTop, height: element.clientHeight, total: element.scrollHeight }));
    assert.ok(modalPosition.top > 0 && modalPosition.top + modalPosition.height >= modalPosition.total - 2,
      "long component modal was actually scrolled to its bottom");
    await page.screenshot({ path: `tmp/spec-fields-sticky-close-${width}.png`, fullPage: true });
    await close.click();
    await expect(dialog()).toHaveCount(0);
    await expect(open()).toBeFocused();
    await open().click();
    await expect(field("capacityMah").getByRole("textbox", { name: "Source excerpt", exact: true })).toHaveValue("Synthetic source-A capacity claim");
    await expect(upload()).toBeEnabled();
  }
  await page.setViewportSize({ width: 1440, height: 1050 });
  checks.push("desktop and 390px bottom-scrolled modal keeps close visible inside viewport and preserves draft/focus after closing");
  await file().setInputFiles(png("source-B"));
  await expect(editor().locator("fieldset")).toHaveCount(0);
  checks.push("changing selected file clears prior field provenance");

  await file().setInputFiles(png("source-A"));
  await addField("capacityMah"); await fillSource("capacityMah", "Synthetic source-A capacity claim");
  await addField("voltage"); await fillSource("voltage", "Synthetic source-A voltage claim", "3");
  const uploaded = page.waitForResponse(response => response.url().endsWith(`/api/components/${fixture.id}/specs`) && response.request().method() === "POST");
  await upload().click();
  const uploadedResponse = await uploaded;
  assert.equal(uploadedResponse.status(), 200);
  const { id: specId } = await uploadedResponse.json();
  const spec = () => dialog().locator("article.post").filter({ has: page.getByRole("link", { name: "source-A.png", exact: true }) });
  const sourceRow = (await api(`/components/${fixture.id}/specs`)).specs.find(row => row.id === specId);
  assert.equal(JSON.parse(sourceRow.field_evidence_json).length, 2);
  assert.match(sourceRow.sha256, /^[a-f0-9]{64}$/);
  checks.push("synthetic upload persists two claimed field sources and file identity without authenticating content");

  // A loaded PDF candidate must never survive a transition to reviewing Spec S.
  // This endpoint alone is mocked; upload/adoption/history calls use the real local Worker.
  await page.route("**/api/specs/extract", route => route.fulfill({ json: { pages: 1, ocrRequired: false, candidates: [{ parameter: "voltage", value: 3.3, unit: "V", page: 1, excerpt: "Synthetic unrelated source-B candidate", conditions: "", method: "pdf-text" }] } }));
  await file().setInputFiles({ name: "unrelated-B.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\nSynthetic unrelated candidate fixture") });
  await dialog().getByRole("button", { name: "Extract PDF candidates", exact: true }).click();
  await expect(dialog().getByRole("button", { name: "Use candidate", exact: true })).toHaveCount(1);
  await spec().getByRole("button", { name: "Review candidates", exact: true }).click();
  await expect(dialog().getByRole("button", { name: "Use candidate", exact: true })).toHaveCount(0);
  await expect(editor().locator("fieldset")).toHaveCount(2);
  await expect(upload()).toBeDisabled();
  await expect(field("voltage").getByRole("textbox", { name: "Source excerpt", exact: true })).toHaveValue("Synthetic source-A voltage claim");
  checks.push("reviewing existing Spec clears unrelated upload/candidates and loads only that Spec's two sources");

  await spec().getByPlaceholder("Review note", { exact: true }).fill("Synthetic local UI review only; no source truth claim");
  const capacity = dialog().locator(".component-parameters").getByLabel("Capacity (mAh)", { exact: true });
  const adopt = () => spec().getByRole("button", { name: "Adopt this spec revision", exact: true });
  await capacity.fill("31"); await capacity.blur();
  await expect(field("capacityMah")).toContainText("Parameter changed");
  await expect(adopt()).toBeDisabled();
  await field("capacityMah").getByRole("button", { name: "Reconfirm current value (manual)", exact: true }).click();
  await expect(adopt()).toBeEnabled();
  await capacity.fill("32"); await capacity.blur();
  await expect(adopt()).toBeDisabled();
  await field("capacityMah").getByRole("button", { name: "Remove evidence", exact: true }).click();
  await expect(adopt()).toBeEnabled();
  await addField("capacityMah"); await fillSource("capacityMah", "Synthetic reviewed 32 mAh claim", "4");
  checks.push("parameter changes disable adoption until manual reconfirmation or source removal");
  const adopted = page.waitForResponse(response => response.url().endsWith(`/api/specs/${specId}/review`) && response.request().method() === "POST");
  await adopt().click();
  const adoptedResponse = await adopted;
  assert.equal(adoptedResponse.status(), 200);
  const { versionId } = await adoptedResponse.json();
  const reviews = (await api(`/specs/${specId}/reviews`)).reviews;
  const reviewedFields = JSON.parse(reviews[0].field_evidence_json);
  assert.equal(reviewedFields.find(field => field.parameter === "capacityMah").value, 32);
  const preservedOriginal = (await api(`/components/${fixture.id}/specs`)).specs.find(row => row.id === specId);
  assert.equal(JSON.parse(preservedOriginal.field_evidence_json).find(field => field.parameter === "capacityMah").value, 30);
  await page.screenshot({ path: "tmp/spec-fields-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await editor().scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: "tmp/spec-fields-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await dialog().getByRole("button", { name: "Close", exact: true }).click();
  await card().getByRole("button", { name: "Use in design", exact: true }).click();
  const report = page.getByRole("button", { name: "Export PDF", exact: true });
  await expect(report).toBeEnabled();
  await report.click();
  await expect(page.locator(".print-report")).toContainText(versionId);
  await expect(page.locator(".print-report")).toContainText("Synthetic reviewed 32 mAh claim");
  await expect(page.locator(".print-report")).toContainText("Synthetic source-A voltage claim");
  await expect(page.locator(".print-report")).toContainText("a file hash does not establish the truth");
  checks.push("review preserves original upload and pins revised field sources into exported report");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: "passed", localOnly: true, componentId: fixture.id, specId, versionId, checks, screenshots: ["tmp/spec-fields-desktop.png", "tmp/spec-fields-mobile.png", "tmp/spec-fields-sticky-close-1440.png", "tmp/spec-fields-sticky-close-390.png"] }, null, 2));
} catch (error) {
  if (page) console.log(JSON.stringify({ stage: "failure", editorCount: await page.locator(".spec-evidence-editor").count(), legends: await page.locator(".spec-evidence-editor legend").allTextContents(), checks }));
  if (page) await page.screenshot({ path: "tmp/spec-fields-failure.png", fullPage: true }).catch(() => {});
  throw error;
} finally { await browser.close(); }
