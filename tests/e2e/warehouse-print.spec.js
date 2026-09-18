const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { execFileSync } = require("child_process");

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

test("varianty nemají popisky a hodnoty jsou výrazné v obou orientacích", async ({ page }) => {
  const variants = [
    ["Velikost: L/XL, Barva: bílá", "L/XL, bílá"],
    ["  BARVA : černá | Velikost: S/M  ", "S/M, černá"],
    ["Veľkosť: XL/XXL; Farba: telová", "XL/XXL, telová"],
    ["biela / L/XL", "L/XL, biela"],
    ["Barva: černá mix barev lemu, Velikost: M/L", "M/L, černá mix barev lemu"],
    ["červená / M/L", "M/L, červená"],
    ["modrofialová / XL/XXL", "XL/XXL, modrofialová"],
    ["růžová / S/M", "S/M, růžová"],
    ["M/L, lékořice", "M/L, lékořice"],
    ["M / L / bílá", "M/L, bílá"],
    ["černá / bílá / XL", "XL, černá / bílá"],
    ["černá / 38/40", "38/40, černá"],
    ["Farba: biela, Veľkosť: UNI", "UNI, biela"],
    ["S/M", "S/M"],
    ["černá / bílá", "černá / bílá"],
    ["Motiv: Barva života / S/M", "Motiv: Barva života / S/M"],
    ['Velikost: <img src=x onerror="window.badVariant=true">', '<img src=x onerror="window.badVariant=true">'],
    [null, ""],
  ];
  const rows = variants.map(([variant], index) => ({ ...fixture()[0], rowNumber: index + 2, variantCode: `TEST-${index}`, variant }));
  await page.route("**/api/datasets/71", (route) => route.fulfill({ json: { dataset: { datasetKind: "warehouse_print" }, rows } }));
  await page.route("**/api/product-images", (route) => route.fulfill({ json: { images: {} } }));
  await page.goto("/warehouse-print.html?dataset=71");
  await expect(page.locator("#print")).toBeEnabled();
  await page.locator("#sort").selectOption("excel");
  for (const [label, size] of [["Na šířku", "16px"], ["Na výšku", "14px"]]) {
    await page.getByText(label, { exact: true }).click();
    await expect(page.locator(".variant-value")).toHaveText(variants.map(([, value]) => value));
    await expect(page.locator(".variant-value").first()).toHaveCSS("font-size", size);
    await expect(page.locator(".variant-value").first()).toHaveCSS("font-weight", "700");
    await expect(page.locator(".variant-value img")).toHaveCount(0);
    expect(await page.evaluate(() => window.badVariant)).toBeUndefined();
    expect(await page.locator("#sheet").evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  }
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

test("boxy využijí sloupec Hotovo a vejdou se alespoň tři vedle sebe", async ({ page }) => {
  const distribution = [[2, 7], [2, 14], [1, 18], [4, 20], [1, 27], [2, 28], [1, 52], [2, 56], [3, 62], [1, 66], [1, 67], [4, 68], [2, 74], [2, 78]];
  const rows = [{ ...fixture()[0], raw: null, quantity: 28, initialQuantity: 28,
    sequence: distribution.map(([quantity, box]) => `${quantity}x${box}`).join(", ") }];
  await page.route("**/api/datasets/71", (route) => route.fulfill({ json: { dataset: { datasetKind: "warehouse_print" }, rows } }));
  await page.route("**/api/product-images", (route) => route.fulfill({ json: { images: {} } }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/warehouse-print.html?dataset=71");
  await expect(page.locator("#print")).toBeEnabled();
  await expect(page.getByRole("columnheader", { name: "Hotovo" })).toHaveCount(0);
  await expect(page.locator("#rows tr td")).toHaveCount(5);
  await expect(page.locator(".check")).toHaveCount(0);
  for (const [orientation, label] of [["portrait", "Na výšku"], ["landscape", "Na šířku"]]) {
    await page.getByText(label, { exact: true }).click();
    for (const [density, densityLabel] of [["normal", "Běžné"], ["compact", "Kompaktní"]]) {
      await page.getByText(densityLabel, { exact: true }).click();
      await expect(page.locator(".allocation")).toHaveText(distribution.map(([quantity, box]) => `${quantity} ks → box ${box}`));
      const layout = await page.locator(".allocation").evaluateAll((nodes) => nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return { top: rect.top, right: rect.right, width: node.clientWidth, content: node.scrollWidth, available: node.parentElement.clientWidth };
      }));
      expect(layout.filter((rect) => Math.abs(rect.top - layout[0].top) < 1).length, JSON.stringify(layout.slice(0, 3))).toBeGreaterThanOrEqual(3);
      expect(new Set(layout.map((rect) => Math.round(rect.top))).size).toBeLessThanOrEqual(5);
      expect(layout.every((rect) => rect.content <= rect.width)).toBe(true);
      expect(await page.locator("#sheet").evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      await page.screenshot({ path: `test-results/warehouse-boxes-${orientation}-${density}.png` });
      await page.pdf({ path: `test-results/warehouse-boxes-${orientation}-${density}.pdf`, preferCSSPageSize: true, printBackground: true });
    }
  }
});

test("Excel otevře vygenerované HTML z disku bez přihlášení a bez API", async ({ page }, testInfo) => {
  const output = testInfo.outputPath("vyskladneni.html");
  const localPython = path.resolve(process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python");
  execFileSync(process.env.TEST_PYTHON || (fs.existsSync(localPython) ? localPython : "python"), [
    "tests/e2e/render-print-fixture.py", output,
  ]);
  const apiRequests = [];
  const errors = [];
  page.on("request", (request) => { if (request.url().includes("/api/")) apiRequests.push(request.url()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(pathToFileURL(output).href);
  await expect(page.locator("#print")).toBeEnabled();
  await expect(page.locator("#login")).toBeHidden();
  await expect(page.locator("#rows tr")).toHaveCount(45);
  await expect(page.locator("#batch")).toContainText("Vyskladnění");
  const expectedTotal = process.env.WAREHOUSE_PRINT_FIXTURE
    ? fixture().reduce((sum, row) => sum + Number(row.quantity), 0) : 135;
  await expect(page.locator("#pieces")).toHaveText(`${expectedTotal} ks`);
  await page.locator("#sort").selectOption("excel");
  await expect(page.locator("#print")).toBeEnabled();
  await page.locator("#reload").click();
  await expect(page.locator("#print")).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => { window.print = () => { window.didPrint = true; }; });
  await page.locator("#print").click();
  await expect.poll(() => page.evaluate(() => window.didPrint)).toBe(true);
  expect(apiRequests).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: "test-results/warehouse-anonymous-preview.png" });
  await page.pdf({ path: "test-results/warehouse-anonymous-a4.pdf", preferCSSPageSize: true, printBackground: true });

  for (const [orientation, label] of [["portrait", "Na výšku"], ["landscape", "Na šířku"]]) {
    await page.getByText(label, { exact: true }).click();
    await expect(page.getByRole("radio", { name: label, exact: true })).toBeChecked();
    await expect(page.locator("#print")).toHaveText(`Tisk A4 ${label.toLowerCase()}`);
    await expect(page.locator("html")).toHaveAttribute("data-orientation", orientation);
    const pageSize = await page.evaluate(() => [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules])
      .filter((rule) => rule.type === CSSRule.PAGE_RULE).at(-1).style.getPropertyValue("size"));
    expect(orientation === "portrait" ? ["a4", "a4 portrait"] : ["a4 landscape"]).toContain(pageSize.toLowerCase());
    await expect(page.locator("#pieces")).toHaveText(`${expectedTotal} ks`);
    for (const [width, height] of [[1280, 720], [1366, 768], [1024, 576]]) {
      await page.setViewportSize({ width, height });
      expect(await page.locator("#sheet").evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: `test-results/warehouse-${orientation}-preview.png` });
    await page.pdf({ path: `test-results/warehouse-${orientation}-a4.pdf`, preferCSSPageSize: true, printBackground: true });
    const normalHeight = await page.locator("table").evaluate((node) => node.getBoundingClientRect().height);
    const normalValues = await page.locator("#rows tr").allTextContents();
    const photoCount = await page.locator("#rows img, #rows .no-photo").count();
    await page.getByText("Kompaktní", { exact: true }).click();
    await expect(page.getByRole("radio", { name: "Kompaktní", exact: true })).toBeChecked();
    await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
    await expect(page.locator("html")).toHaveAttribute("data-orientation", orientation);
    expect(await page.locator("table").evaluate((node) => node.getBoundingClientRect().height)).toBeLessThan(normalHeight * 0.85);
    expect(await page.locator("#rows tr").allTextContents()).toEqual(normalValues);
    await expect(page.locator("#rows img, #rows .no-photo")).toHaveCount(photoCount);
    await expect(page.locator(".variant-value").first()).toHaveCSS("font-weight", "700");
    await page.locator("#reload").click();
    await expect(page.locator("#print")).toBeEnabled();
    await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
    await expect(page.locator("#pieces")).toHaveText(`${expectedTotal} ks`);
    for (const width of [1280, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.locator("#sheet").evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: `test-results/warehouse-${orientation}-compact-preview.png` });
    await page.pdf({ path: `test-results/warehouse-${orientation}-compact-a4.pdf`, preferCSSPageSize: true, printBackground: true });
    await page.getByText("Běžné", { exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-density", "normal");
    expect(await page.locator("table").evaluate((node) => node.getBoundingClientRect().height)).toBeCloseTo(normalHeight, 0);
  }
  expect(apiRequests).toEqual([]);
  expect(errors).toEqual([]);
});
