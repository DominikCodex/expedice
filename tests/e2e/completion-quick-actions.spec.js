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

test("confirmed unpaid payment is ready but still prints an unpaid notice", async ({ page }) => {
  await mockExpeditionApp(page);
  await page.goto("/kompletace");
  const result = await page.evaluate(() => {
    const unpaid = {
      deliveryService: "packeta_pickup",
      pickupPointId: "1001",
      paymentCheckStatus: "unpaid",
      paymentCheckMessage: "Platba není podle feedu uhrazená.",
      problems: [{ category: "payment", severity: "warning", message: "Platba není podle feedu uhrazená." }],
    };
    const unknown = {
      deliveryService: "packeta_pickup",
      pickupPointId: "1001",
      paymentCheckStatus: "unknown",
      paymentCheckMessage: "Stav platby se nepodařilo spolehlivě určit.",
      problems: [],
    };
    return {
      unpaidProblems: inferredCompletionProblems(unpaid),
      unpaidReady: completionMatchesProblemFilter(unpaid, "ready"),
      unpaidPrint: workflowIsUnpaid(unpaid),
      unknownProblems: inferredCompletionProblems(unknown),
      unknownPrint: workflowIsUnpaid(unknown),
    };
  });

  expect(result.unpaidProblems.some((item) => item.category === "payment")).toBe(false);
  expect(result.unpaidReady).toBe(true);
  expect(result.unpaidPrint).toBe(true);
  expect(result.unknownProblems.some((item) => item.category === "payment")).toBe(true);
  expect(result.unknownPrint).toBe(false);
});
