const { test, expect } = require("@playwright/test");
const fs = require("fs");

const fixture = () => process.env.WAREHOUSE_PRINT_FIXTURE
  ? JSON.parse(fs.readFileSync(process.env.WAREHOUSE_PRINT_FIXTURE, "utf8").replace(/^\uFEFF/, ""))
  : Array.from({ length: 45 }, (_, i) => ({
      rowNumber: i + 2, productCode: `Skupina-${Math.floor(i / 5)}`,
      variantCode: `SKU-${String(45 - i).padStart(3, "0")}-ČERNÁ`,
      variant: "Velikost: L/XL, Barva: černá", info: "Dámské kalhotky s vyšším pasem",
      initialQuantity: "3", quantity: "3", remaining: 0, sequence: "1x3, 2x14",
    }));

test("samostatná sestava tiskne všechny původní kusy na A4 na šířku", async ({ page }) => {
  const rows = fixture();
  await page.route("**/api/datasets/71", (route) => route.fulfill({ json: { dataset: { id: 71, datasetKind: "warehouse_print", datasetDate: "2026-09-18", datasetTime: "08:30", worksheetName: "Vyskladnění" }, rows } }));
  await page.route("**/api/product-images", (route) => route.fulfill({ json: { ok: true, configured: true, images: {} } }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/warehouse-print.html?dataset=71");
  await expect(page.locator("#print")).toBeEnabled();
  await expect(page.locator("#rows tr")).toHaveCount(rows.length);
  const total = rows.reduce((sum, row) => sum + Number(row.initialQuantity || row.quantity), 0);
  await expect(page.locator("#pieces")).toHaveText(`${total} ks`);
  await page.locator("#sort").selectOption("excel");
  await expect(page.locator(".sku").first()).toHaveText(rows[0].variantCode);
  await page.locator("#sort").selectOption("product");
  await expect(page.locator("#print")).toBeEnabled();
  await page.evaluate(() => { window.print = () => { window.didPrint = true; }; });
  await page.locator("#print").click();
  await expect.poll(() => page.evaluate(() => window.didPrint)).toBe(true);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".toolbar")).toBeHidden();
  expect(await page.locator("thead").evaluate((node) => getComputedStyle(node).display)).toBe("table-header-group");
  await page.pdf({ path: "test-results/warehouse-print-a4.pdf", preferCSSPageSize: true, printBackground: true });
  await page.emulateMedia({ media: "screen" });
  await page.screenshot({ path: "test-results/warehouse-print-preview.png" });
});

test("tisk čeká na fotografie a zvládne jejich chybu", async ({ page }) => {
  let finishImage;
  const releaseImage = new Promise((resolve) => { finishImage = resolve; });
  await page.route("**/api/datasets/71", (route) => route.fulfill({ json: { dataset: { id: 71, datasetKind: "warehouse_print" }, rows: fixture().slice(0, 1) } }));
  await page.route("**/api/product-images", (route) => route.fulfill({ json: { images: { [fixture()[0].variantCode]: "/test-product.png" } } }));
  await page.route("**/test-product.png", async (route) => { await releaseImage; await route.fulfill({ status: 404, body: "missing" }); });
  await page.goto("/warehouse-print.html?dataset=71", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#rows img")).toHaveCount(1);
  await expect(page.locator("#print")).toBeDisabled();
  finishImage();
  await expect(page.locator("#print")).toBeEnabled();
  await expect(page.locator(".no-photo")).toHaveCount(1);
});

test("odkaz z Excelu po přihlášení otevře stejnou sestavu", async ({ page }) => {
  let authenticated = false;
  await page.route("**/api/datasets/71", (route) => authenticated
    ? route.fulfill({ json: { dataset: { id: 71, datasetKind: "warehouse_print" }, rows: fixture().slice(0, 1) } })
    : route.fulfill({ status: 401, json: { error: "Přihlaste se" } }));
  await page.route("**/api/auth/login", (route) => { authenticated = true; return route.fulfill({ json: { ok: true } }); });
  await page.route("**/api/product-images", (route) => route.fulfill({ json: { images: {} } }));
  await page.goto("/warehouse-print.html?dataset=71");
  await expect(page.locator("#login")).toBeVisible();
  await page.locator('[name="username"]').fill("mock-user");
  await page.locator('[name="password"]').fill("mock-only-not-a-real-password");
  await page.locator('#login button').click();
  await expect(page.locator("#print")).toBeEnabled();
  await expect(page.locator("#login")).toBeHidden();
  expect(page.url()).toContain("dataset=71");
});
