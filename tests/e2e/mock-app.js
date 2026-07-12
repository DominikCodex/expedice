const day = { id: 1, date: "2026-07-08", label: "8.7.2026", status: "active", activeBatches: 2, rowsCount: 12 };
const sortingDataset = { id: 11, datasetKind: "sorting", datasetDate: day.date, datasetTime: "06:20:18", label: "Test roztřídění", rowsCount: 5, status: "active" };
const completionDataset = { id: 12, datasetKind: "completion", datasetDate: day.date, datasetTime: "06:20:18", label: "Test kompletace", rowsCount: 2, status: "active", shopCode: "galantra_cz" };

const sortingRows = [
  { id: 101, datasetId: 11, orderNumber: "42006263", sequence: "3", variantCode: "GBTW-3101-LXL-CERNA", productCode: "GBTW-3101", variant: "černá / L/XL", quantity: "2", initialQuantity: "2", remaining: 1, info: "Dámské bambusové kalhotky klasik", paircode: "GBTWP" },
  { id: 102, datasetId: 11, orderNumber: "42006263", sequence: "3", variantCode: "GBTW-3101-LXL-RUZOVA", productCode: "GBTW-3101", variant: "růžová / L/XL", quantity: "1", initialQuantity: "1", remaining: 0, info: "Dámské bambusové kalhotky klasik", paircode: "GBTWP" },
  { id: 103, datasetId: 11, orderNumber: "42006264", sequence: "4", variantCode: "03019-MBH-LXL-UPE", productCode: "03019P", variant: "béžová / L/XL", quantity: "1", initialQuantity: "1", remaining: 1, info: "Boxerky vyšší bamboo 03019P", paircode: "03019P" },
];

const completionRows = [
  { id: 201, datasetId: 12, shopCode: "galantra_cz", orderNumber: "42006263", orderId: "1665", expeditionNumber: "19", expeditionOrderCode: "3", firstName: "NIKOLA", lastName: "VRABLIKOVA", streetWithNumber: "Vstiš 21", city: "Vstiš", zipCode: "33441", quantity: "3", paidStatus: "Dobírka", shippingMethod: "Osobní odběr na pobočce Zásilkovna.cz", completionStatus: "", raw: { items: [{ variantCode: "GBTW-3101-LXL-CERNA", quantity: 2, name: "Dámské bambusové kalhotky klasik" }, { variantCode: "GBTW-3101-LXL-RUZOVA", quantity: 1, name: "Dámské bambusové kalhotky klasik" }] }, cells: [] },
  { id: 202, datasetId: 12, shopCode: "galantra_cz", orderNumber: "42006264", expeditionNumber: "20", expeditionOrderCode: "0.8", firstName: "KVĚTOSLAVA", lastName: "MALÁ", streetWithNumber: "U Branišovského lesa 1", city: "České Budějovice", zipCode: "37005", quantity: "1", paidStatus: "Zaplaceno", shippingMethod: "Zásilkovna", completionStatus: "STORNO", raw: { items: [{ variantCode: "03019-MBH-LXL-UPE", quantity: 1, name: "Velmi dlouhý název produktu pro kontrolu bezpečného ořezání textu na malém skladovém monitoru" }] }, cells: [] },
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
    if (pathname === "/api/settings") return json(route, { settings: { appearance: { font: "system", completionDensity: "auto" }, expeditionOrderCodeLabels: {}, printAgent: { testingMode: false } } });
    if (pathname === "/api/expedition-days") return json(route, { days: [day] });
    if (pathname === `/api/expedition-days/${day.date}/full`) return json(route, { day, sorting: [sortingDataset], completion: [completionDataset], activeSorting: { dataset: sortingDataset, rows: sortingRows }, activeCompletion: { dataset: completionDataset, rows: completionRows } });
    if (pathname === "/api/expedition-days/1/report") return json(route, { day, snapshot: { id: 1, metrics: { orders: 2, pieces: 4, stockOrders: 1, stockPieces: 1, addressErrors: 0, paymentWarnings: 0, codeRanges: [{ start: 19, end: 19, code: "3", count: 1 }, { start: 20, end: 20, code: "0.8", count: 1 }] } }, live: { sortingRemaining: 2 } });
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

module.exports = { mockExpeditionApp, day };
