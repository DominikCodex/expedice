const day = { id: 1, date: "2026-07-08", label: "8.7.2026", status: "active", activeBatches: 3, rowsCount: 14 };
const sortingDataset = { id: 11, datasetKind: "sorting", datasetDate: day.date, datasetTime: "06:20:18", label: "Test roztřídění", rowsCount: 5, status: "active" };
const completionDataset = { id: 12, datasetKind: "completion", datasetDate: day.date, datasetTime: "06:20:18", label: "Test kompletace", rowsCount: 2, status: "active", shopCode: "galantra_cz" };
const warehouseDataset = { id: 13, datasetKind: "warehouse", datasetDate: day.date, datasetTime: "06:22:00", label: "Test vyskladnění", rowsCount: 2, status: "active" };

const sortingRows = [
  { id: 101, datasetId: 11, orderNumber: "42006263", sequence: "3", variantCode: "GBTW-3101-LXL-CERNA", productCode: "GBTW-3101", variant: "černá / L/XL", quantity: "2", initialQuantity: "2", remaining: 1, info: "Dámské bambusové kalhotky klasik", paircode: "GBTWP" },
  { id: 102, datasetId: 11, orderNumber: "42006263", sequence: "3", variantCode: "GBTW-3101-LXL-RUZOVA", productCode: "GBTW-3101", variant: "růžová / L/XL", quantity: "1", initialQuantity: "1", remaining: 0, info: "Dámské bambusové kalhotky klasik", paircode: "GBTWP" },
  { id: 103, datasetId: 11, orderNumber: "42006264", sequence: "4", variantCode: "03019-MBH-LXL-UPE", productCode: "03019P", variant: "béžová / L/XL", quantity: "1", initialQuantity: "1", remaining: 1, info: "Boxerky vyšší bamboo 03019P", paircode: "03019P" },
];

const completionRows = [
  { id: 201, datasetId: 12, shopCode: "galantra_cz", orderNumber: "42006263", orderId: "1665", expeditionNumber: "19", expeditionOrderCode: "3", firstName: "NIKOLA", lastName: "VRABLIKOVA", streetWithNumber: "Vstiš 21", city: "Vstiš", zipCode: "33441", quantity: "3", paidStatus: "Dobírka", shippingMethod: "Osobní odběr na pobočce Zásilkovna.cz", completionStatus: "", raw: { items: [{ variantCode: "GBTW-3101-LXL-CERNA", quantity: 2, name: "Dámské bambusové kalhotky klasik" }, { variantCode: "GBTW-3101-LXL-RUZOVA", quantity: 1, name: "Dámské bambusové kalhotky klasik" }] }, cells: [] },
  { id: 202, datasetId: 12, shopCode: "galantra_cz", orderNumber: "42006264", expeditionNumber: "20", expeditionOrderCode: "0.8", firstName: "KVĚTOSLAVA", lastName: "MALÁ", streetWithNumber: "U Branišovského lesa 1", city: "České Budějovice", zipCode: "37005", quantity: "1", paidStatus: "Zaplaceno", shippingMethod: "Zásilkovna", completionStatus: "STORNO", raw: { items: [{ variantCode: "03019-MBH-LXL-UPE", quantity: 1, name: "Velmi dlouhý název produktu pro kontrolu bezpečného ořezání textu na malém skladovém monitoru" }] }, cells: [] },
];

const warehouseRows = [
  { id: 301, datasetId: 13, rowNumber: 2, productCode: "6002P", variantCode: "6002-HOLLAND-LXL-CERNA", variant: "Velikost: L/XL, Barva: černá", quantity: "3", initialQuantity: "3", remaining: 3, sequence: "1x3, 2x14", info: "Dámské hladké kalhotky s vyšším pasem", raw: { productName: "Dámské hladké kalhotky s vyšším pasem", allocations: [{ quantity: 1, destination: 3 }, { quantity: 2, destination: 14 }] } },
  { id: 302, datasetId: 13, rowNumber: 3, productCode: "GBTWP", variantCode: "GBTW-3109-SM-TELOVA", variant: "tělová / S/M", quantity: "1", initialQuantity: "1", remaining: 0, sequence: "1x6", info: "Bambusové vyšší dámské boxerky", raw: { productName: "Bambusové vyšší dámské boxerky", allocations: [{ quantity: 1, destination: 6 }] } },
];

