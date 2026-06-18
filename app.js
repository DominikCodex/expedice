const STORAGE_KEY = "rozrazovani-zbozi-v2";
const MAX_HISTORY = 500;

const seed = window.SORTING_SEED || { items: [], eanMap: {}, summary: {} };

const state = {
  items: [],
  eanMap: {},
  history: [],
  settings: {
    showZero: false,
    showImages: true,
  },
};

let activeCandidates = [];

const expeditionState = {
  days: [],
  day: null,
  loaded: false,
  showInactive: false,
};

const sortingState = {
  datasets: [],
  dataset: null,
  loaded: false,
};

const completionState = {
  datasets: [],
  dataset: null,
  rows: [],
  loaded: false,
};

const els = {
  eanInput: document.getElementById("ean-input"),
  manualSearch: document.getElementById("manual-search"),
  showZero: document.getElementById("show-zero"),
  showImages: document.getElementById("show-images"),
  exportData: document.getElementById("export-data"),
  importData: document.getElementById("import-data"),
  resetSeed: document.getElementById("reset-seed"),
  scanMessage: document.getElementById("scan-message"),
  candidatesPanel: document.getElementById("candidates-panel"),
  candidateList: document.getElementById("candidate-list"),
  clearCandidates: document.getElementById("clear-candidates"),
  scanResult: document.getElementById("scan-result"),
  scanSequence: document.getElementById("scan-sequence"),
  scanCode: document.getElementById("scan-code"),
  scanOrder: document.getElementById("scan-order"),
  scanRemaining: document.getElementById("scan-remaining"),
  sortingBody: document.getElementById("sorting-body"),
  historyList: document.getElementById("history-list"),
  rowCount: document.getElementById("row-count"),
  metricOpen: document.getElementById("metric-open"),
  metricItems: document.getElementById("metric-items"),
  metricOrders: document.getElementById("metric-orders"),
  metricDone: document.getElementById("metric-done"),
  expeditionDayList: document.getElementById("expedition-day-list"),
  expeditionRefresh: document.getElementById("expedition-refresh"),
  expeditionShowInactive: document.getElementById("show-inactive-datasets"),
  expeditionDaySummary: document.getElementById("expedition-day-summary"),
  tabSorting: document.getElementById("tab-sorting"),
  tabCompletion: document.getElementById("tab-completion"),
  sortingView: document.getElementById("sorting-view"),
  sortingDataset: document.getElementById("sorting-dataset"),
  sortingRefresh: document.getElementById("sorting-refresh"),
  sortingDelete: document.getElementById("sorting-delete"),
  sortingDatasetInfo: document.getElementById("sorting-dataset-info"),
  completionView: document.getElementById("completion-view"),
  completionDataset: document.getElementById("completion-dataset"),
  completionRefresh: document.getElementById("completion-refresh"),
  completionDelete: document.getElementById("completion-delete"),
  packetaDryRun: document.getElementById("packeta-dry-run"),
  packetaValidate: document.getElementById("packeta-validate"),
  packetaDryRunResult: document.getElementById("packeta-dry-run-result"),
  completionMessage: document.getElementById("completion-message"),
  completionSummary: document.getElementById("completion-summary"),
  completionBody: document.getElementById("completion-body"),
  completionRowCount: document.getElementById("completion-row-count"),
};

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    }[char];
  });
}

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function sameCode(a, b) {
  return normalize(a).trim() === normalize(b).trim();
}

function toNumber(value, fallback = 0) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cloneSeed() {
  return {
    items: (seed.items || []).map(normalizeItem),
    eanMap: seed.eanMap || {},
    history: [],
    settings: {
      showZero: false,
      showImages: true,
    },
  };
}

function normalizeItem(item) {
  const remaining = Math.max(0, Math.trunc(toNumber(item.remaining, 0)));
  const initial = Math.max(remaining, Math.trunc(toNumber(item.initialQuantity, remaining)));
  return {
    id: item.id || uid("row"),
    sourceRow: item.sourceRow || "",
    productCode: item.productCode || "",
    variantCode: item.variantCode || "",
    variant: item.variant || "",
    remaining,
    initialQuantity: initial,
    orderNumber: item.orderNumber || "",
    weight: item.weight || "",
    sequence: item.sequence || "",
    info: item.info || "",
    paircode: item.paircode || "",
    brand: item.brand || brandFromInfo(item.info),
    unitPrice: item.unitPrice || "",
    lineTotal: item.lineTotal || "",
    productName: item.productName || cleanInfo(item.info),
    externalId: item.externalId || "",
    image: item.image || "",
  };
}

function brandFromInfo(info) {
  const parts = String(info || "")
    .split("//")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 1 ? parts[0] : "";
}

function cleanInfo(info) {
  const parts = String(info || "")
    .split("//")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.at(-1) || "";
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function applyLoaded(next) {
  state.items = (next.items || []).map(normalizeItem);
  state.eanMap = next.eanMap || {};
  state.history = Array.isArray(next.history) ? next.history.slice(0, MAX_HISTORY) : [];
  state.settings = {
    showZero: Boolean(next.settings?.showZero),
    showImages: next.settings?.showImages !== false,
  };
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    applyLoaded(cloneSeed());
    saveState();
    return;
  }

  try {
    applyLoaded(JSON.parse(raw));
  } catch {
    applyLoaded(cloneSeed());
    saveState();
  }
}

function setMessage(text, type = "neutral") {
  els.scanMessage.className = `message ${type}`;
  els.scanMessage.textContent = text;
}

function setCompletionMessage(text, type = "neutral") {
  els.completionMessage.className = `message ${type}`;
  els.completionMessage.textContent = text;
}

async function fetchJson(path, options = {}) {
  const headers = options.body
    ? { "Content-Type": "application/json", ...(options.headers || {}) }
    : options.headers || {};
  const response = await fetch(path, { cache: "no-store", ...options, headers });
  if (!response.ok) {
    let message = `API vratilo chybu ${response.status}`;
    try {
      const data = await response.json();
      message = data.error || message;
    } catch {
      // Keep fallback message.
    }
    throw new Error(message);
  }
  return response.json();
}

function datasetLabel(dataset) {
  if (!dataset) return "Bez dávky";
  const shop = dataset.shopName || dataset.shopCode || "neznámý e-shop";
  const kind = dataset.datasetKind === "completion" ? "kompletace" : dataset.datasetKind;
  const status = dataset.status && dataset.status !== "active" ? ` | ${dataset.status}` : "";
  return `${dataset.batchName || dataset.datasetDate} ${dataset.datasetTime} | ${shop} | ${kind} | ${dataset.rowsCount} řádků${status}`;
}

function dayLabel(day) {
  if (!day) return "Bez expedičního dne";
  const latest = day.latestUpload ? ` | poslední ${formatTime(day.latestUpload)}` : "";
  return `${day.label || day.date} | ${day.activeBatches || 0} aktivní dávky | ${day.rowsCount || 0} řádků${latest}`;
}

