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

test("nové připojení nepřebírá dříve otevřený report dne", async ({ page }) => {
  await mockExpeditionApp(page);
  await page.goto("/kompletace");
  await expect(page.locator("#expedition-batch-report")).toBeHidden();
  await expect(page.locator("#expedition-day-list .day-card.active")).toHaveCount(0);

  await page.locator("#expedition-day-list button").first().click();
  await expect(page.locator("#expedition-batch-report")).toBeVisible();

  await page.evaluate(() => {
    showLogin();
    startAppForUser({ id: 1, username: "test", displayName: "TEST", role: "admin" });
  });
  await expect(page.locator("#expedition-batch-report")).toBeHidden();
  await expect(page.locator("#expedition-day-list .day-card.active")).toHaveCount(0);
  await expect(page.locator("#day-required-view")).toBeVisible();
});

test("uživatel bez zámku začíná bez vybraného dne a reportu", async ({ page }) => {
  await mockExpeditionApp(page, "employee");
  await page.goto("/kompletace");
  await expect(page.locator("#expedition-day-list .day-card.active")).toHaveCount(0);
  await expect(page.locator("#expedition-batch-report")).toBeHidden();
  await expect(page.locator("#day-required-view")).toBeVisible();
});

test("platný uživatelský zámek dne se po připojení obnoví", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "expedition-employee-day-lock-v1:1",
      JSON.stringify({ date: "2026-07-08", expiresAt: Date.now() + 60 * 60 * 1000 })
    );
  });
  await mockExpeditionApp(page, "employee");
  await page.goto("/kompletace");
  await expect(page.locator("#expedition-day-list .day-card.active")).toHaveCount(1);
  await expect(page.locator("#expedition-batch-report")).toBeVisible();
  await expect(page.locator("#day-required-view")).toBeHidden();
});

test("admin fronta otevře kompaktní editor bez vodorovného přetečení", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await mockExpeditionApp(page);
  await page.goto("/kompletace");
  await page.locator("#expedition-day-list button").first().click();
  await expect(page.locator("#completion-problem-filters")).toBeVisible();
  await expect(page.locator("#completion-body .completion-queue-row")).toHaveCount(1);
  await page.locator(".completion-filter-panel").scrollIntoViewIfNeeded();
  await page.screenshot({ path: ".codex-playwright/expedition-queue-1280x720.png", fullPage: false });
  await page.locator("#completion-body .completion-queue-row").first().click();
  await expect(page.locator("#expedition-editor")).toBeVisible();
  await expect(page.locator(".expedition-editor-actions")).toBeVisible();
  await expect(page.locator("#editor-save-verify")).toBeInViewport();
  await expect(page.locator("#editor-delivery-service")).toHaveValue("packeta_pickup");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
  const dialogOverflow = await page.locator(".expedition-editor-dialog").evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(dialogOverflow).toBeLessThanOrEqual(2);
  await page.screenshot({ path: ".codex-playwright/expedition-editor-1280x720.png", fullPage: false });
});

test("editor ověří ručně zadané výdejní místo a uloží změnu", async ({ page }) => {
  await mockExpeditionApp(page);
  await page.goto("/kompletace");
  await page.locator("#expedition-day-list button").first().click();
  await page.locator("#completion-body .completion-queue-row").first().click();
  await page.locator("#editor-pickup-id").fill("1001");
  await page.locator("#editor-pickup-verify").click();
  await expect(page.locator("#editor-pickup-selected")).toContainText("Pobočka Praha");
  await page.locator("#editor-save-verify").click();
  await expect(page.locator("#expedition-editor-alert")).toContainText("Uloženo a ověřeno");
});