completionRows[0] = {
  ...completionRows[0],
  country: "CZ",
  currency: "CZK",
  deliveryCarrier: "packeta",
  deliveryCarrierLabel: "Zásilkovna/Packeta",
  deliveryService: "packeta_pickup",
  deliveryServiceLabel: "Výdejní místo Zásilkovna/Packeta",
  pickupPointId: "",
  addressValidationStatus: "",
  editVersion: 0,
  shipments: [],
  problems: [{ category: "pickup", severity: "error", message: "Chybí výdejní místo nebo box." }],
  importedExpeditionDetails: {},
};
completionRows[1] = {
  ...completionRows[1],
  country: "CZ",
  currency: "CZK",
  deliveryCarrier: "packeta",
  deliveryCarrierLabel: "Zásilkovna/Packeta",
  deliveryService: "packeta_pickup",
  deliveryServiceLabel: "Výdejní místo Zásilkovna/Packeta",
  pickupPointId: "1001",
  pickupPointName: "Test pobočka",
  addressValidationStatus: "verified",
  editVersion: 1,
  shipments: [],
  problems: [],
  importedExpeditionDetails: {},
};

async function json(route, value, status = 200) {
  await route.fulfill({ status, contentType: "application/json; charset=utf-8", body: JSON.stringify(value) });
}

