const { test, expect } = require("@playwright/test");
const { mockExpeditionApp } = require("./mock-app");

test("report shows measurable post-upload checks and admin retry", async ({ page }) => {
  await mockExpeditionApp(page);
  await page.goto("/kompletace");
  await page.locator("#expedition-day-list button").first().click();
  await expect(page.locator(".batch-checks")).toBeVisible();
  await expect(page.locator(".batch-check-row").first()).toContainText("2 / 2");
  await expect(page.locator(".batch-check-row").first()).not.toContainText("k řešení");
  await expect(page.locator(".batch-check-progress")).toHaveAttribute("aria-valuenow", "100");
  await expect(page.locator("[data-action='retry-post-upload-checks']")).toBeVisible();
});

test("employee sees checks without the retry action", async ({ page }) => {
  await mockExpeditionApp(page, "employee");
  await page.goto("/kompletace");
  await page.locator("#expedition-day-list button").first().click();
  await expect(page.locator(".batch-checks")).toBeVisible();
  await expect(page.locator("[data-action='retry-post-upload-checks']")).toHaveCount(0);
});

test("expedition editor disables Chrome profile address autocomplete", async ({ page }) => {
  await mockExpeditionApp(page);
  await page.goto("/kompletace");
  await page.locator("#expedition-day-list button").first().click();
  await page.locator("#completion-body .completion-queue-row").first().click();
  const fields = [
    "#editor-first-name",
    "#editor-last-name",
    "#editor-phone",
    "#editor-email",
    "#editor-street-with-number",
    "#editor-street",
    "#editor-house-number",
    "#editor-city",
    "#editor-zip-code",
    "#editor-country",
  ];
  for (const selector of fields) await expect(page.locator(selector)).toHaveAttribute("autocomplete", "off");
});

test("admin settings expose both post-upload automation switches", async ({ page }) => {
  await mockExpeditionApp(page);
  await page.goto("/nastaveni");
  await expect(page.locator("#settings-auto-payment-check")).toBeChecked();
  await expect(page.locator("#settings-auto-address-check")).toBeChecked();
});