function datasetInfoHtml(dataset) {
  if (!dataset) return `<span>Žádná aktivní dávka</span>`;
  return `
    <span><strong>${escapeHtml(dataset.batchName || dataset.datasetDate)}</strong></span>
    <span>${escapeHtml(dataset.datasetTime || "")}</span>
    <span>${escapeHtml(dataset.shopName || dataset.shopCode || "e-shop neurčen")}</span>
    <span>${escapeHtml(dataset.rowsCount || 0)} řádků</span>
    <span>${escapeHtml(dataset.status || "active")}</span>
  `;
}

function expeditionQuery(params = {}) {
  const query = new URLSearchParams();
  if (expeditionState.showInactive) query.set("includeDeleted", "1");
  if (params.date) query.set("date", params.date);
  const text = query.toString();
  return text ? `?${text}` : "";
}

function includeInactiveQuery() {
  return expeditionQuery();
}

function switchView(view) {
  const completion = view === "completion";
  els.sortingView.classList.toggle("hidden", completion);
  els.completionView.classList.toggle("hidden", !completion);
  els.tabSorting.classList.toggle("active", !completion);
  els.tabCompletion.classList.toggle("active", completion);

  if (completion && !completionState.loaded) {
    loadCompletionDatasets();
  }

  if (!completion) {
    requestAnimationFrame(() => els.eanInput.focus());
  }
}

function renderExpeditionDayOptions() {
  els.expeditionDayList.innerHTML = "";

  if (!expeditionState.days.length) {
    els.expeditionDaySummary.innerHTML = `<span>Online zatím neobsahuje žádný expediční den.</span>`;
    return;
  }

  expeditionState.days.forEach((day) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `day-card ${expeditionState.day?.date === day.date ? "active" : ""}`;
    button.dataset.date = day.date;
    button.innerHTML = `
      <strong>${escapeHtml(day.label || day.date)}</strong>
      <span>${escapeHtml(day.activeBatches || 0)} aktivní dávky</span>
      <small>${escapeHtml(day.rowsCount || 0)} řádků${day.latestUpload ? ` | ${escapeHtml(formatTime(day.latestUpload))}` : ""}</small>
    `;
    els.expeditionDayList.appendChild(button);
  });
}

function renderSortingOptions() {
  els.sortingDataset.innerHTML = "";

  if (!sortingState.datasets.length) {
    els.sortingDataset.innerHTML = `<option value="">Žádná dávka roztřídění</option>`;
    els.sortingDatasetInfo.innerHTML = datasetInfoHtml(null);
    els.sortingDelete.disabled = true;
    return;
  }

  sortingState.datasets.forEach((dataset) => {
    const option = document.createElement("option");
    option.value = dataset.id;
    option.textContent = datasetLabel(dataset);
    els.sortingDataset.appendChild(option);
  });

  if (sortingState.dataset) {
    els.sortingDataset.value = String(sortingState.dataset.id);
  }
  els.sortingDatasetInfo.innerHTML = datasetInfoHtml(sortingState.dataset);
  els.sortingDelete.disabled = !sortingState.dataset || sortingState.dataset.status !== "active";
}

async function loadExpeditionDays(preferredDate = "") {
  expeditionState.showInactive = els.expeditionShowInactive.checked;
  els.expeditionDaySummary.innerHTML = `<span>Načítám expediční dny...</span>`;

  try {
    const preferred = preferredDate || expeditionState.day?.date || "";
    const data = await fetchJson(`/api/expedition-days/initial${expeditionQuery({ date: preferred })}`);
    expeditionState.days = data.days || [];
    expeditionState.loaded = true;

    if (!data.day) {
      expeditionState.day = null;
      sortingState.datasets = [];
      sortingState.dataset = null;
      completionState.datasets = [];
      completionState.dataset = null;
      completionState.rows = [];
      renderExpeditionDayOptions();
      renderSortingOptions();
      renderCompletionOptions();
      renderCompletion();
      els.expeditionDaySummary.innerHTML = `<span>Online zatím neobsahuje žádný expediční den.</span>`;
      return;
    }

    expeditionState.day = data.day || null;
    sortingState.datasets = data.sorting || [];
    completionState.datasets = data.completion || [];
    sortingState.loaded = true;
    completionState.loaded = true;

    renderExpeditionDayOptions();
    els.expeditionDaySummary.innerHTML = `<span><strong>${escapeHtml(expeditionState.day.label)}</strong></span><span>${escapeHtml(
      expeditionState.day.activeBatches || 0
    )} aktivní dávky</span><span>${escapeHtml(expeditionState.day.rowsCount || 0)} řádků</span>`;

    renderSortingOptions();
    renderCompletionOptions();

    if (data.activeSorting?.dataset) {
      applySortingDataset(data.activeSorting.dataset, data.activeSorting.rows || []);
    } else {
      sortingState.dataset = null;
      renderSortingOptions();
      setMessage("Pro vybraný expediční den není nahrané roztřídění.", "warning");
    }

    if (data.activeCompletion?.dataset) {
      applyCompletionDataset(data.activeCompletion.dataset, data.activeCompletion.rows || []);
    } else {
      completionState.dataset = null;
      completionState.rows = [];
      renderCompletionOptions();
      renderCompletion();
      setCompletionMessage("Pro vybraný expediční den není nahraná kompletace.", "warning");
    }
  } catch (error) {
    expeditionState.loaded = true;
    els.expeditionDaySummary.innerHTML = `<span>Online dny se nepodařilo načíst: ${escapeHtml(error.message)}</span>`;
  }
}
async function loadExpeditionDays(preferredDate = "") {
  expeditionState.showInactive = els.expeditionShowInactive.checked;
  els.expeditionDaySummary.innerHTML = `<span>Načítám expediční dny...</span>`;

  try {
    const data = await fetchJson(`/api/expedition-days${includeInactiveQuery()}`);
    expeditionState.days = data.days || [];
    expeditionState.loaded = true;
    renderExpeditionDayOptions();

    const selectedDate =
      preferredDate ||
      expeditionState.day?.date ||
      expeditionState.days[0]?.date ||
      "";

    if (!selectedDate) {
      sortingState.datasets = [];
      sortingState.dataset = null;
      completionState.datasets = [];
      completionState.dataset = null;
      completionState.rows = [];
      renderSortingOptions();
      renderCompletionOptions();
      renderCompletion();
      return;
    }

    await loadExpeditionDay(selectedDate);
  } catch (error) {
    expeditionState.loaded = true;
    els.expeditionDaySummary.innerHTML = `<span>Online dny se nepodařilo načíst: ${escapeHtml(error.message)}</span>`;
  }
}