async function mockExpeditionApp(page, role = "admin") {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    if (pathname === "/api/auth/me") return json(route, { authenticated: true, user: { id: 1, username: "test", displayName: "TEST", role } });
    if (pathname === "/api/settings") return json(route, { settings: { appearance: { font: "system", completionDensity: "auto" }, automation: { postUploadPaymentCheck: true, postUploadAddressCheck: true }, expeditionOrderCodeLabels: {}, printAgent: { testingMode: false } } });
    if (pathname === "/api/expedition-days") return json(route, { days: [day] });
    if (pathname === "/api/expedition-days/bulk-delete" && request.method() === "POST") {
      const dates = request.postDataJSON()?.dates || [];
      return json(route, { ok: true, deletedDays: dates.length, deletedDatasets: dates.length * 2, expeditionDays: dates.map((date) => ({ date, status: "deleted" })) });
    }
    if (pathname === `/api/expedition-days/${day.date}/full`) return json(route, { day, sorting: [sortingDataset], warehouse: [warehouseDataset], completion: [completionDataset], activeSorting: { dataset: sortingDataset, rows: sortingRows }, activeWarehouse: { dataset: warehouseDataset, rows: warehouseRows }, activeCompletion: { dataset: completionDataset, rows: completionRows } });
    if (pathname === "/api/expedition-days/1/report") return json(route, { day, snapshot: { id: 1, metrics: { orders: 2, pieces: 4, stockOrders: 1, stockPieces: 1, addressErrors: 0, paymentWarnings: 0, codeRanges: [{ start: 19, end: 19, code: "3", count: 1 }, { start: 20, end: 20, code: "0.8", count: 1 }] } }, live: { sortingRemaining: 2 } });
    if (pathname === "/api/expedition-days/1/checks/latest") return json(route, { ok: true, automation: { postUploadPaymentCheck: true, postUploadAddressCheck: true }, job: { id: "check-1", kind: "post_upload_checks", status: "completed", phase: "done", progress: 100, current: 4, total: 4, message: "AutomatickĂˇ kontrola je dokonÄŤenĂˇ.", result: { payments: { status: "completed", current: 2, total: 2, problems: 2, errors: [] }, addresses: { status: "completed", current: 2, total: 2, problems: 1, suggestions: 1, errors: [] } } } });
    if (pathname === "/api/expedition-days/1/checks/retry" && request.method() === "POST") return json(route, { ok: true, checkJob: { id: "check-2", status: "queued", phase: "queued", progress: 0, current: 0, total: 4, message: "Kontrola ÄŤekĂˇ na spuĹˇtÄ›nĂ­.", result: { payments: { status: "queued", current: 0, total: 2 }, addresses: { status: "queued", current: 0, total: 2 } } } }, 202);
    if (pathname === "/api/expedition-days/1/integrity") return json(route, { ok: false, summary: { errors: 1, warnings: 0, info: 0 }, issues: [{ severity: "error", code: "variant_quantity", message: "Nesedí množství konkrétní varianty.", context: { orderNumber: "42006263" } }] });
    if (/\/api\/completion\/rows\/\d+\/sorting-check$/.test(pathname)) return json(route, { ok: false, dataset: sortingDataset, rows: sortingRows.filter((row) => pathname.includes("201") ? row.orderNumber === "42006263" : row.orderNumber === "42006264"), remainingTotal: 1, variantComparison: { hasExpectedVariants: true, matches: true, items: [] } });
    if (/\/api\/completion\/rows\/\d+\/shipments$/.test(pathname) && request.method() === "GET") {
      const row = pathname.includes("201") ? completionRows[0] : completionRows[1];
      return json(route, { ok: true, row, shipments: row.shipments || [], problems: row.problems || [] });
    }
    if (/\/api\/completion\/rows\/\d+\/expedition-details$/.test(pathname) && request.method() === "PATCH") {
      const source = pathname.includes("201") ? completionRows[0] : completionRows[1];
      const payload = request.postDataJSON();
      const updated = { ...source, ...(payload.details || {}), editVersion: (source.editVersion || 0) + 1, addressValidationStatus: "verified", addressValidationMessage: "Ověřeno v testu.", problems: [] };
      return json(route, { ok: true, row: updated, shipments: [], problems: [], validation: { status: "verified", message: "Ověřeno v testu.", issues: [] } });
    }
    if (pathname === "/api/pickup-points") return json(route, { ok: true, widgetKey: "test-key", catalog: { rowsCount: 1, refreshedAt: "2026-07-08T06:00:00Z" }, points: [{ carrier: url.searchParams.get("carrier"), country: "CZ", id: "1001", name: "Pobočka Praha", address: "Václavské náměstí 1", city: "Praha", zipCode: "11000", codAllowed: true }] });
    if (/\/api\/pickup-points\/(packeta|dpd)\//.test(pathname)) return json(route, { ok: true, point: { carrier: pathname.includes("dpd") ? "dpd" : "packeta", country: "CZ", id: "1001", name: "Pobočka Praha", address: "Václavské náměstí 1", city: "Praha", zipCode: "11000", codAllowed: true } });
    if (/\/api\/completion\/rows\/\d+\/workflow$/.test(pathname)) return json(route, { ok: true, row: { ...completionRows[0], completionStatus: "OK" }, integrityWarnings: [] });
    if (/\/api\/warehouse\/rows\/\d+$/.test(pathname) && request.method() === "PATCH") {
      const row = warehouseRows.find((item) => pathname.endsWith(`/${item.id}`));
      const action = request.postDataJSON()?.action;
      const initial = Number(row.initialQuantity || row.quantity || 0);
      if (action === "deduct") row.remaining = Math.max(0, row.remaining - 1);
      if (action === "restore") row.remaining = Math.min(initial, row.remaining + 1);
      if (action === "complete") row.remaining = 0;
      if (action === "reset") row.remaining = initial;
      return json(route, { ok: true, row: { ...row } });
    }
    if (pathname === `/api/datasets/${warehouseDataset.id}`) return json(route, { dataset: warehouseDataset, rows: warehouseRows });
    if (pathname === "/api/product-images") return json(route, { ok: true, images: {} });
    if (pathname === "/api/payment-feeds/updates") return json(route, { rows: [] });
    if (pathname === "/api/audit-events") return json(route, { events: [], retentionDays: 90 });
    if (pathname === "/api/test-slow") {
      await new Promise((resolve) => setTimeout(resolve, 900));
      return json(route, { ok: true });
    }
    return json(route, { ok: true, rows: [] });
  });
}

module.exports = { mockExpeditionApp, day, completionRows };
