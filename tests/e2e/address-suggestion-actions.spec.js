const { test, expect } = require("@playwright/test");
const { mockExpeditionApp, completionRows } = require("./mock-app");

test("návrh Mapy.com lze jedním kliknutím použít a uložit", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await mockExpeditionApp(page);

  const suggestedAddress = {
    streetWithNumber: "Mochovská 322",
    street: "Mochovská",
    houseNumber: "322",
    city: "Nehvizdy",
    zipCode: "25080",
  };
  const suggestionMessage =
    "Nalezená adresa neodpovídá zadanému číslu domu. Návrh Mapy.com: Mochovská 322, Nehvizdy, Česko";
  const rowWithSuggestion = {
    ...completionRows[0],
    deliveryCarrier: "dpd",
    deliveryService: "dpd_courier",
    streetWithNumber: "Mochovská 322/6",
    street: "Mochovská",
    houseNumber: "322/6",
    city: "Nehvizdy",
    zipCode: "25080",
    addressValidationStatus: "suggestion",
    addressValidationMessage: suggestionMessage,
    addressValidationResult: {
      status: "suggestion",
      message: suggestionMessage,
      suggestedAddress,
    },
    problems: [{ category: "address", severity: "warning", message: suggestionMessage }],
  };
  let savedDetails = null;

  await page.route("**/api/completion/rows/201/shipments", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({ ok: true, row: rowWithSuggestion, shipments: [], problems: rowWithSuggestion.problems }),
    });
  });
  await page.route("**/api/completion/rows/201/expedition-details", async (route) => {
    const payload = route.request().postDataJSON();
    savedDetails = payload.details;
    const updated = {
      ...rowWithSuggestion,
      ...savedDetails,
      editVersion: rowWithSuggestion.editVersion + 1,
      addressValidationStatus: "verified",
      addressValidationMessage: "Adresa byla ověřena.",
      addressValidationResult: { status: "verified", message: "Adresa byla ověřena." },
      problems: [],
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        ok: true,
        row: updated,
        shipments: [],
        problems: [],
        validation: { status: "verified", message: "Adresa byla ověřena.", issues: [] },
      }),
    });
  });

  await page.goto("/kompletace");
  await page.locator("#expedition-day-list button").first().click();
  await page.locator("#completion-body .completion-queue-row").first().click();

  const applyButton = page.locator('[data-editor-action="apply-save-address-suggestion"]');
  const mapyLink = page.locator("#editor-address-result .mapy-link");
  await expect(applyButton).toBeVisible();
  await expect(mapyLink).toBeVisible();
  const mapyHref = await mapyLink.getAttribute("href");
  expect(mapyHref).toContain("https://mapy.com/cs/zakladni?");
  expect(decodeURIComponent(mapyHref)).toContain("Mochovská+322");
  await page.locator("#editor-address-result").scrollIntoViewIfNeeded();
  await page.screenshot({ path: ".codex-playwright/address-suggestion-actions-1280x720.png", fullPage: false });

  await applyButton.click();
  await expect(page.locator("#expedition-editor-alert")).toContainText("Uloženo a ověřeno");
  expect(savedDetails.streetWithNumber).toBe("Mochovská 322");
  expect(savedDetails.street).toBe("Mochovská");
  expect(savedDetails.houseNumber).toBe("322");
  expect(savedDetails.city).toBe("Nehvizdy");
  expect(savedDetails.zipCode).toBe("25080");
});
