const { test, expect } = require("@playwright/test");
const { mockExpeditionApp } = require("./mock-app");

const sizes = [
  { width: 1280, height: 720, label: "1280x720" },
  { width: 1366, height: 768, label: "1366x768" },
  { width: 1500, height: 800, label: "1500x800" },
  { width: 1600, height: 900, label: "1600x900" },
  { width: 1024, height: 576, label: "1280x720-zoom125" },
];

for (const size of sizes) {
  test(`kompletace nepřetéká ${size.label}`, async ({ page }) => {
    await page.setViewportSize(size);
    await mockExpeditionApp(page);
    await page.goto("/kompletace");
    await page.locator("#expedition-day-list button").first().click();
    await expect(page.locator("#completion-view")).toBeVisible();
    await page.locator("#workflow-expedition-number").fill("19");
    await page.waitForTimeout(650);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(2);
    await expect(page.locator(".workflow-sorting-item").first()).toBeVisible();
    await page.screenshot({ path: `.codex-playwright/stabilization-${size.label}.png`, fullPage: false });
  });
}

test("expediční vstup rozpozná patvar s boxovým kódem", async ({ page }) => {
  await mockExpeditionApp(page);
  await page.goto("/kompletace");
  await page.locator("#expedition-day-list button").first().click();
  const input = page.locator("#workflow-expedition-number");
  await input.fill("22X19S");
  await page.waitForTimeout(650);
  await expect(input).toHaveValue("19");
  await expect(page.locator("#workflow-order-number")).toContainText("42006263");
});

test("čekání na server neukazuje vymyšlená procenta", async ({ page }) => {
  await mockExpeditionApp(page);
  await page.goto("/kompletace");
  await page.evaluate(() => {
    window.__slowRequest = fetchJson("/api/test-slow");
  });
  await expect(page.locator("#global-progress")).toBeVisible();
  await expect(page.locator("#global-progress-percent")).toHaveText("—");
  await page.evaluate(() => window.__slowRequest);
  await expect(page.locator("#global-progress")).toBeHidden();
});