async function loadExpeditionDay(dayDate) {
  if (!dayDate) return;
  const data = await fetchJson(`/api/expedition-days/${encodeURIComponent(dayDate)}/full${includeInactiveQuery()}`);
  expeditionState.day = data.day || null;
  sortingState.datasets = data.sorting || [];
  completionState.datasets = data.completion || [];
  sortingState.loaded = true;
  completionState.loaded = true;

  renderExpeditionDayOptions();
  els.expeditionDaySummary.innerHTML = expeditionState.day
    ? `<span><strong>${escapeHtml(expeditionState.day.label)}</strong></span><span>${escapeHtml(
        expeditionState.day.activeBatches || 0
      )} aktivní dávky</span><span>${escapeHtml(expeditionState.day.rowsCount || 0)} řádků</span>`
    : `<span>Den není načtený.</span>`;

  renderSortingOptions();
  renderCompletionOptions();

  if (data.activeSorting?.dataset) {
    applySortingDataset(data.activeSorting.dataset, data.activeSorting.rows || []);
  } else {
    sortingState.dataset = null;
    renderSortingOptions();
    setMessage("Pro vybraný expediční den není nahrané roztřídění.", "warning");
  }

  if (data.activeCompletion?.dataset) {
    applyCompletionDataset(data.activeCompletion.dataset, data.activeCompletion.rows || []);
  } else {
    completionState.dataset = null;
    completionState.rows = [];
    renderCompletionOptions();
    renderCompletion();
    setCompletionMessage("Pro vybraný expediční den není nahraná kompletace.", "warning");
  }
}

function sortingRowToItem(row) {
  return normalizeItem({
    id: `online-${row.id}`,
    sourceRow: row.rowNumber || "",
    productCode: row.productCode || "",
    variantCode: row.variantCode || "",
    variant: row.variant || "",
    remaining: row.remaining ?? row.quantity ?? 0,
    initialQuantity: row.initialQuantity || row.quantity || row.remaining || 0,
    orderNumber: row.orderNumber || "",
    weight: row.weight || "",
    sequence: row.sequence || "",
    info: row.info || "",
    paircode: row.paircode || "",
    brand: brandFromInfo(row.info),
    productName: cleanInfo(row.info),
  });
}

function applySortingDataset(dataset, rows) {
  sortingState.dataset = dataset || null;
  const nextItems = (rows || []).map(sortingRowToItem);
  applyLoaded({
    items: nextItems,
    eanMap: Object.keys(state.eanMap || {}).length ? state.eanMap : seed.eanMap || {},
    history: [],
    settings: state.settings,
  });
  activeCandidates = [];
  saveState();
  renderSortingOptions();
  renderAll();
  setMessage(`Načteno roztřídění: ${datasetLabel(sortingState.dataset)}.`, "success");
}

async function loadSortingDataset(datasetId) {
  if (!datasetId) return;
  setMessage("Načítám vybrané roztřídění...", "neutral");
  try {
    const data = await fetchJson(`/api/datasets/${datasetId}`);
    applySortingDataset(data.dataset || null, data.rows || []);
  } catch (error) {
    setMessage(`Roztřídění se nepodařilo načíst: ${error.message}`, "error");
  }
}

async function deleteDataset(dataset, afterDelete) {
  if (!dataset) return false;
  const label = datasetLabel(dataset);
  if (!confirm(`Smazat dávku?\n\n${label}\n\nData zůstanou v historii jako smazaná.`)) return false;

  await fetchJson(`/api/datasets/${dataset.id}`, {
    method: "DELETE",
    body: JSON.stringify({
      deletedBy: "web",
      reason: "Smazáno ve webovém rozhraní",
    }),
  });

  await afterDelete();
  return true;
}

function renderCompletionOptions() {
  els.completionDataset.innerHTML = "";

  if (!completionState.datasets.length) {
    els.completionDataset.innerHTML = `<option value="">Žádná dávka</option>`;
    els.completionDelete.disabled = true;
    els.packetaDryRun.disabled = true;
    els.packetaValidate.disabled = true;
    return;
  }

  completionState.datasets.forEach((dataset) => {
    const option = document.createElement("option");
    option.value = dataset.id;
    option.textContent = datasetLabel(dataset);
    els.completionDataset.appendChild(option);
  });

  if (completionState.dataset) {
    els.completionDataset.value = String(completionState.dataset.id);
  }
  els.completionDelete.disabled = !completionState.dataset || completionState.dataset.status !== "active";
  els.packetaDryRun.disabled = !completionState.dataset;
  els.packetaValidate.disabled = !completionState.dataset;
}

async function loadCompletionDatasets() {
  if (expeditionState.day?.date) {
    await loadExpeditionDay(expeditionState.day.date);
    return;
  }
  await loadExpeditionDays();
}

function applyCompletionDataset(dataset, rows) {
  completionState.dataset = dataset || null;
  completionState.rows = rows || [];
  hidePacketaDryRunResult();
  renderCompletionOptions();
  renderCompletion();
  setCompletionMessage(`Načteno: ${datasetLabel(completionState.dataset)}.`, "success");
}

function hidePacketaDryRunResult() {
  els.packetaDryRunResult.classList.add("hidden");
  els.packetaDryRunResult.innerHTML = "";
}

function renderPacketaDryRun(data) {
  const packets = data.packets || [];
  const skipped = data.skipped || [];
  const packetsCount = data.packetsCount ?? packets.length;
  const skippedCount = data.skippedCount ?? skipped.length;
  const truncatedCount = data.truncatedCount || 0;

  const packetCards = packets
    .map((packet, index) => {
      const warnings = packet.warnings?.length
        ? `<div class="warning-list">${packet.warnings
            .map((warning) => `<span>${escapeHtml(warning)}</span>`)
            .join("")}</div>`
        : "";

      return `
        <details class="dry-run-item" ${index === 0 ? "open" : ""}>
          <summary>
            <strong>${escapeHtml(packet.orderNumber || "-")}</strong>
            <span>${escapeHtml(packet.customer || "-")}</span>
            <small>${escapeHtml(packet.service || "")} | ${escapeHtml(packet.eshop || "")} | ${escapeHtml(
        packet.currency || ""
      )}</small>
          </summary>
          <div class="dry-run-meta">
            <span>Adresa ID: ${escapeHtml(packet.addressId || "-")}</span>
            <span>Dobirka: ${escapeHtml(packet.cod || "-")}</span>
            <span>Vaha: ${escapeHtml(packet.weight || "-")}</span>
          </div>
          ${warnings}
          <pre>${escapeHtml(packet.requestXml || "")}</pre>
        </details>
      `;
    })
    .join("");

  const skippedHtml = skipped.length
    ? `
      <details class="dry-run-item dry-run-skipped">
        <summary>
          <strong>Preskocene radky</strong>
          <span>${escapeHtml(skippedCount)} ks</span>
        </summary>
        <div class="skipped-list">
          ${skipped
            .slice(0, 80)
            .map(
              (row) => `
                <div>
                  <strong>${escapeHtml(row.orderNumber || "-")}</strong>
                  <span>${escapeHtml(row.customer || "")}</span>
                  <small>${escapeHtml(row.reason || "")}</small>
                </div>
              `
            )
            .join("")}
        </div>
      </details>
    `
    : "";

  els.packetaDryRunResult.classList.remove("hidden");
  els.packetaDryRunResult.innerHTML = `
    <div class="section-head compact">
      <div>
        <p class="eyebrow">Zasilkovna / Packeta</p>
        <h2>Dry run vytvoreni zásilek</h2>
      </div>
      <div class="dry-run-counts">
        <span>${escapeHtml(packetsCount)} zásilek</span>
        <span>${escapeHtml(skippedCount)} přeskočeno</span>
        ${truncatedCount ? `<span>${escapeHtml(truncatedCount)} dalsich skryto</span>` : ""}
      </div>
    </div>
    <div class="dry-run-note">
      Nic se neposlalo do Zásilkovny a databaze se nezmenila. API heslo je v náhledu záměrně vynechané.
    </div>
    <div class="dry-run-list">
      ${packetCards || `<div class="empty">Nenašel jsem žádnou zásilku k vytvoření.</div>`}
      ${skippedHtml}
    </div>
  `;
}

