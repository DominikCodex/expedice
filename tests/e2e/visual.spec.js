const { test, expect } = require("@playwright/test");

const sizes = [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1500, height: 800 },
  { width: 1600, height: 900 },
];

for (const size of sizes) {
  test(`kompletace nepřetéká ${size.width}x${size.height}`, async ({ page }) => {
    test.skip(!process.env.EXPEDICE_TEST_USER || !process.env.EXPEDICE_TEST_PASSWORD, "Vyžaduje testovací účet z prostředí.");
    await page.setViewportSize(size);
    await page.goto("/kompletace");
    const password = page.locator('input[type="password"]:visible');
    if (await password.isVisible().catch(() => false)) {
      await page.locator('input:not([type="password"]):visible').first().fill(process.env.EXPEDICE_TEST_USER);
      await password.fill(process.env.EXPEDICE_TEST_PASSWORD);
      await page.locator('button[type="submit"]').click();
    }
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(2);
  });
}

