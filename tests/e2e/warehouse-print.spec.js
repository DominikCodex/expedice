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

test("všechny prioritní řádky včetně II. jakosti předcházejí ostatním", async ({ page }) => {
  const items = [
    ["B", "B-N", "1x8"],
    ["A", "A-II-JAKOST-N", "1x6"],
    ["B", "B-II-JAKOST-P", "1x2"],
    ["A", "A-N", "1x5"],
    ["B", "B-P", "1x2, 1x8"],
    ["A", "A-P", "1x4"],
    ["A", "A-II-JAKOST-P", "1x4"],
    ["B", "B-II-JAKOST-N", "1x7"],
  ];
  const rows = items.map(([productCode, variantCode, sequence], i) => ({
    productCode, variantCode, sequence, rowNumber: i + 2,
    variant: "M/L, červená", info: "Testovací výrobek", initialQuantity: i === 4 ? 2 : 1,
  }));
  const cell = (box, code) => [...Array(16).fill(""), box, code];
  await page.route("**/api/datasets/71", (route) => route.fulfill({ json: {
    dataset: { datasetKind: "warehouse_print" }, rows,
    helperSheets: { KOMPLETACE: { cells: [cell("Box", "Kód"), cell("2", "0,8"), cell("4", "0.8"), cell("8", "1")] } },
  } }));
  await page.route("**/api/product-images", (route) => route.fulfill({ json: { images: {} } }));
  await page.goto("/warehouse-print.html?dataset=71");
  await expect(page.locator("#print")).toBeEnabled();
  const normal = page.getByRole("radio", { name: "Běžné pořadí", exact: true });
  const priority = page.getByRole("radio", { name: "Prioritní zásilky první", exact: true });
  await expect(normal).toBeChecked();
  const orders = {
    product: ["A-P", "B-P", "A-II-JAKOST-P", "B-II-JAKOST-P", "A-N", "B-N", "A-II-JAKOST-N", "B-II-JAKOST-N"],
    excel: ["B-P", "A-P", "B-II-JAKOST-P", "A-II-JAKOST-P", "B-N", "A-N", "A-II-JAKOST-N", "B-II-JAKOST-N"],
    box: ["B-P", "A-P", "B-II-JAKOST-P", "A-II-JAKOST-P", "A-N", "B-N", "A-II-JAKOST-N", "B-II-JAKOST-N"],
  };
  for (const sort of Object.keys(orders)) {
    await page.locator("#sort").selectOption(sort);
    const original = await page.locator(".sku").allTextContents();
    await page.getByText("Prioritní zásilky první", { exact: true }).click();
    await expect(page.locator(".sku")).toHaveText(orders[sort]);
    await expect(page.locator(".section-heading th")).toHaveText(["PRIORITNÍ", "PRIORITNÍ – II. JAKOST", "OSTATNÍ", "OSTATNÍ – II. JAKOST"]);
    await expect(page.locator(".quality-label")).toHaveCount(4);
    await expect(page.locator("#pieces")).toHaveText("9 ks");
    await expect(page.locator(".allocation")).toHaveCount(9);
    await expect(page.locator(".allocation-red")).toHaveCount(4);
    const mixed = page.locator("#rows tr").filter({ has: page.locator(".sku", { hasText: /^B-P$/ }) });
    await expect(mixed.locator(".allocation")).toHaveCount(2);
    await page.getByText("Běžné pořadí", { exact: true }).click();
    await expect(page.locator(".sku")).toHaveText(original);
  }
  await page.getByText("Prioritní zásilky první", { exact: true }).click();
  for (const orientation of ["Na šířku", "Na výšku"]) {
    await page.getByText(orientation, { exact: true }).click();
    for (const density of ["Běžné", "Kompaktní"]) {
      await page.getByText(density, { exact: true }).click();
      await expect(page.locator(".sku")).toHaveText(orders.box);
      for (const width of [1280, 1024]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
    }
  }
  await page.locator("#reload").click();
  await expect(page.locator("#print")).toBeEnabled();
  await expect(priority).toBeChecked();
  await expect(page.locator(".sku")).toHaveText(orders.box);
  await page.screenshot({ path: "test-results/warehouse-priority-preview.png", fullPage: true });
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".toolbar")).toBeHidden();
  await page.pdf({ path: "test-results/warehouse-priority.pdf", preferCSSPageSize: true, printBackground: true });
});

