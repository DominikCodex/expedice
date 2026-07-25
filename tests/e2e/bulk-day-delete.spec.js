const { test, expect } = require("@playwright/test");
const { mockExpeditionApp } = require("./mock-app");

async function renderTwoAdminDays(page) {
  await expect(page.locator("#expedition-day-list .day-card")).toHaveCount(1);
  await page.evaluate(() => {
    expeditionState.days = [
      ...expeditionState.days,
      {
        ...expeditionState.days[0],
        id: 2,
        date: "2026-07-07",
        label: "7.7.2026",
      },
    ];
    renderExpeditionDayOptions();
  });
}

test("admin hromadně přesune vybrané dny do koše", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await mockExpeditionApp(page);
  await page.goto("/kompletace");
  await renderTwoAdminDays(page);

  const selectors = page.locator("#expedition-day-list input[data-day-select]");
  await expect(selectors).toHaveCount(2);
  await selectors.nth(0).check();
  await selectors.nth(1).check();
  await expect(page.locator("#expedition-delete-day")).toHaveText("Smazat 2 dny");

  page.on("dialog", (dialog) => dialog.accept());
  const requestPromise = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().endsWith("/api/expedition-days/bulk-delete")
  );
  await page.locator("#expedition-delete-day").click();
  const request = await requestPromise;

  expect(request.postDataJSON().dates).toEqual(["2026-07-08", "2026-07-07"]);
  await expect(page.locator("#completion-message")).toContainText("2 expedičních dnů");
});

test("uživatel nevidí výběr ani hromadné mazání dnů", async ({ page }) => {
  await mockExpeditionApp(page, "employee");
  await page.goto("/kompletace");

  await expect(page.locator("#expedition-day-list input[data-day-select]")).toHaveCount(0);
  await expect(page.locator("#expedition-delete-day")).toBeHidden();
});

test("adminský výběr dne se vejde do postranního panelu", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await mockExpeditionApp(page);
  await page.goto("/kompletace");
  await renderTwoAdminDays(page);
  await page.locator("#expedition-day-list input[data-day-select]").first().check();

  const overflow = await page.locator(".day-sidebar").evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
  await page.screenshot({ path: ".codex-playwright/bulk-day-delete-1280x720.png", fullPage: false });
});