async function runPacketaDryRun() {
  if (!completionState.dataset?.id) {
    setCompletionMessage("Nejdřív načti kompletaci pro expediční den.", "warning");
    return;
  }

  els.packetaDryRun.disabled = true;
  hidePacketaDryRunResult();
  setCompletionMessage("Skládám dry run Zásilkovny...", "neutral");

  try {
    const data = await fetchJson(
      `/api/packeta/dry-run?datasetId=${encodeURIComponent(completionState.dataset.id)}&limit=50`
    );
    renderPacketaDryRun(data);
    setCompletionMessage(
      `Dry run hotový: ${data.packetsCount || 0} zásilek, přeskočeno ${data.skippedCount || 0}.`,
      "success"
    );
  } catch (error) {
    setCompletionMessage(`Dry run Zásilkovny se nepodařil: ${error.message}`, "error");
  } finally {
    els.packetaDryRun.disabled = !completionState.dataset;
  }
}

function renderPacketaValidation(data) {
  const results = data.results || [];
  const skipped = data.skipped || [];
  const okCount = results.filter((item) => item.valid).length;
  const errorCount = results.length - okCount;

  const resultCards = results
    .map((item, index) => {
      const tone = item.valid ? "ok" : "danger";
      const status = item.valid ? "OK" : item.status || "chyba";
      return `
        <details class="dry-run-item validation-item ${tone}" ${index === 0 || !item.valid ? "open" : ""}>
          <summary>
            <strong>${escapeHtml(item.orderNumber || "-")}</strong>
            <span>${escapeHtml(item.customer || "-")}</span>
            <small>${escapeHtml(status)} | HTTP ${escapeHtml(item.httpStatus || "-")} | ${escapeHtml(
        item.service || ""
      )}</small>
          </summary>
          <div class="dry-run-meta">
            <span>Adresa ID: ${escapeHtml(item.addressId || "-")}</span>
            <span>E-shop: ${escapeHtml(item.eshop || "-")}</span>
            <span>Doprava: ${escapeHtml(item.shippingMethod || "-")}</span>
          </div>
          ${item.error ? `<div class="warning-list"><span>${escapeHtml(item.error)}</span></div>` : ""}
          <pre>${escapeHtml(item.responseText || "Bez textove odpovedi.")}</pre>
        </details>
      `;
    })
    .join("");

  const skippedHtml = skipped.length
    ? `
      <details class="dry-run-item dry-run-skipped">
        <summary>
          <strong>Preskocene radky</strong>
          <span>${escapeHtml(skipped.length)} ks</span>
        </summary>
        <div class="skipped-list">
          ${skipped
            .slice(0, 80)
            .map(
              (row) => `
                <div>
                  <strong>${escapeHtml(row.orderNumber || "-")}</strong>
                  <span>${escapeHtml(row.customer || "")}</span>
                  <small>${escapeHtml(row.reason || "")}</small>
                </div>
              `
            )
            .join("")}
        </div>
      </details>
    `
    : "";

  els.packetaDryRunResult.classList.remove("hidden");
  els.packetaDryRunResult.innerHTML = `
    <div class="section-head compact">
      <div>
        <p class="eyebrow">Zasilkovna / Packeta</p>
        <h2>Test API validace</h2>
      </div>
      <div class="dry-run-counts">
        <span>${escapeHtml(okCount)} OK</span>
        <span>${escapeHtml(errorCount)} chyb</span>
        <span>${escapeHtml(data.notValidatedCount || 0)} neověřeno</span>
      </div>
    </div>
    <div class="dry-run-note">
      Tohle volalo validacni funkci Packety. Stitky se nevytvorily, ale data byla odeslana do API kvuli kontrole chyb.
    </div>
    <div class="dry-run-list">
      ${resultCards || `<div class="empty">Není co validovat.</div>`}
      ${skippedHtml}
    </div>
  `;
}

async function runPacketaValidation() {
  if (!completionState.dataset?.id) {
    setCompletionMessage("Nejdřív načti kompletaci pro expediční den.", "warning");
    return;
  }

  if (
    !confirm(
      "Odeslat testovaci validaci do Zasilkovny/Packety?\n\nZasilky se nemaji vytvorit, ale realna data se poslou do API kvuli kontrole chyb."
    )
  ) {
    return;
  }

  els.packetaValidate.disabled = true;
  hidePacketaDryRunResult();
  setCompletionMessage("Posílám testovací validaci do Packety...", "neutral");

  try {
    const data = await fetchJson("/api/packeta/validate", {
      method: "POST",
      body: JSON.stringify({
        datasetId: completionState.dataset.id,
        limit: 30,
      }),
    });
    renderPacketaValidation(data);
    const errors = (data.results || []).filter((item) => !item.valid).length;
    setCompletionMessage(
      `Test API hotový: ${data.validatedCount || 0} ověřeno, ${errors} chyb, ${data.notValidatedCount || 0} neověřeno.`,
      errors ? "warning" : "success"
    );
  } catch (error) {
    setCompletionMessage(`Test API Zásilkovny se nepodařil: ${error.message}`, "error");
  } finally {
    els.packetaValidate.disabled = !completionState.dataset;
  }
}

function completionRowElement(rowId) {
  return Array.from(els.completionBody.querySelectorAll("tr")).find(
    (row) => row.dataset.completionRowId === String(rowId)
  );
}

function collectCompletionRowEdits(rowId) {
  const tr = completionRowElement(rowId);
  const values = {};
  if (!tr) return values;
  tr.querySelectorAll("[data-field]").forEach((input) => {
    values[input.dataset.field] = input.value.trim();
  });
  return values;
}

function replaceCompletionRow(row) {
  const index = completionState.rows.findIndex((item) => String(item.id) === String(row.id));
  if (index >= 0) completionState.rows[index] = row;
}

async function saveCompletionRow(rowId) {
  const values = collectCompletionRowEdits(rowId);
  setCompletionMessage("Ukládám upravený kontakt a adresu...", "neutral");

  try {
    const data = await fetchJson(`/api/completion/rows/${encodeURIComponent(rowId)}`, {
      method: "PATCH",
      body: JSON.stringify(values),
    });
    if (data.row) {
      replaceCompletionRow(data.row);
      renderCompletion();
    }
    setCompletionMessage("Kontakt a adresa jsou uložené.", "success");
  } catch (error) {
    setCompletionMessage(`Uložení adresy se nepodařilo: ${error.message}`, "error");
  }
}

