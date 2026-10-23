import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
import assert from "node:assert/strict";

const origin = process.env.POWERMATCH_TEST_ORIGIN ?? "http://127.0.0.1:5173";
const fixture = JSON.parse(
  fs.readFileSync(
    process.env.POWERMATCH_TEST_SESSION ?? "tmp/test-admin-browser.json",
    "utf8",
  ),
);
const browser = await chromium.launch({ headless: true, channel: "msedge" }),
  checks = [],
  errors = [];
try {
  const context = await browser.newContext({
    locale: "en-US",
    viewport: { width: 1440, height: 1050 },
  });
  await context.addCookies([
    { name: "pm_session", value: fixture.token, url: origin },
  ]);
  await context.addInitScript(() => localStorage.setItem("pm-language", "en"));
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin + "/?page=compare");
  await expect(
    page
      .locator(".comparison-cloud")
      .getByRole("button", { name: /^(Save collection|保存集合)$/ }),
  ).toBeEnabled();
  await page
    .getByRole("combobox", { name: "Language", exact: true })
    .selectOption("en");
  const cloud = () => page.locator(".comparison-cloud"),
    dialog = () => page.getByRole("dialog");
  const save = () =>
    cloud().getByRole("button", { name: "Save collection", exact: true });
  await expect(save()).toBeEnabled();
  await save().click();
  await expect(dialog().getByLabel("Visibility")).toHaveValue("private");
  const name = "Comparison fixture " + Date.now();
  await dialog().getByLabel("Collection name").fill(name);
  await dialog().getByLabel("Visibility").selectOption("company");
  await page.keyboard.press("Escape");
  await expect(dialog()).toHaveCount(0);
  await expect(save()).toBeFocused();
  await save().click();
  await expect(dialog().getByLabel("Collection name")).toHaveValue(name);
  await expect(dialog().getByLabel("Visibility")).toHaveValue("company");
  await dialog().getByLabel("Visibility").selectOption("private");
  await page.locator(".backdrop").click({ position: { x: 3, y: 3 } });
  await expect(dialog()).toHaveCount(0);
  await expect(save()).toBeFocused();
  await save().click();
  await expect(dialog().getByLabel("Collection name")).toHaveValue(name);
  await dialog().getByRole("button", { name: "Close", exact: true }).click();
  await expect(save()).toBeFocused();
  checks.push(
    "Desktop visible close, Escape and backdrop restore focus and retain unsaved collection fields",
  );
  const lock = page.getByLabel(
    "Lock common conditions: load, lighting and simulation horizon",
  );
  await lock.uncheck();
  await save().click();
  await dialog().getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog()).toHaveCount(0);
  await expect(cloud()).toContainText("Linked revision 1");
  const savedUrl = page.url();
  assert.ok(savedUrl.includes("comparison="));
  assert.ok(!savedUrl.includes("token="));
  await page.reload();
  await expect(save()).toBeEnabled();
  await expect(cloud()).toContainText("Linked revision 1");
  await expect(lock).not.toBeChecked();
  checks.push(
    "Real local API saves immutable collection; refresh retains CAS association and common-condition setting",
  );
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Workbench", exact: true })
    .click();
  await page
    .locator(".design-bar input")
    .fill("Unsaved input must survive collection close");
  await page.goto(savedUrl);
  await expect(save()).toBeEnabled();
  await cloud()
    .getByRole("button", { name: "Open linked collection", exact: true })
    .click();
  await expect(dialog()).toContainText(name);
  await page.keyboard.press("Escape");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Workbench", exact: true })
    .click();
  await expect(page.locator(".design-bar input")).toHaveValue(
    "Unsaved input must survive collection close",
  );
  await page.goto(savedUrl);
  await expect(save()).toBeEnabled();
  await cloud()
    .getByRole("button", { name: "Open linked collection", exact: true })
    .click();
  await dialog()
    .getByRole("button", { name: "Confirm replacement and open", exact: true })
    .click();
  await expect(dialog()).toHaveCount(0);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Workbench", exact: true })
    .click();
  await expect(page.locator(".design-bar input")).not.toHaveValue(
    "Unsaved input must survive collection close",
  );
  checks.push(
    "Stable collection links require explicit replacement; cancel preserves workbench draft and confirmation loads saved copies",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(savedUrl);
  await expect(save()).toBeEnabled();
  await save().click();
  await dialog()
    .getByLabel("Collection name")
    .fill("Mobile unsaved collection name");
  await page.keyboard.press("Escape");
  await expect(save()).toBeFocused();
  await save().click();
  await expect(dialog().getByLabel("Collection name")).toHaveValue(
    "Mobile unsaved collection name",
  );
  await dialog().getByRole("button", { name: "Close", exact: true }).click();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  checks.push(
    "390px mobile collection controls and overlay close preserve field values without horizontal overflow",
  );
  const guest = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await guest.addInitScript(() => localStorage.setItem("pm-language", "en"));
  const gp = await guest.newPage();
  await gp.goto(origin + "/?page=compare");
  await expect(
    gp
      .locator(".comparison-cloud")
      .getByRole("button", { name: "Save collection", exact: true }),
  ).toBeEnabled();
  await gp
    .locator(".comparison-cloud")
    .getByRole("button", { name: "Save collection", exact: true })
    .click();
  await expect(gp.getByRole("dialog").getByLabel("Visibility")).toHaveValue(
    "public",
  );
  await expect(
    gp.getByRole("dialog").getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  checks.push(
    "Guest public collection save requires explicit complete-design publication confirmation",
  );
  let capturedResolve, releaseResolve;
  const captured = new Promise((resolve) => (capturedResolve = resolve)),
    released = new Promise((resolve) => (releaseResolve = resolve));
  await page.route("**/api/comparisons?scope=mine**", async (route) => {
    assert.ok(route.request().headers()["x-powermatch-actor"]);
    const response = await route.fetch();
    capturedResolve();
    await released;
    await route.fulfill({ response });
  });
  await cloud()
    .getByRole("button", { name: "Open collection", exact: true })
    .click();
  await captured;
  await context.clearCookies({ name: "pm_session" });
  releaseResolve();
  await expect(dialog()).toHaveCount(0);
  await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  await expect(save()).toBeEnabled();
  checks.push(
    "Delayed private list response is discarded after an external cookie sign-out; identity verification switches to the guest draft",
  );
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks, errors }, null, 2));
  await guest.close();
  await context.close();
} finally {
  await browser.close();
}
