const { test, expect } = require("@playwright/test");
const { mockExpeditionApp } = require("./mock-app");

test("vyskladnění zobrazuje produkty, boxy a skutečný průběh", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await mockExpeditionApp(page);
  await page.goto("/vyskladneni");
  await page.locator("#expedition-day-list button").first().click();

  await expect(page.locator("#warehouse-view")).toBeVisible();
  await expect(page.locator("#warehouse-metric-variants")).toHaveText("2");
  await expect(page.locator("#warehouse-metric-pieces")).toHaveText("4");
  await expect(page.locator("#warehouse-metric-remaining")).toHaveText("3");
  await expect(page.locator("#warehouse-body .warehouse-row")).toHaveCount(1);
  await expect(page.locator("#warehouse-body")).toContainText("6002-HOLLAND-LXL-CERNA");
  await expect(page.locator("#warehouse-body")).toContainText("Box 14");
  await page.screenshot({ path: ".codex-playwright/warehouse-products-1366x768.png", fullPage: false });

  await page.locator("[data-warehouse-view='boxes']").click();
  await expect(page.locator("#warehouse-boxes-panel")).toBeVisible();
  await expect(page.locator(".warehouse-box-group")).toHaveCount(2);
  await page.screenshot({ path: ".codex-playwright/warehouse-boxes-1366x768.png", fullPage: false });

  await page.locator("#warehouse-show-completed").check();
  await expect(page.locator(".warehouse-box-group")).toHaveCount(3);

  await page.locator("[data-warehouse-view='products']").click();
  await page.locator("button[data-warehouse-action='complete'][data-row-id='301']").click();
  await expect(page.locator("#warehouse-metric-remaining")).toHaveText("0");
  await expect(page.locator("#warehouse-metric-progress")).toHaveText("100 %");
});

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 1500, height: 800 },
  { width: 1024, height: 576 },
]) {
  test(`vyskladnění nepřetéká ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockExpeditionApp(page);
    await page.goto("/vyskladneni");
    await page.locator("#expedition-day-list button").first().click();
    await expect(page.locator("#warehouse-view")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(2);
  });
}

test("Excel vyskladnění může nahrát jen admin", async ({ page }) => {
  await mockExpeditionApp(page, "employee");
  await page.goto("/vyskladneni");
  await page.locator("#expedition-day-list button").first().click();
  await expect(page.locator("#tab-warehouse")).toBeVisible();
  await expect(page.locator("#warehouse-upload-trigger")).toBeHidden();
});