function renderAddressValidation(rowId, data) {
  const tr = completionRowElement(rowId);
  const target = tr?.querySelector("[data-address-validation]");
  if (!target) return;

  const items = data.items || [];
  const first = items[0];
  if (!items.length) {
    target.innerHTML = `<span class="address-badge warning">Nenalezeno</span>`;
    return;
  }

  target.innerHTML = `
    <span class="address-badge ${data.valid ? "ok" : "warning"}">${data.valid ? "Overeno" : "Navrh"}</span>
    <small>${escapeHtml(first.name || "")}${first.location ? `, ${escapeHtml(first.location)}` : ""}${
    first.zip ? ` | PSC ${escapeHtml(first.zip)}` : ""
  }</small>
  `;
}

async function validateCompletionAddress(rowId) {
  const row = completionState.rows.find((item) => String(item.id) === String(rowId)) || {};
  const values = collectCompletionRowEdits(rowId);
  setCompletionMessage("Ověřuji adresu přes Mapy.com...", "neutral");

  try {
    const data = await fetchJson("/api/address/validate", {
      method: "POST",
      body: JSON.stringify({
        rowId,
        ...values,
        shopCode: row.shopCode || completionState.dataset?.shopCode || "",
      }),
    });
    row.addressValidationStatus = data.status || (data.valid ? "verified" : "suggestion");
    row.addressValidationMessage = data.message || "";
    row.addressValidationQuery = data.query || "";
    row.addressValidationCheckedAt = new Date().toISOString();
    row.addressValidationResult = data;
    renderAddressValidation(rowId, data);
    setCompletionMessage(data.valid ? "Adresa je ověřena přes Mapy.com." : "Mapy.com našly jen návrh adresy.", data.valid ? "success" : "warning");
  } catch (error) {
    const tr = completionRowElement(rowId);
    const target = tr?.querySelector("[data-address-validation]");
    if (target) target.innerHTML = `<span class="address-badge danger">Chyba</span><small>${escapeHtml(error.message)}</small>`;
    setCompletionMessage(`Ověření adresy se nepodařilo: ${error.message}`, "error");
  }
}

async function loadCompletionDataset(datasetId) {
  if (!datasetId) return;
  setCompletionMessage("Načítám vybranou kompletaci...", "neutral");
  try {
    const data = await fetchJson(`/api/datasets/${datasetId}`);
    applyCompletionDataset(data.dataset || null, data.rows || []);
  } catch (error) {
    setCompletionMessage(`Dávku se nepodařilo načíst: ${error.message}`, "error");
  }
}

function completionStatus(row) {
  const raw = [row.completionStatus, row.packetaStatus, row.labelPrinted, row.note]
    .filter(Boolean)
    .join(" ");
  const text = normalize(raw);
  if (text.includes("storno")) return { label: "STORNO", tone: "danger" };
  if (text.includes("error") || text.includes("chyba")) return { label: "CHYBA", tone: "danger" };
  if (text.includes("label printed") || text.includes("stit")) return { label: "STITek", tone: "ok" };
  if (normalize(row.paidStatus).includes("nezaplaceno")) return { label: "NEZAPLACENO", tone: "warning" };
  if (row.completionStatus) return { label: row.completionStatus, tone: "neutral" };
  return { label: "čeká", tone: "neutral" };
}

