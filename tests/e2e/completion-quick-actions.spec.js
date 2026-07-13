const { test, expect } = require("@playwright/test");
const { mockExpeditionApp } = require("./mock-app");

test("quick actions open Mapy and send the order to Packeta", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await mockExpeditionApp(page);
  await page.goto("/kompletace");
  await page.locator("#expedition-day-list button").first().click();

  const row = page.locator("#completion-body .completion-queue-row").first();
  const mapy = row.locator("a.completion-mapy-action");
  await expect(mapy).toBeVisible();
  await expect(mapy).toHaveAttribute("href", /mapy\.com/);

  page.on("dialog", (dialog) => dialog.accept());
  const sendRequest = page.waitForRequest(
    (request) => request.method() === "POST" && /\/api\/completion\/rows\/201\/send-carrier$/.test(request.url())
  );
  await row.locator("button[data-action='send-carrier-row']").click();
  await sendRequest;
  await expect(page.locator("#completion-message")).toContainText("Odesláno");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
});

test("existing shipment number suppresses a missing pickup point problem", async ({ page }) => {
  await mockExpeditionApp(page);
  await page.goto("/kompletace");
  const result = await page.evaluate(() => {
    const base = {
      deliveryService: "dpd_pickup",
      pickupPointId: "",
      dpdOrderAndPieces: "13835080503326",
      problems: [{ category: "pickup", severity: "error", message: "Chybí výdejní místo nebo box." }],
    };
    return {
      withShipment: inferredCompletionProblems(base),
      withoutShipment: inferredCompletionProblems({ ...base, dpdOrderAndPieces: "" }),
    };
  });
  expect(result.withShipment.some((item) => item.category === "pickup")).toBe(false);
  expect(result.withoutShipment.some((item) => item.category === "pickup")).toBe(true);
});