test("prioritní kusy se oddělí i uvnitř varianty bez změny původních součtů", async ({ page }) => {
  const rows = [
    { variantCode: "MODEL-A-SM", sequence: "3×20; 2x7", initialQuantity: 5 },
    { variantCode: "MODEL-A-ML-II-JAKOST", sequence: "9x99", initialQuantity: 5,
      raw: { productName: "Český výrobek II. jakosti", allocations: [{ quantity: "1", destination: "7" }, { quantity: "4", destination: "30" }] } },
    { variantCode: "MODEL-B-SM", sequence: "1x7", initialQuantity: 1 },
    { variantCode: "MODEL-C-SM", sequence: "2x10", initialQuantity: 2 },
    { variantCode: "MODEL-D-SM-II-JAKOST", sequence: "1x7", initialQuantity: 1 },
    { variantCode: "MODEL-E-SM-II-JAKOST", sequence: "1x12", initialQuantity: 1 },
  ].map((row, i) => ({ productCode: "MODEL", variant: "S/M, černá", info: "Testovací výrobek", rowNumber: i + 2, ...row }));
  let helpers = { KOMPLETACE: { cells: [Array(18).fill(""), [...Array(16).fill(""), 7, "0,8"]] } };
  await page.route("**/api/datasets/71", (route) => route.fulfill({ json: {
    dataset: { datasetKind: "warehouse_print" }, rows, helperSheets: helpers,
  } }));
  await page.route("**/api/product-images", (route) => route.fulfill({ json: { images: {} } }));
  await page.goto("/warehouse-print.html?dataset=71");
  await expect(page.locator("#print")).toBeEnabled();
  const readRows = () => page.locator(".item-row").evaluateAll((nodes) => nodes.map((node) => ({
    code: node.querySelector(".sku").textContent,
    quantity: Number(node.querySelector(".quantity").textContent),
    allocations: [...node.querySelectorAll(".allocation")].map((item) => ({
      quantity: Number(item.querySelector("b").textContent.replace(" ks", "")),
      box: Number(item.querySelector("b:last-child").textContent), red: item.classList.contains("allocation-red"),
    })),
  })));
  for (const sort of ["product", "excel", "box"]) {
    await page.locator("#sort").selectOption(sort);
    const original = await readRows();
    await page.getByText("Prioritní kusy zvlášť", { exact: true }).click();
    await expect(page.locator(".item-row")).toHaveCount(8);
    await expect(page.locator("#pieces")).toHaveText("15 ks");
    await expect(page.locator("#summary")).toHaveText("6 variant · 5 boxů");
    await expect(page.locator(".section-heading th")).toHaveText([
      "PRIORITNÍ KUSY", "PRIORITNÍ KUSY – II. JAKOST", "OSTATNÍ KUSY", "OSTATNÍ KUSY – II. JAKOST",
    ]);
    const split = await readRows();
    expect(split.reduce((sum, row) => sum + row.quantity, 0)).toBe(15);
    expect(split.every((row) => row.quantity === row.allocations.reduce((sum, item) => sum + item.quantity, 0))).toBe(true);
    expect(split.slice(0, 4).every((row) => row.allocations.every((item) => item.red))).toBe(true);
    expect(split.slice(4).every((row) => row.allocations.every((item) => !item.red))).toBe(true);
    for (const source of original) {
      const parts = split.filter((row) => row.code === source.code);
      expect(parts.reduce((sum, row) => sum + row.quantity, 0)).toBe(source.quantity);
      expect(parts.flatMap((row) => row.allocations).sort((a, b) => a.box - b.box))
        .toEqual([...source.allocations].sort((a, b) => a.box - b.box));
    }
    if (sort === "box") expect(split.slice(4).map((row) => row.code)).toEqual([
      "MODEL-C-SM", "MODEL-A-SM", "MODEL-E-SM-II-JAKOST", "MODEL-A-ML-II-JAKOST",
    ]);
    await page.getByText("Prioritní zásilky první", { exact: true }).click();
    await expect(page.locator(".item-row")).toHaveCount(6);
    expect((await readRows()).find((row) => row.code === "MODEL-A-SM").quantity).toBe(5);
    await page.getByText("Běžné pořadí", { exact: true }).click();
    expect(await readRows()).toEqual(original);
  }
  await page.getByText("Prioritní kusy zvlášť", { exact: true }).click();
  for (const [orientation, label] of [["portrait", "Na výšku"], ["landscape", "Na šířku"]]) {
    await page.getByText(label, { exact: true }).click();
    for (const [density, label] of [["normal", "Běžné"], ["compact", "Kompaktní"]]) {
      await page.getByText(label, { exact: true }).click();
      for (const [width, height] of [[1280, 720], [1366, 768], [1500, 800], [1600, 900], [1024, 576]]) {
        await page.setViewportSize({ width, height });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.screenshot({ path: `test-results/warehouse-split-${orientation}-${density}.png`, fullPage: true });
      await page.emulateMedia({ media: "print" });
      await expect(page.locator(".toolbar")).toBeHidden();
      await page.pdf({ path: `test-results/warehouse-split-${orientation}-${density}.pdf`, preferCSSPageSize: true, printBackground: true });
      await page.emulateMedia({ media: "screen" });
    }
  }
  await page.locator("#reload").click();
  await expect(page.locator("#print")).toBeEnabled();
  await expect(page.locator(".item-row")).toHaveCount(8);
  helpers = {};
  await page.locator("#reload").click();
  await expect(page.locator("#print")).toBeEnabled();
  await expect(page.locator(".item-row")).toHaveCount(6);
  await expect(page.locator(".allocation-red")).toHaveCount(0);
  await expect(page.locator("#pieces")).toHaveText("15 ks");
});

test("produkty se oddělují podle kódu a Giny spárované z EXCEL", async ({ page }) => {
  const codes = [
    "03019-MBH-XLXXL-UPE", "03019-LBH-LXL-UPE",
    "BOXERKY-BASIC-021-LXL-CERNA", "BOXERKY-BASIC-021-ML-CERNA", "BOXERKY-BASIC-022-ML-CERNA",
    "GBTW-3106-XXL3XL-CERNA", "GBTW-3109-SM-CERNA", "GBTW-3109-SM-TELOVA",
    "6002-HOLLAND-LXL-BILA", "6002-HOLLAND-SM-BILA", "BEZPOMLCKY", "KRATKY-KOD",
    "03100-A-SM", "03100-B-SM", "03200-A-SM", "03200-B-SM",
  ];
  const rows = codes.map((variantCode, i) => ({
    rowNumber: i + 2, productCode: i === 0 ? "ZZZ" : "SKUPINA", variantCode,
    info: i < 2 ? "Boxerky vyšší bamboo Gina" : "Testovací výrobek", variant: "L/XL, černá",
    initialQuantity: 1, sequence: `1x${i + 1}`,
  }));
  const helperRow = (code, brand) => ["", "", code, "", "", "", "", "", "", brand];
  const cells = [helperRow("Označení varianty:", "Doplňkové info:"),
    helperRow(` ${codes[0].toLowerCase()} `, " // gInA //Boxerky"), helperRow(codes[0], "//Gina//Boxerky"),
    helperRow(codes[1], "//Gina//Boxerky"),
    helperRow(codes[12], "//Gina//Výrobek"), helperRow(codes[12], "//Jiná značka//Výrobek"),
    helperRow(codes[13], "//Gina//Výrobek"), helperRow(codes[13], "//Jiná značka//Výrobek"),
    helperRow(codes[14], "//Jiná značka//Název obsahuje Gina"), helperRow(codes[15], "//Jiná značka//Gina"),
  ];
  let helpers = { EXCEL: { cells } };
  await page.route("**/api/datasets/71", (route) => route.fulfill({ json: {
    dataset: { datasetKind: "warehouse_print" }, rows, helperSheets: helpers,
  } }));
  await page.route("**/api/product-images", (route) => route.fulfill({ json: { images: {} } }));
  await page.goto("/warehouse-print.html?dataset=71");
  await expect(page.locator("#print")).toBeEnabled();
  // Group ordering must not be based on the old broad productCode (ZZZ/SKUPINA).
  await expect(page.locator(".sku").nth(0)).toHaveText(codes[1]);
  await expect(page.locator(".sku").nth(1)).toHaveText(codes[0]);
  await expect(page.locator("#rows .item-row").nth(1)).not.toHaveClass(/group-start/);
  await page.locator("#sort").selectOption("excel");
  const boundaries = [0, 2, 4, 5, 6, 8, 10, 11, 12, 13, 14, 15];
  await expect(page.locator(".sku")).toHaveText(codes);
  await expect(page.locator("tr.group-start .sku")).toHaveText(boundaries.map((i) => codes[i]));
  await expect(page.locator("#pieces")).toHaveText("16 ks");
  await expect(page.locator(".allocation")).toHaveCount(16);
  for (const orientation of ["Na šířku", "Na výšku"]) {
    await page.getByText(orientation, { exact: true }).click();
    for (const density of ["Běžné", "Kompaktní"]) {
      await page.getByText(density, { exact: true }).click();
      await expect(page.locator("tr.group-start .sku")).toHaveText(boundaries.map((i) => codes[i]));
      await expect(page.locator("tr.group-start").first().locator("td").first()).toHaveCSS("border-top-width", "2px");
      await expect(page.locator("#rows .item-row").nth(1).locator("td").first()).toHaveCSS("border-top-width", "0px");
      for (const width of [1280, 1024]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
    }
  }
  await page.screenshot({ path: "test-results/warehouse-product-groups.png", fullPage: true });
  await page.emulateMedia({ media: "print" });
  await page.pdf({ path: "test-results/warehouse-product-groups.pdf", preferCSSPageSize: true, printBackground: true });
  await page.emulateMedia({ media: "screen" });
  // A later load with missing or incomplete helper data must not reuse the old Gina match.
  for (const fallback of [{}, { EXCEL: { cells: [["Něco:"]] } }]) {
    helpers = fallback;
    await page.locator("#reload").click();
    await expect(page.locator("#print")).toBeEnabled();
    await expect(page.locator("#rows .item-row").nth(1)).toHaveClass(/group-start/);
  }
});

test("rámečky, nadpisy, více kusů a přirozené velikosti zůstávají čitelné i v tisku", async ({ page }) => {
  const variants = ["XL/XXL, černá", "L/XL, černá", "S/M, červená", "M/L, bílá", "S/M, bílá", "UNI, černá", "40/42, modrá", "38/40, modrá", "XXL/3XL, černá"];
  const rows = variants.map((variant, i) => ({
    rowNumber: i + 2, productCode: "MODEL", variantCode: `MODEL-BAMBOO-${i}`, variant,
    info: "Dámské bambusové kalhotky – český název", initialQuantity: i === 0 ? 3 : 1, sequence: `${i === 0 ? 3 : 1}x${i + 1}`,
  }));
  rows.push({ ...rows[0], rowNumber: 20, variantCode: "MODEL-BAMBOO-II-JAKOST", initialQuantity: 1, sequence: "1x20" });
  rows.push({ ...rows[0], rowNumber: 21, variantCode: "JINY-VYROBEK-SM", info: '<img src=x onerror="window.badHeading=true">', initialQuantity: 1, sequence: "1x21" });
  rows.push({ ...rows.at(-1), rowNumber: 22, variantCode: "JINY-VYROBEK-ML", sequence: "1x22" });
  const header = Array(18).fill("");
  const completion = [...header]; completion[16] = "1"; completion[17] = "0,8";
  await page.route("**/api/datasets/71", (route) => route.fulfill({ json: {
    dataset: { datasetKind: "warehouse_print" }, rows, helperSheets: { KOMPLETACE: { cells: [header, completion] } },
  } }));
  await page.route("**/api/product-images", (route) => route.fulfill({ json: { images: {} } }));
  await page.goto("/warehouse-print.html?dataset=71");
  await expect(page.locator("#print")).toBeEnabled();
  const model = page.locator(".item-row").filter({ has: page.locator(".sku", { hasText: /^MODEL-BAMBOO-\d$/ }) });
  await expect(model.locator(".variant-value")).toHaveText([4, 2, 3, 1, 0, 8, 7, 6, 5].map((i) => variants[i]));
  await expect(page.locator(".product-heading")).toHaveCount(2);
  await expect(page.locator(".product-total")).toHaveText(["Celkem 2 ks", "Celkem 11 ks"]);
  await expect(page.locator(".product-heading img")).toHaveCount(0);
  expect(await page.evaluate(() => window.badHeading)).toBeUndefined();
  await expect(page.locator(".item-row")).toHaveCount(12);
  await expect(page.locator("#pieces")).toHaveText("14 ks");
  await expect(page.locator(".quality-label")).toHaveCount(1);
  await expect(page.locator(".allocation-multiple")).toHaveCount(1);
  await expect(page.locator(".allocation-multiple")).toHaveText("3 ks → box 1");
  await expect(page.locator(".allocation-multiple")).toHaveCSS("color", "rgb(180, 35, 24)");
  await expect(page.locator(".allocation-multiple b").first()).toHaveCSS("text-decoration-line", "underline");
  for (const [orientation, label] of [["landscape", "Na šířku"], ["portrait", "Na výšku"]]) {
    await page.getByText(label, { exact: true }).click();
    for (const [density, label] of [["normal", "Běžné"], ["compact", "Kompaktní"]]) {
      await page.getByText(label, { exact: true }).click();
      for (const width of [1280, 1024]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
      await expect(page.locator(".item-row").first().locator("td").first()).toHaveCSS("border-left-width", "2px");
      await expect(page.locator(".item-row").first().locator("td").last()).toHaveCSS("border-right-width", "2px");
      await expect(page.locator(".group-end").first().locator("td").first()).toHaveCSS("border-bottom-width", "2px");
      await expect(page.locator(".product-meta > .sku + .quality-label")).toHaveCount(1);
      const badgeLayout = await page.locator(".quality-label").evaluate((badge) => {
        const code = badge.previousElementSibling.getBoundingClientRect();
        const rect = badge.getBoundingClientRect();
        const cell = badge.closest("td").getBoundingClientRect();
        return { afterCode: rect.left >= code.right, insideCell: rect.right <= cell.right,
          sharesLine: rect.top < code.bottom && rect.bottom > code.top,
          noOverflow: badge.parentElement.scrollWidth <= badge.parentElement.clientWidth };
      });
      expect(badgeLayout).toEqual({ afterCode: true, insideCell: true, sharesLine: true, noOverflow: true });
      if (density === "compact") {
        const allocation = page.locator(".allocation-multiple");
        const measure = () => allocation.evaluate((node) => ({
          badge: node.getBoundingClientRect().height,
          row: node.closest("tr").getBoundingClientRect().height,
        }));
        await expect(allocation).toHaveCSS("padding-top", "2px");
        await expect(allocation).toHaveCSS("padding-bottom", "2px");
        const current = await measure();
        const previousStyle = await page.addStyleTag({ content: '[data-density="compact"] .allocation { padding-block: 1px; }' });
        const previous = await measure();
        await previousStyle.evaluate((node) => node.remove());
        expect(current.badge - previous.badge).toBeCloseTo(2, 1);
        expect(current.row).toBeCloseTo(previous.row, 1);
      }
      await page.screenshot({ path: `test-results/warehouse-workflow-${orientation}-${density}.png`, fullPage: true });
      await page.emulateMedia({ media: "print" });
      await expect(page.locator(".section-heading th").first()).toHaveCSS("color", "rgb(24, 43, 39)");
      await expect(page.locator(".product-heading").first()).toHaveCSS("break-after", "avoid");
      await page.pdf({ path: `test-results/warehouse-workflow-${orientation}-${density}.pdf`, preferCSSPageSize: true, printBackground: false });
      await page.emulateMedia({ media: "screen" });
    }
  }
  await page.locator("#sort").selectOption("excel");
  await expect(page.locator(".sku")).toHaveText(rows.map((row) => row.variantCode));
});

test("tisk skryje pouze přesnou frázi o pěti kusech, ostatní vícepacky zachová", async ({ page }) => {
  const cases = [
    ["Výhodné balení 5 kusů -\u00a0Dámské kalhotky", "Dámské kalhotky"],
    ["Výhodné balení 5 kusů - Dámské kalhotky", "Dámské kalhotky"],
    ["Výhodné balení 5 kusů -&#xA0;&#x20;Dámské kalhotky", "Dámské kalhotky"],
    ["Výhodné balení 5 kusů -&nbsp;Dámské kalhotky", "Dámské kalhotky"],
    ["5-PACK Výhodné balení pánských boxerek", "5-PACK Výhodné balení pánských boxerek"],
    ["3-PACK Bambusové ponožky", "3-PACK Bambusové ponožky"],
    ["Výhodné balení 3 kusů - Ponožky", "Výhodné balení 3 kusů - Ponožky"],
    ["Výhodné balení 5 kusů – Ponožky", "Výhodné balení 5 kusů – Ponožky"],
    ["5-PACK Výhodné balení 5 kusů - Boxerky II. jakost", "5-PACK Boxerky II. jakost"],
    ['Výhodné balení 5 kusů - <img src=x onerror="window.badName=true">', '<img src=x onerror="window.badName=true">'],
  ];
  const rows = cases.flatMap(([name], i) => [0, 1].map((variant) => ({
    productCode: "MODEL", variantCode: `MODEL-${i}-${variant}`, rowNumber: i * 2 + variant + 2,
    variant: "S/M, černá", initialQuantity: 1, sequence: "1x7", info: name,
    ...(variant === 0 ? { raw: { productName: name } } : {}),
  })));
  await page.route("**/api/datasets/71", (route) => route.fulfill({ json: { dataset: { datasetKind: "warehouse_print" }, rows } }));
  await page.route("**/api/product-images", (route) => route.fulfill({ json: { images: {} } }));
  await page.goto("/warehouse-print.html?dataset=71");
  await expect(page.locator("#print")).toBeEnabled();
  await page.locator("#sort").selectOption("excel");
  await expect(page.locator(".product-name")).toHaveText(cases.flatMap(([, expected]) => [expected, expected]));
  await expect(page.locator(".product-heading span")).toHaveText(cases.map(([, expected]) => expected));
  await expect(page.locator("#pieces")).toHaveText("20 ks");
  await expect(page.locator(".quality-label")).toHaveCount(2);
  expect(await page.evaluate(() => window.badName)).toBeUndefined();
  await page.screenshot({ path: "test-results/warehouse-clean-product-names.png", fullPage: true });
});

test("nadpis sčítá jen varianty a kusy vypsané v příslušném bloku", async ({ page }) => {
  const rows = [
    ["MODEL-A-SM", "S/M, bílá", "2x7, 3x20", "5"],
    ["MODEL-A-ML", "M/L, černá", "1x7, 4x20", "5"],
    ["MODEL-A-SM-II-JAKOST", "S/M, bílá", "3x7, 1x20", "4"],
    ["MODEL-A-ML-II-JAKOST", "M/L, černá", "2x7, 4x20", "6"],
  ].map(([variantCode, variant, sequence, initialQuantity], i) => ({
    variantCode, variant, sequence, initialQuantity, rowNumber: i + 2, productCode: "MODEL",
    info: "Dámské kalhotky s vyšším pasem",
  }));
  await page.route("**/api/datasets/71", (route) => route.fulfill({ json: {
    dataset: { datasetKind: "warehouse_print" }, rows,
    helperSheets: { KOMPLETACE: { cells: [Array(18).fill(""), [...Array(16).fill(""), 7, "0,8"]] } },
  } }));
  await page.route("**/api/product-images", (route) => route.fulfill({ json: { images: {} } }));
  await page.goto("/warehouse-print.html?dataset=71");
  await expect(page.locator("#print")).toBeEnabled();
  for (const sort of ["product", "excel", "box"]) {
    await page.locator("#sort").selectOption(sort);
    // Box sorting interleaves quality classes here, leaving only single-row blocks.
    await expect(page.locator(".product-total")).toHaveText(sort === "box" ? [] : ["Celkem 10 ks", "Celkem 10 ks"]);
    await page.getByText("Prioritní zásilky první", { exact: true }).click();
    await expect(page.locator(".product-total")).toHaveText(["Celkem 10 ks", "Celkem 10 ks"]);
    await page.getByText("Prioritní kusy zvlášť", { exact: true }).click();
    await expect(page.locator(".product-total")).toHaveText(["Celkem 3 ks", "Celkem 5 ks", "Celkem 7 ks", "Celkem 5 ks"]);
    await expect(page.locator("#pieces")).toHaveText("20 ks");
    await expect(page.locator("#summary")).toHaveText("4 variant · 2 boxů");
    await page.getByText("Běžné pořadí", { exact: true }).click();
  }
  await page.getByText("Prioritní kusy zvlášť", { exact: true }).click();
  await page.getByText("Na výšku", { exact: true }).click();
  await page.getByText("Kompaktní", { exact: true }).click();
  await page.screenshot({ path: "test-results/warehouse-product-totals.png", fullPage: true });
  await page.emulateMedia({ media: "print" });
  await page.pdf({ path: "test-results/warehouse-product-totals.pdf", preferCSSPageSize: true });
});

test("samostatná sestava tiskne všechny původní kusy na A4 na šířku", async ({ page }) => {
  const rows = fixture();
  await page.route("**/api/datasets/71", (route) => route.fulfill({ json: { dataset: { id: 71, datasetKind: "warehouse_print", datasetDate: "2026-09-18", datasetTime: "08:30", worksheetName: "Vyskladnění" }, rows } }));
  await page.route("**/api/product-images", (route) => route.fulfill({ json: { ok: true, configured: true, images: {} } }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/warehouse-print.html?dataset=71");
  await expect(page.locator("#print")).toBeEnabled();
  await expect(page.locator("#rows .item-row")).toHaveCount(rows.length);
  await expect(page.locator("thead th")).toHaveText(["Produkt / kód varianty", "Foto", "Varianta", "Celkem", "Kolik a kam do boxů"]);
  const firstCells = page.locator("#rows .item-row").first().locator("td");
  await expect(firstCells.nth(0).locator(".sku")).toHaveCount(1);
  await expect(firstCells.nth(1).locator("img, .no-photo")).toHaveCount(1);
  await expect(firstCells.nth(2).locator(".variant-value")).toHaveCount(1);
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
  await expect(page.locator("#rows .item-row td").nth(1).locator("img")).toHaveCount(1);
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

test("II. jakost je až na konci celé sestavy za všemi běžnými produkty", async ({ page }) => {
  const items = [
    ["6009P", "6009-ML-BILA-II-JAKOST", "Kalhotky 6009", 8],
    ["6002P", "6002-SM-TELOVA", "Kalhotky 6002", 7],
    ["6009P", "6009-SM-CERNA", "Kalhotky 6009", 6],
    ["6002P", "6002-LXL-BILA", "Nohavičky 6002 II. akosť - Farba", 5],
    ["6009P", "6009-LXL-BILA", "Kalhotky 6009 II. jakost - Barva", 4],
    ["6009P", "6009-XLXL-TELOVA", "Kalhotky 6009", 3],
    ["6010P", "6010-BILA", "Kalhotky 6010 2. jakost", 2],
    ["6009P", "6009-SM-MODRA", "Kalhotky 6009 III. jakost", 1],
  ];
  const rows = items.map(([productCode, variantCode, productName, box], index) => ({
    rowNumber: index + 2, productCode, variantCode, info: productName,
    raw: index === 3 ? { productName } : null,
    variant: "M/L, bílá", quantity: 2, initialQuantity: 2, sequence: `2x${box}`,
  }));
  await page.route("**/api/datasets/71", (route) => route.fulfill({ json: { dataset: { datasetKind: "warehouse_print" }, rows } }));
  await page.route("**/api/product-images", (route) => route.fulfill({ json: { images: {} } }));
  await page.goto("/warehouse-print.html?dataset=71");
  await expect(page.locator("#print")).toBeEnabled();
  const expected = [1, 2, 7, 5, 3, 4, 0, 6];
  await expect(page.locator(".sku")).toHaveText(expected.map((index) => items[index][1]));
  await expect(page.locator(".allocation")).toHaveText(expected.map((index) => `2 ks → box ${items[index][3]}`));
  await expect(page.locator("#pieces")).toHaveText("16 ks");
  await expect(page.locator("#rows tr.group-start .sku")).toHaveText([1, 2, 5, 3, 4, 0, 6].map((index) => items[index][1]));
  for (const label of ["Na šířku", "Na výšku"]) {
    await page.getByText(label, { exact: true }).click();
    expect(await page.locator("#sheet").evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  }
  await page.screenshot({ path: "test-results/warehouse-quality-groups.png", fullPage: true });
  await page.locator("#sort").selectOption("excel");
  await expect(page.locator(".sku")).toHaveText(items.map((item) => item[1]));
  await page.locator("#sort").selectOption("box");
  await expect(page.locator(".sku")).toHaveText([...items].sort((a, b) => a[3] - b[3]).map((item) => item[1]));
  await page.locator("#sort").selectOption("product");
  await expect(page.locator(".sku")).toHaveText(expected.map((index) => items[index][1]));
});

test("celý text boxu s kódem 0,8 z KOMPLETACE je červený i v tisku", async ({ page }) => {
  const destinations = [7, 14, 18, 20, 27, 28, 52, 56, 62, 66, 67, 68, 74, 78];
  const pairs = [["007", "0,8"], ["14", "0.8"], ["18", " 0,80 "], ["20", "1.8"], ["27", "8"], ["28", "0,81"], ["52", ""], ["56", "0,8x"], ["62", "0,8"], ["7", "0,8"], ["-66", "0,8"], ["67x", "0,8"], ["68.5", "0,8"], ["", "0,8"]];
  const cells = [Array(18).fill("Hlavička"), ...pairs.map(([box, code]) => {
    const row = Array(18).fill("");
    row[11] = "78";
    row[16] = box;
    row[17] = code;
    return row;
  })];
  let withHelpers = true;
  await page.route("**/api/datasets/71", (route) => route.fulfill({ json: {
    dataset: { datasetKind: "warehouse_print" },
    rows: [{ ...fixture()[0], raw: null, quantity: 14, initialQuantity: 14, sequence: destinations.map((box) => `1x${box}`).join(",") }],
    ...(withHelpers ? { helperSheets: { KOMPLETACE: { cells } } } : {}),
  } }));
  await page.route("**/api/product-images", (route) => route.fulfill({ json: { images: {} } }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/warehouse-print.html?dataset=71");
  await expect(page.locator("#print")).toBeEnabled();
  const red = page.locator(".allocation-red");
  for (const orientation of ["Na šířku", "Na výšku"]) {
    await page.getByText(orientation, { exact: true }).click();
    for (const density of ["Běžné", "Kompaktní"]) {
      await page.getByText(density, { exact: true }).click();
      for (const media of ["screen", "print"]) {
        await page.emulateMedia({ media });
        await expect(red).toHaveText([7, 14, 18, 62].map((box) => `1 ks → box ${box}`));
        expect(await red.evaluateAll((nodes) => nodes.every((node) =>
          [node, ...node.querySelectorAll("b")].every((el) => getComputedStyle(el).color === "rgb(180, 35, 24)")))).toBe(true);
        await expect(page.locator(".allocation:not(.allocation-red)").first()).toHaveCSS("color", "rgb(24, 43, 39)");
      }
      await page.emulateMedia({ media: "screen" });
    }
  }
  await page.getByText("Běžné", { exact: true }).click();
  await page.screenshot({ path: "test-results/warehouse-red-boxes.png" });
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".toolbar")).toBeHidden();
  await page.pdf({ path: "test-results/warehouse-red-boxes.pdf", preferCSSPageSize: true, printBackground: false });
  await page.emulateMedia({ media: "screen" });
  for (const sort of ["excel", "box", "product"]) {
    await page.locator("#sort").selectOption(sort);
    await expect(red).toHaveCount(4);
  }
  await page.locator("#reload").click();
  await expect(page.locator("#print")).toBeEnabled();
  await expect(red).toHaveCount(4);
  withHelpers = false;
  await page.locator("#reload").click();
  await expect(page.locator("#print")).toBeEnabled();
  await expect(red).toHaveCount(0);
  await expect(page.locator(".allocation")).toHaveCount(14);
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
  await expect(page.locator("#rows .item-row td")).toHaveCount(5);
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
  await expect(page.locator("#rows .item-row")).toHaveCount(45);
  const helpers = await page.locator("#warehouse-print-data").evaluate((node) => JSON.parse(node.textContent).helperSheets);
  expect(helpers.EXCEL.cells[1]).toEqual(["SKU-ČERNÁ", "TEST-POMOCNY-PRODUKT"]);
  expect(helpers.KOMPLETACE.cells[1][0]).toBe("00123");
  expect(await page.locator("body").innerText()).not.toContain("TEST-POMOCNY-PRODUKT");
  expect(await page.locator("body").innerText()).not.toContain("TEST-NEZOBRAZOVAT");
  expect(await page.evaluate(() => window.helperExecuted)).toBeUndefined();
  const redBoxCount = await page.locator(".allocation-red").count();
  expect(redBoxCount).toBeGreaterThan(0);
  expect(await page.locator(".allocation-red b:last-child").allTextContents()).toEqual(Array(redBoxCount).fill("3"));
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

  await page.locator("#sort").selectOption("product");
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
    await page.emulateMedia({ media: "print" });
    await page.pdf({ path: `test-results/warehouse-${orientation}-a4.pdf`, preferCSSPageSize: true, printBackground: true });
    await page.emulateMedia({ media: "screen" });
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
    await page.emulateMedia({ media: "print" });
    await page.pdf({ path: `test-results/warehouse-${orientation}-compact-a4.pdf`, preferCSSPageSize: true, printBackground: true });
    await page.emulateMedia({ media: "screen" });
    await page.getByText("Běžné", { exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-density", "normal");
    expect(await page.locator("table").evaluate((node) => node.getBoundingClientRect().height)).toBeCloseTo(normalHeight, 0);
  }
  const originalRows = await page.locator(".item-row").allTextContents();
  await page.getByText("Prioritní kusy zvlášť", { exact: true }).click();
  await expect(page.locator("#print")).toBeEnabled();
  await expect(page.locator("#pieces")).toHaveText(`${expectedTotal} ks`);
  expect(await page.locator(".quantity").evaluateAll((nodes) => nodes.reduce((sum, node) => sum + Number(node.textContent), 0))).toBe(expectedTotal);
  await page.getByText("Běžné pořadí", { exact: true }).click();
  expect(await page.locator(".item-row").allTextContents()).toEqual(originalRows);
  expect(apiRequests).toEqual([]);
  expect(errors).toEqual([]);
});