function renderCompletionSummary(rows) {
  const orders = new Set(rows.map((row) => row.orderNumber).filter(Boolean)).size;
  const pieces = rows.reduce((total, row) => total + Math.max(0, Math.trunc(toNumber(row.quantity, 0))), 0);
  const labels = rows.filter((row) => normalize(row.labelPrinted).includes("label printed")).length;
  const errors = rows.filter((row) => {
    const status = completionStatus(row);
    return status.tone === "danger";
  }).length;
  const shopCounts = rows.reduce((acc, row) => {
    const key = row.shopCode || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const shops = Object.entries(shopCounts)
    .map(([shop, count]) => `${shop}: ${count}`)
    .join(" | ");

  els.completionSummary.innerHTML = `
    <span><strong>${orders}</strong> objednavek</span>
    <span><strong>${rows.length}</strong> řádků</span>
    <span><strong>${pieces}</strong> kusu</span>
    <span><strong>${labels}</strong> stitku</span>
    <span><strong>${errors}</strong> chyb/storen</span>
    <span>${escapeHtml(shops || "bez e-shopu")}</span>
  `;
}

function completionInput(row, field, value, className = "") {
  return `<input class="table-input ${escapeHtml(className)}" data-row-id="${escapeHtml(row.id)}" data-field="${escapeHtml(
    field
  )}" value="${escapeHtml(value || "")}" />`;
}

function addressValidationHtml(row) {
  const status = row.addressValidationStatus || "";
  const message = row.addressValidationMessage || "";
  const checked = row.addressValidationCheckedAt ? formatTime(row.addressValidationCheckedAt) : "";
  const labels = {
    verified: ["Ověřeno", "ok"],
    suggestion: ["Návrh", "warning"],
    not_found: ["Nenalezeno", "danger"],
    error: ["Chyba", "danger"],
  };
  const [label, tone] = labels[status] || ["Neověřeno", "neutral"];
  return `
    <div class="address-validation" data-address-validation="${escapeHtml(row.id)}">
      <span class="address-badge ${escapeHtml(tone)}">${escapeHtml(label)}</span>
      ${message ? `<small>${escapeHtml(message)}${checked ? ` | ${escapeHtml(checked)}` : ""}</small>` : ""}
    </div>
  `;
}

function deliveryCarrierHtml(row) {
  const carrier = row.deliveryCarrier || "manual";
  const label = row.deliveryCarrierLabel || "Ruční kontrola";
  const service = row.deliveryServiceLabel || row.shippingMethod || "";
  return `
    <div class="delivery-cell">
      <span class="delivery-badge ${escapeHtml(carrier)}">${escapeHtml(label)}</span>
      <small>${escapeHtml(service)}</small>
    </div>
  `;
}

function renderCompletion() {
  const rows = completionState.rows;
  els.completionRowCount.textContent = `${rows.length} řádků`;
  renderCompletionSummary(rows);
  els.completionBody.innerHTML = "";
  els.completionDelete.disabled = !completionState.dataset || completionState.dataset.status !== "active";

  if (!rows.length) {
    els.completionBody.innerHTML = `<tr><td colspan="11" class="empty">Zadna kompletace k zobrazeni.</td></tr>`;
    return;
  }

  rows.forEach((row) => {
    const status = completionStatus(row);
    const customer = [row.firstName, row.lastName].filter(Boolean).join(" ");
    const address = [row.city, row.zipCode].filter(Boolean).join(" ");
    const tr = document.createElement("tr");
    tr.dataset.completionRowId = row.id;
    tr.innerHTML = `
      <td>
        <div class="completion-actions">
          <button type="button" data-action="save-completion-row" data-row-id="${escapeHtml(row.id)}">Uložit</button>
          <button type="button" class="secondary" data-action="validate-address" data-row-id="${escapeHtml(row.id)}">Ověřit</button>
        </div>
      </td>
      <td><span class="shop-chip">${escapeHtml(row.shopCode || completionState.dataset?.shopCode || "-")}</span></td>
      <td class="code">${escapeHtml(row.expeditionNumber || row.rowNumber || "")}</td>
      <td class="code">${escapeHtml(row.orderNumber || "")}</td>
      <td class="code">${escapeHtml(row.expeditionOrderCode || "")}</td>
      <td class="code">${escapeHtml(row.packetaId || "")}</td>
      <td>${escapeHtml(row.completionStatus || "")}</td>
      <td class="code">${escapeHtml(row.orderId || "")}</td>
      <td>${completionInput(row, "street", row.street || "")}</td>
      <td>${completionInput(row, "houseNumber", row.houseNumber || "")}</td>
      <td>${escapeHtml(row.dpdFlag || "")}</td>
      <td>${escapeHtml(row.packetaStatus || "")}</td>
      <td class="code">${escapeHtml(row.packetaShipmentId || "")}</td>
      <td class="code">${escapeHtml(row.orderDate || "")}</td>
      <td>
        <strong>${escapeHtml(customer || "-")}</strong>
        <small>${escapeHtml(address)}</small>
      </td>
      <td>${completionInput(row, "phone", row.phone || "", "phone-input")}</td>
      <td>${completionInput(row, "email", row.email || "", "email-input")}</td>
      <td>${completionInput(row, "streetWithNumber", row.streetWithNumber || [row.street, row.houseNumber].filter(Boolean).join(" "), "address-input")}</td>
      <td>${completionInput(row, "city", row.city || "")}</td>
      <td>${completionInput(row, "zipCode", row.zipCode || "", "zip-input")}</td>
      <td>${addressValidationHtml(row)}</td>
      <td>${deliveryCarrierHtml(row)}</td>
      <td>${escapeHtml(row.shippingMethod || "")}</td>
      <td>${escapeHtml(row.paymentMethod || row.paidStatus || "")}</td>
      <td>${escapeHtml(row.codAmount || "")}</td>
      <td><span class="qty">${escapeHtml(row.quantity || "")}</span></td>
      <td><span class="status-chip ${status.tone}">${escapeHtml(status.label)}</span></td>
      <td>${escapeHtml(row.labelPrinted || row.packetaShipmentId || "")}</td>
      <td class="completion-note">${escapeHtml(row.note || "")}</td>
    `;
    els.completionBody.appendChild(tr);
  });
}

function showScanResult(entry) {
  if (!entry) return;
  els.scanResult.classList.remove("hidden");
  els.scanResult.classList.remove("pulse");
  void els.scanResult.offsetWidth;
  els.scanResult.classList.add("pulse");
  els.scanSequence.textContent = entry.sequence || "-";
  els.scanCode.textContent = entry.variantCode || entry.productCode || "-";
  els.scanOrder.textContent = `Objednávka ${entry.orderNumber || "-"}`;
  els.scanRemaining.textContent = `Zbývá ${entry.remainingAfter} ks`;
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("cs-CZ", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function itemHaystack(item) {
  return normalize(
    [
      item.orderNumber,
      item.sequence,
      item.productCode,
      item.variantCode,
      eansForItem(item).map((entry) => entry.ean).join(" "),
      item.variant,
      item.info,
      item.paircode,
      item.brand,
      item.productName,
      item.externalId,
      item.image,
    ].join(" ")
  );
}

function eansForItem(item) {
  const matches = [];
  Object.entries(state.eanMap).forEach(([ean, entries]) => {
    entries.forEach((entry) => {
      const exact = sameCode(item.variantCode, entry.articleCode);
      const pair =
        sameCode(item.paircode, entry.prefix) ||
        sameCode(item.productCode, entry.prefix);
      if (!exact && !pair) return;

      matches.push({
        ean,
        exact,
        size: entry.size || "",
        color: entry.color || "",
      });
    });
  });

  const unique = new Map();
  matches
    .sort((a, b) => Number(b.exact) - Number(a.exact) || a.ean.localeCompare(b.ean))
    .forEach((match) => {
      const existing = unique.get(match.ean);
      if (!existing || match.exact) unique.set(match.ean, match);
    });

  return Array.from(unique.values());
}

function renderEans(item) {
  const matches = eansForItem(item);
  if (!matches.length) return `<span class="muted">bez EAN</span>`;

  const exact = matches.filter((match) => match.exact);
  const visible = (exact.length ? exact : matches).slice(0, 4);
  const more = matches.length - visible.length;

  return `
    <div class="ean-list">
      ${visible
        .map((match) => {
          const title = [match.color, match.size].filter(Boolean).join(" / ");
          return `<span class="ean-chip ${match.exact ? "exact" : ""}" title="${escapeHtml(title || "EAN")}">${escapeHtml(
            match.ean
          )}</span>`;
        })
        .join("")}
      ${more > 0 ? `<span class="ean-more">+${more}</span>` : ""}
    </div>
  `;
}

function visibleItems() {
  const query = normalize(els.manualSearch.value.trim());
  return state.items.filter((item) => {
    if (!state.settings.showZero && item.remaining <= 0) return false;
    if (!query) return true;
    return itemHaystack(item).includes(query);
  });
}

function activeDeductedAmount() {
  return state.history.reduce((total, entry) => {
    if (entry.type === "deduct" && !entry.undone) return total + entry.amount;
    if (entry.type === "restore") return total - entry.amount;
    return total;
  }, 0);
}

function renderMetrics() {
  const openPieces = state.items.reduce((total, item) => total + item.remaining, 0);
  const openRows = state.items.filter((item) => item.remaining > 0).length;
  const orders = new Set(state.items.map((item) => item.orderNumber).filter(Boolean)).size;
  els.metricOpen.textContent = openPieces;
  els.metricItems.textContent = openRows;
  els.metricOrders.textContent = orders;
  els.metricDone.textContent = Math.max(0, activeDeductedAmount());
}

function renderTable() {
  const rows = visibleItems();
  els.rowCount.textContent = `${rows.length} řádků`;
  els.sortingBody.innerHTML = "";

  if (!rows.length) {
    els.sortingBody.innerHTML = `<tr><td colspan="11" class="empty">Nic nenalezeno.</td></tr>`;
    return;
  }

  rows.forEach((item) => {
    const tr = document.createElement("tr");
    tr.dataset.id = item.id;
    tr.className = item.remaining <= 0 ? "done" : "";
    const imageCell =
      state.settings.showImages && item.image
        ? `<span class="image-chip" title="${escapeHtml(item.image)}">${escapeHtml(item.image)}</span>`
        : "";

    tr.innerHTML = `
      <td class="code">${escapeHtml(item.orderNumber)}</td>
      <td>${escapeHtml(item.sequence)}</td>
      <td>
        <div class="code">${escapeHtml(item.variantCode || item.productCode)}</div>
        <small>${escapeHtml(item.paircode)}</small>
      </td>
      <td>${renderEans(item)}</td>
      <td>${escapeHtml(item.variant)}</td>
      <td><span class="qty ${item.remaining <= 0 ? "zero" : ""}">${item.remaining}</span></td>
      <td>
        <div class="row-actions deduct-actions">
          <button type="button" data-action="deduct" data-id="${escapeHtml(item.id)}" ${item.remaining <= 0 ? "disabled" : ""}>-1</button>
        </div>
      </td>
      <td>${escapeHtml(item.brand)}</td>
      <td>${escapeHtml(item.productName || item.info)}</td>
      <td>${imageCell}</td>
      <td>
        <div class="row-actions restore-actions">
          <button type="button" class="undo" data-action="restore" data-id="${escapeHtml(item.id)}">+1</button>
        </div>
      </td>
    `;
    els.sortingBody.appendChild(tr);
  });
}

function renderHistory() {
  const entries = state.history.slice(0, 80);
  els.historyList.innerHTML = "";

  if (!entries.length) {
    els.historyList.innerHTML = `<div class="empty">Historie je zatím prázdná.</div>`;
    return;
  }

  entries.forEach((entry) => {
    const div = document.createElement("div");
    div.className = "history-item";
    const sign = entry.type === "deduct" ? "-" : "+";
    const canUndo = entry.type === "deduct" && !entry.undone;
    const undone = entry.undone ? " (vráceno)" : "";
    const source = entry.ean ? `EAN ${entry.ean}` : entry.mode || "ručně";
    div.innerHTML = `
      <div class="history-main">
        <strong>${escapeHtml(sign)}${entry.amount} ks${escapeHtml(undone)}</strong>
        <span class="history-code">${escapeHtml(entry.variantCode || entry.productCode)}</span>
        <span class="history-sequence">poř. ${escapeHtml(entry.sequence || "-")}</span>
      </div>
      <div class="history-meta">${escapeHtml(formatTime(entry.at))} | obj. ${escapeHtml(entry.orderNumber)} | zůstává ${escapeHtml(entry.remainingAfter)} | ${escapeHtml(source)}</div>
      <div class="history-name">${escapeHtml(entry.variant || entry.productName || "")}</div>
      ${
        canUndo
          ? `<div class="history-actions"><button type="button" data-action="undo-history" data-id="${escapeHtml(entry.id)}">Vrátit</button></div>`
          : ""
      }
    `;
    els.historyList.appendChild(div);
  });
}

function renderCandidates() {
  if (!activeCandidates.length) {
    els.candidatesPanel.classList.add("hidden");
    els.candidateList.innerHTML = "";
    return;
  }

  els.candidatesPanel.classList.remove("hidden");
  els.candidateList.innerHTML = "";
  activeCandidates.forEach((candidate) => {
    const item = candidate.item;
    const div = document.createElement("div");
    div.className = "candidate";
    div.innerHTML = `
      <strong>${escapeHtml(item.variantCode || item.productCode)}</strong>
      <div>${escapeHtml(item.productName || item.info)}</div>
      <small>Obj. ${escapeHtml(item.orderNumber)} | poř. ${escapeHtml(item.sequence)} | ${escapeHtml(item.variant)}</small>
      <div class="candidate-footer">
        <span class="qty">${item.remaining}</span>
        <button type="button" data-action="candidate-deduct" data-id="${escapeHtml(item.id)}">Odepsat 1</button>
      </div>
    `;
    els.candidateList.appendChild(div);
  });
}

function renderAll() {
  els.showZero.checked = state.settings.showZero;
  els.showImages.checked = state.settings.showImages;
  renderMetrics();
  renderTable();
  renderHistory();
  renderCandidates();
}

function historyEntry(item, amount, type, context = {}) {
  return {
    id: uid("hist"),
    at: new Date().toISOString(),
    type,
    amount,
    itemId: item.id,
    sourceRow: item.sourceRow,
    productCode: item.productCode,
    variantCode: item.variantCode,
    variant: item.variant,
    productName: item.productName,
    orderNumber: item.orderNumber,
    sequence: item.sequence,
    remainingAfter: item.remaining,
    ean: context.ean || "",
    mode: context.mode || "",
    undone: false,
  };
}

function changeItem(itemId, delta, context = {}) {
  const item = state.items.find((entry) => entry.id === itemId);
  if (!item) return null;

  if (delta < 0 && item.remaining <= 0) {
    setMessage("Tahle položka už má nulový zůstatek.", "warning");
    return null;
  }

  const amount = Math.abs(delta);
  if (delta < 0) {
    item.remaining = Math.max(0, item.remaining - amount);
  } else {
    item.remaining += amount;
  }

  const entry = historyEntry(item, amount, delta < 0 ? "deduct" : "restore", context);
  state.history.unshift(entry);
  state.history = state.history.slice(0, MAX_HISTORY);
  saveState();
  activeCandidates = activeCandidates.filter((candidate) => candidate.item.remaining > 0);
  renderAll();
  return entry;
}

function undoHistory(historyId) {
  const entry = state.history.find((item) => item.id === historyId);
  if (!entry || entry.type !== "deduct" || entry.undone) return;
  const item = state.items.find((candidate) => candidate.id === entry.itemId);
  if (!item) return;

  item.remaining += entry.amount;
  entry.undone = true;
  state.history.unshift(historyEntry(item, entry.amount, "restore", { mode: "vrácení odpisu" }));
  state.history = state.history.slice(0, MAX_HISTORY);
  saveState();
  renderAll();
  setMessage(`Vráceno ${entry.amount} ks pro ${entry.variantCode}.`, "success");
}

function findScanCandidates(ean) {
  const entries = state.eanMap[ean] || [];
  const candidates = new Map();

  entries.forEach((entry) => {
    state.items.forEach((item) => {
      if (item.remaining <= 0) return;
      const exact = sameCode(item.variantCode, entry.articleCode);
      const pair =
        sameCode(item.paircode, entry.prefix) ||
        sameCode(item.productCode, entry.prefix);
      if (!exact && !pair) return;

      const existing = candidates.get(item.id);
      const matchType = exact ? "přesná varianta" : "paircode";
      if (!existing || exact) {
        candidates.set(item.id, {
          item,
          entry,
          matchType,
        });
      }
    });
  });

  return {
    entries,
    candidates: Array.from(candidates.values()).sort((a, b) => {
      if (a.matchType !== b.matchType) return a.matchType === "přesná varianta" ? -1 : 1;
      return Number(a.item.sequence || 0) - Number(b.item.sequence || 0);
    }),
  };
}

function processScan(rawValue) {
  const ean = rawValue.replace(/\D/g, "");
  if (ean.length !== 13) return;

  els.eanInput.value = "";
  activeCandidates = [];
  const result = findScanCandidates(ean);

  if (!result.entries.length) {
    setMessage(`EAN ${ean} není v načtené EAN tabulce.`, "error");
    renderCandidates();
    return;
  }

  if (!result.candidates.length) {
    setMessage(`EAN ${ean} znám, ale u odpovídajícího zboží už není co odepsat.`, "warning");
    renderCandidates();
    return;
  }

  const exactCandidates = result.candidates.filter((candidate) => candidate.matchType === "přesná varianta");
  if (result.entries.length === 1 && exactCandidates.length === 1) {
    const entry = changeItem(exactCandidates[0].item.id, -1, {
      ean,
      mode: "EAN jednoznačná varianta",
    });
    if (entry) {
      showScanResult(entry);
      setMessage(
        `Odepsáno 1 ks: ${entry.variantCode}, obj. ${entry.orderNumber}, poř. ${entry.sequence}.`,
        "success"
      );
    }
    return;
  }

  activeCandidates = result.candidates;
  renderAll();
  setMessage(`EAN ${ean} má více možných shod. Vyber správnou položku.`, "warning");
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `rozrazovani-data-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed || !Array.isArray(parsed.items)) {
        throw new Error("Invalid data");
      }
      applyLoaded(parsed);
      activeCandidates = [];
      saveState();
      renderAll();
      setMessage("Import dat proběhl v pořádku.", "success");
    } catch {
      setMessage("Import se nepodařil. Soubor nemá očekávaný JSON formát.", "error");
    }
  };
  reader.readAsText(file);
}

function resetFromSeed() {
  if (!seed.items?.length) {
    setMessage("Seed z Excelu není k dispozici.", "error");
    return;
  }
  if (!confirm("Načíst znovu seed z Excelu? Aktuální lokální odpisy se přepíšou.")) return;
  applyLoaded(cloneSeed());
  activeCandidates = [];
  saveState();
  renderAll();
  setMessage(
    `Načteno ${state.items.length} řádků a ${Object.keys(state.eanMap).length} EAN kódů ze seedu.`,
    "success"
  );
}

els.eanInput.addEventListener("input", () => {
  const digits = els.eanInput.value.replace(/\D/g, "");
  if (digits !== els.eanInput.value) {
    els.eanInput.value = digits;
  }
  if (digits.length === 13) {
    processScan(digits);
  }
});

els.eanInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    processScan(els.eanInput.value);
  }
});

els.manualSearch.addEventListener("input", () => {
  activeCandidates = [];
  renderAll();
  if (normalize(els.manualSearch.value).includes("501")) {
    setMessage("Pozor na kód 501 - v původním procesu měl riziko záměny.", "warning");
  }
});

els.showZero.addEventListener("change", () => {
  state.settings.showZero = els.showZero.checked;
  saveState();
  renderAll();
});

els.showImages.addEventListener("change", () => {
  state.settings.showImages = els.showImages.checked;
  saveState();
  renderAll();
});

els.exportData.addEventListener("click", exportData);
els.resetSeed.addEventListener("click", resetFromSeed);
els.clearCandidates.addEventListener("click", () => {
  activeCandidates = [];
  renderAll();
});

els.importData.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (file) importData(file);
  event.target.value = "";
});

els.sortingBody.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const id = button.dataset.id;
  if (button.dataset.action === "deduct") {
    const entry = changeItem(id, -1, { mode: "ruční odpis" });
    if (entry) setMessage(`Odepsáno 1 ks: ${entry.variantCode}.`, "success");
  }
  if (button.dataset.action === "restore") {
    const entry = changeItem(id, 1, { mode: "ruční navrácení" });
    if (entry) setMessage(`Vráceno 1 ks: ${entry.variantCode}.`, "success");
  }
});

els.candidateList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action='candidate-deduct']");
  if (!button) return;
  const entry = changeItem(button.dataset.id, -1, { mode: "výběr z kandidátů" });
  if (entry) {
    showScanResult(entry);
    setMessage(`Odepsáno 1 ks: ${entry.variantCode}, poř. ${entry.sequence}.`, "success");
  }
});

els.historyList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action='undo-history']");
  if (!button) return;
  undoHistory(button.dataset.id);
});

els.expeditionRefresh.addEventListener("click", () => loadExpeditionDays(expeditionState.day?.date || ""));
els.expeditionShowInactive.addEventListener("change", () => loadExpeditionDays(expeditionState.day?.date || ""));
els.expeditionDayList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-date]");
  if (!button) return;
  loadExpeditionDay(button.dataset.date);
});

els.tabSorting.addEventListener("click", () => switchView("sorting"));
els.tabCompletion.addEventListener("click", () => switchView("completion"));
els.sortingRefresh.addEventListener("click", () => {
  loadSortingDataset(els.sortingDataset.value);
});
els.sortingDataset.addEventListener("change", () => {
  loadSortingDataset(els.sortingDataset.value);
});
els.sortingDelete.addEventListener("click", async () => {
  try {
    const deleted = await deleteDataset(sortingState.dataset, () =>
      loadExpeditionDays(expeditionState.day?.date || "")
    );
    if (deleted) setMessage("Dávka roztřídění byla smazaná.", "success");
  } catch (error) {
    setMessage(`Dávku roztřídění se nepodařilo smazat: ${error.message}`, "error");
  }
});
els.completionRefresh.addEventListener("click", () => loadCompletionDatasets());
els.completionDataset.addEventListener("change", () => {
  loadCompletionDataset(els.completionDataset.value);
});
els.completionDelete.addEventListener("click", async () => {
  try {
    const deleted = await deleteDataset(completionState.dataset, () =>
      loadExpeditionDays(expeditionState.day?.date || "")
    );
    if (deleted) setCompletionMessage("Dávka kompletace byla smazaná.", "success");
  } catch (error) {
    setCompletionMessage(`Dávku kompletace se nepodařilo smazat: ${error.message}`, "error");
  }
});

els.completionBody.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  if (button.dataset.action === "save-completion-row") {
    saveCompletionRow(button.dataset.rowId);
  }
  if (button.dataset.action === "validate-address") {
    validateCompletionAddress(button.dataset.rowId);
  }
});
els.completionBody.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  if (button.dataset.action === "save-completion-row") {
    saveCompletionRow(button.dataset.rowId);
  }
  if (button.dataset.action === "validate-address") {
    validateCompletionAddress(button.dataset.rowId);
  }
});
els.packetaDryRun.addEventListener("click", runPacketaDryRun);
els.packetaValidate.addEventListener("click", runPacketaValidation);

loadState();
renderAll();
renderSortingOptions();
renderCompletion();
setMessage(
  `Načteno ${state.items.length} řádků, ${Object.keys(state.eanMap).length} EAN kódů, objednávek: ${
    new Set(state.items.map((item) => item.orderNumber).filter(Boolean)).size
  }.`,
  "neutral"
);
requestAnimationFrame(() => els.eanInput.focus());
loadExpeditionDays();
