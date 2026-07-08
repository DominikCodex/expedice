const STORAGE_KEY = "rozrazovani-zbozi-v2";
const MAX_HISTORY = 500;
const EAN_AUDIT_RENDER_LIMIT = 500;
const EMPLOYEE_DAY_LOCK_KEY = "expedition-employee-day-lock-v1";
const EMPLOYEE_DAY_LOCK_MS = 10 * 60 * 60 * 1000;
const GLOBAL_PROGRESS_DELAY_MS = 300;

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
const pendingAdjustments = new Set();
const zeroRowsKeptUntilRefresh = new Set();
let scanInProgress = false;

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
  paymentUpdatesSince: null,
  paymentPollInFlight: false,
};

const completionFilters = {
  search: "",
  flow: "",
  carrier: "",
  status: "",
  shop: "",
};

const eanFilters = {
  search: "",
  risk: "ambiguous",
  match: "",
  shop: "",
  sort: "risk",
};

const expandedCompletionRows = new Set();

const completionWorkflowState = {
  row: null,
  index: -1,
  checkedItemKeys: new Set(),
  sortingRefreshTimer: null,
  sortingRefreshRowId: null,
  sortingRefreshInFlight: false,
  expeditionNumberInputTimer: null,
};
const workflowAutoPrintedRows = new Set();

const settingsState = {
  loaded: false,
  settings: null,
};

const productImageState = {
  images: {},
  requested: new Set(),
  pending: new Set(),
  loading: false,
  error: "",
  configured: true,
};

const authState = {
  user: null,
  appStarted: false,
};

const globalProgressState = {
  nextId: 1,
  active: new Map(),
};

const VIEW_ROUTES = {
  sorting: "/roztrideni",
  completion: "/kompletace",
  eans: "/eany",
  settings: "/nastaveni",
};

const ROUTE_VIEWS = {
  "/": "sorting",
  "/roztrideni": "sorting",
  "/kompletace": "completion",
  "/eany": "eans",
  "/nastaveni": "settings",
};

const SHOP_ADMIN_DOMAINS = {
  iveronika_cz: "www.iveronika.cz",
  iveronika_sk: "www.iveronika.sk",
  galantra_cz: "www.galantra.cz",
  fidule_cz: "www.fidule.cz",
};

const UI_FONT_OPTIONS = {
  system: {
    label: "Systémový",
    stack: '"Segoe UI", "Trebuchet MS", Arial, sans-serif',
  },
  segoe: {
    label: "Segoe UI",
    stack: '"Segoe UI", Arial, sans-serif',
  },
  aptos: {
    label: "Aptos",
    stack: 'Aptos, "Segoe UI", Arial, sans-serif',
  },
  inter: {
    label: "Inter / moderní",
    stack: 'Inter, "Segoe UI", Arial, sans-serif',
  },
  arial: {
    label: "Arial",
    stack: 'Arial, "Helvetica Neue", sans-serif',
  },
  verdana: {
    label: "Verdana",
    stack: 'Verdana, "Segoe UI", sans-serif',
  },
  tahoma: {
    label: "Tahoma",
    stack: 'Tahoma, "Segoe UI", sans-serif',
  },
  roboto: {
    label: "Roboto",
    stack: 'Roboto, "Segoe UI", Arial, sans-serif',
  },
  lexend: {
    label: "Lexend",
    stack: 'Lexend, "Segoe UI", Arial, sans-serif',
  },
  georgia: {
    label: "Georgia",
    stack: 'Georgia, "Times New Roman", serif',
  },
};

const COMPLETION_DENSITY_OPTIONS = {
  auto: "Automaticky",
  comfortable: "Pohodlné",
  warehouse: "Skladové",
  ultra: "Ultra kompaktní",
};

const usersState = {
  users: [],
  loaded: false,
};

const employeeDayLockState = {
  choosing: false,
};

const els = {
  globalProgress: document.getElementById("global-progress"),
  globalProgressLabel: document.getElementById("global-progress-label"),
  globalProgressDetail: document.getElementById("global-progress-detail"),
  appShell: document.getElementById("app-shell"),
  authView: document.getElementById("auth-view"),
  loginForm: document.getElementById("login-form"),
  loginUsername: document.getElementById("login-username"),
  loginPassword: document.getElementById("login-password"),
  passwordChangeForm: document.getElementById("password-change-form"),
  changeCurrentPassword: document.getElementById("change-current-password"),
  changeNewPassword: document.getElementById("change-new-password"),
  authMessage: document.getElementById("auth-message"),
  authUserName: document.getElementById("auth-user-name"),
  authLogout: document.getElementById("auth-logout"),
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
  expeditionDeleteDay: document.getElementById("expedition-delete-day"),
  expeditionDayLock: document.getElementById("expedition-day-lock"),
  expeditionDayLockChange: document.getElementById("expedition-day-lock-change"),
  expeditionTrashToggle: document.getElementById("expedition-trash-toggle"),
  expeditionShowInactive: document.getElementById("show-inactive-datasets"),
  expeditionDaySummary: document.getElementById("expedition-day-summary"),
  expeditionBatchReport: document.getElementById("expedition-batch-report"),
  tabSorting: document.getElementById("tab-sorting"),
  tabCompletion: document.getElementById("tab-completion"),
  tabEans: document.getElementById("tab-eans"),
  tabSettings: document.getElementById("tab-settings"),
  dayRequiredView: document.getElementById("day-required-view"),
  sortingView: document.getElementById("sorting-view"),
  sortingDataset: document.getElementById("sorting-dataset"),
  sortingRefresh: document.getElementById("sorting-refresh"),
  sortingDatasetInfo: document.getElementById("sorting-dataset-info"),
  completionView: document.getElementById("completion-view"),
  completionDataset: document.getElementById("completion-dataset"),
  completionRefresh: document.getElementById("completion-refresh"),
  paymentFeedSync: document.getElementById("payment-feed-sync"),
  packetaDryRun: document.getElementById("packeta-dry-run"),
  packetaValidate: document.getElementById("packeta-validate"),
  packetaSend: document.getElementById("packeta-send"),
  labelCacheBatch: document.getElementById("label-cache-batch"),
  dpdDryRun: document.getElementById("dpd-dry-run"),
  dpdSend: document.getElementById("dpd-send"),
  completionValidateAddresses: document.getElementById("completion-validate-addresses"),
  packetaDryRunResult: document.getElementById("packeta-dry-run-result"),
  completionMessage: document.getElementById("completion-message"),
  completionSummary: document.getElementById("completion-summary"),
  completionBody: document.getElementById("completion-body"),
  completionRowCount: document.getElementById("completion-row-count"),
  completionFilterSearch: document.getElementById("completion-filter-search"),
  completionFilterFlow: document.getElementById("completion-filter-flow"),
  completionFilterCarrier: document.getElementById("completion-filter-carrier"),
  completionFilterStatus: document.getElementById("completion-filter-status"),
  completionFilterShop: document.getElementById("completion-filter-shop"),
  completionFilterReset: document.getElementById("completion-filter-reset"),
  addressValidationLog: document.getElementById("address-validation-log"),
  addressValidationLogRefresh: document.getElementById("address-validation-log-refresh"),
  workflowBoxCode: document.getElementById("completion-box-code"),
  workflowExpeditionNumber: document.getElementById("workflow-expedition-number"),
  workflowPrev: document.getElementById("workflow-prev"),
  workflowNext: document.getElementById("workflow-next"),
  workflowSaveOk: document.getElementById("workflow-save-ok"),
  workflowCustomerName: document.getElementById("workflow-customer-name"),
  workflowStreet: document.getElementById("workflow-street"),
  workflowCity: document.getElementById("workflow-city"),
  workflowOrderNumber: document.getElementById("workflow-order-number"),
  workflowShipping: document.getElementById("workflow-shipping"),
  workflowPieces: document.getElementById("workflow-pieces"),
  workflowCod: document.getElementById("workflow-cod"),
  workflowCountry: document.getElementById("workflow-country"),
  workflowStatus: document.getElementById("workflow-status"),
  workflowItems: document.getElementById("workflow-items"),
  workflowWarning: document.getElementById("workflow-warning"),
  workflowNote: document.getElementById("workflow-note"),
  workflowUnpaid: document.getElementById("workflow-unpaid"),
  workflowError: document.getElementById("workflow-error"),
  workflowUnpaidError: document.getElementById("workflow-unpaid-error"),
  workflowOpenOrder: document.getElementById("workflow-open-order"),
  workflowClearError: document.getElementById("workflow-clear-error"),
  workflowManualReprint: document.getElementById("workflow-manual-reprint"),
  workflowMessage: document.getElementById("workflow-message"),
  eansView: document.getElementById("eans-view"),
  eansSummary: document.getElementById("eans-summary"),
  eansFilterSearch: document.getElementById("eans-filter-search"),
  eansFilterRisk: document.getElementById("eans-filter-risk"),
  eansFilterMatch: document.getElementById("eans-filter-match"),
  eansFilterShop: document.getElementById("eans-filter-shop"),
  eansFilterSort: document.getElementById("eans-filter-sort"),
  eansFilterReset: document.getElementById("eans-filter-reset"),
  eansRowCount: document.getElementById("eans-row-count"),
  eansBody: document.getElementById("eans-body"),
  eansMapRowCount: document.getElementById("eans-map-row-count"),
  eansMapBody: document.getElementById("eans-map-body"),
  settingsView: document.getElementById("settings-view"),
  settingsSave: document.getElementById("settings-save"),
  settingsMessage: document.getElementById("settings-message"),
  settingsUiFont: document.getElementById("settings-ui-font"),
  settingsCompletionDensity: document.getElementById("settings-completion-density"),
  settingsUiFontPreview: document.getElementById("settings-ui-font-preview"),
  settingsStatusFont: document.getElementById("settings-status-font"),
  settingsStatusProductFeed: document.getElementById("settings-status-product-feed"),
  settingsStatusPayments: document.getElementById("settings-status-payments"),
  settingsStatusCarriers: document.getElementById("settings-status-carriers"),
  settingsStatusPrint: document.getElementById("settings-status-print"),
  settingsMapyKey: document.getElementById("settings-mapy-key"),
  settingsMapyStatus: document.getElementById("settings-mapy-status"),
  settingsProductFeedUrl: document.getElementById("settings-product-feed-url"),
  settingsProductFeedTimeout: document.getElementById("settings-product-feed-timeout"),
  settingsProductFeedMaxMb: document.getElementById("settings-product-feed-max-mb"),
  settingsProductFeedStatus: document.getElementById("settings-product-feed-status"),
  productFeedTest: document.getElementById("product-feed-test"),
  settingsPaymentLookback: document.getElementById("settings-payment-lookback"),
  settingsPaymentStatus: document.getElementById("settings-payment-status"),
  settingsPaymentIveronikaUrl: document.getElementById("settings-payment-iveronika-url"),
  settingsPaymentIveronikaStatus: document.getElementById("settings-payment-iveronika-status"),
  settingsPaymentIveronikaSkUrl: document.getElementById("settings-payment-iveronika-sk-url"),
  settingsPaymentIveronikaSkStatus: document.getElementById("settings-payment-iveronika-sk-status"),
  settingsPaymentGalantraUrl: document.getElementById("settings-payment-galantra-url"),
  settingsPaymentGalantraStatus: document.getElementById("settings-payment-galantra-status"),
  settingsPacketaUrl: document.getElementById("settings-packeta-url"),
  settingsPacketaPassword: document.getElementById("settings-packeta-password"),
  settingsPacketaStatus: document.getElementById("settings-packeta-status"),
  settingsPacketaIveronikaPassword: document.getElementById("settings-packeta-iveronika-password"),
  settingsPacketaIveronikaStatus: document.getElementById("settings-packeta-iveronika-status"),
  settingsPacketaGalantraPassword: document.getElementById("settings-packeta-galantra-password"),
  settingsPacketaGalantraStatus: document.getElementById("settings-packeta-galantra-status"),
  settingsDpdUrl: document.getElementById("settings-dpd-url"),
  settingsDpdKey: document.getElementById("settings-dpd-key"),
  settingsDpdCustomerDsw: document.getElementById("settings-dpd-customer-dsw"),
  settingsDpdCustomerId: document.getElementById("settings-dpd-customer-id"),
  settingsDpdIveronikaKey: document.getElementById("settings-dpd-iveronika-key"),
  settingsDpdIveronikaStatus: document.getElementById("settings-dpd-iveronika-status"),
  settingsDpdIveronikaCustomerDsw: document.getElementById("settings-dpd-iveronika-customer-dsw"),
  settingsDpdIveronikaCustomerId: document.getElementById("settings-dpd-iveronika-customer-id"),
  settingsDpdGalantraKey: document.getElementById("settings-dpd-galantra-key"),
  settingsDpdGalantraStatus: document.getElementById("settings-dpd-galantra-status"),
  settingsDpdGalantraCustomerDsw: document.getElementById("settings-dpd-galantra-customer-dsw"),
  settingsDpdGalantraCustomerId: document.getElementById("settings-dpd-galantra-customer-id"),
  settingsDpdShipmentType: document.getElementById("settings-dpd-shipment-type"),
  settingsDpdMode: document.getElementById("settings-dpd-mode"),
  settingsDpdEnabled: document.getElementById("settings-dpd-enabled"),
  settingsDpdNotification: document.getElementById("settings-dpd-notification"),
  settingsDpdStatus: document.getElementById("settings-dpd-status"),
  settingsSenderName: document.getElementById("settings-sender-name"),
  settingsSenderStreet: document.getElementById("settings-sender-street"),
  settingsSenderHouse: document.getElementById("settings-sender-house"),
  settingsSenderCity: document.getElementById("settings-sender-city"),
  settingsSenderZip: document.getElementById("settings-sender-zip"),
  settingsSenderCountry: document.getElementById("settings-sender-country"),
  settingsSenderContact: document.getElementById("settings-sender-contact"),
  settingsSenderPhone: document.getElementById("settings-sender-phone"),
  settingsSenderEmail: document.getElementById("settings-sender-email"),
  settingsPrintTestingMode: document.getElementById("settings-print-testing-mode"),
  printAgentTest: document.getElementById("print-agent-test"),
  printAgentStatus: document.getElementById("print-agent-status"),
  usersPanel: document.getElementById("users-admin-panel"),
  usersRefresh: document.getElementById("users-refresh"),
  usersList: document.getElementById("users-list"),
  userCreateUsername: document.getElementById("user-create-username"),
  userCreateDisplay: document.getElementById("user-create-display"),
  userCreatePassword: document.getElementById("user-create-password"),
  userCreateRole: document.getElementById("user-create-role"),
  userCreateSubmit: document.getElementById("user-create-submit"),
};

function uiFontKey(value) {
  return UI_FONT_OPTIONS[value] ? value : "system";
}

function completionDensityKey(value) {
  return COMPLETION_DENSITY_OPTIONS[value] ? value : "auto";
}

function applyAppearanceSettings(settings = {}) {
  const appearance = settings.appearance || {};
  const fontKey = uiFontKey(appearance.font);
  const densityKey = completionDensityKey(appearance.completionDensity);
  const font = UI_FONT_OPTIONS[fontKey];
  document.documentElement.style.setProperty("--app-font-family", font.stack);
  document.documentElement.dataset.uiFont = fontKey;
  document.documentElement.dataset.completionDensity = densityKey;
  if (els.settingsUiFont) {
    els.settingsUiFont.value = fontKey;
  }
  if (els.settingsCompletionDensity) {
    els.settingsCompletionDensity.value = densityKey;
  }
  if (els.settingsUiFontPreview) {
    els.settingsUiFontPreview.style.fontFamily = font.stack;
    els.settingsUiFontPreview.textContent =
      `${font.label} / ${COMPLETION_DENSITY_OPTIONS[densityKey]}: Přehledné roztřídění 03019-MBH-LXL-UPE`;
  }
}

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

function productCodeKey(value) {
  return String(value ?? "").trim().toUpperCase();
}

function addProductImageCode(target, value) {
  const key = productCodeKey(value);
  if (key) target.add(key);
}

function resetProductImages() {
  productImageState.images = {};
  productImageState.requested = new Set();
  productImageState.pending = new Set();
  productImageState.loading = false;
  productImageState.error = "";
  productImageState.configured = true;
}

function productImageForCode(code) {
  return productImageState.images[productCodeKey(code)] || "";
}

function productImageForItem(item) {
  return (
    item?.image ||
    productImageForCode(item?.variantCode) ||
    productImageForCode(item?.productCode) ||
    productImageForCode(item?.code) ||
    ""
  );
}

function productImageHtml(item, className = "") {
  const image = productImageForItem(item);
  if (!state.settings.showImages || !image) return "";
  const label = item?.productName || item?.variantCode || item?.productCode || "Produkt";
  return `
    <span class="product-image-frame ${escapeHtml(className)}" title="${escapeHtml(label)}">
      <img src="${escapeHtml(image)}" alt="${escapeHtml(label)}" loading="lazy" decoding="async" />
    </span>
  `;
}

function collectProductImageCodesFromItems(items) {
  const codes = new Set();
  (items || []).forEach((item) => {
    addProductImageCode(codes, item?.variantCode);
    addProductImageCode(codes, item?.productCode);
    addProductImageCode(codes, item?.code);
  });
  return codes;
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
    datasetRowId: item.datasetRowId || item.rowId || "",
    shopCode: item.shopCode || "",
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
  zeroRowsKeptUntilRefresh.clear();
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

function setWorkflowMessage(text, type = "neutral") {
  els.workflowMessage.className = `message ${type}`;
  els.workflowMessage.textContent = text;
}

function setSettingsMessage(text, type = "neutral") {
  els.settingsMessage.className = `message ${type}`;
  els.settingsMessage.textContent = text;
}

function progressLabelForRequest(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const text = String(path || "");
  if (text.includes("/api/expedition-days")) return "Načítám expediční dny...";
  if (text.includes("/api/datasets")) return "Načítám dávku...";
  if (text.includes("/api/settings")) return method === "GET" ? "Načítám nastavení..." : "Ukládám nastavení...";
  if (text.includes("/api/product-feed/check")) return "Ověřuji produktový feed...";
  if (text.includes("/api/product-images")) return "Načítám obrázky produktů...";
  if (text.includes("/api/payment-feeds/sync")) return "Páruji platby...";
  if (text.includes("/api/address/validate")) return "Ověřuji adresu...";
  if (text.includes("/api/packeta")) return "Komunikuji se Zásilkovnou...";
  if (text.includes("/api/dpd")) return "Komunikuji s DPD...";
  if (text.includes("/api/labels")) return "Připravuji štítky...";
  if (text.includes("/api/users")) return "Načítám uživatele...";
  if (method !== "GET") return "Zpracovávám požadavek...";
  return "Načítám data...";
}

function renderGlobalProgress() {
  if (!els.globalProgress) return;
  const visible = Array.from(globalProgressState.active.values()).filter((entry) => entry.visible);
  els.globalProgress.classList.toggle("hidden", !visible.length);
  if (!visible.length) return;

  const latest = visible[visible.length - 1];
  els.globalProgressLabel.textContent = latest.label || "Načítám data...";
  els.globalProgressDetail.textContent = visible.length > 1 ? `Běží ${visible.length} požadavky.` : "Chvilku strpení.";
}

function beginGlobalProgress(label) {
  const id = globalProgressState.nextId++;
  const entry = {
    id,
    label,
    visible: false,
    timer: window.setTimeout(() => {
      const current = globalProgressState.active.get(id);
      if (!current) return;
      current.visible = true;
      renderGlobalProgress();
    }, GLOBAL_PROGRESS_DELAY_MS),
  };
  globalProgressState.active.set(id, entry);
  return id;
}

function endGlobalProgress(id) {
  if (!id) return;
  const entry = globalProgressState.active.get(id);
  if (!entry) return;
  window.clearTimeout(entry.timer);
  globalProgressState.active.delete(id);
  renderGlobalProgress();
}

async function fetchJson(path, options = {}) {
  const { progress = true, progressLabel = "", headers: customHeaders, ...fetchOptions } = options;
  const headers = fetchOptions.body
    ? { "Content-Type": "application/json", ...(customHeaders || {}) }
    : customHeaders || {};
  const progressId = progress ? beginGlobalProgress(progressLabel || progressLabelForRequest(path, fetchOptions)) : null;
  try {
    const response = await fetch(path, { cache: "no-store", ...fetchOptions, headers });
    if (!response.ok) {
      let message = `API vrátilo chybu ${response.status}`;
      let errorData = null;
      try {
        const data = await response.json();
        errorData = data;
        message = data.error || message;
      } catch {
        // Keep fallback message.
      }
      if (response.status === 401) {
        showLogin("Přihlášení vypršelo nebo je potřeba se znovu přihlásit.");
      }
      const error = new Error(message);
      error.status = response.status;
      error.data = errorData;
      throw error;
    }
    return response.json();
  } finally {
    endGlobalProgress(progressId);
  }
}

function collectCompletionProductImageCodes(rows) {
  const codes = new Set();
  (rows || []).forEach((row) => {
    collectProductImageCodesFromItems(workflowSortingItems(row)).forEach((code) => codes.add(code));
    collectProductImageCodesFromItems(completionStructuredProductItems(row)).forEach((code) => codes.add(code));
    collectProductImageCodesFromItems(completionTextProductItems(row)).forEach((code) => codes.add(code));
  });
  return codes;
}

function collectCurrentProductImageCodes() {
  const codes = collectProductImageCodesFromItems(state.items || []);
  collectCompletionProductImageCodes(completionState.rows || []).forEach((code) => codes.add(code));
  if (completionWorkflowState.row) {
    collectProductImageCodesFromItems(workflowPhysicalItems(completionWorkflowState.row)).forEach((code) => codes.add(code));
  }
  return codes;
}

async function ensureProductImagesForCodes(codes, options = {}) {
  const requestedCodes = Array.from(codes || [])
    .map(productCodeKey)
    .filter(Boolean)
    .filter((code) => !productImageState.images[code] && !productImageState.requested.has(code));
  if (!requestedCodes.length) return;

  if (productImageState.loading) {
    requestedCodes.forEach((code) => productImageState.pending.add(code));
    return;
  }

  productImageState.loading = true;
  requestedCodes.forEach((code) => productImageState.requested.add(code));
  try {
    const data = await fetchJson("/api/product-images", {
      method: "POST",
      body: JSON.stringify({ codes: requestedCodes }),
    });
    productImageState.configured = data.configured !== false;
    productImageState.error = data.ok === false ? data.error || "Produktový feed se nepodařilo načíst." : "";
    if (data.ok === false) {
      requestedCodes.forEach((code) => productImageState.requested.delete(code));
    } else {
      Object.entries(data.images || {}).forEach(([code, image]) => {
        if (image) productImageState.images[productCodeKey(code)] = image;
      });
    }
  } catch (error) {
    productImageState.error = error.message;
    requestedCodes.forEach((code) => productImageState.requested.delete(code));
    console.warn("Produktové obrázky se nepodařilo načíst.", error);
  } finally {
    productImageState.loading = false;
  }

  if (options.render !== false) {
    renderAll();
    renderCompletion();
    renderWorkflow();
  }

  if (productImageState.pending.size) {
    const pending = new Set(productImageState.pending);
    productImageState.pending.clear();
    ensureProductImagesForCodes(pending, options);
  }
}

function ensureProductImagesForCurrentData(options = {}) {
  return ensureProductImagesForCodes(collectCurrentProductImageCodes(), options);
}

function isAdmin() {
  return authState.user?.role === "admin";
}

function employeeDayLockStorageKey() {
  const userKey = authState.user?.id || authState.user?.username || "anonymous";
  return `${EMPLOYEE_DAY_LOCK_KEY}:${userKey}`;
}

function removeEmployeeDayLock() {
  try {
    localStorage.removeItem(employeeDayLockStorageKey());
  } catch {
    // Local storage can be unavailable in strict browser modes.
  }
}

function readEmployeeDayLock() {
  if (!authState.user || isAdmin()) return null;
  try {
    const raw = localStorage.getItem(employeeDayLockStorageKey());
    if (!raw) return null;
    const lock = JSON.parse(raw);
    if (!lock?.date || !lock?.expiresAt || Number(lock.expiresAt) <= Date.now()) {
      removeEmployeeDayLock();
      return null;
    }
    return {
      date: String(lock.date),
      expiresAt: Number(lock.expiresAt),
    };
  } catch {
    removeEmployeeDayLock();
    return null;
  }
}

function saveEmployeeDayLock(dayDate) {
  if (!authState.user || isAdmin() || !dayDate) return;
  const lock = {
    date: dayDate,
    expiresAt: Date.now() + EMPLOYEE_DAY_LOCK_MS,
  };
  try {
    localStorage.setItem(employeeDayLockStorageKey(), JSON.stringify(lock));
  } catch {
    // If localStorage is blocked, the app still works without the guard.
  }
  employeeDayLockState.choosing = false;
}

function renderEmployeeDayLockPanel(lock = readEmployeeDayLock()) {
  if (!els.expeditionDayLock) return;
  const show = !isAdmin() && Boolean(lock) && !employeeDayLockState.choosing;
  els.expeditionDayLock.classList.toggle("hidden", !show);
}

function employeeVisibleDays() {
  const lock = readEmployeeDayLock();
  if (isAdmin() || employeeDayLockState.choosing || !lock) {
    return { days: expeditionState.days, lock: null };
  }
  const lockedDays = expeditionState.days.filter((day) => day.date === lock.date);
  if (!lockedDays.length) {
    removeEmployeeDayLock();
    employeeDayLockState.choosing = true;
    return { days: expeditionState.days, lock: null };
  }
  return { days: lockedDays, lock };
}

function preferredEmployeeLockedDate() {
  if (employeeDayLockState.choosing) return "";
  const lock = readEmployeeDayLock();
  if (!lock) return "";
  return expeditionState.days.some((day) => day.date === lock.date) ? lock.date : "";
}

function setAuthMessage(text, type = "neutral") {
  els.authMessage.className = `message ${type}`;
  els.authMessage.textContent = text;
}

function setLoginBusy(isBusy) {
  const button = els.loginForm.querySelector("button[type='submit']");
  if (!button) return;
  button.disabled = isBusy;
  button.textContent = isBusy ? "Přihlašuji..." : "Přihlásit";
}

function setPasswordChangeBusy(isBusy) {
  const button = els.passwordChangeForm.querySelector("button[type='submit']");
  if (!button) return;
  button.disabled = isBusy;
  button.textContent = isBusy ? "Ukládám..." : "Uložit nové heslo";
}

function showLogin(message = "Přihlas se prosím do expedičního systému.") {
  authState.user = null;
  employeeDayLockState.choosing = false;
  setLoginBusy(false);
  setPasswordChangeBusy(false);
  els.appShell.classList.add("hidden");
  els.authView.classList.remove("hidden");
  els.loginForm.classList.remove("hidden");
  els.passwordChangeForm.classList.add("hidden");
  setAuthMessage(message, "neutral");
  requestAnimationFrame(() => els.loginUsername.focus());
}

function showPasswordChange(user) {
  authState.user = user;
  setLoginBusy(false);
  setPasswordChangeBusy(false);
  els.appShell.classList.add("hidden");
  els.authView.classList.remove("hidden");
  els.loginForm.classList.add("hidden");
  els.passwordChangeForm.classList.remove("hidden");
  setAuthMessage("Nastav prosím nové heslo.", "neutral");
  requestAnimationFrame(() => els.changeCurrentPassword.focus());
}

function applyRoleVisibility() {
  const admin = isAdmin();
  els.tabEans?.classList.toggle("hidden", !admin);
  els.tabSettings.classList.toggle("hidden", !admin);
  els.expeditionDeleteDay?.classList.toggle("hidden", !admin);
  els.expeditionTrashToggle?.classList.toggle("hidden", !admin);
  if (admin) {
    els.expeditionDayLock?.classList.add("hidden");
  }
  if (!admin && els.expeditionShowInactive?.checked) {
    els.expeditionShowInactive.checked = false;
    expeditionState.showInactive = false;
  }
  els.packetaValidate.classList.toggle("hidden", !admin);
  els.packetaSend?.classList.toggle("hidden", !admin);
  els.labelCacheBatch?.classList.toggle("hidden", !admin);
  els.dpdSend.classList.toggle("hidden", !admin);
  if (!admin && (!els.settingsView.classList.contains("hidden") || (els.eansView && !els.eansView.classList.contains("hidden")))) {
    switchView("sorting");
  }
}

function normalizedRoutePath(path = window.location.pathname) {
  return (path.replace(/\/+$/, "") || "/").toLowerCase();
}

function viewFromRoute() {
  return ROUTE_VIEWS[normalizedRoutePath()] || "sorting";
}

function routeForView(view) {
  return VIEW_ROUTES[view] || VIEW_ROUTES.sorting;
}

function setRouteForView(view, replace = false) {
  const targetPath = routeForView(view);
  if (normalizedRoutePath() === targetPath) return;
  const method = replace ? "replaceState" : "pushState";
  window.history[method]({ view }, "", targetPath);
}

function startAppForUser(user) {
  authState.user = user;
  employeeDayLockState.choosing = false;
  els.authView.classList.add("hidden");
  els.appShell.classList.remove("hidden");
  els.authUserName.textContent = `${user.displayName || user.username} · ${user.role === "admin" ? "admin" : "uživatel"}`;
  applyRoleVisibility();
  if (!settingsState.loaded) {
    loadSettings({ silent: true });
  } else if (settingsState.settings) {
    applyAppearanceSettings(settingsState.settings);
  }

  if (!authState.appStarted) {
    loadState();
    renderAll();
    renderSortingOptions();
    renderCompletion();
    renderWorkflow();
    setMessage(
      `Načteno ${state.items.length} řádků, ${Object.keys(state.eanMap).length} EAN kódů, objednávek: ${
        new Set(state.items.map((item) => item.orderNumber).filter(Boolean)).size
      }.`,
      "neutral"
    );
    authState.appStarted = true;
  }

  switchView(viewFromRoute(), { replaceRoute: true });
  requestAnimationFrame(() => loadExpeditionDays());
}

async function checkAuth() {
  try {
    const response = await fetch("/api/auth/me", { cache: "no-store" });
    if (!response.ok) throw new Error("Auth check failed");
    const data = await response.json();
    if (!data.authenticated || !data.user) {
      showLogin();
      return;
    }
    startAppForUser(data.user);
  } catch {
    showLogin("Přihlášení se nepodařilo ověřit. Zkus to prosím znovu.");
  }
}

async function login() {
  const username = els.loginUsername.value.trim();
  const password = els.loginPassword.value;
  if (!username || !password) {
    setAuthMessage("Vyplň uživatele i heslo.", "warning");
    return;
  }
  setLoginBusy(true);
  setAuthMessage("Přihlašuji a připravuji pracovní prostředí...", "neutral");
  try {
    const data = await fetchJson("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    els.loginPassword.value = "";
    startAppForUser(data.user);
  } catch (error) {
    setAuthMessage(error.message, "error");
  } finally {
    setLoginBusy(false);
  }
}

async function logout() {
  try {
    await fetchJson("/api/auth/logout", { method: "POST" });
  } catch {
    // Logout should be forgiving even if the session is already gone.
  }
  showLogin("Byl jsi odhlášen.");
}

async function changePassword() {
  const currentPassword = els.changeCurrentPassword.value;
  const newPassword = els.changeNewPassword.value;
  if (!currentPassword || !newPassword) {
    setAuthMessage("Vyplň aktuální i nové heslo.", "warning");
    return;
  }
  setPasswordChangeBusy(true);
  setAuthMessage("Ukládám nové heslo...", "neutral");
  try {
    const data = await fetchJson("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    els.changeCurrentPassword.value = "";
    els.changeNewPassword.value = "";
    startAppForUser(data.user);
  } catch (error) {
    setAuthMessage(error.message, "error");
  } finally {
    setPasswordChangeBusy(false);
  }
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

function countUniqueOrders(rows) {
  const orders = new Set();
  let fallback = 0;
  (rows || []).forEach((row) => {
    const orderNumber = String(row?.orderNumber || "").trim();
    if (orderNumber) {
      orders.add(orderNumber);
    } else {
      fallback += 1;
    }
  });
  return orders.size + fallback;
}

function batchReportMetricHtml(label, value, tone = "") {
  return `
    <div class="batch-report-metric ${escapeHtml(tone)}">
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(label)}</span>
    </div>
  `;
}

function completionRowQuantity(row) {
  return workflowQuantityFromValue(row?.quantity || row?.amount);
}

function completionSortingPiecesForRow(row) {
  if (completionFlowKind(row) !== "sorting") return 0;
  return workflowSortingItems(row).reduce((total, item) => {
    const lineQuantity = workflowItemLineQuantity(item);
    if (lineQuantity) return total + lineQuantity;
    const initial = toNumber(item.initialQuantity, NaN);
    const fallback = toNumber(item.quantity, toNumber(item.remaining, 0));
    return total + Math.max(0, Math.trunc(Number.isFinite(initial) ? initial : fallback));
  }, 0);
}

function completionStockPieces(rows) {
  return (rows || []).reduce((total, row) => {
    const quantity = completionRowQuantity(row);
    const kind = completionFlowKind(row);
    if (kind === "stock") return total + quantity;
    if (kind === "sorting") return total + Math.max(0, quantity - completionSortingPiecesForRow(row));
    return total;
  }, 0);
}

const EXPEDITION_ORDER_CODE_LABELS = {
  "0.8": "Komplet ze skladu Galantra.cz přes Zásilkovnu",
  1: "Komplet ze skladu iVeronika.cz",
  "1.5": "Komplet ze skladu iVeronika.sk",
  "1.8": "Komplet ze skladu Galantra.cz přes DPD",
  "1.9": "Komplet ze skladu DPD mimo Galantra.cz",
  2: "Zásilkovna pouze Hotex",
  3: "Zásilkovna Milpex",
  4: "Zásilkovna Milpex + Hotex kombinace",
  5: "Zatím nepoužíváme",
  6: "iVeronika.sk Zásilkovna",
  7: "DPD Milpex nebo Hotex",
  8: "ERRORKA Galantra.cz",
};

function normalizeExpeditionOrderCode(value) {
  const text = String(value ?? "").trim().replace(",", ".");
  const numericValue = toNumber(text, NaN);
  if (!Number.isFinite(numericValue)) return text;
  const knownCode = Object.keys(EXPEDITION_ORDER_CODE_LABELS).find((code) => Math.abs(Number(code) - numericValue) < 0.00001);
  if (knownCode) return knownCode;
  return Number.isInteger(numericValue) ? String(numericValue) : String(Math.round(numericValue * 10) / 10);
}

function expeditionOrderCodeTone(code) {
  const value = toNumber(code, NaN);
  if (!Number.isFinite(value)) return "unknown";
  if (value === 8) return "danger";
  if (value < 2) return "stock";
  if (value >= 2 && value <= 7) return "sorting";
  return "unknown";
}

function expeditionOrderCodeLabel(code) {
  return EXPEDITION_ORDER_CODE_LABELS[code] || "Neznámý kód";
}

function completionExpeditionNumber(row) {
  const value = toNumber(row?.expeditionNumber, NaN);
  return Number.isFinite(value) ? Math.trunc(value) : null;
}

function completionCodeRanges(rows) {
  const items = [];
  let withoutExpeditionNumber = 0;

  (rows || []).forEach((row) => {
    const expeditionNumber = completionExpeditionNumber(row);
    if (!expeditionNumber) {
      withoutExpeditionNumber += 1;
      return;
    }
    items.push({
      expeditionNumber,
      code: normalizeExpeditionOrderCode(row?.expeditionOrderCode),
    });
  });

  items.sort((a, b) => a.expeditionNumber - b.expeditionNumber);

  const ranges = [];
  items.forEach((item) => {
    const last = ranges[ranges.length - 1];
    if (last && last.code === item.code && item.expeditionNumber === last.end + 1) {
      last.end = item.expeditionNumber;
      last.count += 1;
      return;
    }
    ranges.push({
      start: item.expeditionNumber,
      end: item.expeditionNumber,
      code: item.code,
      count: 1,
    });
  });

  return { ranges, withoutExpeditionNumber };
}

function batchReportRangesHtml(rows) {
  const { ranges, withoutExpeditionNumber } = completionCodeRanges(rows);
  if (!ranges.length && !withoutExpeditionNumber) return "";
  const showCodes = isAdmin();

  const rangeRows = ranges
    .map((range) => {
      const rangeText = range.start === range.end ? String(range.start) : `${range.start}-${range.end}`;
      const tone = expeditionOrderCodeTone(range.code);
      return `
        <div class="batch-report-range ${escapeHtml(tone)} ${showCodes ? "" : "without-code"}">
          <strong>${escapeHtml(rangeText)}</strong>
          ${showCodes ? `<span class="batch-report-code">${escapeHtml(range.code || "-")}</span>` : ""}
          <span>${escapeHtml(expeditionOrderCodeLabel(range.code))}</span>
        </div>
      `;
    })
    .join("");

  const missing = withoutExpeditionNumber
    ? `<div class="batch-report-range unknown ${showCodes ? "" : "without-code"}"><strong>?</strong>${
        showCodes ? `<span class="batch-report-code">-</span>` : ""
      }<span>Bez expedičního čísla: ${escapeHtml(withoutExpeditionNumber)}</span></div>`
    : "";

  return `<div class="batch-report-ranges" aria-label="Rozpis expedičních kódů">${rangeRows}${missing}</div>`;
}

function printExpeditionBatchReport() {
  if (!els.expeditionBatchReport || els.expeditionBatchReport.classList.contains("hidden")) return;
  const reportClone = els.expeditionBatchReport.cloneNode(true);
  reportClone.querySelectorAll("[data-action='print-batch-report']").forEach((button) => button.remove());
  const printWindow = window.open("", "_blank", "width=420,height=720");
  if (!printWindow) {
    setMessage("Prohlížeč zablokoval tiskové okno. Povol prosím vyskakovací okna pro expedici.", "warning");
    return;
  }

  printWindow.document.write(`
    <!doctype html>
    <html lang="cs">
      <head>
        <meta charset="UTF-8" />
        <title>Report vybrané várky</title>
        <link rel="stylesheet" href="styles.css?v=batch-report-stock-pieces-20260708" />
      </head>
      <body class="batch-report-print-page">
        ${reportClone.outerHTML}
        <script>
          window.addEventListener("load", () => {
            window.focus();
            window.print();
          });
        <\/script>
      </body>
    </html>
  `);
  printWindow.document.close();
}

function renderExpeditionBatchReport() {
  if (!els.expeditionBatchReport) return;
  if (!hasSelectedExpeditionDay()) {
    els.expeditionBatchReport.classList.add("hidden");
    els.expeditionBatchReport.innerHTML = "";
    return;
  }

  const rows = completionState.rows || [];
  const flowCounts = completionFlowCounts(rows);
  const pieces = rows.reduce((total, row) => total + completionRowQuantity(row), 0);
  const stockPieces = completionStockPieces(rows);
  const addressRows = rows.filter((row) => completionRequiresAddressValidation(row));
  const addressErrors = addressRows.filter((row) => completionAddressHasError(row)).length;
  const paymentWarnings = rows.filter((row) => ["warning", "danger"].includes(paymentCheckTone(row))).length;
  const statusErrors = rows.filter((row) => normalize(row?.completionStatus || "").includes("error")).length;
  const sortingRows = state.items || [];
  const sortingRemaining = sortingRows.reduce((total, item) => total + Math.max(0, Math.trunc(toNumber(item.remaining, 0))), 0);
  const completionDataset = completionState.dataset;
  const sortingDataset = sortingState.dataset;
  const hasCompletionRows = rows.length > 0;

  const title = completionDataset
    ? `${completionDataset.batchName || completionDataset.datasetDate || "Kompletace"} ${completionDataset.datasetTime || ""}`.trim()
    : "Kompletace není načtená";
  const rowsFallback = completionDataset?.rowsCount || 0;
  const ordersValue = hasCompletionRows ? countUniqueOrders(rows) : rowsFallback || "-";
  const piecesValue = hasCompletionRows ? pieces : "-";

  const notes = [];
  if (completionDataset) {
    notes.push(`${completionDataset.shopName || completionDataset.shopCode || "e-shop neurčen"} | ${completionDataset.rowsCount || rows.length || 0} řádků`);
  }
  if (sortingDataset) {
    notes.push(`Roztřídění: ${sortingRows.length || sortingDataset.rowsCount || 0} řádků, zbývá ${sortingRemaining} ks`);
  }
  if (statusErrors) notes.push(`Error stav: ${statusErrors}`);
  if (flowCounts.unknown) notes.push(`Neurčený typ práce: ${flowCounts.unknown}`);
  if (!completionDataset && !sortingDataset) {
    notes.push("Pro vybraný den zatím není načtená aktivní dávka.");
  }

  els.expeditionBatchReport.innerHTML = `
    <div class="batch-report-head">
      <div>
        <span>Report vybrané várky</span>
        <strong>${escapeHtml(title)}</strong>
      </div>
      <button type="button" class="batch-report-print" data-action="print-batch-report">Tisk</button>
    </div>
    <div class="batch-report-grid">
      ${batchReportMetricHtml("Objednávek", ordersValue)}
      ${batchReportMetricHtml("Kusů", piecesValue)}
      ${batchReportMetricHtml("Skladovek (objednávek)", hasCompletionRows ? flowCounts.stock : "-")}
      ${batchReportMetricHtml("Skladovky (kusů)", hasCompletionRows ? stockPieces : "-")}
      ${batchReportMetricHtml("Chybné adresy", hasCompletionRows ? addressErrors : "-", addressErrors ? "danger" : "")}
      ${batchReportMetricHtml("Platby k řešení", hasCompletionRows ? paymentWarnings : "-", paymentWarnings ? "warning" : "")}
    </div>
    ${hasCompletionRows ? batchReportRangesHtml(rows) : ""}
    <p class="batch-report-note">${notes.map((note) => `<span>${escapeHtml(note)}</span>`).join("")}</p>
  `;
  els.expeditionBatchReport.classList.remove("hidden");
}

function expeditionQuery(params = {}) {
  const query = new URLSearchParams();
  if (isAdmin() && expeditionState.showInactive) query.set("includeDeleted", "1");
  if (params.date) query.set("date", params.date);
  const text = query.toString();
  return text ? `?${text}` : "";
}

function includeInactiveQuery() {
  return expeditionQuery();
}

function setExpeditionDaySummary(html, options = {}) {
  const visible = isAdmin() || Boolean(options.employeeVisible);
  els.expeditionDaySummary.classList.toggle("hidden", !visible);
  els.expeditionDaySummary.innerHTML = visible ? html : "";
}

function hasSelectedExpeditionDay() {
  return Boolean(expeditionState.day?.date);
}

function activeModuleView() {
  if (els.tabCompletion?.classList.contains("active")) return "completion";
  if (els.tabEans?.classList.contains("active")) return "eans";
  if (els.tabSettings?.classList.contains("active")) return "settings";
  return "sorting";
}

function clearSelectedExpeditionDayData(options = {}) {
  expeditionState.day = null;
  sortingState.datasets = [];
  sortingState.dataset = null;
  sortingState.loaded = false;
  completionState.datasets = [];
  completionState.dataset = null;
  completionState.rows = [];
  completionState.loaded = false;
  completionState.paymentUpdatesSince = null;
  completionState.paymentPollInFlight = false;
  completionWorkflowState.row = null;
  completionWorkflowState.index = -1;
  completionWorkflowState.checkedItemKeys = new Set();
  expandedCompletionRows.clear();
  stopWorkflowSortingAutoRefresh();

  state.items = [];
  state.history = [];
  activeCandidates = [];
  pendingAdjustments.clear();
  zeroRowsKeptUntilRefresh.clear();
  scanInProgress = false;

  els.scanResult?.classList.add("hidden");
  els.candidatesPanel?.classList.add("hidden");
  if (els.expeditionDeleteDay) els.expeditionDeleteDay.disabled = true;
  renderExpeditionBatchReport();
  hidePacketaDryRunResult();
  setMessage("Vyber expediční den vlevo.", "neutral");
  setCompletionMessage("Vyber expediční den vlevo.", "neutral");
  setWorkflowMessage("Vyber expediční den vlevo.", "neutral");

  if (options.render === false) return;
  renderSortingOptions();
  renderCompletionOptions();
  renderAll();
  renderWorkflow();
  renderCompletion();
  renderDayRequiredGuard();
}

function renderDayRequiredGuard(view = activeModuleView()) {
  const guarded = (view === "sorting" || view === "completion") && !hasSelectedExpeditionDay();
  els.dayRequiredView?.classList.toggle("hidden", !guarded);
  els.sortingView.classList.toggle("hidden", view !== "sorting" || guarded);
  els.completionView.classList.toggle("hidden", view !== "completion" || guarded);
  els.eansView?.classList.toggle("hidden", view !== "eans");
  els.settingsView.classList.toggle("hidden", view !== "settings");
  return guarded;
}

function focusBarcodeInputForView(view) {
  const target = view === "completion" ? els.workflowBoxCode : view === "sorting" ? els.eanInput : null;
  if (!target) return;

  const applyFocus = () => {
    if (view === "completion" && document.activeElement === els.workflowExpeditionNumber) return;
    if (view === "completion" && els.completionView.classList.contains("hidden")) return;
    if (view === "sorting" && els.sortingView.classList.contains("hidden")) return;
    if (!document.body.contains(target) || target.disabled) return;
    target.focus({ preventScroll: true });
    if (typeof target.select === "function") {
      target.select();
    }
  };

  requestAnimationFrame(() => {
    applyFocus();
    requestAnimationFrame(applyFocus);
  });
}

function switchView(view, options = {}) {
  if ((view === "settings" || view === "eans") && !isAdmin()) {
    setMessage("Tahle stránka je dostupná jen adminovi.", "warning");
    view = "sorting";
  }
  const completion = view === "completion";
  const eans = view === "eans";
  const settings = view === "settings";
  els.tabSorting.classList.toggle("active", !completion && !eans && !settings);
  els.tabCompletion.classList.toggle("active", completion);
  els.tabEans?.classList.toggle("active", eans);
  els.tabSettings.classList.toggle("active", settings);

  const dayGuarded = renderDayRequiredGuard(view);

  if (completion && !dayGuarded && !completionState.loaded) {
    loadCompletionDatasets();
  }

  if (eans) {
    renderEanAudit();
  }

  if (settings && !settingsState.loaded) {
    loadSettings();
  }

  if (settings && isAdmin() && !usersState.loaded) {
    loadUsers();
  }

  if (!dayGuarded) {
    focusBarcodeInputForView(completion ? "completion" : !eans && !settings ? "sorting" : "");
  }

  if (options.updateRoute !== false) {
    setRouteForView(view, Boolean(options.replaceRoute));
  }
}

function renderExpeditionDayOptions() {
  els.expeditionDayList.innerHTML = "";
  const visible = employeeVisibleDays();
  renderEmployeeDayLockPanel(visible.lock);

  if (!visible.days.length) {
    setExpeditionDaySummary(`<span>Online zatím neobsahuje žádný expediční den.</span>`, { employeeVisible: true });
    return;
  }

  visible.days.forEach((day) => {
    const employeeSimple = !isAdmin();
    const deleted = day.status && day.status !== "active";
    const active = expeditionState.day?.date === day.date;
    const batches = deleted ? day.allBatches || 0 : day.activeBatches || 0;
    const rows = deleted ? day.allRowsCount || 0 : day.rowsCount || 0;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `day-card ${employeeSimple ? "employee-simple" : ""} ${active ? "active" : ""} ${deleted ? "deleted" : ""}`;
    button.dataset.date = day.date;
    button.innerHTML = employeeSimple
      ? `<strong>${escapeHtml(day.label || day.date)}</strong>`
      : `
        <strong>${escapeHtml(day.label || day.date)}</strong>
        <span>${deleted ? "V koši" : `${escapeHtml(batches)} aktivní dávky`}</span>
        <small>${escapeHtml(batches)} dávky | ${escapeHtml(rows)} řádků${day.latestUpload ? ` | ${escapeHtml(formatTime(day.latestUpload))}` : ""}</small>
      `;
    els.expeditionDayList.appendChild(button);
  });
}

function renderSortingOptions() {
  els.sortingDataset.innerHTML = "";

  if (!sortingState.datasets.length) {
    els.sortingDataset.innerHTML = `<option value="">Žádná dávka roztřídění</option>`;
    els.sortingDatasetInfo.innerHTML = datasetInfoHtml(null);
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
}

async function loadExpeditionDays(preferredDate = "") {
  expeditionState.showInactive = isAdmin() && els.expeditionShowInactive.checked;
  setExpeditionDaySummary(`<span>Načítám expediční dny...</span>`, { employeeVisible: true });

  try {
    const data = await fetchJson(`/api/expedition-days${includeInactiveQuery()}`);
    expeditionState.days = data.days || [];
    expeditionState.loaded = true;
    renderExpeditionDayOptions();

    if (!expeditionState.days.length) {
      clearSelectedExpeditionDayData();
      setExpeditionDaySummary(`<span>Online zatím neobsahuje žádný expediční den.</span>`, { employeeVisible: true });
      return;
    }

    const lockedDate = preferredEmployeeLockedDate();
    const selectedDate =
      lockedDate ||
      preferredDate ||
      (expeditionState.day?.date && expeditionState.days.some((day) => day.date === expeditionState.day.date)
        ? expeditionState.day.date
        : "") ||
      "";

    if (!selectedDate) {
      clearSelectedExpeditionDayData();
      setExpeditionDaySummary(`<span>Vyber expediční den vlevo.</span>`, { employeeVisible: false });
      return;
    }

    await loadExpeditionDay(selectedDate);
  } catch (error) {
    expeditionState.loaded = true;
    setExpeditionDaySummary(`<span>Online dny se nepodařilo načíst: ${escapeHtml(error.message)}</span>`, { employeeVisible: true });
  }
}

async function loadExpeditionDay(dayDate) {
  if (!dayDate) {
    clearSelectedExpeditionDayData();
    return;
  }
  const data = await fetchJson(`/api/expedition-days/${encodeURIComponent(dayDate)}/full${includeInactiveQuery()}`);
  expeditionState.day = data.day || null;
  sortingState.datasets = data.sorting || [];
  completionState.datasets = data.completion || [];
  sortingState.loaded = true;
  completionState.loaded = true;
  sortingState.dataset = null;
  completionState.dataset = null;
  completionState.rows = [];
  completionWorkflowState.row = null;
  completionWorkflowState.index = -1;
  completionWorkflowState.checkedItemKeys = new Set();
  expandedCompletionRows.clear();
  stopWorkflowSortingAutoRefresh();

  if (!expeditionState.day?.date) {
    clearSelectedExpeditionDayData();
    setExpeditionDaySummary(`<span>Den není načtený.</span>`, { employeeVisible: false });
    return;
  }

  renderExpeditionDayOptions();
  const deleted = expeditionState.day?.status && expeditionState.day.status !== "active";
  const batches = deleted ? expeditionState.day?.allBatches || 0 : expeditionState.day?.activeBatches || 0;
  const rows = deleted ? expeditionState.day?.allRowsCount || 0 : expeditionState.day?.rowsCount || 0;
  setExpeditionDaySummary(
    expeditionState.day
      ? `<span><strong>${escapeHtml(expeditionState.day.label)}</strong></span><span>${escapeHtml(
          deleted ? "v koši" : `${batches} aktivní dávky`
        )}</span><span>${escapeHtml(rows)} řádků</span>`
      : `<span>Den není načtený.</span>`,
    { employeeVisible: false }
  );
  if (els.expeditionDeleteDay) {
    els.expeditionDeleteDay.disabled = !isAdmin() || !expeditionState.day || deleted;
  }

  renderSortingOptions();
  renderCompletionOptions();
  renderExpeditionBatchReport();

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
    completionWorkflowState.row = null;
    completionWorkflowState.index = -1;
    renderCompletionOptions();
    renderExpeditionBatchReport();
    renderWorkflow();
    renderCompletion();
    setCompletionMessage("Pro vybraný expediční den není nahraná kompletace.", "warning");
  }

  const view = activeModuleView();
  const guarded = renderDayRequiredGuard(view);
  if (!guarded && (view === "sorting" || view === "completion")) {
    focusBarcodeInputForView(view);
  }
}

function sortingRowToItem(row) {
  const initialQuantity =
    workflowQuantityFromValue(row.initialQuantity) ||
    workflowQuantityFromValue(row.quantity) ||
    workflowQuantityFromValue(row.remaining);
  return normalizeItem({
    id: `online-${row.id}`,
    sourceRow: row.rowNumber || "",
    productCode: row.productCode || "",
    variantCode: row.variantCode || "",
    variant: row.variant || "",
    remaining: row.remaining ?? row.quantity ?? 0,
    initialQuantity,
    orderNumber: row.orderNumber || "",
    weight: row.weight || "",
    sequence: row.sequence || "",
    info: row.info || "",
    paircode: row.paircode || "",
    brand: brandFromInfo(row.info),
    productName: cleanInfo(row.info),
    image: row.image || "",
    datasetRowId: row.id || "",
    shopCode: row.shopCode || "",
  });
}

function applySortingDataset(dataset, rows) {
  sortingState.dataset = dataset || null;
  zeroRowsKeptUntilRefresh.clear();
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
  renderExpeditionBatchReport();
  renderAll();
  ensureProductImagesForCodes(collectProductImageCodesFromItems(nextItems));
  setMessage(`Načteno roztřídění: ${datasetLabel(sortingState.dataset)}.`, "success");
  focusBarcodeInputForView("sorting");
}

async function loadSortingDataset(datasetId) {
  if (!hasSelectedExpeditionDay()) {
    clearSelectedExpeditionDayData();
    setMessage("Nejdřív vyber expediční den vlevo.", "warning");
    return;
  }
  if (!datasetId) return;
  setMessage("Načítám vybrané roztřídění...", "neutral");
  try {
    const data = await fetchJson(`/api/datasets/${datasetId}`);
    applySortingDataset(data.dataset || null, data.rows || []);
  } catch (error) {
    setMessage(`Roztřídění se nepodařilo načíst: ${error.message}`, "error");
  }
}

async function deleteCurrentExpeditionDay() {
  if (!isAdmin()) {
    setMessage("Smazání expedičního dne je dostupné jen adminovi.", "warning");
    return;
  }
  const day = expeditionState.day;
  if (!day?.date) {
    setMessage("Není vybraný žádný expediční den ke smazání.", "warning");
    return;
  }
  if (day.status && day.status !== "active") {
    setMessage("Tenhle expediční den už je v koši.", "warning");
    return;
  }

  const label = day.label || day.date;
  const confirmed = confirm(
    `Přesunout celý expediční den do koše?\n\n${label}\n\nDo koše se přesunou všechny dávky roztřídění i kompletace v tomto dni. Uvidí je jen admin v Koši.`
  );
  if (!confirmed) return;

  els.expeditionDeleteDay.disabled = true;
  try {
    const data = await fetchJson(`/api/expedition-days/${encodeURIComponent(day.date)}`, {
      method: "DELETE",
      body: JSON.stringify({
        deletedBy: "web",
        reason: "Smazán celý expediční den ve webovém rozhraní",
      }),
    });
    sortingState.dataset = null;
    sortingState.datasets = [];
    completionState.dataset = null;
    completionState.datasets = [];
    completionState.rows = [];
    expeditionState.day = null;
    expeditionState.showInactive = true;
    els.expeditionShowInactive.checked = true;
    setMessage(`Expediční den ${label} je v koši. Přesunuto dávek: ${data.deletedDatasets || 0}.`, "success");
    setCompletionMessage(`Expediční den ${label} je v koši.`, "success");
    await loadExpeditionDays(day.date);
  } catch (error) {
    setMessage(`Expediční den se nepodařilo smazat: ${error.message}`, "error");
  } finally {
    els.expeditionDeleteDay.disabled = false;
  }
}

function renderCompletionOptions() {
  els.completionDataset.innerHTML = "";

  if (!completionState.datasets.length) {
    els.completionDataset.innerHTML = `<option value="">Žádná dávka</option>`;
    els.paymentFeedSync.disabled = true;
    els.packetaDryRun.disabled = true;
    els.packetaValidate.disabled = true;
    if (els.packetaSend) els.packetaSend.disabled = true;
    if (els.labelCacheBatch) els.labelCacheBatch.disabled = true;
    els.dpdDryRun.disabled = true;
    els.dpdSend.disabled = true;
    els.completionValidateAddresses.disabled = true;
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
  els.paymentFeedSync.disabled = !completionState.dataset;
  els.packetaDryRun.disabled = !completionState.dataset;
  els.packetaValidate.disabled = !completionState.dataset;
  if (els.packetaSend) els.packetaSend.disabled = !completionState.dataset;
  if (els.labelCacheBatch) els.labelCacheBatch.disabled = !completionState.dataset;
  els.dpdDryRun.disabled = !completionState.dataset;
  els.dpdSend.disabled = !completionState.dataset;
  els.completionValidateAddresses.disabled = !completionState.dataset;
}

async function loadCompletionDatasets() {
  if (expeditionState.day?.date) {
    await loadExpeditionDay(expeditionState.day.date);
    return;
  }
  clearSelectedExpeditionDayData();
  await loadExpeditionDays();
  if (!hasSelectedExpeditionDay()) {
    setCompletionMessage("Nejdřív vyber expediční den vlevo.", "warning");
  }
}

function applyCompletionDataset(dataset, rows) {
  completionState.dataset = dataset || null;
  completionState.rows = rows || [];
  completionState.paymentUpdatesSince = null;
  completionWorkflowState.row = null;
  completionWorkflowState.index = -1;
  expandedCompletionRows.clear();
  hidePacketaDryRunResult();
  renderCompletionOptions();
  renderExpeditionBatchReport();
  renderWorkflow();
  renderCompletion();
  ensureProductImagesForCodes(collectCompletionProductImageCodes(completionState.rows));
  loadAddressValidationLog();
  setCompletionMessage(`Načteno: ${datasetLabel(completionState.dataset)}.`, "success");
  window.setTimeout(() => pollPaymentFeedUpdates(), 200);
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
  const sendMode = data.createShipments === true || data.validationOnly === false;
  const okCount = results.filter((item) => (sendMode ? item.created : item.valid)).length;
  const errorCount = results.length - okCount;

  const resultCards = results
    .map((item, index) => {
      const success = sendMode ? item.created : item.valid;
      const tone = success ? "ok" : "danger";
      const status = success ? (sendMode ? `Vytvořeno ${item.shipmentId || ""}`.trim() : "OK") : item.status || "chyba";
      return `
        <details class="dry-run-item validation-item ${tone}" ${index === 0 || !success ? "open" : ""}>
          <summary>
            <strong>${escapeHtml(item.orderNumber || "-")}</strong>
            <span>${escapeHtml(item.customer || "-")}</span>
            <small>${escapeHtml(status)} | HTTP ${escapeHtml(item.httpStatus || "-")} | ${escapeHtml(
        item.service || ""
      )}</small>
          </summary>
          <div class="dry-run-meta">
            <span>Adresa ID: ${escapeHtml(item.addressId || "-")}</span>
            ${item.shipmentId ? `<span>Zásilka ID: ${escapeHtml(item.shipmentId)}</span>` : ""}
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
        <h2>${sendMode ? "Ostré odeslání zásilek" : "Test API validace"}</h2>
      </div>
      <div class="dry-run-counts">
        <span>${escapeHtml(okCount)} ${sendMode ? "vytvořeno" : "OK"}</span>
        <span>${escapeHtml(errorCount)} chyb</span>
        <span>${escapeHtml(data.notValidatedCount || 0)} neověřeno</span>
        ${sendMode ? `<span>${escapeHtml(data.skippedCount || skipped.length)} přeskočeno</span>` : ""}
      </div>
    </div>
    <div class="dry-run-note">
      ${
        sendMode
          ? "Tohle bylo ostré vytvoření zásilek z konkrétní vybrané dávky. Vytvořená ID se uložila zpět do řádků."
          : "Tohle volalo validacni funkci Packety. Stitky se nevytvorily, ale data byla odeslana do API kvuli kontrole chyb."
      }
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

async function runPacketaSend() {
  if (!completionState.dataset?.id) {
    setCompletionMessage("Nejdřív načti konkrétní expediční dávku kompletace.", "warning");
    return;
  }

  const datasetLabelText = datasetLabel(completionState.dataset);
  if (
    !confirm(
      `Opravdu ostře odeslat všechny vhodné zásilky z této konkrétní dávky do Zásilkovny/Packety?\n\n${datasetLabelText}\n\nPojistky: zásilky s existujícím ID se přeskočí, dobírka se pošle podle uložené částky a doručení na adresu bez ověření Mapy.com se neodešle.`
    )
  ) {
    return;
  }

  els.packetaSend.disabled = true;
  hidePacketaDryRunResult();
  setCompletionMessage("Odesílám vybranou dávku do Zásilkovny/Packety...", "neutral");

  try {
    const data = await fetchJson("/api/packeta/send", {
      method: "POST",
      body: JSON.stringify({
        datasetId: completionState.dataset.id,
      }),
    });
    (data.rows || []).forEach((row) => updateCompletionRowInState(row));
    renderCompletion();
    renderPacketaValidation(data);
    const errors = data.errorCount || 0;
    setCompletionMessage(
      `Odeslání Zásilkovny hotové: ${data.createdCount || 0} vytvořeno, ${errors} chyb, ${
        data.skippedCount || 0
      } přeskočeno.`,
      errors ? "warning" : "success"
    );
  } catch (error) {
    setCompletionMessage(`Odeslání do Zásilkovny se nepodařilo: ${error.message}`, "error");
  } finally {
    els.packetaSend.disabled = !completionState.dataset;
  }
}

function renderLabelCacheResult(data) {
  const ready = data.ready || [];
  const skipped = data.skipped || [];
  const errors = data.errors || [];
  const readyHtml = ready
    .slice(0, 80)
    .map(
      (item) => `
        <div class="cache-result-row ok">
          <strong>${escapeHtml(item.orderNumber || "-")}</strong>
          <span>${escapeHtml(item.carrier || "-")} | ${escapeHtml(item.labelNumber || "-")}</span>
          <small>${escapeHtml(item.size || 0)} B</small>
        </div>
      `
    )
    .join("");
  const errorHtml = errors
    .slice(0, 80)
    .map(
      (item) => `
        <div class="cache-result-row error">
          <strong>${escapeHtml(item.orderNumber || "-")}</strong>
          <span>${escapeHtml(item.carrier || "-")} | ${escapeHtml(item.labelNumber || "-")}</span>
          <small>${escapeHtml(item.error || "")}</small>
        </div>
      `
    )
    .join("");
  const skippedHtml = skipped.length
    ? `
      <details class="dry-run-item dry-run-skipped">
        <summary>
          <strong>Přeskočeno</strong>
          <span>${escapeHtml(skipped.length)} ks</span>
        </summary>
        <div class="skipped-list">
          ${skipped
            .slice(0, 80)
            .map(
              (item) => `
                <div>
                  <strong>${escapeHtml(item.orderNumber || "-")}</strong>
                  <span>${escapeHtml(item.labelNumber || "")}</span>
                  <small>${escapeHtml(item.reason || "")}</small>
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
        <p class="eyebrow">Serverová cache štítků</p>
        <h2>Příprava DPD štítků dávky</h2>
      </div>
      <div class="dry-run-counts">
        <span>${escapeHtml(data.readyCount || 0)} připraveno</span>
        <span>${escapeHtml(data.skippedCount || 0)} přeskočeno</span>
        <span>${escapeHtml(data.errorCount || 0)} chyb</span>
      </div>
    </div>
    <div class="dry-run-note">
      Hotové DPD štítky se uložily na server. Zásilkovna/Packeta je v tomto testu pouze přeskočená a nic se do ní neodesílá.
    </div>
    <div class="cache-result-list">
      ${errorHtml}
      ${readyHtml || (!errorHtml ? `<div class="empty">Žádný nový štítek nebylo potřeba připravit.</div>` : "")}
      ${skippedHtml}
    </div>
  `;
}

async function runLabelCacheBatch() {
  if (!completionState.dataset?.id) {
    setCompletionMessage("Nejdřív načti konkrétní expediční dávku kompletace.", "warning");
    return;
  }
  if (
    !confirm(
      `Připravit DPD PDF štítky na server pro tuto konkrétní dávku?\n\n${datasetLabel(
        completionState.dataset
      )}\n\nSystém stáhne jen chybějící DPD štítky. Zásilkovna/Packeta se teď přeskočí a nic se neodešle.`
    )
  ) {
    return;
  }

  els.labelCacheBatch.disabled = true;
  hidePacketaDryRunResult();
  setCompletionMessage("Připravuji DPD štítky dávky na server...", "neutral");
  try {
    const data = await fetchJson("/api/labels/cache-batch", {
      method: "POST",
      body: JSON.stringify({ datasetId: completionState.dataset.id, carrier: "dpd" }),
    });
    (data.rows || []).forEach((row) => replaceCompletionRow(row));
    renderWorkflow();
    renderCompletion();
    renderLabelCacheResult(data);
    setCompletionMessage(
      `Příprava DPD štítků hotová: ${data.readyCount || 0} připraveno, ${data.skippedCount || 0} přeskočeno, ${
        data.errorCount || 0
      } chyb.`,
      data.errorCount ? "warning" : "success"
    );
  } catch (error) {
    setCompletionMessage(`Příprava štítků selhala: ${error.message}`, "error");
  } finally {
    els.labelCacheBatch.disabled = !completionState.dataset;
  }
}

function renderDpdResult(data, title = "DPD dry run") {
  const shipments = data.shipments || [];
  const skipped = data.skipped || [];
  const result = data.result || null;

  const shipmentCards = shipments
    .map((shipment, index) => {
      const warnings = shipment.warnings?.length
        ? `<div class="warning-list">${shipment.warnings
            .map((warning) => `<span>${escapeHtml(warning)}</span>`)
            .join("")}</div>`
        : "";
      return `
        <details class="dry-run-item" ${index === 0 ? "open" : ""}>
          <summary>
            <strong>${escapeHtml(shipment.orderNumber || "-")}</strong>
            <span>${escapeHtml(shipment.customer || "-")}</span>
            <small>${escapeHtml(shipment.serviceLabel || shipment.service || "")}</small>
          </summary>
          ${warnings}
          <pre>${escapeHtml(JSON.stringify(shipment.payload || shipment, null, 2))}</pre>
        </details>
      `;
    })
    .join("");

  const skippedHtml = skipped.length
    ? `
      <details class="dry-run-item dry-run-skipped">
        <summary>
          <strong>Přeskočené řádky</strong>
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

  const resultHtml = result
    ? `
      <details class="dry-run-item ${result.ok ? "validation-item ok" : "validation-item danger"}" open>
        <summary>
          <strong>Odpověď DPD konektoru</strong>
          <span>${escapeHtml(result.ok ? "OK" : "Chyba")}</span>
          <small>HTTP ${escapeHtml(result.httpStatus || "-")}</small>
        </summary>
        ${result.error ? `<div class="warning-list"><span>${escapeHtml(result.error)}</span></div>` : ""}
        <pre>${escapeHtml(result.responseText || "Bez textové odpovědi.")}</pre>
      </details>
    `
    : "";

  els.packetaDryRunResult.classList.remove("hidden");
  els.packetaDryRunResult.innerHTML = `
    <div class="section-head compact">
      <div>
        <p class="eyebrow">DPD</p>
        <h2>${escapeHtml(title)}</h2>
      </div>
      <div class="dry-run-counts">
        <span>${escapeHtml(data.shipmentsCount || shipments.length)} zásilek</span>
        <span>${escapeHtml(data.skippedCount || skipped.length)} přeskočeno</span>
        ${data.notSentCount ? `<span>${escapeHtml(data.notSentCount)} neodesláno</span>` : ""}
      </div>
    </div>
    <div class="dry-run-note">
      DPD větev zpracovává pouze řádky označené jako DPD. Packeta a e-mailové poukazy se do tohoto výstupu neposílají.
    </div>
    <div class="dry-run-list">
      ${resultHtml}
      ${shipmentCards || `<div class="empty">Nenašel jsem žádnou DPD zásilku k vytvoření.</div>`}
      ${skippedHtml}
    </div>
  `;
}

async function runDpdDryRun() {
  if (!completionState.dataset?.id) {
    setCompletionMessage("Nejdřív načti kompletaci pro expediční den.", "warning");
    return;
  }

  els.dpdDryRun.disabled = true;
  hidePacketaDryRunResult();
  setCompletionMessage("Skládám dry run DPD...", "neutral");

  try {
    const data = await fetchJson(
      `/api/dpd/dry-run?datasetId=${encodeURIComponent(completionState.dataset.id)}&limit=50`
    );
    renderDpdResult(data, "DPD dry run");
    setCompletionMessage(
      `DPD dry run hotový: ${data.shipmentsCount || 0} zásilek, přeskočeno ${data.skippedCount || 0}.`,
      "success"
    );
  } catch (error) {
    setCompletionMessage(`DPD dry run se nepodařil: ${error.message}`, "error");
  } finally {
    els.dpdDryRun.disabled = !completionState.dataset;
  }
}

async function runDpdSend() {
  if (!completionState.dataset?.id) {
    setCompletionMessage("Nejdřív načti kompletaci pro expediční den.", "warning");
    return;
  }

  if (
    !confirm(
      "Spustit DPD API konektor?\n\nServer odešle DPD řádky jen pokud je na Railway nastavené DPD_API_ENABLED=1 a DPD_API_URL."
    )
  ) {
    return;
  }

  els.dpdSend.disabled = true;
  hidePacketaDryRunResult();
  setCompletionMessage("Spouštím DPD API konektor...", "neutral");

  try {
    const data = await fetchJson("/api/dpd/send", {
      method: "POST",
      body: JSON.stringify({
        datasetId: completionState.dataset.id,
        limit: 30,
        mode: "test",
      }),
    });
    renderDpdResult(data, "DPD API konektor");
    setCompletionMessage(
      data.ok
        ? `DPD API hotovo: odesláno ${data.sentCount || 0} zásilek.`
        : `DPD API zatím neodeslalo data: ${data.result?.error || "zkontroluj nastavení"}.`,
      data.ok ? "success" : "warning"
    );
  } catch (error) {
    setCompletionMessage(`DPD API se nepodařilo spustit: ${error.message}`, "error");
  } finally {
    els.dpdSend.disabled = !completionState.dataset;
  }
}

function renderSecretInput(input, status, saved, savedText, emptyText) {
  if (!input) return;
  input.value = "";
  input.placeholder = saved ? "Uloženo, prázdné = ponechat uložené" : "Zatím není uložené";
  if (status) {
    status.textContent = saved ? savedText : emptyText;
    status.classList.toggle("settings-hint-ok", Boolean(saved));
    status.classList.toggle("settings-hint-missing", !saved);
  }
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} kB`;
  return `${value} B`;
}

function productFeedStatusText(productFeed) {
  const timeout = productFeed.downloadTimeoutSeconds || 600;
  const maxMb = productFeed.maxDownloadMegabytes || 512;
  return productFeed.hasUrl
    ? `Produktový feed je uložený. Timeout ${timeout} s, limit ${maxMb} MB.`
    : `Produktový feed zatím není uložený. Timeout ${timeout} s, limit ${maxMb} MB.`;
}

function collectProductFeedSettings() {
  return {
    url: els.settingsProductFeedUrl.value.trim(),
    encoding: "windows-1250",
    delimiter: ";",
    downloadTimeoutSeconds: Number(els.settingsProductFeedTimeout.value) || 600,
    maxDownloadMegabytes: Number(els.settingsProductFeedMaxMb.value) || 512,
  };
}

function paymentCheckKind(row) {
  return normalize(row?.paymentCheckStatus || "");
}

function completionRowIsCod(row) {
  const status = paymentCheckKind(row);
  const text = normalize(
    [
      row?.paymentMethod,
      row?.paidStatus,
      row?.completionStatus,
      row?.shippingMethod,
    ]
      .filter(Boolean)
      .join(" ")
  );
  return (
    status === "cod" ||
    toNumber(row?.codAmount, 0) > 0 ||
    text.includes("dobirk") ||
    text.includes("dobierk") ||
    text.includes("na dobierku") ||
    text.includes("pri prevzati") ||
    text.includes("cash on delivery") ||
    /\bcod\b/.test(text)
  );
}

function paymentCheckLabel(row) {
  const status = paymentCheckKind(row);
  if (status === "storno") return "STORNO";
  if (completionRowIsCod(row)) return "Dobírka";
  if (status === "paid") return "Zaplaceno";
  if (status === "unpaid") return "Nezaplaceno";
  if (status === "missing") return "Platba nezjištěna";
  if (status === "unknown") return "Platba nejasná";
  return "";
}

function paymentCheckTone(row) {
  const status = paymentCheckKind(row);
  if (status === "storno") return "danger";
  if (status === "paid" || completionRowIsCod(row)) return "ok";
  if (status === "unpaid" || status === "missing" || status === "unknown") return "warning";
  return "neutral";
}

function completionFlowValue(row) {
  return toNumber(String(row?.expeditionOrderCode || "").replace(",", "."), NaN);
}

function completionFlowKind(row) {
  const value = completionFlowValue(row);
  if (!Number.isFinite(value)) return "unknown";
  return value < 2 ? "stock" : "sorting";
}

function completionFlowLabel(kind) {
  if (kind === "stock") return "Samostatné skladovky";
  if (kind === "sorting") return "Z roztřídění";
  if (kind === "unknown") return "Neurčeno";
  return "Všechny typy";
}

function completionFlowCounts(rows) {
  return rows.reduce(
    (acc, row) => {
      const kind = completionFlowKind(row);
      acc[kind] = (acc[kind] || 0) + 1;
      acc.all += 1;
      return acc;
    },
    { all: 0, stock: 0, sorting: 0, unknown: 0 }
  );
}

function updateCompletionFlowFilterOptions(rows) {
  if (!els.completionFilterFlow) return;
  const counts = completionFlowCounts(rows || []);
  Array.from(els.completionFilterFlow.options).forEach((option) => {
    const kind = option.value || "all";
    const count = counts[kind] || 0;
    option.textContent = `${completionFlowLabel(option.value)} (${count})`;
  });
}

function paymentCheckHtml(row) {
  const label = paymentCheckLabel(row);
  if (!label) return "";
  const tone = paymentCheckTone(row);
  const title = row?.paymentCheckMessage || row?.paymentCheckSourceStatus || "";
  return `<span class="payment-check-badge ${tone}" title="${escapeHtml(title)}">${escapeHtml(label)}</span>`;
}

function setSettingsStatus(element, text, status = "ok") {
  if (!element) return;
  element.textContent = text;
  const tile = element.closest(".settings-status-tile");
  if (tile) tile.dataset.status = status;
}

function storedCount(items) {
  return items.filter(Boolean).length;
}

function renderSettingsOverview(settings, context = {}) {
  const appearance = settings.appearance || {};
  const fontKey = uiFontKey(appearance.font);
  const densityKey = completionDensityKey(appearance.completionDensity);
  const productFeed = context.productFeed || settings.productFeed || {};
  const paymentIveronika = context.paymentIveronika || {};
  const paymentIveronikaSk = context.paymentIveronikaSk || {};
  const paymentGalantra = context.paymentGalantra || {};
  const packeta = context.packeta || settings.packeta || {};
  const dpd = context.dpd || settings.dpd || {};
  const packetaIveronika = context.packetaIveronika || {};
  const packetaGalantra = context.packetaGalantra || {};
  const dpdIveronika = context.dpdIveronika || {};
  const dpdGalantra = context.dpdGalantra || {};
  const printAgent = context.printAgent || settings.printAgent || {};

  setSettingsStatus(
    els.settingsStatusFont,
    `${UI_FONT_OPTIONS[fontKey].label} / ${COMPLETION_DENSITY_OPTIONS[densityKey]}`,
    "ok"
  );
  setSettingsStatus(
    els.settingsStatusProductFeed,
    productFeed.hasUrl
      ? `${productFeed.downloadTimeoutSeconds || 600}s / ${productFeed.maxDownloadMegabytes || 512} MB`
      : "URL chybí",
    productFeed.hasUrl ? "ok" : "missing"
  );

  const paymentCount = storedCount([paymentIveronika.hasUrl, paymentIveronikaSk.hasUrl, paymentGalantra.hasUrl]);
  setSettingsStatus(
    els.settingsStatusPayments,
    `${paymentCount}/3 e-shopy`,
    paymentCount === 3 ? "ok" : paymentCount > 0 ? "warning" : "missing"
  );

  const packetaReady = packeta.hasApiPassword || packetaIveronika.hasApiPassword || packetaGalantra.hasApiPassword;
  const dpdReady = dpd.hasApiKey || dpdIveronika.hasApiKey || dpdGalantra.hasApiKey;
  setSettingsStatus(
    els.settingsStatusCarriers,
    `${packetaReady ? "Packeta OK" : "Packeta chybí"} · ${dpdReady ? "DPD OK" : "DPD chybí"}`,
    packetaReady && dpdReady ? "ok" : packetaReady || dpdReady ? "warning" : "missing"
  );

  setSettingsStatus(
    els.settingsStatusPrint,
    printAgent.testingMode ? "Testovací režim" : "Přímý tisk",
    printAgent.testingMode ? "warning" : "ok"
  );
}

function renderSettings(settings) {
  applyAppearanceSettings(settings);
  const mapy = settings.mapy || {};
  const printAgent = settings.printAgent || {};
  const paymentFeeds = settings.paymentFeeds || {};
  const productFeed = settings.productFeed || {};
  const paymentFeedShops = paymentFeeds.shops || {};
  const paymentIveronika = paymentFeedShops.iveronika_cz || {};
  const paymentIveronikaSk = paymentFeedShops.iveronika_sk || {};
  const paymentGalantra = paymentFeedShops.galantra_cz || {};
  const packeta = settings.packeta || {};
  const dpd = settings.dpd || {};
  const packetaClients = packeta.clients || {};
  const packetaIveronika = packetaClients.iveronika_cz || {};
  const packetaGalantra = packetaClients.galantra_cz || {};
  const dpdClients = dpd.clients || {};
  const dpdIveronika = dpdClients.iveronika_cz || {};
  const dpdGalantra = dpdClients.galantra_cz || {};

  renderSettingsOverview(settings, {
    printAgent,
    productFeed,
    paymentIveronika,
    paymentIveronikaSk,
    paymentGalantra,
    packeta,
    packetaIveronika,
    packetaGalantra,
    dpd,
    dpdIveronika,
    dpdGalantra,
  });

  els.settingsMapyKey.value = "";
  els.settingsMapyStatus.textContent = mapy.hasApiKey ? "API key je uložený." : "API key zatím není uložený.";
  if (els.settingsPrintTestingMode) {
    els.settingsPrintTestingMode.checked = Boolean(printAgent.testingMode);
  }
  renderSecretInput(
    els.settingsProductFeedUrl,
    els.settingsProductFeedStatus,
    productFeed.hasUrl,
    productFeedStatusText(productFeed),
    productFeedStatusText(productFeed)
  );
  els.settingsProductFeedTimeout.value = productFeed.downloadTimeoutSeconds || 600;
  els.settingsProductFeedMaxMb.value = productFeed.maxDownloadMegabytes || 512;
  els.settingsPaymentLookback.value = paymentFeeds.lookbackDays || 10;
  if (els.settingsPaymentStatus) {
    const dateRange = paymentFeeds.dateRange || {};
    els.settingsPaymentStatus.textContent =
      dateRange.dateFrom && dateRange.dateUntil
        ? `Datumy se doplní automaticky: ${dateRange.dateFrom} až ${dateRange.dateUntil}.`
        : "Datumy se při kontrole plateb doplní automaticky.";
  }
  renderSecretInput(
    els.settingsPaymentIveronikaUrl,
    els.settingsPaymentIveronikaStatus,
    paymentIveronika.hasUrl,
    "CSV feed je uložený.",
    "CSV feed zatím není uložený."
  );
  renderSecretInput(
    els.settingsPaymentIveronikaSkUrl,
    els.settingsPaymentIveronikaSkStatus,
    paymentIveronikaSk.hasUrl,
    "CSV feed je uložený.",
    "CSV feed zatím není uložený."
  );
  renderSecretInput(
    els.settingsPaymentGalantraUrl,
    els.settingsPaymentGalantraStatus,
    paymentGalantra.hasUrl,
    "CSV feed je uložený.",
    "CSV feed zatím není uložený."
  );

  els.settingsPacketaUrl.value = packeta.apiUrl || "";
  els.settingsPacketaPassword.value = "";
  renderSecretInput(
    els.settingsPacketaIveronikaPassword,
    els.settingsPacketaIveronikaStatus,
    packetaIveronika.hasApiPassword,
    "API heslo je uložené.",
    "API heslo zatím není uložené."
  );
  renderSecretInput(
    els.settingsPacketaGalantraPassword,
    els.settingsPacketaGalantraStatus,
    packetaGalantra.hasApiPassword,
    "API heslo je uložené.",
    "API heslo zatím není uložené."
  );
  els.settingsPacketaStatus.textContent = [
    packeta.hasApiPassword ? "Výchozí API heslo je uložené." : "Výchozí API heslo zatím není uložené.",
    packetaIveronika.hasApiPassword ? "iVeronika.cz má uložené API heslo." : "iVeronika.cz zatím nemá API heslo.",
    packetaGalantra.hasApiPassword ? "Galantra.cz má uložené API heslo." : "Galantra.cz zatím nemá API heslo.",
  ].join(" ");

  els.settingsDpdUrl.value = dpd.apiBaseUrl || "https://geoapi.dpd.cz/v1";
  els.settingsDpdKey.value = "";
  els.settingsDpdCustomerDsw.value = dpd.customerDsw || "";
  els.settingsDpdCustomerId.value = dpd.customerId || "";
  renderSecretInput(
    els.settingsDpdIveronikaKey,
    els.settingsDpdIveronikaStatus,
    dpdIveronika.hasApiKey,
    "DPD API key je uložený.",
    "DPD API key zatím není uložený."
  );
  els.settingsDpdIveronikaCustomerDsw.value = dpdIveronika.customerDsw || "";
  els.settingsDpdIveronikaCustomerId.value = dpdIveronika.customerId || "";
  renderSecretInput(
    els.settingsDpdGalantraKey,
    els.settingsDpdGalantraStatus,
    dpdGalantra.hasApiKey,
    "DPD API key je uložený.",
    "DPD API key zatím není uložený."
  );
  els.settingsDpdGalantraCustomerDsw.value = dpdGalantra.customerDsw || "";
  els.settingsDpdGalantraCustomerId.value = dpdGalantra.customerId || "";
  els.settingsDpdShipmentType.value = dpd.shipmentType || "Standard";
  els.settingsDpdMode.value = dpd.mode || "test";
  els.settingsDpdEnabled.checked = Boolean(dpd.sendEnabled);
  els.settingsDpdNotification.checked = dpd.notification !== false;
  els.settingsDpdStatus.textContent = [
    dpd.hasApiKey ? "Výchozí DPD API key je uložený." : "Výchozí DPD API key zatím není uložený.",
    dpdIveronika.hasApiKey ? "iVeronika.cz má uložený DPD API key." : "iVeronika.cz zatím nemá DPD API key.",
    dpdGalantra.hasApiKey ? "Galantra.cz má uložený DPD API key." : "Galantra.cz zatím nemá DPD API key.",
  ].join(" ");

  els.settingsSenderName.value = dpd.senderName || "";
  els.settingsSenderStreet.value = dpd.senderStreet || "";
  els.settingsSenderHouse.value = dpd.senderHouseNumber || "";
  els.settingsSenderCity.value = dpd.senderCity || "";
  els.settingsSenderZip.value = dpd.senderZipCode || "";
  els.settingsSenderCountry.value = dpd.senderCountry || "CZ";
  els.settingsSenderContact.value = dpd.senderContactName || "";
  els.settingsSenderPhone.value = dpd.senderPhone || "";
  els.settingsSenderEmail.value = dpd.senderEmail || "";
}

async function loadSettings(options = {}) {
  if (!options.silent) {
    setSettingsMessage("Načítám nastavení...", "neutral");
  }
  try {
    const data = await fetchJson("/api/settings");
    settingsState.settings = data.settings || {};
    settingsState.loaded = true;
    renderSettings(settingsState.settings);
    if (!options.silent) {
      setSettingsMessage("Nastavení je načtené.", "success");
    }
  } catch (error) {
    if (options.silent) {
      console.warn("Nastavení vzhledu se nepodařilo načíst.", error);
      return;
    }
    setSettingsMessage(`Nastavení se nepodařilo načíst: ${error.message}`, "error");
  }
}

function collectSettings() {
  return {
    appearance: {
      font: uiFontKey(els.settingsUiFont?.value),
      completionDensity: completionDensityKey(els.settingsCompletionDensity?.value),
    },
    mapy: {
      apiKey: els.settingsMapyKey.value.trim(),
    },
    printAgent: {
      testingMode: Boolean(els.settingsPrintTestingMode?.checked),
    },
    productFeed: collectProductFeedSettings(),
    paymentFeeds: {
      lookbackDays: Number(els.settingsPaymentLookback.value) || 10,
      encoding: "windows-1250",
      delimiter: ";",
      shops: {
        iveronika_cz: {
          name: "iVeronika.cz",
          url: els.settingsPaymentIveronikaUrl.value.trim(),
        },
        iveronika_sk: {
          name: "iVeronika.sk",
          url: els.settingsPaymentIveronikaSkUrl.value.trim(),
        },
        galantra_cz: {
          name: "Galantra.cz",
          url: els.settingsPaymentGalantraUrl.value.trim(),
        },
      },
    },
    packeta: {
      apiUrl: els.settingsPacketaUrl.value.trim(),
      apiPassword: els.settingsPacketaPassword.value,
      clients: {
        iveronika_cz: {
          name: "iVeronika.cz",
          apiPassword: els.settingsPacketaIveronikaPassword.value,
        },
        galantra_cz: {
          name: "Galantra.cz",
          apiPassword: els.settingsPacketaGalantraPassword.value,
        },
      },
    },
    dpd: {
      apiBaseUrl: els.settingsDpdUrl.value.trim(),
      apiKey: els.settingsDpdKey.value,
      sendEnabled: els.settingsDpdEnabled.checked,
      mode: els.settingsDpdMode.value,
      customerDsw: els.settingsDpdCustomerDsw.value.trim(),
      customerId: els.settingsDpdCustomerId.value.trim(),
      clients: {
        iveronika_cz: {
          name: "iVeronika.cz",
          apiKey: els.settingsDpdIveronikaKey.value,
          customerDsw: els.settingsDpdIveronikaCustomerDsw.value.trim(),
          customerId: els.settingsDpdIveronikaCustomerId.value.trim(),
        },
        galantra_cz: {
          name: "Galantra.cz",
          apiKey: els.settingsDpdGalantraKey.value,
          customerDsw: els.settingsDpdGalantraCustomerDsw.value.trim(),
          customerId: els.settingsDpdGalantraCustomerId.value.trim(),
        },
      },
      shipmentType: els.settingsDpdShipmentType.value,
      notification: els.settingsDpdNotification.checked,
      senderName: els.settingsSenderName.value.trim(),
      senderStreet: els.settingsSenderStreet.value.trim(),
      senderHouseNumber: els.settingsSenderHouse.value.trim(),
      senderCity: els.settingsSenderCity.value.trim(),
      senderZipCode: els.settingsSenderZip.value.trim(),
      senderCountry: els.settingsSenderCountry.value.trim() || "CZ",
      senderContactName: els.settingsSenderContact.value.trim(),
      senderPhone: els.settingsSenderPhone.value.trim(),
      senderEmail: els.settingsSenderEmail.value.trim(),
    },
  };
}

async function saveSettings() {
  els.settingsSave.disabled = true;
  setSettingsMessage("Ukládám nastavení...", "neutral");
  try {
    const data = await fetchJson("/api/settings", {
      method: "POST",
      body: JSON.stringify({ settings: collectSettings() }),
    });
    settingsState.settings = data.settings || {};
    settingsState.loaded = true;
    renderSettings(settingsState.settings);
    resetProductImages();
    ensureProductImagesForCurrentData();
    setSettingsMessage("Nastavení je uložené.", "success");
  } catch (error) {
    setSettingsMessage(`Nastavení se nepodařilo uložit: ${error.message}`, "error");
  } finally {
    els.settingsSave.disabled = false;
  }
}

async function testProductFeed() {
  els.productFeedTest.disabled = true;
  els.settingsProductFeedStatus.classList.remove("settings-hint-ok", "settings-hint-missing");
  els.settingsProductFeedStatus.textContent = "Ověřuju produktový feed...";
  setSettingsMessage("Ověřuju produktový feed...", "neutral");
  try {
    const data = await fetchJson("/api/product-feed/check", {
      method: "POST",
      body: JSON.stringify({ productFeed: collectProductFeedSettings() }),
    });
    const imageColumns = (data.imageColumns || []).slice(0, 6).join(", ");
    const rowsSeen = Number(data.rowsSeen || 0).toLocaleString("cs-CZ");
    els.settingsProductFeedStatus.textContent =
      `Feed OK: ${rowsSeen} řádků, ${formatBytes(data.bytesRead)}, ` +
      `${data.fieldCount || 0} sloupců, obrázky: ${imageColumns || "nenalezeny"}.`;
    els.settingsProductFeedStatus.classList.add("settings-hint-ok");
    setSettingsMessage("Produktový feed je ověřený.", "success");
  } catch (error) {
    els.settingsProductFeedStatus.textContent = `Feed se nepodařilo ověřit: ${error.message}`;
    els.settingsProductFeedStatus.classList.add("settings-hint-missing");
    setSettingsMessage(`Produktový feed se nepodařilo ověřit: ${error.message}`, "error");
  } finally {
    els.productFeedTest.disabled = false;
  }
}

function completionRowElement(rowId) {
  return Array.from(els.completionBody.querySelectorAll("tr")).find(
    (row) => row.dataset.completionRowId === String(rowId)
  );
}

function collectCompletionRowEdits(rowId) {
  const values = {};
  els.completionBody.querySelectorAll("[data-field]").forEach((input) => {
    if (String(input.dataset.rowId) !== String(rowId)) return;
    values[input.dataset.field] = input.value.trim();
  });
  return values;
}

function replaceCompletionRow(row) {
  const index = completionState.rows.findIndex((item) => String(item.id) === String(row.id));
  if (index >= 0) completionState.rows[index] = row;
}

async function pollPaymentFeedUpdates() {
  if (!completionState.dataset?.id || els.completionView.classList.contains("hidden")) return;
  if (completionState.paymentPollInFlight) return;
  completionState.paymentPollInFlight = true;
  const datasetId = completionState.dataset.id;
  const params = new URLSearchParams({ datasetId });
  if (completionState.paymentUpdatesSince) {
    params.set("since", completionState.paymentUpdatesSince);
  }
  try {
    const data = await fetchJson(`/api/payment-feeds/updates?${params.toString()}`, { progress: false });
    completionState.paymentUpdatesSince = data.serverTime || new Date().toISOString();
    const rows = data.rows || [];
    if (!rows.length) return;
    await refreshCompletionRowsFromServer(datasetId, { progress: false });
    setCompletionMessage(`Platební stavy aktualizovány: ${rows.length} změn.`, "warning");
  } catch (error) {
    console.warn("Payment feed update polling failed", error);
  } finally {
    completionState.paymentPollInFlight = false;
  }
}

async function refreshCompletionRowsFromServer(datasetId, options = {}) {
  const data = await fetchJson(`/api/datasets/${encodeURIComponent(datasetId)}`, {
    progress: options.progress !== false,
  });
  if (!completionState.dataset || String(completionState.dataset.id) !== String(datasetId)) return;
  completionState.dataset = data.dataset || completionState.dataset;
  completionState.rows = data.rows || [];
  if (completionWorkflowState.row) {
    const currentWorkflowRow = completionState.rows.find((row) => String(row.id) === String(completionWorkflowState.row.id));
    if (currentWorkflowRow) {
      completionWorkflowState.row = currentWorkflowRow;
      renderWorkflowRow(currentWorkflowRow);
    }
  }
  renderCompletionOptions();
  renderCompletion();
}

async function syncPaymentFeedsManually() {
  if (!completionState.dataset?.id) {
    setCompletionMessage("Nejdřív načti expediční dávku kompletace.", "warning");
    return;
  }

  const datasetId = completionState.dataset.id;
  els.paymentFeedSync.disabled = true;
  setCompletionMessage("Páruji platby z e-shopových feedů...", "neutral");
  try {
    const data = await fetchJson("/api/payment-feeds/sync", {
      method: "POST",
      body: JSON.stringify({ source: "manual-completion" }),
    });
    completionState.paymentUpdatesSince = null;
    await pollPaymentFeedUpdates();
    const sync = data.sync || {};
    const errors = data.errors || sync.errors || [];
    const shopResults = data.shopResults || {};
    const shopText = Object.keys(shopResults).length
      ? ` Feedy: ${Object.entries(shopResults)
          .map(([shopCode, result]) => `${shopCode}: ${result.rowsSeen ?? 0} ř.`)
          .join(", ")}.`
      : "";
    const errorText = errors.length
      ? ` Chyby feedů: ${errors.map((item) => `${item.shopCode || "feed"}: ${item.error || "neznámá chyba"}`).join(" | ")}`
      : "";
    const refreshed = await fetchJson(`/api/datasets/${encodeURIComponent(datasetId)}`);
    applyCompletionDataset(refreshed.dataset || null, refreshed.rows || []);
    setCompletionMessage(
      `Platby spárovány: feed řádků ${data.rowsSeen ?? sync.rowsSeen ?? 0}, zkontrolováno ${data.rowsChecked ?? sync.rowsChecked ?? 0}, změněno ${data.rowsChanged ?? sync.rowsChanged ?? 0}.${shopText}${errorText}`,
      errors.length ? "warning" : "success"
    );
  } catch (error) {
    setCompletionMessage(`Platby se nepodařilo spárovat: ${error.message}`, "error");
  } finally {
    els.paymentFeedSync.disabled = !completionState.dataset;
  }
}

async function saveCompletionRow(rowId) {
  const values = collectCompletionRowEdits(rowId);
  setCompletionMessage("Ukládám kontakt, adresu a poznámku pro přepravce...", "neutral");

  try {
    const data = await fetchJson(`/api/completion/rows/${encodeURIComponent(rowId)}`, {
      method: "PATCH",
      body: JSON.stringify(values),
    });
    if (data.row) {
      replaceCompletionRow(data.row);
      renderCompletion();
    }
    setCompletionMessage("Kontakt, adresa a poznámka pro přepravce jsou uložené.", "success");
  } catch (error) {
    setCompletionMessage(`Uložení adresy se nepodařilo: ${error.message}`, "error");
  }
}

function dpdLabelNumberFromText(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const match = text.match(/\b\d{14}\b/);
  return match ? match[0] : "";
}

function completionLabelNumber(row) {
  return String(row?.packetaShipmentId || "").trim() || dpdLabelNumberFromText(row?.dpdOrderAndPieces);
}

async function sendCompletionCarrier(rowId) {
  const row = completionState.rows.find((item) => String(item.id) === String(rowId));
  const carrierLabel = row?.deliveryCarrierLabel || "dopravce";
  const orderNumber = row?.orderNumber || rowId;
  const alreadySent = completionLabelNumber(row) || row?.labelPrinted;
  const warning = alreadySent ? `\n\nPozor: řádek už má záznam štítku/zásilky (${alreadySent}).` : "";
  if (!window.confirm(`Odeslat objednávku ${orderNumber} do ${carrierLabel}?${warning}`)) return;

  const button = completionRowElement(rowId)?.querySelector(`[data-action="send-carrier-row"]`);
  if (button) button.disabled = true;
  setCompletionMessage(`Odesílám objednávku ${orderNumber} do ${carrierLabel}...`, "neutral");

  try {
    const data = await fetchJson(`/api/completion/rows/${encodeURIComponent(rowId)}/send-carrier`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    if (data.row) {
      replaceCompletionRow(data.row);
      renderCompletion();
    }
    const shipmentId = data.shipmentId ? `, zásilka ${data.shipmentId}` : "";
    setCompletionMessage(`Odesláno do ${carrierLabel}${shipmentId}.`, "success");
  } catch (error) {
    setCompletionMessage(`Odeslání do ${carrierLabel} se nepodařilo: ${error.message}`, "error");
  } finally {
    if (button) button.disabled = false;
  }
}

async function printCompletionCarrierLabel(rowId, setStatus = setCompletionMessage, options = {}) {
  const row = completionState.rows.find((item) => String(item.id) === String(rowId));
  const labelNumber = completionLabelNumber(row);
  if (!labelNumber) {
    setStatus("Řádek zatím nemá číslo zásilky/štítku.", "warning");
    return false;
  }
  if (!options.skipNoteConfirm && !confirmWorkflowOrderNoteBeforePrint(row)) {
    setStatus("Tisk zrušený: poznámka objednávky nebyla potvrzená.", "warning");
    return false;
  }

  const url = `/api/completion/rows/${encodeURIComponent(rowId)}/label?markPrinted=1`;
  const carrier = row.deliveryCarrier || (String(labelNumber).replace(/\D/g, "").length === 14 ? "dpd" : "packeta");
  setStatus(`Posílám štítek ${labelNumber} do lokálního tiskového agenta...`, "neutral");

  try {
    const result = await printPdfViaAgent({
      pdfUrl: url,
      type: "carrier_label",
      carrier,
      filename: `${labelNumber}.pdf`,
    });
    if (result.cancelled) {
      setStatus(`TESTOVÁNÍ: tisk štítku ${labelNumber} byl zrušen, nic se neposlalo na tiskárnu.`, "warning");
      return false;
    }
    row.labelPrinted = "Label printed";
    replaceCompletionRow(row);
    renderCompletion();
    renderWorkflow();
    setStatus(`Štítek ${labelNumber} odeslán na tiskárnu: ${result.printer}.`, "success");
    return true;
  } catch (error) {
    if (String(error.message || "").includes("cache") || String(error.message || "").includes("Stitek neni pripraveny")) {
      setStatus(`Štítek ${labelNumber} není připravený v serverové cache. Nejdřív spusť Připravit štítky dávky.`, "warning");
      return false;
    }
    let manualObjectUrl = "";
    try {
      const manualResponse = await fetch(url, { cache: "no-store", credentials: "same-origin" });
      if (!manualResponse.ok) {
        const errorText = await manualResponse.text().catch(() => "");
        if (errorText.includes("cache") || errorText.includes("Stitek neni pripraveny")) {
          setStatus(`Štítek ${labelNumber} není připravený v serverové cache. Nejdřív spusť Připravit štítky dávky.`, "warning");
          return false;
        }
        throw new Error(errorText || "PDF štítek se nepodařilo otevřít.");
      }
      manualObjectUrl = URL.createObjectURL(await manualResponse.blob());
    } catch (manualError) {
      setStatus(`Tiskový agent neběží a PDF se nepodařilo načíst z cache: ${manualError.message}`, "error");
      return false;
    }
    const printWindow = window.open(manualObjectUrl, "_blank", "noopener");
    if (!printWindow) {
      URL.revokeObjectURL(manualObjectUrl);
      setStatus(`Tiskový agent neběží a prohlížeč zablokoval otevření PDF: ${error.message}`, "error");
      return false;
    }
    row.labelPrinted = "Label printed";
    replaceCompletionRow(row);
    renderCompletion();
    renderWorkflow();
    setStatus(`Agent neběží (${error.message}). Štítek ${labelNumber} jsem otevřel jako PDF pro ruční tisk.`, "warning");
    return true;
  }
}

async function downloadCompletionCarrierLabel(rowId) {
  const row = completionState.rows.find((item) => String(item.id) === String(rowId));
  const labelNumber = completionLabelNumber(row);
  if (!labelNumber) {
    setCompletionMessage("Řádek zatím nemá číslo zásilky/štítku.", "warning");
    return;
  }

  const url = `/api/completion/rows/${encodeURIComponent(rowId)}/label?download=1`;
  setCompletionMessage(`Stahuji testovací PDF štítku ${labelNumber}...`, "neutral");
  try {
    const response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(errorText || "PDF štítek se nepodařilo stáhnout.");
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `${labelNumber}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
    setCompletionMessage(`Testovací PDF štítku ${labelNumber} staženo. Stav vytištění se nezměnil.`, "success");
  } catch (error) {
    setCompletionMessage(`Stažení testovacího PDF selhalo: ${error.message}`, "error");
  }
}

async function printCompletionIssueDocument(rowId, kind, setStatus = setCompletionMessage, options = {}) {
  const row = completionState.rows.find((item) => String(item.id) === String(rowId));
  const labels = {
    unpaid: "nezaplacenku",
    error: "errorku",
    unpaid_error: "nezaplaceno + error",
  };
  const label = labels[kind] || "kontrolní papír";
  const orderNumber = row?.orderNumber || rowId;
  if (!options.skipNoteConfirm && !confirmWorkflowOrderNoteBeforePrint(row)) {
    setStatus(`Tisk ${label} zrušený: poznámka objednávky nebyla potvrzená.`, "warning");
    return false;
  }
  const url = `/api/completion/rows/${encodeURIComponent(rowId)}/issue-document?kind=${encodeURIComponent(kind)}`;
  setStatus(`Tisknu ${label} pro objednávku ${orderNumber} na výchozí tiskárnu...`, "neutral");

  try {
    const result = await printPdfViaAgent({
      pdfUrl: url,
      type: "default",
      carrier: "",
      filename: `${kind}-${orderNumber}.pdf`,
    });
    if (result.cancelled) {
      setStatus(`TESTOVÁNÍ: tisk dokumentu pro objednávku ${orderNumber} byl zrušen.`, "warning");
      return;
    }
    setStatus(`Kontrolní papír byl odeslán na tiskárnu (${result.printer || "výchozí"}).`, "success");
  } catch (error) {
    window.open(url, "_blank", "noopener");
    setStatus(
      `Lokální tiskový agent netiskl (${error.message}). Otevřel jsem PDF pro ruční tisk.`,
      "warning"
    );
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

function applyAddressValidationResponse(row, data) {
  if (data.row) {
    replaceCompletionRow(data.row);
    return data.row;
  }
  row.addressValidationStatus = data.status || (data.valid ? "verified" : "suggestion");
  row.addressValidationMessage = data.message || "";
  row.addressValidationQuery = data.query || "";
  row.addressValidationCheckedAt = new Date().toISOString();
  row.addressValidationResult = data;
  if (data.appliedAddress) {
    row.streetWithNumber = data.appliedAddress.streetWithNumber || row.streetWithNumber || "";
    row.street = data.appliedAddress.street || row.street || "";
    row.houseNumber = data.appliedAddress.houseNumber || row.houseNumber || "";
    row.city = data.appliedAddress.city || row.city || "";
    row.zipCode = data.appliedAddress.zipCode || row.zipCode || "";
  }
  return row;
}

function completionAddressPayload(row, rowId) {
  const edited = collectCompletionRowEdits(rowId);
  return {
    rowId,
    firstName: row.firstName || "",
    lastName: row.lastName || "",
    streetWithNumber: row.streetWithNumber || "",
    street: row.street || "",
    houseNumber: row.houseNumber || "",
    city: row.city || "",
    zipCode: row.zipCode || "",
    shippingMethod: row.shippingMethod || "",
    currency: row.currency || "",
    shopCode: row.shopCode || completionState.dataset?.shopCode || "",
    ...edited,
  };
}

async function validateCompletionAddress(rowId) {
  const row = completionState.rows.find((item) => String(item.id) === String(rowId)) || {};
  setCompletionMessage("Ověřuji adresu přes Mapy.com...", "neutral");

  try {
    const data = await fetchJson("/api/address/validate", {
      method: "POST",
      body: JSON.stringify(completionAddressPayload(row, rowId)),
    });
    applyAddressValidationResponse(row, data);
    renderCompletion();
    const applied = data.appliedSuggestion ? " Návrh jsem rovnou propsal do adresy." : "";
    setCompletionMessage(
      data.valid ? `Adresa je ověřena přes Mapy.com.${applied}` : "Mapy.com našly jen návrh adresy.",
      data.valid ? "success" : "warning"
    );
  } catch (error) {
    const tr = completionRowElement(rowId);
    const target = tr?.querySelector("[data-address-validation]");
    if (target) target.innerHTML = `<span class="address-badge danger">Chyba</span><small>${escapeHtml(error.message)}</small>`;
    setCompletionMessage(`Ověření adresy se nepodařilo: ${error.message}`, "error");
  }
}

async function validateAddressRow(row) {
  const data = await fetchJson("/api/address/validate", {
    method: "POST",
    body: JSON.stringify(completionAddressPayload(row, row.id)),
  });
  applyAddressValidationResponse(row, data);
  return data;
}

async function validateAddressDeliveriesBulk() {
  if (!completionState.rows.length) {
    setCompletionMessage("Nejdřív načti kompletaci pro expediční den.", "warning");
    return;
  }

  const addressRows = completionState.rows.filter((row) => completionRequiresAddressValidation(row));
  if (!addressRows.length) {
    setCompletionMessage("V načtené kompletaci nevidím žádné objednávky s doručením na adresu.", "warning");
    return;
  }

  const rows = addressRows.filter((row) => !completionAddressIsResolvedOk(row));
  const skippedOk = addressRows.length - rows.length;
  if (!rows.length) {
    setCompletionMessage(`Všechny adresní zásilky už jsou ověřené a v pořádku (${skippedOk} přeskočeno).`, "success");
    showAddressValidationSummary({ checked: 0, skippedOk, failed: 0, addressErrors: 0, results: [] });
    return;
  }

  const confirmed = window.confirm(
    `Ověřit přes Mapy.com objednávky s doručením na adresu?\n\nNových dotazů: ${rows.length}\nJiž ověřené OK přeskočím: ${skippedOk}\n\nPo kontrole automaticky zobrazím chybné adresy.`
  );
  if (!confirmed) return;

  els.completionValidateAddresses.disabled = true;
  let checked = 0;
  let failed = 0;
  const results = [];
  const queue = rows.slice();
  const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length) {
      const row = queue.shift();
      try {
        const data = await validateAddressRow(row);
        results.push({ row, data });
      } catch (error) {
        row.addressValidationStatus = "error";
        row.addressValidationMessage = error.message || "Ověření adresy selhalo";
        row.addressValidationCheckedAt = new Date().toISOString();
        failed += 1;
      } finally {
        checked += 1;
        if (checked === rows.length || checked % 5 === 0) {
          setCompletionMessage(`Ověřuji adresy: ${checked}/${rows.length} hotovo...`, "neutral");
        }
      }
    }
  });

  try {
    await Promise.all(workers);
    const addressErrors = completionState.rows.filter((row) => completionRequiresAddressValidation(row) && completionAddressHasError(row)).length;
    completionFilters.status = "address_error";
    els.completionFilterStatus.value = "address_error";
    renderCompletion();
    loadAddressValidationLog();
    showAddressValidationSummary({ checked, skippedOk, failed, addressErrors, results });
    setCompletionMessage(
      `Kontrola adres hotová: ${checked} ověřeno, ${skippedOk} OK přeskočeno, ${addressErrors} problematických adres${failed ? `, ${failed} technických chyb` : ""}.`,
      addressErrors || failed ? "warning" : "success"
    );
  } finally {
    els.completionValidateAddresses.disabled = !completionState.dataset;
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
  if (!completionRowIsCod(row) && normalize(row.paidStatus).includes("nezaplaceno")) return { label: "NEZAPLACENO", tone: "warning" };
  if (row.completionStatus) return { label: row.completionStatus, tone: "neutral" };
  return { label: "čeká", tone: "neutral" };
}

function renderCompletionSummary(rows) {
  updateCompletionFlowFilterOptions(rows);
  const orders = new Set(rows.map((row) => row.orderNumber).filter(Boolean)).size;
  const pieces = rows.reduce((total, row) => total + Math.max(0, Math.trunc(toNumber(row.quantity, 0))), 0);
  const labels = rows.filter((row) => normalize(row.labelPrinted).includes("label printed")).length;
  const addressErrors = rows.filter((row) => completionRequiresAddressValidation(row) && completionAddressHasError(row)).length;
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
    <span><strong>${addressErrors}</strong> chyb adres</span>
    <span>${escapeHtml(shops || "bez e-shopu")}</span>
  `;
}

function addressValidationActionLabel(action) {
  const labels = {
    "address-cleaned": "Očištěná adresa",
    "address-replaced": "Přepsaná adresa",
    "address-completed": "Doplněná adresa",
    "carrier-note": "Pozn. přepravce",
    verified: "Ověřeno",
    suggestion: "Návrh",
    not_found: "Nenalezeno",
    error: "Chyba",
  };
  return labels[action] || action || "-";
}

function renderAddressValidationLog(logs = []) {
  if (!els.addressValidationLog) return;
  if (!logs.length) {
    els.addressValidationLog.innerHTML = `<p class="empty-log">Zatím tu nejsou žádné záznamy ověření adres.</p>`;
    return;
  }
  els.addressValidationLog.innerHTML = logs
    .map(
      (item) => `
        <article class="address-log-item ${escapeHtml(item.status || "")} ${item.revertedAt ? "reverted" : ""}">
          <strong>${escapeHtml(addressValidationActionLabel(item.action))}</strong>
          <span>${escapeHtml(formatTime(item.createdAt) || "")}</span>
          ${item.actorName ? `<small>Uživatel: ${escapeHtml(item.actorName)}</small>` : ""}
          <small>${escapeHtml(item.orderNumber || "-")} | ${escapeHtml(item.customerName || "-")}</small>
          <p>${escapeHtml(item.message || "")}</p>
          <small>${escapeHtml(item.originalAddress || "-")} → ${escapeHtml(item.resolvedAddress || "-")}</small>
          ${
            item.details?.cleanupOriginalStreet
              ? `<small>Očištěno: ${escapeHtml(item.details.cleanupOriginalStreet)} → ${escapeHtml(
                  item.details.cleanupStreet || "-"
                )}</small>`
              : ""
          }
          ${
            item.carrierNoteAfter
              ? `<small>Pozn. přepravce: ${escapeHtml(item.carrierNoteAfter)}</small>`
              : ""
          }
          ${item.revertedAt ? `<small>Vráceno: ${escapeHtml(formatTime(item.revertedAt) || "")} ${escapeHtml(item.revertedBy || "")}</small>` : ""}
          ${
            item.canRevert
              ? `<button type="button" class="secondary address-log-revert" data-action="revert-address-log" data-log-id="${escapeHtml(
                  item.id
                )}">Vrátit změnu</button>`
              : ""
          }
        </article>
      `
    )
    .join("");
}

async function loadAddressValidationLog() {
  if (!els.addressValidationLog) return;
  if (!completionState.dataset?.id) {
    renderAddressValidationLog([]);
    return;
  }
  els.addressValidationLog.innerHTML = `<p class="empty-log">Načítám log ověření adres...</p>`;
  try {
    const data = await fetchJson(
      `/api/address-validation-logs?datasetId=${encodeURIComponent(completionState.dataset.id)}&limit=40`
    );
    renderAddressValidationLog(data.logs || []);
  } catch (error) {
    els.addressValidationLog.innerHTML = `<p class="empty-log error">Log se nepodařilo načíst: ${escapeHtml(error.message)}</p>`;
  }
}

async function revertAddressValidationLog(logId) {
  if (!logId) return;
  if (!confirm("Vrátit adresu a poznámku pro přepravce do původního stavu podle tohoto logu?")) return;
  try {
    const data = await fetchJson(`/api/address-validation-logs/${encodeURIComponent(logId)}/revert`, {
      method: "POST",
    });
    if (data.row) {
      replaceCompletionRow(data.row);
      renderCompletion();
    }
    await loadAddressValidationLog();
    setCompletionMessage("Změna z logu byla vrácená.", "success");
  } catch (error) {
    setCompletionMessage(`Vrácení změny selhalo: ${error.message}`, "error");
  }
}

function addressValidationSummaryStats({ checked, skippedOk, failed, addressErrors, results }) {
  const verified = results.filter((item) => item.data?.valid).length;
  const replaced = results.filter((item) => item.data?.appliedSuggestion).length;
  const completed = results.filter((item) => item.data?.appliedAddressCompletion).length;
  const cleaned = results.filter((item) => item.data?.appliedAddressCleanup).length;
  const carrierNotes = results.filter((item) => item.data?.appliedCarrierNote).length;
  const notFound = results.filter((item) => item.data?.status === "not_found").length;
  return { checked, skippedOk, failed, addressErrors, verified, replaced, completed, cleaned, carrierNotes, notFound };
}

function showAddressValidationSummary(summary) {
  const stats = addressValidationSummaryStats(summary);
  document.querySelector(".address-summary-overlay")?.remove();

  const overlay = document.createElement("div");
  overlay.className = "address-summary-overlay";
  overlay.innerHTML = `
    <section class="address-summary-dialog" role="dialog" aria-modal="true" aria-labelledby="address-summary-title">
      <div class="address-summary-head">
        <div>
          <p class="eyebrow">Mapy.com</p>
          <h2 id="address-summary-title">Ověření adres je hotové</h2>
        </div>
        <button type="button" class="address-summary-close" data-address-summary-close aria-label="Zavřít">×</button>
      </div>
      <div class="address-summary-lead ${
        stats.addressErrors || stats.failed ? "warning" : "success"
      }">
        ${
          stats.checked
            ? `Zkontrolováno ${stats.checked} nových adres. Detailní audit je uložený dole v Logu ověření adres.`
            : `Všechny adresy už byly ověřené, takže nebylo potřeba znovu volat Mapy.com.`
        }
      </div>
      <div class="address-summary-grid">
        <article><span>${stats.checked}</span><strong>Nově zkontrolováno</strong></article>
        <article><span>${stats.skippedOk}</span><strong>OK přeskočeno</strong></article>
        <article class="ok"><span>${stats.verified}</span><strong>Ověřeno jako OK</strong></article>
        <article class="${stats.addressErrors ? "warning" : "ok"}"><span>${stats.addressErrors}</span><strong>Problematické adresy</strong></article>
      </div>
      <div class="address-summary-details">
        <h3>Co se upravilo</h3>
        <ul>
          <li><span>Přepsané návrhy adres</span><strong>${stats.replaced}</strong></li>
          <li><span>Doplněné chybějící údaje</span><strong>${stats.completed}</strong></li>
          <li><span>Očištěné adresy</span><strong>${stats.cleaned}</strong></li>
          <li><span>Doplněné poznámky pro přepravce</span><strong>${stats.carrierNotes}</strong></li>
          <li><span>Nenalezeno</span><strong>${stats.notFound}</strong></li>
          <li><span>Technické chyby volání</span><strong>${stats.failed}</strong></li>
        </ul>
      </div>
      <div class="address-summary-actions">
        <button type="button" class="secondary" data-address-summary-log>Přejít na log</button>
        <button type="button" data-address-summary-close>Zavřít</button>
      </div>
    </section>
  `;

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay || event.target.closest("[data-address-summary-close]")) {
      overlay.remove();
    }
    if (event.target.closest("[data-address-summary-log]")) {
      overlay.remove();
      els.addressValidationLog?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
  document.body.appendChild(overlay);
  overlay.querySelector("[data-address-summary-close]")?.focus();
}

function completionInput(row, field, value, className = "") {
  return `<input class="table-input ${escapeHtml(className)}" data-row-id="${escapeHtml(row.id)}" data-field="${escapeHtml(
    field
  )}" value="${escapeHtml(value || "")}" />`;
}

function completionMetaLine(label, value, className = "") {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return `<small class="${escapeHtml(className)}"><b>${escapeHtml(label)}:</b> ${escapeHtml(text)}</small>`;
}

function completionOrderAdminUrl(row) {
  const orderId = String(row?.orderId || "").trim();
  if (!orderId) return "";
  const shopCode = row?.shopCode || completionState.dataset?.shopCode || "";
  const domain = SHOP_ADMIN_DOMAINS[shopCode];
  if (!domain) return "";
  return `https://${domain}/admin/objednavky-detail/?id=${encodeURIComponent(orderId)}`;
}

function openCompletionOrder(row) {
  const url = completionOrderAdminUrl(row);
  if (!url) {
    setCompletionMessage("Objednávku nejde otevřít: chybí ID objednávky nebo doména e-shopu.", "warning");
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

function completionCarrierKey(row) {
  if (row.deliveryCarrier) return row.deliveryCarrier;
  if (row.deliveryIsDpd) return "dpd";
  if (row.deliveryIsPacketa) return "packeta";
  if (row.deliveryIsGiftVoucher) return "gift";
  return "manual";
}

function completionCarrierTone(row) {
  const carrier = completionCarrierKey(row);
  if (carrier === "dpd") return "carrier-dpd";
  if (carrier === "packeta") return "carrier-packeta";
  if (carrier === "gift") return "carrier-gift";
  return "carrier-manual";
}

function completionRowTone(row, status) {
  const tones = [completionCarrierTone(row)];
  if (status?.tone) tones.push(`status-${status.tone}`);
  const paymentTone = paymentCheckTone(row);
  if (paymentTone === "warning" || paymentTone === "danger") tones.push(`payment-${paymentTone}`);
  if (completionLabelNumber(row) || row.labelPrinted) tones.push("has-label");
  return tones.join(" ");
}

function completionMainBadges(row, status) {
  const badges = [
    `<span class="completion-type-badge ${escapeHtml(completionCarrierTone(row))}">${escapeHtml(
      row.deliveryCarrierLabel || "Ruční"
    )}</span>`,
    `<span class="status-chip ${escapeHtml(status.tone)}">${escapeHtml(status.label)}</span>`,
  ];
  if (completionLabelNumber(row) || row.labelPrinted) {
    badges.push(`<span class="completion-type-badge has-label">štítek</span>`);
  }
  const paymentBadge = paymentCheckHtml(row);
  if (paymentBadge) badges.push(paymentBadge);
  if (!completionRowIsCod(row) && (normalize(row.paidStatus).includes("nezaplaceno") || normalize(row.completionStatus).includes("nezaplaceno"))) {
    badges.push(`<span class="completion-type-badge payment-warning">nezapl.</span>`);
  }
  return badges.join("");
}

function completionSearchText(row) {
  return normalize(
    [
      row.orderNumber,
      row.orderId,
      row.expeditionNumber,
      row.expeditionOrderCode,
      row.firstName,
      row.lastName,
      row.streetWithNumber,
      row.street,
      row.houseNumber,
      row.city,
      row.zipCode,
      row.phone,
      row.email,
      row.shippingMethod,
      row.deliveryCarrierLabel,
      row.packetaShipmentId,
      row.dpdOrderAndPieces,
      row.packetaId,
      row.addressValidationStatus,
      row.addressValidationMessage,
      row.addressValidationQuery,
      row.carrierNote,
      row.note,
      row.shopCode,
    ].join(" ")
  );
}

function completionMatchesFilters(row) {
  const status = completionStatus(row);
  if (completionFilters.flow && completionFlowKind(row) !== completionFilters.flow) {
    return false;
  }
  if (completionFilters.search && !completionSearchText(row).includes(normalize(completionFilters.search))) {
    return false;
  }
  if (completionFilters.carrier && completionCarrierKey(row) !== completionFilters.carrier) {
    return false;
  }
  if (completionFilters.shop && (row.shopCode || completionState.dataset?.shopCode || "") !== completionFilters.shop) {
    return false;
  }
  if (completionFilters.status === "label") {
    return Boolean(completionLabelNumber(row) || row.labelPrinted);
  }
  if (completionFilters.status === "address_error") {
    return completionRequiresAddressValidation(row) && completionAddressHasError(row);
  }
  if (completionFilters.status === "open") {
    return !row.completionStatus && status.tone !== "ok" && !completionLabelNumber(row) && !row.labelPrinted;
  }
  if (completionFilters.status && status.tone !== completionFilters.status) {
    return false;
  }
  return true;
}

function filteredCompletionRows() {
  return completionState.rows.filter((row) => completionMatchesFilters(row));
}

function renderCompletionFilterOptions(rows) {
  const carrierOptions = new Map();
  const shopOptions = new Map();
  rows.forEach((row) => {
    carrierOptions.set(completionCarrierKey(row), row.deliveryCarrierLabel || completionCarrierKey(row));
    const shop = row.shopCode || completionState.dataset?.shopCode || "";
    if (shop) shopOptions.set(shop, shop);
  });

  const currentCarrier = completionFilters.carrier;
  const currentShop = completionFilters.shop;
  els.completionFilterCarrier.innerHTML = `<option value="">Všichni dopravci</option>${Array.from(carrierOptions.entries())
    .sort((a, b) => a[1].localeCompare(b[1], "cs"))
    .map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`)
    .join("")}`;
  els.completionFilterShop.innerHTML = `<option value="">Všechny e-shopy</option>${Array.from(shopOptions.keys())
    .sort((a, b) => a.localeCompare(b, "cs"))
    .map((shop) => `<option value="${escapeHtml(shop)}">${escapeHtml(shop)}</option>`)
    .join("")}`;
  els.completionFilterCarrier.value = currentCarrier;
  els.completionFilterShop.value = currentShop;
}

function completionProductPreviewItems(row) {
  const items = [
    ...workflowSortingItems(row),
    ...completionStructuredProductItems(row),
    ...completionTextProductItems(row),
  ];
  const seen = new Set();
  return items.filter((item, index) => {
    const key = [item.variantCode, item.productCode, item.productName, item.variant]
      .map((value) => normalize(String(value || "")))
      .join("|");
    if (seen.has(key)) return false;
    seen.add(key || `product-${index}`);
    return true;
  });
}

function completionProductImagesHtml(row, limit = 4) {
  const items = completionProductPreviewItems(row).filter((item) => productImageForItem(item));
  if (!state.settings.showImages || !items.length) return "";
  const visible = items.slice(0, limit);
  const hiddenCount = Math.max(0, items.length - visible.length);
  return `
    <div class="completion-product-images" aria-label="Obrázky produktů">
      ${visible.map((item) => productImageHtml(item, "completion-product-image")).join("")}
      ${hiddenCount ? `<span class="product-image-more">+${escapeHtml(hiddenCount)}</span>` : ""}
    </div>
  `;
}

function completionProductListHtml(row) {
  const items = completionProductPreviewItems(row);
  if (!items.length) return `<div class="completion-product-empty">Produkty nejsou v řádku čitelně rozepsané.</div>`;
  return `
    <div class="completion-product-list">
      ${items
        .map((item) => {
          const code = item.variantCode || item.productCode || "-";
          const image = productImageHtml(item, "completion-detail-product-image");
          return `
            <div class="completion-product-item">
              ${image || ""}
              <div>
                <strong class="code">${escapeHtml(code)}</strong>
                <span>${escapeHtml(item.productName || item.info || "Položka objednávky")}</span>
                <small>${escapeHtml(item.variant || [item.color, item.size].filter(Boolean).join(" / ") || "Bez varianty")}</small>
              </div>
              <b>${escapeHtml(item.initialQuantity || item.quantity || 1)} ks</b>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function completionDetailHtml(row) {
  const editableAddress = row.streetWithNumber || [row.street, row.houseNumber].filter(Boolean).join(" ");
  return `
    <div class="completion-detail-grid">
      <section class="completion-products-section">
        <h3>Produkty</h3>
        ${completionProductListHtml(row)}
      </section>
      <section>
        <h3>Kontakt a adresa</h3>
        <div class="completion-detail-fields">
          ${completionInput(row, "streetWithNumber", editableAddress, "address-input")}
          <div class="completion-inline-inputs">
            ${completionInput(row, "city", row.city || "", "city-input")}
            ${completionInput(row, "zipCode", row.zipCode || "", "zip-input")}
          </div>
          <div class="completion-inline-inputs">
            ${completionInput(row, "street", row.street || "", "street-input")}
            ${completionInput(row, "houseNumber", row.houseNumber || "", "house-input")}
          </div>
          ${completionInput(row, "phone", row.phone || "", "phone-input")}
          ${completionInput(row, "email", row.email || "", "email-input")}
        </div>
      </section>
      <section>
        <h3>Doprava a štítky</h3>
        ${completionMetaLine("Doprava", row.shippingMethod)}
        ${completionMetaLine("Dopravce", row.deliveryCarrierLabel)}
        ${completionMetaLine("Zásilkovna ID", row.packetaId, "code")}
        ${completionMetaLine("ID zásilky", row.packetaShipmentId, "code")}
        ${completionMetaLine("Stav Zásilkovna", row.packetaStatus)}
        ${completionMetaLine("Štítek", row.labelPrinted)}
        ${completionMetaLine("DPD", row.dpdFlag)}
        ${completionMetaLine("DPD štítek", row.dpdOrderAndPieces, "code")}
        ${completionMetaLine("Poznámka pro přepravce", row.carrierNote)}
      </section>
      <section>
        <h3>Objednávka</h3>
        ${completionMetaLine("Objednávka", row.orderNumber, "code")}
        ${completionMetaLine("ID objednávky", row.orderId, "code")}
        ${completionMetaLine("Kód pořadí", row.expeditionOrderCode, "code")}
        ${completionMetaLine("Datum", row.orderDate, "code")}
        ${completionMetaLine("E-shop", row.shopCode || completionState.dataset?.shopCode)}
        ${completionMetaLine("Měna", row.currency)}
        ${completionMetaLine("Dobírka", row.codAmount)}
      </section>
      <section>
        <h3>Poznámky</h3>
        ${completionInput(row, "carrierNote", row.carrierNote || "", "carrier-note-input")}
        ${completionMetaLine("Poznámka pro přepravce", row.carrierNote)}
        <p>${escapeHtml(row.note || "Bez poznámky.")}</p>
        ${completionMetaLine("Status kompletace", row.completionStatus)}
        ${completionMetaLine("Platba", row.paymentMethod || row.paidStatus)}
        ${completionMetaLine("Kontrola platby", [paymentCheckLabel(row), row.paymentCheckMessage].filter(Boolean).join(" - "))}
        ${completionMetaLine("Status z feedu", row.paymentCheckSourceStatus)}
        ${completionMetaLine("Zrušená záloha", row.canceledOrderBackup)}
      </section>
    </div>
  `;
}

function addressValidationHtml(row) {
  const status = row.addressValidationStatus || "";
  const message = row.addressValidationMessage || "";
  const checked = row.addressValidationCheckedAt ? formatTime(row.addressValidationCheckedAt) : "";
  const mapyUrl = mapyAddressUrl(row);
  const labels = {
    verified: ["Ověřeno", "ok"],
    suggestion: ["Návrh", "warning"],
    not_found: ["Nenalezeno", "danger"],
    error: ["Chybná adresa", "danger"],
  };
  const [label, tone] = labels[status] || ["Neověřeno", "neutral"];
  return `
    <div class="address-validation" data-address-validation="${escapeHtml(row.id)}">
      <div class="address-validation-top">
        <span class="address-badge ${escapeHtml(tone)}">${escapeHtml(label)}</span>
        <a class="mapy-link" href="${escapeHtml(mapyUrl)}" target="_blank" rel="noopener">Mapy</a>
      </div>
      ${message ? `<small>${escapeHtml(message)}${checked ? ` | ${escapeHtml(checked)}` : ""}</small>` : ""}
    </div>
  `;
}

function completionAddressStatus(row) {
  return row.addressValidationStatus || "";
}

function completionAddressHasError(row) {
  const status = completionAddressStatus(row);
  return status === "suggestion" || status === "not_found" || status === "error";
}

function completionAddressIsResolvedOk(row) {
  const result = row.addressValidationResult || {};
  return completionAddressStatus(row) === "verified" || result.valid === true;
}

function completionRequiresAddressValidation(row) {
  if (row.deliveryIsGiftVoucher) return false;
  if (row.deliveryRequiresAddress === true) return true;
  const shipping = normalize(row.shippingMethod || row.deliveryServiceLabel || "");
  if (!shipping) return false;
  if (shipping.includes("vydej") || shipping.includes("box") || shipping.includes("poboc") || shipping.includes("odberne misto")) {
    return false;
  }
  return shipping.includes("adresa") || shipping.includes("kuryr") || shipping.includes("kurier") || completionCarrierKey(row) === "dpd";
}

function rowAddressQuery(row) {
  const street = row.streetWithNumber || [row.street, row.houseNumber].filter(Boolean).join(" ");
  return [street, row.zipCode, row.city].filter(Boolean).join(", ");
}

function firstMapyResult(row) {
  const result = row.addressValidationResult || {};
  const items = Array.isArray(result.items) ? result.items : [];
  return items[0] || null;
}

function mapyCoordinate(result, keys) {
  if (!result) return "";
  for (const key of keys) {
    if (result[key] !== undefined && result[key] !== null && result[key] !== "") return result[key];
  }
  const position = result.position || result.coords || result.coordinates || {};
  for (const key of keys) {
    if (position[key] !== undefined && position[key] !== null && position[key] !== "") return position[key];
  }
  return "";
}

function mapyAddressUrl(row) {
  const result = firstMapyResult(row);
  const query = result
    ? [result.name, result.location, result.zip].filter(Boolean).join(", ") || rowAddressQuery(row)
    : rowAddressQuery(row);
  const params = new URLSearchParams();
  params.set("q", query || row.orderNumber || "adresa");

  const source = result?.source || result?.sourceType || result?.type || "";
  const id = result?.id || result?.sourceId || result?.addrId || "";
  const x = mapyCoordinate(result, ["x", "lon", "lng", "longitude"]);
  const y = mapyCoordinate(result, ["y", "lat", "latitude"]);
  if (source && id) {
    params.set("source", source);
    params.set("id", id);
    params.set("ds", "1");
  }
  if (x && y) {
    params.set("x", x);
    params.set("y", y);
    params.set("z", "17");
  }
  return `https://mapy.com/sk/zakladni?${params.toString()}`;
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

function labelCacheStatusHtml(row) {
  if (!completionLabelNumber(row)) return "";
  const status = row.labelCacheStatus || "";
  if (status === "ready") {
    return `<span class="label-cache-chip ready" title="PDF štítek je připravený na serveru">v cache</span>`;
  }
  if (status === "error") {
    return `<span class="label-cache-chip error" title="${escapeHtml(row.labelCacheError || "Stažení štítku selhalo")}">chyba cache</span>`;
  }
  return `<span class="label-cache-chip missing" title="PDF štítek zatím není připravený na serveru">chybí cache</span>`;
}

function carrierSendActionHtml(row) {
  const carrier = row.deliveryCarrier || "manual";
  const labelNumber = completionLabelNumber(row);
  if ((carrier === "dpd" || carrier === "packeta") && labelNumber) {
    return `
      <div class="carrier-actions">
        <button type="button" class="label-print ${escapeHtml(carrier)}" data-action="print-carrier-label" data-row-id="${escapeHtml(
      row.id
    )}">Tisk štítku</button>
        <button type="button" class="secondary label-download" data-action="download-carrier-label" data-row-id="${escapeHtml(
      row.id
    )}">Test PDF</button>
        ${labelCacheStatusHtml(row)}
      </div>
    `;
  }
  if (authState.user?.role !== "admin") return "";
  if (paymentCheckKind(row) === "storno") {
    return `<button type="button" class="secondary" disabled>STORNO</button>`;
  }
  if (carrier !== "dpd" && carrier !== "packeta") {
    return `<button type="button" class="secondary" disabled>Bez dopravce</button>`;
  }
  const label = carrier === "dpd" ? "Odeslat DPD" : "Odeslat Zás.";
  return `<button type="button" class="carrier-send ${escapeHtml(carrier)}" data-action="send-carrier-row" data-row-id="${escapeHtml(
    row.id
  )}">${label}</button>`;
}

const PRINT_AGENT_URL = localStorage.getItem("expedicePrintAgentUrl") || "http://127.0.0.1:8787";

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 1200) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

async function isPrintAgentTestingModeEnabled() {
  if (authState.user?.role !== "admin") return false;
  if (els.settingsPrintTestingMode?.checked) return true;

  if (!settingsState.loaded || !settingsState.settings) {
    try {
      const data = await fetchJson("/api/settings");
      settingsState.settings = data.settings || {};
      settingsState.loaded = true;
      renderSettings(settingsState.settings);
    } catch (error) {
      console.warn("Nastavení testovacího tisku se nepodařilo načíst.", error);
      return false;
    }
  }

  return Boolean(settingsState.settings?.printAgent?.testingMode);
}

async function confirmPrintAgentJob({ type, carrier, filename }) {
  if (!(await isPrintAgentTestingModeEnabled())) return true;

  const lines = [
    "TESTOVÁNÍ TISKU",
    "",
    "Opravdu poslat tento dokument na tiskárnu?",
    "",
    `Soubor: ${filename || "-"}`,
    `Typ: ${type || "-"}`,
  ];
  if (carrier) lines.push(`Dopravce: ${carrier}`);
  lines.push("", "OK = tisknout, Storno = netisknout.");
  return window.confirm(lines.join("\n"));
}

async function printPdfViaAgent({ pdfUrl, type, carrier, filename }) {
  if (!(await confirmPrintAgentJob({ type, carrier, filename }))) {
    return { ok: true, cancelled: true, printer: "" };
  }

  const health = await fetchWithTimeout(`${PRINT_AGENT_URL}/health`, { cache: "no-store" }, 900);
  if (!health.ok) throw new Error("Lokální tiskový agent neběží.");

  const pdfResponse = await fetch(pdfUrl, { cache: "no-store", credentials: "same-origin" });
  if (!pdfResponse.ok) {
    const errorText = await pdfResponse.text().catch(() => "");
    throw new Error(errorText || "PDF štítek se nepodařilo stáhnout.");
  }

  const contentBase64 = arrayBufferToBase64(await pdfResponse.arrayBuffer());
  const printResponse = await fetchWithTimeout(
    `${PRINT_AGENT_URL}/print`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type,
        carrier,
        filename,
        contentBase64,
        copies: 1,
      }),
    },
    30000
  );
  const data = await printResponse.json().catch(() => ({}));
  if (!printResponse.ok || !data.ok) {
    throw new Error(data.error || "Tiskový agent vrátil chybu.");
  }
  return data;
}

async function testPrintAgent() {
  if (!els.printAgentStatus) return;
  els.printAgentStatus.textContent = "Zkouším spojení s lokálním tiskovým agentem...";
  els.printAgentStatus.classList.remove("settings-hint-ok", "settings-hint-missing");
  try {
    const response = await fetchWithTimeout(`${PRINT_AGENT_URL}/health`, { cache: "no-store" }, 1200);
    if (!response.ok) throw new Error("Agent neodpověděl v pořádku.");
    const data = await response.json();
    const printers = data.config?.printers || {};
    els.printAgentStatus.classList.add("settings-hint-ok");
    els.printAgentStatus.textContent = `Agent běží (${data.version || "?"}). SumatraPDF: ${
      data.sumatraAvailable ? "ano" : "ne"
    }. DPD: ${printers.dpdLabel || "výchozí"}, Zásilkovna: ${printers.packetaLabel || "výchozí"}, dokumenty: ${
      printers.defaultDocument || "výchozí Windows tiskárna"
    }.`;
  } catch (error) {
    els.printAgentStatus.classList.add("settings-hint-missing");
    els.printAgentStatus.textContent = `Agent neběží nebo není dostupný: ${error.message}`;
  }
}

function parseWorkflowBoxCode(value) {
  const text = String(value || "").trim().toUpperCase();
  const boxBarcodeNumber = parseWorkflowBoxBarcode(text);
  if (boxBarcodeNumber) return boxBarcodeNumber;
  if (/^\d+$/.test(text)) return text;
  return "";
}

function parseWorkflowBoxBarcode(value) {
  const text = String(value || "").trim().toUpperCase();
  const boxMatch = text.match(/X\s*(\d+)\s*S/);
  return boxMatch ? boxMatch[1] : "";
}

function focusWorkflowBoxCodeInput() {
  if (!els.workflowBoxCode) return;
  requestAnimationFrame(() => {
    els.workflowBoxCode.focus({ preventScroll: true });
    els.workflowBoxCode.select?.();
  });
}

function workflowRowsSorted() {
  return [...completionState.rows]
    .filter((row) => row.expeditionNumber || row.expeditionOrderCode)
    .sort((a, b) => toNumber(a.expeditionNumber || a.expeditionOrderCode, 0) - toNumber(b.expeditionNumber || b.expeditionOrderCode, 0));
}

function normalizeWorkflowNumber(number) {
  return String(number || "").replace(/^0+/, "");
}

function findWorkflowRowByNumber(number) {
  const normalized = normalizeWorkflowNumber(number);
  return workflowRowsSorted().find((row) => {
    const expeditionNumber = normalizeWorkflowNumber(row.expeditionNumber || row.expeditionOrderCode);
    return expeditionNumber === normalized;
  });
}

function workflowExpeditionNumberText(row) {
  return row?.expeditionNumber || row?.expeditionOrderCode || "";
}

function setWorkflowExpeditionNumberText(value) {
  if (!els.workflowExpeditionNumber) return;
  if ("value" in els.workflowExpeditionNumber) {
    els.workflowExpeditionNumber.value = value || "";
  } else {
    els.workflowExpeditionNumber.textContent = value || "-";
  }
}

function workflowStatusTone(row) {
  const status = normalize(row?.completionStatus || "");
  const paymentStatus = paymentCheckKind(row);
  if (!row) return "neutral";
  if (paymentStatus === "storno" || status.includes("storno")) return "storno";
  if (status.includes("error") || status.includes("chyba")) return "danger";
  if (status.includes("nezaplac")) return "warning";
  if (["unpaid", "missing", "unknown"].includes(paymentStatus)) return "warning";
  return "ok";
}

function workflowPaymentText(row) {
  if (!row) return "Platba: -";
  const cod = String(row.codAmount || "").trim();
  const currency = row.currency || "";
  const paymentLabel = paymentCheckLabel(row);
  const payment = row.paymentMethod || row.paidStatus || "";
  if (paymentLabel) return `Kontrola platby: ${paymentLabel}`;
  if (toNumber(cod, 0) > 0) return `Dobírka: ${cod} ${currency}`.trim();
  return `Platba: ${payment || "bez dobírky"}`;
}

function workflowAutoPrintKey(row) {
  return `${completionState.dataset?.id || "dataset"}:${row?.id || row?.orderNumber || ""}`;
}

function workflowIsUnpaid(row) {
  if (completionRowIsCod(row)) return false;
  const paymentStatus = paymentCheckKind(row);
  if (paymentStatus === "unpaid" || paymentStatus === "missing" || paymentStatus === "unknown") return true;
  if (paymentStatus === "paid" || paymentStatus === "cod" || paymentStatus === "storno") return false;
  const text = normalize(
    [
      row?.paidStatus,
      row?.paymentStatus,
      row?.paymentMethod,
      row?.completionStatus,
      row?.packetaStatus,
      row?.note,
    ]
      .filter(Boolean)
      .join(" ")
  );
  return (
    text.includes("nezaplac") ||
    text.includes("neuhrazen") ||
    text.includes("neuhraden") ||
    text.includes("caka na platbu") ||
    text.includes("ceka na platbu") ||
    text.includes("pripominka platby")
  );
}

async function autoPrintWorkflowDocuments(row, boxNumber) {
  if (!row?.id) return;
  const key = workflowAutoPrintKey(row);
  if (workflowAutoPrintedRows.has(key)) {
    setWorkflowMessage(`Načten box X${boxNumber}S: objednávka ${row.orderNumber || "-"}. Automatický tisk už v této relaci proběhl.`, "warning");
    return;
  }

  if (paymentCheckKind(row) === "storno") {
    setWorkflowMessage(`Načten box X${boxNumber}S: objednávka ${row.orderNumber || "-"} je STORNO. Netisknu štítek.`, "error");
    return;
  }

  const hasCarrierLabel = Boolean(completionLabelNumber(row));
  const needsUnpaidDocument = workflowIsUnpaid(row);
  if (!hasCarrierLabel && !needsUnpaidDocument) return;

  workflowAutoPrintedRows.add(key);
  const printed = [];
  if (hasCarrierLabel) {
    const labelPrinted = await printCompletionCarrierLabel(row.id, setWorkflowMessage, { skipNoteConfirm: true });
    if (labelPrinted) printed.push("štítek dopravce");
  }
  if (needsUnpaidDocument) {
    await printCompletionIssueDocument(row.id, "unpaid", setWorkflowMessage, { skipNoteConfirm: true });
    printed.push("nezaplacenka");
  }
  if (printed.length) {
    setWorkflowMessage(
      `Načten box X${boxNumber}S: objednávka ${row.orderNumber || "-"}. Automaticky odesláno k tisku: ${printed.join(" + ")}.`,
      "success"
    );
  }
}

function workflowCountryText(row) {
  if (!row) return "-";
  const currency = row?.currency || "";
  if (currency === "EUR" || normalize(row?.shippingMethod || "").includes("packeta.sk")) return "SLOVENSKO";
  return "ČESKÁ REPUBLIKA";
}

function workflowSortingItems(row) {
  if (Array.isArray(row?.workflowSortingItems)) {
    return applyCompletionOrderQuantitiesToSortingItems(row, row.workflowSortingItems);
  }
  const orderNumber = normalize(row?.orderNumber || "").trim();
  if (!orderNumber) return [];
  const items = (state.items || []).filter((item) => normalize(item.orderNumber || "").trim() === orderNumber);
  return applyCompletionOrderQuantitiesToSortingItems(row, items);
}

function workflowSortingCheck(row) {
  if (!row) {
    return {
      requiresSorting: false,
      ok: false,
      tone: "neutral",
      label: "Čekám na box",
      message: "Po načtení boxu zkontroluji souvislost s roztříděním.",
      items: [],
      remainingTotal: 0,
      initialTotal: 0,
    };
  }

  const flowKind = completionFlowKind(row);
  if (flowKind === "unknown") {
    return {
      requiresSorting: false,
      ok: false,
      tone: "warning",
      label: "Neurčený typ práce",
      message: "Kód pořadí není čitelný, ověř prosím ručně, zda má objednávka jít přes roztřídění.",
      items: [],
      remainingTotal: 0,
      initialTotal: 0,
    };
  }

  const items = workflowSortingItems(row);
  const sortingDataset = row.workflowSortingDataset || sortingState.dataset;
  const remainingTotal = items.reduce((total, item) => total + Math.max(0, Math.trunc(toNumber(item.remaining, 0))), 0);
  const initialTotal = items.reduce((total, item) => {
    const lineQuantity = workflowItemLineQuantity(item);
    if (lineQuantity) return total + lineQuantity;
    const initial = toNumber(item.initialQuantity, NaN);
    const fallback = toNumber(item.quantity, toNumber(item.remaining, 0));
    return total + Math.max(0, Math.trunc(Number.isFinite(initial) ? initial : fallback));
  }, 0);

  if (row.workflowSortingError) {
    return {
      requiresSorting: flowKind === "sorting",
      ok: false,
      tone: "warning",
      label: "Roztřídění nelze ověřit",
      message: `Aktuální stav z databáze se nepodařilo načíst: ${row.workflowSortingError}`,
      items,
      remainingTotal,
      initialTotal,
    };
  }
  if (!items.length) {
    return {
      requiresSorting: flowKind === "sorting",
      ok: false,
      tone: "danger",
      label: "Položky objednávky nenalezeny",
      message: sortingDataset
        ? "Položky objednávky v Roztřídění nenalezeny."
        : "Pro tento expediční den není načtená aktivní dávka roztřídění.",
      items: [],
      remainingTotal: 0,
      initialTotal: 0,
    };
  }

  if (flowKind === "stock") {
    return {
      requiresSorting: false,
      ok: true,
      tone: "ok",
      label: "Samostatná skladovka",
      message: "Kód pořadí je pod 2, položky z Roztřídění slouží jen k fyzické kontrole boxu.",
      items,
      remainingTotal,
      initialTotal,
    };
  }

  const ok = remainingTotal === 0;
  return {
    requiresSorting: true,
    ok,
    tone: ok ? "ok" : "danger",
    label: ok ? "Roztřídění OK" : "Roztřídění není hotové",
    message: ok
      ? "Všechny položky objednávky jsou v roztřídění odepsané."
      : `Z roztřídění ještě zbývá odepsat ${remainingTotal} ks. Dej jako errorku a řeš individuálně.`,
    items,
    remainingTotal,
    initialTotal,
  };
}

function workflowChecklistKey(item, index) {
  const base = item.datasetRowId || item.id || item.variantCode || item.productCode || item.orderNumber || "item";
  return `${String(base).replace(/[^a-zA-Z0-9_-]/g, "_")}-${index}`;
}

function normalizeWorkflowPhysicalItem(item, index, fallbackRow = null) {
  if (typeof item === "string") {
    return {
      datasetRowId: `text-${index}`,
      variantCode: fallbackRow?.orderNumber || "-",
      variant: "",
      productName: item,
      initialQuantity: fallbackRow?.quantity || 1,
      remaining: null,
      physicalOnly: true,
    };
  }
  const color = item.color || item.colour || item.barva || item["Barva"] || "";
  const size = item.size || item.velikost || item["Velikost"] || "";
  const variant = item.variant || item.variantName || item.varianta || [color, size].filter(Boolean).join(" / ");
  const hasSortingContext =
    item.lineQuantity !== undefined ||
    item.sortingInitialQuantity !== undefined ||
    item.remaining !== undefined ||
    item.datasetRowId !== undefined;
  const itemQuantity =
    workflowQuantityFromValue(item.lineQuantity) ||
    workflowQuantityFromValue(item.initialQuantity) ||
    workflowQuantityFromValue(item.quantity) ||
    workflowQuantityFromValue(item.quantityText) ||
    workflowQuantityFromValue(item.mnozstvi) ||
    workflowQuantityFromValue(item["Množství"]) ||
    workflowQuantityFromValue(item.pocet) ||
    workflowQuantityFromValue(item["Počet"]) ||
    workflowQuantityFromValue(item.count) ||
    workflowQuantityFromValue(item.qty);
  return {
    ...item,
    datasetRowId: item.datasetRowId || item.id || `physical-${fallbackRow?.id || fallbackRow?.orderNumber || "row"}-${index}`,
    variantCode: item.variantCode || item.productCode || item.sku || item.code || item.kod || item["Kód"] || fallbackRow?.orderNumber || "-",
    variant,
    color,
    size,
    productName:
      item.productName ||
      item.product_name ||
      item.name ||
      item.title ||
      item.nazev ||
      item["Název"] ||
      item.info ||
      item.description ||
      fallbackRow?.note ||
      "Položka objednávky",
    initialQuantity: itemQuantity || (hasSortingContext ? 1 : fallbackRow?.quantity || 1),
    remaining: item.remaining ?? null,
    physicalOnly: Boolean(item.physicalOnly),
  };
}

function normalizedObjectValue(object, keys) {
  if (!object || typeof object !== "object") return "";
  for (const key of keys) {
    if (object[key] !== undefined && object[key] !== null && String(object[key]).trim() !== "") return object[key];
  }
  const wanted = new Set(keys.map((key) => normalize(String(key)).replace(/[^a-z0-9]/g, "")));
  for (const [key, value] of Object.entries(object)) {
    const normalizedKey = normalize(String(key)).replace(/[^a-z0-9]/g, "");
    if (wanted.has(normalizedKey) && value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function parseCompletionProductLine(line, row, index) {
  const cleanLine = String(line || "")
    .replace(/^ERROR:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleanLine) return null;
  const match =
    cleanLine.match(/^([A-Z0-9][A-Z0-9-]{2,})\s+(.+?)\s+(\d+)\s*x\s+(.+)$/i) ||
    cleanLine.match(/^([A-Z0-9][A-Z0-9-]{2,})\s+(.+?)\s+(\d+)\s*ks\s+(.+)$/i);
  if (!match) return null;
  const variantPart = match[2].trim();
  const variantParts = variantPart.split("/").map((part) => part.trim()).filter(Boolean);
  return normalizeWorkflowPhysicalItem(
    {
      datasetRowId: `parsed-${row.id || row.orderNumber || "row"}-${index}`,
      variantCode: match[1].trim(),
      color: variantParts[0] || "",
      size: variantParts.slice(1).join(" / "),
      variant: variantPart,
      initialQuantity: match[3],
      productName: match[4].trim(),
      physicalOnly: true,
    },
    index,
    row
  );
}

function completionTextProductItems(row) {
  const values = [];
  const raw = row?.raw && typeof row.raw === "object" ? row.raw : {};
  Object.values(raw).forEach((value) => {
    if (typeof value === "string") values.push(value);
  });
  (row?.cells || []).forEach((value) => {
    if (typeof value === "string") values.push(value);
  });

  const items = [];
  values.forEach((value) => {
    String(value)
      .split(/\r?\n| {3,}|\t+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        const parsed = parseCompletionProductLine(line, row, items.length);
        if (parsed) items.push(parsed);
      });
  });
  return items;
}

function completionStructuredProductItems(row) {
  const raw = row?.raw && typeof row.raw === "object" ? row.raw : {};
  const arrayKeys = [
    "items",
    "products",
    "productItems",
    "product_items",
    "orderProducts",
    "order_items",
    "goods",
    "zbozi",
    "zboží",
  ];
  for (const key of arrayKeys) {
    if (Array.isArray(raw[key]) && raw[key].length) {
      return raw[key].map((item, index) => normalizeWorkflowPhysicalItem(item, index, row));
    }
  }

  const productName = normalizedObjectValue(raw, ["productName", "product_name", "name", "title", "nazev", "název", "Název", "zbozi", "zboží", "polozka", "položka"]);
  const productCode = normalizedObjectValue(raw, ["variantCode", "productCode", "sku", "code", "kod", "kód", "Kód", "Označení varianty", "Kod produktu", "Kód produktu"]);
  if (!productName && !productCode) return [];

  return [
    normalizeWorkflowPhysicalItem(
      {
        datasetRowId: `structured-${row.id || row.orderNumber || "row"}`,
        variantCode: productCode,
        color: normalizedObjectValue(raw, ["color", "colour", "barva", "Barva"]),
        size: normalizedObjectValue(raw, ["size", "velikost", "Velikost"]),
        variant: normalizedObjectValue(raw, ["variant", "variantName", "varianta", "Varianta"]),
        productName,
        initialQuantity: normalizedObjectValue(raw, ["quantity", "quantityText", "mnozstvi", "množství", "Množství", "pocet", "počet", "ks"]) || row.quantity || 1,
        physicalOnly: true,
      },
      0,
      row
    ),
  ];
}

function completionRowsForWorkflowOrder(row) {
  if (!row?.orderNumber) return row ? [row] : [];
  return completionState.rows.filter(
    (candidate) =>
      String(candidate.datasetId || "") === String(row.datasetId || "") &&
      String(candidate.orderNumber || "") === String(row.orderNumber || "")
  );
}

function completionProductItemsForOrder(row) {
  const rows = completionRowsForWorkflowOrder(row);
  const items = [];
  rows.forEach((entry) => {
    items.push(...completionStructuredProductItems(entry));
    items.push(...completionTextProductItems(entry));
  });

  const seen = new Set();
  return items.filter((item, index) => {
    const key = [item.variantCode, item.productName, item.variant, item.initialQuantity].map((value) => normalize(String(value || ""))).join("|");
    if (seen.has(key)) return false;
    seen.add(key || `item-${index}`);
    return true;
  });
}

function workflowQuantityFromValue(value) {
  const text = String(value ?? "").replace(",", ".").trim();
  if (!text) return 0;
  const match = text.match(/\d+(?:\.\d+)?/);
  if (!match) return 0;
  return Math.max(0, Math.trunc(toNumber(match[0], 0)));
}

function workflowItemQuantity(item) {
  const fields = [
    item?.orderQuantity,
    item?.displayQuantity,
    item?.initialQuantity,
    item?.quantity,
    item?.quantityText,
    item?.mnozstvi,
    item?.["Množství"],
    item?.count,
    item?.qty,
  ];
  for (const value of fields) {
    const quantity = workflowQuantityFromValue(value);
    if (quantity > 0) return quantity;
  }
  return 0;
}

function workflowItemLineQuantity(item) {
  const fields = [
    item?.lineQuantity,
    item?.sortingInitialQuantity,
    item?.initialQuantity,
    item?.quantity,
    item?.quantityText,
    item?.mnozstvi,
    item?.["Množství"],
    item?.pocet,
    item?.["Počet"],
    item?.count,
    item?.qty,
  ];
  for (const value of fields) {
    const quantity = workflowQuantityFromValue(value);
    if (quantity > 0) return quantity;
  }
  return 0;
}

function workflowItemCodeKeys(item) {
  const keys = new Set();
  addProductImageCode(keys, item?.variantCode);
  addProductImageCode(keys, item?.code);
  addProductImageCode(keys, item?.sku);
  if (!keys.size) addProductImageCode(keys, item?.productCode);
  return Array.from(keys);
}

function completionOrderQuantityMap(row) {
  const quantities = new Map();
  completionProductItemsForOrder(row).forEach((item) => {
    const quantity = workflowItemQuantity(item) || 1;
    workflowItemCodeKeys(item).forEach((code) => {
      quantities.set(code, (quantities.get(code) || 0) + quantity);
    });
  });
  return quantities;
}

function applyCompletionOrderQuantitiesToSortingItems(row, items) {
  const quantityByCode = completionOrderQuantityMap(row);
  const sortingItems = items || [];
  const codeCounts = new Map();
  sortingItems.forEach((item) => {
    workflowItemCodeKeys(item).forEach((code) => {
      codeCounts.set(code, (codeCounts.get(code) || 0) + 1);
    });
  });

  const enrichWithLineQuantity = (item, lineQuantity) => ({
    ...item,
    sortingInitialQuantity: item.sortingInitialQuantity || item.initialQuantity || item.quantity || "",
    lineQuantity,
    displayQuantity: lineQuantity,
    orderQuantity: undefined,
  });

  if (!quantityByCode.size) {
    const orderTotal = workflowQuantityFromValue(row?.quantity || row?.amount);
    if (orderTotal > 0 && sortingItems.length === orderTotal) {
      return sortingItems.map((item) => enrichWithLineQuantity(item, workflowItemLineQuantity(item) || 1));
    }
    return sortingItems.map((item) => {
      const lineQuantity = workflowItemLineQuantity(item);
      return lineQuantity ? enrichWithLineQuantity(item, lineQuantity) : item;
    });
  }
  return sortingItems.map((item) => {
    const matchedCode = workflowItemCodeKeys(item).find((code) => quantityByCode.has(code) && (codeCounts.get(code) || 0) === 1);
    if (matchedCode) {
      const orderQuantity = quantityByCode.get(matchedCode);
      if (orderQuantity) {
        return {
          ...item,
          sortingInitialQuantity: item.initialQuantity || item.quantity || "",
          initialQuantity: orderQuantity,
          quantity: orderQuantity,
          lineQuantity: orderQuantity,
          displayQuantity: orderQuantity,
        };
      }
    }

    const lineQuantity = workflowItemLineQuantity(item);
    return lineQuantity ? enrichWithLineQuantity(item, lineQuantity) : item;
  });
}

function workflowPhysicalItems(row) {
  if (!row) return [];
  const sortingCheck = workflowSortingCheck(row);
  if (sortingCheck.items.length) {
    return sortingCheck.items.map((item, index) => normalizeWorkflowPhysicalItem(item, index, row));
  }
  if (row.orderNumber && completionFlowKind(row) !== "unknown") {
    return [];
  }

  const completionItems = completionProductItemsForOrder(row);
  if (completionItems.length) {
    return completionItems;
  }

  const itemText =
    row.productName ||
    row.itemName ||
    row.productsText ||
    row.itemsText ||
    row.orderItemsText ||
    row.note ||
    `Objednávka ${row.orderNumber || "-"} - zkontroluj položky ze skladové přípravy`;
  return [
    normalizeWorkflowPhysicalItem(
      {
        datasetRowId: `completion-${row.id || row.orderNumber || "row"}`,
        variantCode: row.productCode || row.variantCode || row.orderNumber || "-",
        variant: row.variant || row.variantName || "",
        productName: itemText,
        initialQuantity: row.quantity || row.pieces || row.itemCount || 1,
        remaining: null,
        physicalOnly: true,
      },
      0,
      row
    ),
  ];
}

function workflowPhysicalCheck(row) {
  const items = workflowPhysicalItems(row);
  const checked = items.filter((item, index) => completionWorkflowState.checkedItemKeys.has(workflowChecklistKey(item, index))).length;
  return {
    required: false,
    ok: checked >= items.length,
    checked,
    total: items.length,
  };
}

function workflowRowNeedsSortingAutoRefresh(row) {
  return Boolean(row?.id && row?.orderNumber && completionFlowKind(row) !== "unknown");
}

function workflowSortingSnapshot(row) {
  const check = workflowSortingCheck(row);
  return JSON.stringify({
    ok: check.ok,
    remainingTotal: check.remainingTotal,
    items: (check.items || []).map((item) => ({
      id: item.datasetRowId || item.id || item.variantCode || item.productCode || "",
      remaining: item.remaining,
      initialQuantity: item.initialQuantity,
    })),
  });
}

function stopWorkflowSortingAutoRefresh() {
  if (completionWorkflowState.sortingRefreshTimer) {
    window.clearInterval(completionWorkflowState.sortingRefreshTimer);
  }
  completionWorkflowState.sortingRefreshTimer = null;
  completionWorkflowState.sortingRefreshRowId = null;
  completionWorkflowState.sortingRefreshInFlight = false;
}

function syncWorkflowSortingAutoRefresh() {
  const row = completionWorkflowState.row;
  if (!workflowRowNeedsSortingAutoRefresh(row)) {
    stopWorkflowSortingAutoRefresh();
    return;
  }

  if (
    completionWorkflowState.sortingRefreshTimer &&
    String(completionWorkflowState.sortingRefreshRowId) === String(row.id)
  ) {
    return;
  }

  stopWorkflowSortingAutoRefresh();
  completionWorkflowState.sortingRefreshRowId = row.id;
  completionWorkflowState.sortingRefreshTimer = window.setInterval(autoRefreshWorkflowSortingCheck, 5000);
}

async function autoRefreshWorkflowSortingCheck() {
  const row = completionWorkflowState.row;
  if (!workflowRowNeedsSortingAutoRefresh(row)) {
    stopWorkflowSortingAutoRefresh();
    return;
  }
  if (document.hidden || els.completionView?.classList.contains("hidden")) return;
  if (completionWorkflowState.sortingRefreshInFlight) return;

  const rowId = row.id;
  const before = workflowSortingSnapshot(row);
  completionWorkflowState.sortingRefreshInFlight = true;
  try {
    const updatedRow = await refreshWorkflowSortingCheck(row, { progress: false });
    if (!completionWorkflowState.row || String(completionWorkflowState.row.id) !== String(rowId)) return;
    const after = workflowSortingSnapshot(updatedRow);
    if (before !== after) {
      renderWorkflow();
      const check = workflowSortingCheck(updatedRow);
      setWorkflowMessage(
        check.ok
          ? "Roztřídění se na pozadí aktualizovalo: všechny položky jsou odepsané."
          : `Roztřídění se na pozadí aktualizovalo: ještě zbývá ${check.remainingTotal} ks.`,
        check.ok ? "success" : "warning"
      );
    }
  } finally {
    completionWorkflowState.sortingRefreshInFlight = false;
  }
}

async function refreshWorkflowSortingCheck(row, options = {}) {
  if (!row?.id || !row?.orderNumber || completionFlowKind(row) === "unknown") return row;
  try {
    const data = await fetchJson(`/api/completion/rows/${encodeURIComponent(row.id)}/sorting-check`, {
      progress: options.progress !== false,
      progressLabel: "Ověřuji roztřídění...",
    });
    const sortingItems = (data.rows || []).map(sortingRowToItem);
    ensureProductImagesForCodes(collectProductImageCodesFromItems(sortingItems));
    const updatedRow = {
      ...row,
      workflowSortingItems: sortingItems,
      workflowSortingDataset: data.dataset || null,
      workflowSortingError: "",
      workflowSortingCheckedAt: new Date().toISOString(),
    };
    updateCompletionRowInState(updatedRow);
    return updatedRow;
  } catch (error) {
    const updatedRow = {
      ...row,
      workflowSortingItems: workflowSortingItems(row),
      workflowSortingDataset: sortingState.dataset || null,
      workflowSortingError: error.message,
      workflowSortingCheckedAt: new Date().toISOString(),
    };
    updateCompletionRowInState(updatedRow);
    return updatedRow;
  }
}

function workflowSortingCheckHtml(row) {
  const check = workflowSortingCheck(row);
  const physicalCheck = workflowPhysicalCheck(row);
  const flowKind = completionFlowKind(row);
  const physicalItems = workflowPhysicalItems(row);
  const checkMessage = flowKind === "stock" ? "" : check.message;
  const itemRows = physicalItems.length
    ? physicalItems
        .map((item, itemIndex) => {
          const checkKey = workflowChecklistKey(item, itemIndex);
          const checked = completionWorkflowState.checkedItemKeys.has(checkKey);
          const hasRemaining = item.remaining !== null && item.remaining !== undefined && item.remaining !== "";
          const showRemaining = flowKind === "sorting" && hasRemaining;
          const remaining = hasRemaining ? Math.max(0, Math.trunc(toNumber(item.remaining, 0))) : null;
          const initial = workflowItemLineQuantity(item) || workflowItemQuantity(item) || 1;
          const sortingInitial = workflowQuantityFromValue(item.sortingInitialQuantity);
          const quantityTitle =
            sortingInitial && sortingInitial !== initial
              ? ` title="${escapeHtml(`Množství podle objednávky. V roztřídění bylo ${sortingInitial} ks.`)}"`
              : "";
          const variantParts = String(item.variant || "")
            .split("/")
            .map((part) => part.trim())
            .filter(Boolean);
          const color = item.color || variantParts[0] || "";
          const size = item.size || variantParts.slice(1).join(" / ") || "";
          const meta = [
            color ? `Barva: ${color}` : "",
            size ? `Velikost: ${size}` : "",
            !color && !size && item.variant ? `Varianta: ${item.variant}` : "",
          ].filter(Boolean);
          return `
            <button type="button" class="workflow-sorting-item ${showRemaining && remaining > 0 ? "pending" : "done"} ${checked ? "checked" : ""}" data-action="workflow-check-item" data-check-key="${escapeHtml(checkKey)}">
              <span class="workflow-check-box" aria-hidden="true">${checked ? "OK" : ""}</span>
              ${productImageHtml(item, "workflow-product-image") || `<span class="workflow-product-image-placeholder" aria-hidden="true"></span>`}
              <span class="workflow-product-code">${escapeHtml(item.variantCode || item.productCode || "-")}</span>
              <span class="workflow-product-name">${escapeHtml(item.productName || item.info || "Položka objednávky")}</span>
              <span class="workflow-product-meta">${escapeHtml(meta.join(" | ") || "Bez varianty")}</span>
              <strong class="workflow-product-qty"${quantityTitle}>${escapeHtml(initial)} ks</strong>
              <strong class="workflow-product-state">${showRemaining ? `${escapeHtml(remaining)} zbývá` : "ke kontrole"}</strong>
            </button>
          `;
        })
        .join("")
    : `<div class="workflow-sorting-empty">Žádné položky ke kontrole.</div>`;

  return `
    <section class="workflow-sorting-check ${check.tone}">
      <div class="workflow-sorting-head">
        <strong>${escapeHtml(check.label)}</strong>
        ${checkMessage ? `<span>${escapeHtml(checkMessage)}</span>` : ""}
      </div>
      ${
        check.items.length
          ? `<div class="workflow-sorting-totals">
              <span>${escapeHtml(check.initialTotal)} ks původně</span>
              <span>${escapeHtml(check.remainingTotal)} ks zbývá</span>
              <span>${escapeHtml(check.items.length)} položek</span>
            </div>`
          : ""
      }
      ${
        physicalCheck.required
          ? `<div class="workflow-physical-check ${physicalCheck.ok ? "ok" : "warning"}">
              <strong>Fyzická kontrola položek: ${escapeHtml(physicalCheck.checked)} / ${escapeHtml(physicalCheck.total)}</strong>
              <span>${physicalCheck.ok ? "Kolegyně odkontrolovala všechny položky v boxu." : "Před uložením OK odklikni každou položku, kterou fyzicky vidíš v boxu."}</span>
            </div>`
          : ""
      }
      <div class="workflow-sorting-list">${itemRows}</div>
    </section>
  `;
}

function workflowItemsHtml(row) {
  if (!row) return "Po načtení boxu zobrazím obsah objednávky.";
  const note = row.note ? `<small>${escapeHtml(row.note)}</small>` : "";
  return `
    ${note}
    ${workflowSortingCheckHtml(row)}
  `;
}

function renderWorkflow() {
  const row = completionWorkflowState.row;
  const fullName = row ? `${row.firstName || ""} ${row.lastName || ""}`.trim() : "Načti expediční box";
  const expeditionNumber = workflowExpeditionNumberText(row);
  const tone = workflowStatusTone(row);
  let statusText = row ? "OK - připraveno" : "Čekám na sken boxu";
  const isDpd = row && (row.delivery?.isDpd || normalize(row.shippingMethod || "").includes("dpd"));
  const paymentWarning = row && ["storno", "unpaid", "missing", "unknown"].includes(paymentCheckKind(row));
  if (tone === "storno") {
    statusText = "STORNO - neexpedovat";
  } else if (tone === "ok" && row) {
    statusText = "OK - připraveno";
  } else if (tone === "warning" && row) {
    statusText = "NEZAPLACENO";
  } else if (tone === "danger" && row) {
    statusText = "ERROR - řešit";
  }

  setWorkflowExpeditionNumberText(expeditionNumber);
  els.workflowCustomerName.textContent = fullName || "-";
  els.workflowStreet.textContent = row?.streetWithNumber || row?.street || "-";
  els.workflowCity.textContent = [row?.city, row?.zipCode].filter(Boolean).join(", ") || "-";
  els.workflowOrderNumber.textContent = row?.orderNumber || "-";
  els.workflowShipping.textContent = row?.shippingMethod || "-";
  els.workflowPieces.textContent = `Kusů: ${row?.quantity || "-"}`;
  els.workflowCod.textContent = workflowPaymentText(row);
  els.workflowCountry.textContent = workflowCountryText(row);
  els.workflowStatus.className = `workflow-status ${tone}`;
  els.workflowStatus.textContent = statusText;
  const workflowPanel = els.workflowStatus.closest(".completion-workflow-panel");
  if (workflowPanel) {
    workflowPanel.dataset.tone = tone;
    workflowPanel.dataset.carrier = row ? completionCarrierKey(row) : "";
    workflowPanel.dataset.payment = row ? paymentCheckKind(row) : "";
  }
  els.workflowItems.innerHTML = workflowItemsHtml(row);
  els.workflowNote.textContent = row?.completionStatus ? `Stav kompletace: ${row.completionStatus}` : "";
  const warnings = [];
  const sortingCheck = workflowSortingCheck(row);
  if (paymentWarning) warnings.push(`${paymentCheckLabel(row)}: ${row.paymentCheckMessage || "zkontroluj objednávku před odesláním"}`);
  if (isDpd) warnings.push("Pozor: Doručení přes DPD = jiný svoz");
  if (sortingCheck.requiresSorting && !sortingCheck.ok) warnings.push(sortingCheck.message);
  els.workflowWarning.classList.toggle("hidden", !warnings.length);
  els.workflowWarning.textContent = warnings.join(" | ");
  if (workflowPanel) {
    workflowPanel.classList.toggle("has-workflow-warning", warnings.length > 0);
  }

  const disabled = !row;
  [
    els.workflowSaveOk,
    els.workflowUnpaid,
    els.workflowError,
    els.workflowUnpaidError,
    els.workflowOpenOrder,
    els.workflowClearError,
    els.workflowManualReprint,
  ].forEach((button) => {
    button.disabled = disabled;
  });
  if (els.workflowSaveOk) {
    els.workflowSaveOk.disabled = disabled;
  }
  syncWorkflowSortingAutoRefresh();
}

function selectWorkflowRow(row, message = "", tone = "success") {
  if (!row) return;
  const sorted = workflowRowsSorted();
  completionWorkflowState.row = row;
  completionWorkflowState.index = sorted.findIndex((entry) => entry.id === row.id);
  completionWorkflowState.checkedItemKeys = new Set();
  renderWorkflow();
  if (message) setWorkflowMessage(message, tone);
}

function workflowOrderNoteText(row) {
  const note = String(row?.note || "").trim();
  if (!note || note === "-") return "";
  return note;
}

function confirmWorkflowOrderNoteBeforePrint(row) {
  const note = workflowOrderNoteText(row);
  if (!note) return true;
  const order = row?.orderNumber ? `Objednávka ${row.orderNumber}` : "Objednávka";
  window.alert(
    `${order} má poznámku:\n\n${note}\n\nOK = přečteno. Zkontroluj prosím, jestli poznámka nevyžaduje ruční úpravu objednávky.`
  );
  return true;
}

async function scanWorkflowBox(value = els.workflowBoxCode.value, options = {}) {
  const number = parseWorkflowBoxCode(value);
  if (!number) {
    setWorkflowMessage("Box musí být ve tvaru X16S, případně jen číslo 16.", "warning");
    return;
  }
  if (!completionState.rows.length) {
    setWorkflowMessage("Nejdřív načti kompletaci pro expediční den.", "warning");
    return;
  }
  let row = findWorkflowRowByNumber(number);
  if (!row) {
    setWorkflowMessage(`Expediční číslo ${number} v načtené kompletaci nevidím.`, "error");
    return;
  }
  if (row.orderNumber && completionFlowKind(row) !== "unknown") {
    setWorkflowMessage("Ověřuji aktuální stav roztřídění pro tento box...", "neutral");
    row = await refreshWorkflowSortingCheck(row);
  }
  const sortingCheck = workflowSortingCheck(row);
  const sortingSuffix =
    sortingCheck.requiresSorting && !sortingCheck.ok ? ` ${sortingCheck.label}: ${sortingCheck.remainingTotal} ks zbývá.` : "";
  selectWorkflowRow(
    row,
    `Načten box X${number}S: objednávka ${row.orderNumber || "-"}.${sortingSuffix}`,
    sortingCheck.requiresSorting && !sortingCheck.ok ? "warning" : "success"
  );
  els.workflowBoxCode.value = "";
  if (options.focusBox !== false) {
    focusWorkflowBoxCodeInput();
  }
  if (!confirmWorkflowOrderNoteBeforePrint(row)) {
    setWorkflowMessage("Automatický tisk je pozastavený, protože poznámka objednávky nebyla potvrzená.", "warning");
    return;
  }
  await autoPrintWorkflowDocuments(row, number);
}

function clearWorkflowNumberInputTimer() {
  if (completionWorkflowState.expeditionNumberInputTimer) {
    window.clearTimeout(completionWorkflowState.expeditionNumberInputTimer);
  }
  completionWorkflowState.expeditionNumberInputTimer = null;
}

function selectWorkflowNumberFromInput(options = {}) {
  clearWorkflowNumberInputTimer();
  const rawValue = els.workflowExpeditionNumber.value;
  const scannedBoxNumber = parseWorkflowBoxBarcode(rawValue);
  if (scannedBoxNumber) {
    scanWorkflowBox(rawValue, { focusBox: true }).catch((error) => setWorkflowMessage(`Načtení boxu selhalo: ${error.message}`, "error"));
    return;
  }

  const number = parseWorkflowBoxCode(rawValue);
  if (!number) {
    setWorkflowExpeditionNumberText(workflowExpeditionNumberText(completionWorkflowState.row));
    setWorkflowMessage("Zadej expediční číslo, například 16.", "warning");
    return;
  }
  if (!completionState.rows.length) {
    setWorkflowExpeditionNumberText(workflowExpeditionNumberText(completionWorkflowState.row));
    setWorkflowMessage("Nejdřív načti kompletaci pro expediční den.", "warning");
    return;
  }
  const currentNumber = workflowExpeditionNumberText(completionWorkflowState.row);
  if (currentNumber && normalizeWorkflowNumber(currentNumber) === normalizeWorkflowNumber(number)) {
    setWorkflowExpeditionNumberText(currentNumber);
    if (options.focusBox) focusWorkflowBoxCodeInput();
    return;
  }
  const row = findWorkflowRowByNumber(number);
  if (!row) {
    setWorkflowExpeditionNumberText(workflowExpeditionNumberText(completionWorkflowState.row));
    setWorkflowMessage(`Expediční číslo ${number} v načtené kompletaci nevidím.`, "error");
    return;
  }
  selectWorkflowRow(row);
  if (options.focusBox) focusWorkflowBoxCodeInput();
}

function scheduleWorkflowNumberInputSelection() {
  clearWorkflowNumberInputTimer();
  if (!String(els.workflowExpeditionNumber.value || "").trim()) return;
  completionWorkflowState.expeditionNumberInputTimer = window.setTimeout(() => {
    selectWorkflowNumberFromInput();
  }, 500);
}

function moveWorkflow(delta) {
  const sorted = workflowRowsSorted();
  if (!sorted.length) return;
  const currentIndex = completionWorkflowState.index >= 0 ? completionWorkflowState.index : 0;
  const nextIndex = Math.max(0, Math.min(sorted.length - 1, currentIndex + delta));
  selectWorkflowRow(sorted[nextIndex]);
}

function updateCompletionRowInState(row) {
  const index = completionState.rows.findIndex((entry) => entry.id === row.id);
  if (index >= 0) completionState.rows[index] = row;
  if (completionWorkflowState.row?.id === row.id) {
    completionWorkflowState.row = row;
  }
}

async function saveWorkflowAction(action) {
  let row = completionWorkflowState.row;
  if (!row) return null;
  if (action === "ok" && workflowRowNeedsSortingAutoRefresh(row)) {
    setWorkflowMessage("Ještě ověřuji aktuální stav roztřídění před uložením OK...", "neutral");
    row = await refreshWorkflowSortingCheck(row);
    if (completionWorkflowState.row && String(completionWorkflowState.row.id) === String(row.id)) {
      completionWorkflowState.row = row;
      renderWorkflow();
    }
  }
  const sortingCheck = workflowSortingCheck(row);
  if (action === "ok" && sortingCheck.requiresSorting && !sortingCheck.ok) {
    const confirmed = window.confirm(
      `${sortingCheck.label}: ${sortingCheck.message}\n\nOpravdu i přesto uložit box jako OK? Obvykle se v tomhle stavu dává Error.`
    );
    if (!confirmed) {
      setWorkflowMessage("Uložení OK zrušeno. Pokud položky nesedí, použij tlačítko Error.", "warning");
      return null;
    }
  }
  try {
    const data = await fetchJson(`/api/completion/rows/${row.id}/workflow`, {
      method: "POST",
      body: JSON.stringify({ action }),
    });
    updateCompletionRowInState(data.row);
    renderWorkflow();
    renderCompletion();
    setWorkflowMessage(`Uloženo: ${data.row.completionStatus || "stav vyčištěn"}.`, "success");
    return data.row;
  } catch (error) {
    setWorkflowMessage(`Uložení stavu selhalo: ${error.message}`, "error");
    return null;
  }
}

async function saveWorkflowActionAndPrint(action, kind) {
  const row = completionWorkflowState.row;
  if (!row) {
    setWorkflowMessage("Nejdřív načti expediční box.", "warning");
    return;
  }
  const updatedRow = await saveWorkflowAction(action);
  const targetRow = updatedRow || completionWorkflowState.row || row;
  if (!targetRow?.id) return;
  await printCompletionIssueDocument(targetRow.id, kind, setWorkflowMessage);
}

function openWorkflowOrder() {
  const row = completionWorkflowState.row;
  const url = completionOrderAdminUrl(row);
  if (!url) {
    setWorkflowMessage("Objednávku nejde otevřít: chybí ID objednávky nebo doména e-shopu.", "warning");
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

function renderCompletion() {
  const allRows = completionState.rows;
  renderExpeditionBatchReport();
  renderCompletionFilterOptions(allRows);
  const rows = filteredCompletionRows();
  els.completionRowCount.textContent = `${rows.length} / ${allRows.length} řádků`;
  renderCompletionSummary(rows);
  els.completionBody.innerHTML = "";

  if (!rows.length) {
    els.completionBody.innerHTML = `<tr><td colspan="14" class="empty">Zadna kompletace k zobrazeni.</td></tr>`;
    return;
  }

  rows.forEach((row) => {
    const status = completionStatus(row);
    const customer = [row.firstName, row.lastName].filter(Boolean).join(" ");
    const address = [row.city, row.zipCode].filter(Boolean).join(" ");
    const shop = row.shopCode || completionState.dataset?.shopCode || "-";
    const labelOrShipment = row.labelPrinted || completionLabelNumber(row);
    const rowId = String(row.id);
    const expanded = expandedCompletionRows.has(rowId);
    const tr = document.createElement("tr");
    tr.className = `completion-main-row ${completionRowTone(row, status)} ${expanded ? "expanded" : ""}`;
    tr.dataset.completionRowId = row.id;
    tr.innerHTML = `
      <td>
        <div class="completion-actions">
          <button type="button" data-action="save-completion-row" data-row-id="${escapeHtml(row.id)}">Uložit</button>
          <button type="button" class="secondary" data-action="validate-address" data-row-id="${escapeHtml(row.id)}">Ověřit</button>
          <button type="button" class="secondary" data-action="open-shop-order" data-row-id="${escapeHtml(row.id)}">E-shop</button>
          ${carrierSendActionHtml(row)}
        </div>
      </td>
      <td class="completion-sequence">
        <strong class="code">${escapeHtml(row.expeditionNumber || row.rowNumber || "")}</strong>
        <span class="shop-chip">${escapeHtml(shop)}</span>
      </td>
      <td class="completion-order-cell">
        <strong class="code">${escapeHtml(row.orderNumber || "-")}</strong>
        ${completionProductImagesHtml(row)}
        <div class="completion-badges">${completionMainBadges(row, status)}</div>
      </td>
      <td class="completion-customer-cell">
        <strong>${escapeHtml(customer || "-")}</strong>
        <small>${escapeHtml(address)}</small>
        ${completionMetaLine("E-shop", shop)}
      </td>
      <td class="completion-address-summary">
        <strong>${escapeHtml(row.streetWithNumber || [row.street, row.houseNumber].filter(Boolean).join(" ") || "-")}</strong>
        <small>${escapeHtml(address)}</small>
      </td>
      <td class="completion-contact-cell">
        <strong>${escapeHtml(row.phone || "-")}</strong>
        <small>${escapeHtml(row.email || "")}</small>
      </td>
      <td>${addressValidationHtml(row)}</td>
      <td class="completion-carrier-cell">
        ${deliveryCarrierHtml(row)}
        ${labelOrShipment ? `<small class="code">${escapeHtml(labelOrShipment)}</small>` : ""}
      </td>
      <td class="completion-carrier-note">${completionInput(row, "carrierNote", row.carrierNote || "", "carrier-note-input")}</td>
      <td class="completion-payment-cell">
        <span class="currency-chip ${escapeHtml((row.currency || "").toLowerCase())}">${escapeHtml(row.currency || "")}</span>
        ${completionMetaLine("Dobírka", row.codAmount)}
        ${completionMetaLine("Platba", row.paymentMethod || row.paidStatus)}
        ${completionMetaLine("Kontrola", paymentCheckLabel(row))}
      </td>
      <td><span class="qty">${escapeHtml(row.quantity || "")}</span></td>
      <td><span class="status-chip ${status.tone}">${escapeHtml(status.label)}</span></td>
      <td class="completion-note">${escapeHtml(row.note || "")}</td>
      <td class="completion-tech-cell">
        ${completionMetaLine("ID", row.orderId, "code")}
        ${completionMetaLine("Datum", row.orderDate, "code")}
      </td>
    `;
    els.completionBody.appendChild(tr);

    const detailRow = document.createElement("tr");
    detailRow.className = `completion-detail-row ${expanded ? "" : "hidden"}`;
    detailRow.dataset.detailFor = row.id;
    detailRow.innerHTML = `<td colspan="14">${completionDetailHtml(row)}</td>`;
    els.completionBody.appendChild(detailRow);
  });
}

function toggleCompletionDetail(rowId) {
  const key = String(rowId);
  if (expandedCompletionRows.has(key)) {
    expandedCompletionRows.delete(key);
  } else {
    expandedCompletionRows.add(key);
  }
  renderCompletion();
}

function renderUsers() {
  if (!els.usersList) return;
  if (!usersState.users.length) {
    els.usersList.innerHTML = `<div class="empty">Zatím tu není žádný uživatel.</div>`;
    return;
  }

  els.usersList.innerHTML = `
    <table class="users-table">
      <thead>
        <tr>
          <th>Uživatel</th>
          <th>Role</th>
          <th>Stav</th>
          <th>Poslední přihlášení</th>
          <th>Akce</th>
        </tr>
      </thead>
      <tbody>
        ${usersState.users
          .map((user) => {
            const self = authState.user?.id === user.id;
            return `
              <tr class="${user.active ? "" : "inactive"}">
                <td>
                  <strong>${escapeHtml(user.displayName || user.username)}</strong>
                  <small>${escapeHtml(user.username)}</small>
                </td>
                <td>
                  <select data-action="change-user-role" data-user-id="${escapeHtml(user.id)}" ${self ? "disabled" : ""}>
                    <option value="employee" ${user.role === "employee" ? "selected" : ""}>Uživatel</option>
                    <option value="admin" ${user.role === "admin" ? "selected" : ""}>Admin</option>
                  </select>
                </td>
                <td><span class="status-chip ${user.active ? "ok" : "danger"}">${user.active ? "aktivní" : "vypnutý"}</span></td>
                <td>${escapeHtml(user.lastLoginAt ? formatTime(user.lastLoginAt) : "zatím nikdy")}</td>
                <td>
                  <div class="user-actions">
                    <button type="button" class="secondary" data-action="reset-user-password" data-user-id="${escapeHtml(user.id)}">Reset hesla</button>
                    <button type="button" class="${user.active ? "danger" : "secondary"}" data-action="toggle-user-active" data-user-id="${escapeHtml(user.id)}" data-active="${user.active ? "0" : "1"}" ${self ? "disabled" : ""}>${user.active ? "Vypnout" : "Zapnout"}</button>
                  </div>
                </td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
  `;
}

async function loadUsers() {
  if (!isAdmin()) return;
  try {
    const data = await fetchJson("/api/users");
    usersState.users = data.users || [];
    usersState.loaded = true;
    renderUsers();
  } catch (error) {
    usersState.loaded = true;
    els.usersList.innerHTML = `<div class="empty">Uživatele se nepodařilo načíst: ${escapeHtml(error.message)}</div>`;
  }
}

async function createUserFromForm() {
  const username = els.userCreateUsername.value.trim();
  const displayName = els.userCreateDisplay.value.trim();
  const password = els.userCreatePassword.value;
  const role = els.userCreateRole.value || "employee";
  if (!username || !password) {
    setSettingsMessage("Vyplň e-mail/uživatele a první heslo.", "warning");
    return;
  }
  try {
    await fetchJson("/api/users", {
      method: "POST",
      body: JSON.stringify({ username, displayName, password, role }),
    });
    els.userCreateUsername.value = "";
    els.userCreateDisplay.value = "";
    els.userCreatePassword.value = "";
    setSettingsMessage("Uživatel byl vytvořený. Přidělené heslo zůstává platné.", "success");
    await loadUsers();
  } catch (error) {
    setSettingsMessage(`Uživatele se nepodařilo vytvořit: ${error.message}`, "error");
  }
}

async function patchUser(userId, payload) {
  await fetchJson(`/api/users/${userId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  await loadUsers();
}

async function resetUserPassword(userId) {
  const password = prompt("Zadej nové heslo pro uživatele:");
  if (!password) return;
  try {
    await fetchJson(`/api/users/${userId}/reset-password`, {
      method: "POST",
      body: JSON.stringify({ password }),
    });
    setSettingsMessage("Heslo bylo uložené a zůstává platné.", "success");
    await loadUsers();
  } catch (error) {
    setSettingsMessage(`Reset hesla selhal: ${error.message}`, "error");
  }
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

function uniqueCleanValues(values) {
  const unique = new Map();
  values
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .forEach((value) => {
      const key = normalize(value);
      if (!unique.has(key)) unique.set(key, value);
    });
  return Array.from(unique.values());
}

function sortEanCandidates(candidates) {
  return candidates.sort((a, b) => {
    if (a.exact !== b.exact) return a.exact ? -1 : 1;
    return candidateSequenceRank(a) - candidateSequenceRank(b) || toNumber(b.item.remaining, 0) - toNumber(a.item.remaining, 0);
  });
}

function candidateSequenceRank(candidate) {
  const sequence = Number(candidate?.item?.sequence);
  return Number.isFinite(sequence) ? sequence : Number.MAX_SAFE_INTEGER;
}

function setBestEanCandidate(target, item, entry, exact) {
  const current = target.get(item.id);
  if (current && (!exact || current.exact)) return;
  target.set(item.id, {
    item,
    entry,
    exact,
    matchType: exact ? "přesná varianta" : "paircode/prefix",
  });
}

function eanEntryMatchType(entry, item) {
  if (sameCode(item.variantCode, entry.articleCode)) return "exact";
  if (sameCode(item.paircode, entry.prefix) || sameCode(item.productCode, entry.prefix)) return "pair";
  return "";
}

function candidateVariantKey(candidate) {
  return productCodeKey(candidate?.item?.variantCode || candidate?.entry?.articleCode || candidate?.item?.productCode || "");
}

function candidateVariantKeys(candidates) {
  return uniqueCleanValues(candidates.map(candidateVariantKey));
}

function scanDecisionForCandidates(candidates) {
  const exactCandidates = sortEanCandidates(candidates.filter((candidate) => candidate.exact));
  const exactVariantKeys = candidateVariantKeys(exactCandidates);
  if (exactCandidates.length && exactVariantKeys.length === 1) {
    return {
      mode: "ok",
      candidates: exactCandidates,
      exactCandidates,
      exactVariantKeys,
    };
  }
  return {
    mode: candidates.length ? "choice" : "no-active",
    candidates: sortEanCandidates(candidates.slice()),
    exactCandidates,
    exactVariantKeys,
  };
}

function buildEanAuditData() {
  const itemIdsWithEan = new Set();
  const records = Object.entries(state.eanMap || {}).map(([ean, entries]) => {
    const entryList = Array.isArray(entries) ? entries : [];
    const allCandidateMap = new Map();
    const activeCandidateMap = new Map();

    entryList.forEach((entry) => {
      state.items.forEach((item) => {
        const matchType = eanEntryMatchType(entry, item);
        if (!matchType) return;
        itemIdsWithEan.add(item.id);
        setBestEanCandidate(allCandidateMap, item, entry, matchType === "exact");
        if (toNumber(item.remaining, 0) > 0) {
          setBestEanCandidate(activeCandidateMap, item, entry, matchType === "exact");
        }
      });
    });

    const allCandidates = sortEanCandidates(Array.from(allCandidateMap.values()));
    const activeCandidates = sortEanCandidates(Array.from(activeCandidateMap.values()));
    const exactCandidates = activeCandidates.filter((candidate) => candidate.exact);
    const pairCandidates = activeCandidates.filter((candidate) => !candidate.exact);
    const scanDecision = scanDecisionForCandidates(activeCandidates);
    const exactVariantKeys = scanDecision.exactVariantKeys;
    const articleCodes = uniqueCleanValues(entryList.map((entry) => entry.articleCode));
    const prefixes = uniqueCleanValues(entryList.map((entry) => entry.prefix));
    const colors = uniqueCleanValues(entryList.flatMap((entry) => [entry.color, entry.secondColor, entry.colorCode]));
    const sizes = uniqueCleanValues(entryList.map((entry) => entry.size));
    const shopCodes = uniqueCleanValues(allCandidates.map((candidate) => candidate.item.shopCode || "bez e-shopu"));
    const scanMode = scanDecision.mode;

    const record = {
      ean,
      entries: entryList,
      entryCount: entryList.length,
      articleCodes,
      prefixes,
      colors,
      sizes,
      allCandidates,
      activeCandidates,
      exactCandidates,
      pairCandidates,
      exactVariantKeys,
      safeCandidates: scanDecision.mode === "ok" ? scanDecision.candidates : [],
      shopCodes,
      scanMode,
    };
    record.reasons = eanAuditReasons(record);
    record.tone = eanAuditTone(record);
    return record;
  });

  return {
    records,
    itemIdsWithEan,
    rowsWithoutEan: state.items.filter((item) => !itemIdsWithEan.has(item.id)).length,
  };
}

function eanAuditReasons(record) {
  const reasons = [];
  if (record.scanMode === "ok") {
    if (record.safeCandidates.length > 1) reasons.push("více řádků stejné varianty");
    if (record.pairCandidates.length) reasons.push("prefix shody ignorované");
    if (record.entryCount > 1 && record.articleCodes.length === 1) reasons.push("duplicitní záznam mapy");
    if (!reasons.length) reasons.push("jednoznačný sken");
    return reasons;
  }
  if (record.articleCodes.length > 1) reasons.push("více articleCode");
  if (record.prefixes.length > 1) reasons.push("více prefixů");
  if (record.exactVariantKeys.length > 1) reasons.push("více přesných variant");
  if (record.activeCandidates.length && !record.exactCandidates.length) reasons.push("jen paircode/prefix");
  if (!record.activeCandidates.length && record.allCandidates.length) reasons.push("shody jsou na nule");
  if (!record.allCandidates.length) reasons.push("není v aktuální dávce");
  if (!reasons.length) reasons.push("jednoznačný sken");
  return reasons;
}

function eanAuditTone(record) {
  if (record.scanMode === "choice") return "danger";
  if (record.scanMode === "no-active") return "warning";
  return "ok";
}

function eanAuditStatusLabel(record) {
  if (record.scanMode === "ok") return "Jednoznačný";
  if (record.scanMode === "choice") return "Výběr kandidáta";
  return "Bez aktivní shody";
}

function eanAuditIsAmbiguous(record) {
  return record.tone === "danger";
}

function eanAuditHaystack(record) {
  return normalize(
    [
      record.ean,
      record.articleCodes.join(" "),
      record.prefixes.join(" "),
      record.colors.join(" "),
      record.sizes.join(" "),
      record.entries.map((entry) => entry.description).join(" "),
      record.allCandidates
        .map((candidate) =>
          [
            candidate.item.orderNumber,
            candidate.item.sequence,
            candidate.item.variantCode,
            candidate.item.productCode,
            candidate.item.paircode,
            candidate.item.variant,
            candidate.item.productName,
            candidate.item.info,
            candidate.item.shopCode,
          ].join(" ")
        )
        .join(" "),
    ].join(" ")
  );
}

function eanAuditPassesFilters(record) {
  const query = normalize(eanFilters.search);
  if (query && !eanAuditHaystack(record).includes(query)) return false;

  if (eanFilters.risk === "ambiguous" && !eanAuditIsAmbiguous(record)) return false;
  if (eanFilters.risk === "scan-choice" && record.scanMode !== "choice") return false;
  if (
    eanFilters.risk === "map" &&
    !(record.entryCount > 1 || record.articleCodes.length > 1 || record.prefixes.length > 1)
  ) {
    return false;
  }
  if (eanFilters.risk === "no-current" && record.activeCandidates.length) return false;
  if (eanFilters.risk === "ok" && record.scanMode !== "ok") return false;

  if (eanFilters.match === "exact" && !record.exactCandidates.length) return false;
  if (eanFilters.match === "pair" && !record.pairCandidates.length) return false;
  if (eanFilters.match === "none" && record.allCandidates.length) return false;
  if (eanFilters.shop && !record.shopCodes.includes(eanFilters.shop)) return false;
  return true;
}

function eanAuditRiskRank(record) {
  if (record.tone === "danger") return 0;
  if (record.tone === "warning") return 1;
  return 2;
}

function sortEanAuditRecords(records) {
  return records.sort((a, b) => {
    if (eanFilters.sort === "ean") return a.ean.localeCompare(b.ean);
    if (eanFilters.sort === "candidates") {
      return b.activeCandidates.length - a.activeCandidates.length || a.ean.localeCompare(b.ean);
    }
    if (eanFilters.sort === "entries") return b.entryCount - a.entryCount || a.ean.localeCompare(b.ean);
    return (
      eanAuditRiskRank(a) - eanAuditRiskRank(b) ||
      b.activeCandidates.length - a.activeCandidates.length ||
      b.entryCount - a.entryCount ||
      a.ean.localeCompare(b.ean)
    );
  });
}

function renderEanShopFilter(records) {
  if (!els.eansFilterShop) return;
  const shops = uniqueCleanValues(records.flatMap((record) => record.shopCodes)).sort((a, b) => a.localeCompare(b));
  if (eanFilters.shop && !shops.includes(eanFilters.shop)) {
    eanFilters.shop = "";
  }
  els.eansFilterShop.innerHTML = `
    <option value="">Všechny e-shopy</option>
    ${shops.map((shop) => `<option value="${escapeHtml(shop)}">${escapeHtml(shop)}</option>`).join("")}
  `;
  els.eansFilterShop.value = eanFilters.shop;
}

function renderEanSummary(data, visibleRecords) {
  if (!els.eansSummary) return;
  const ambiguous = data.records.filter(eanAuditIsAmbiguous).length;
  const choice = data.records.filter((record) => record.scanMode === "choice").length;
  const noCurrent = data.records.filter((record) => !record.allCandidates.length).length;
  els.eansSummary.innerHTML = `
    <span><strong>${escapeHtml(data.records.length)}</strong> EANů v mapě</span>
    <span><strong>${escapeHtml(ambiguous)}</strong> rizikových</span>
    <span><strong>${escapeHtml(choice)}</strong> vyžaduje výběr</span>
    <span><strong>${escapeHtml(noCurrent)}</strong> mimo aktuální dávku</span>
    <span><strong>${escapeHtml(data.rowsWithoutEan)}</strong> řádků bez EAN shody</span>
    <span>Zobrazeno ${escapeHtml(visibleRecords.length)}</span>
  `;
}

function eanMapEntryHaystack(row) {
  const entry = row.entry;
  return normalize(
    [
      row.ean,
      entry.articleCode,
      entry.prefix,
      entry.description,
      entry.originalArticle,
      entry.colorCode,
      entry.color,
      entry.secondColor,
      entry.size,
      entry.weight,
    ].join(" ")
  );
}

function formatEanWeight(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "-";
  const parsed = toNumber(raw, NaN);
  if (!Number.isFinite(parsed)) return raw;
  return `${parsed.toLocaleString("cs-CZ", {
    maximumFractionDigits: 3,
  })} kg`;
}

function buildEanMapRows() {
  return Object.entries(state.eanMap || {})
    .flatMap(([ean, entries]) => {
      const entryList = Array.isArray(entries) ? entries : [];
      return entryList.map((entry, index) => {
        const matches = state.items
          .map((item) => ({ item, matchType: eanEntryMatchType(entry, item) }))
          .filter((match) => match.matchType);
        const activeMatches = matches.filter((match) => toNumber(match.item.remaining, 0) > 0);
        return {
          ean,
          entry,
          index,
          matches,
          activeMatches,
          exactActive: activeMatches.filter((match) => match.matchType === "exact").length,
          pairActive: activeMatches.filter((match) => match.matchType === "pair").length,
        };
      });
    })
    .sort((a, b) => a.ean.localeCompare(b.ean) || String(a.entry.articleCode || "").localeCompare(String(b.entry.articleCode || "")));
}

function renderEanMapRow(row) {
  const entry = row.entry;
  const colors = uniqueCleanValues([entry.color, entry.secondColor, entry.colorCode]).join(" | ") || "-";
  return `
    <tr>
      <td class="code">${escapeHtml(row.ean)}</td>
      <td class="code">${escapeHtml(entry.articleCode || "-")}</td>
      <td class="code">${escapeHtml(entry.prefix || "-")}</td>
      <td>${escapeHtml(colors)}</td>
      <td>${escapeHtml(entry.size || "-")}</td>
      <td class="ean-map-description">
        <strong>${escapeHtml(entry.description || "-")}</strong>
        ${entry.originalArticle ? `<small>${escapeHtml(entry.originalArticle)}</small>` : ""}
      </td>
      <td>${escapeHtml(formatEanWeight(entry.weight))}</td>
      <td>
        <strong>${escapeHtml(row.activeMatches.length)} aktivních / ${escapeHtml(row.matches.length)} celkem</strong>
        <small>${escapeHtml(row.exactActive)} přesně | ${escapeHtml(row.pairActive)} přes prefix</small>
      </td>
    </tr>
  `;
}

function renderEanMapTable() {
  if (!els.eansMapBody) return;
  const allRows = buildEanMapRows();
  const query = normalize(eanFilters.search);
  const rows = query ? allRows.filter((row) => eanMapEntryHaystack(row).includes(query)) : allRows;
  els.eansMapRowCount.textContent =
    rows.length === allRows.length ? `${rows.length} záznamů` : `${rows.length} z ${allRows.length} záznamů`;

  if (!rows.length) {
    els.eansMapBody.innerHTML = `<tr><td colspan="8" class="empty">EAN mapa neobsahuje žádný záznam pro aktuální hledání.</td></tr>`;
    return;
  }

  els.eansMapBody.innerHTML = rows.map(renderEanMapRow).join("");
}

function renderEanEntryDetail(entry) {
  const meta = [
    entry.prefix ? `prefix ${entry.prefix}` : "",
    entry.color ? `barva ${entry.color}` : "",
    entry.size ? `vel. ${entry.size}` : "",
    entry.weight ? formatEanWeight(entry.weight) : "",
  ].filter(Boolean);
  return `
    <div class="ean-detail-line">
      <strong class="code">${escapeHtml(entry.articleCode || "-")}</strong>
      <span>${escapeHtml(entry.description || "-")}</span>
      <small>${escapeHtml(meta.join(" | ") || "bez detailu")}</small>
    </div>
  `;
}

function renderEanCandidateDetail(candidate) {
  const item = candidate.item;
  return `
    <div class="ean-detail-line ${candidate.exact ? "exact" : "pair"}">
      <strong class="code">${escapeHtml(item.variantCode || item.productCode || "-")}</strong>
      <span>${escapeHtml(item.productName || item.info || "-")}</span>
      <small>Obj. ${escapeHtml(item.orderNumber || "-")} | poř. ${escapeHtml(item.sequence || "-")} | ${escapeHtml(
    candidate.matchType
  )} | zbývá ${escapeHtml(item.remaining ?? "-")} | ${escapeHtml(item.shopCode || "bez e-shopu")}</small>
    </div>
  `;
}

function renderEanAuditDetails(record) {
  const entries = record.entries.slice(0, 20).map(renderEanEntryDetail).join("");
  const candidates = record.allCandidates.slice(0, 30).map(renderEanCandidateDetail).join("");
  const entryMore = record.entries.length > 20 ? `<small class="muted">+${escapeHtml(record.entries.length - 20)} dalších záznamů</small>` : "";
  const candidateMore =
    record.allCandidates.length > 30 ? `<small class="muted">+${escapeHtml(record.allCandidates.length - 30)} dalších shod</small>` : "";
  return `
    <details class="ean-audit-detail">
      <summary>Podrobnosti</summary>
      <div class="ean-detail-grid">
        <div>
          <h3>EAN mapa</h3>
          ${entries || `<div class="empty">Bez záznamu v EAN mapě.</div>`}
          ${entryMore}
        </div>
        <div>
          <h3>Shody v dávce</h3>
          ${candidates || `<div class="empty">Žádná shoda v aktuální dávce.</div>`}
          ${candidateMore}
        </div>
      </div>
    </details>
  `;
}

function renderEanAuditRow(record) {
  const reasonHtml = record.reasons
    .slice(0, 5)
    .map((reason) => `<span class="ean-reason ${escapeHtml(record.tone)}">${escapeHtml(reason)}</span>`)
    .join("");
  const extraReasons = record.reasons.length > 5 ? `<span class="ean-reason">+${escapeHtml(record.reasons.length - 5)}</span>` : "";
  const firstArticles = record.articleCodes.slice(0, 3).join(", ") || "-";
  const firstPrefixes = record.prefixes.slice(0, 3).join(", ") || "-";
  const activeHeadline =
    record.scanMode === "ok"
      ? `${record.safeCandidates.length} k postupnému odpisu`
      : `${record.activeCandidates.length} aktivních shod`;
  return `
    <tr class="ean-audit-row ${escapeHtml(record.tone)}">
      <td class="code">${escapeHtml(record.ean)}</td>
      <td>
        <span class="status-chip ${escapeHtml(record.tone)}">${escapeHtml(eanAuditStatusLabel(record))}</span>
      </td>
      <td>
        <strong>${escapeHtml(record.entryCount)} záznamů</strong>
        <small>${escapeHtml(record.articleCodes.length)} article | ${escapeHtml(record.prefixes.length)} prefix</small>
        <small class="code">${escapeHtml(firstArticles)}</small>
        <small>${escapeHtml(firstPrefixes)}</small>
      </td>
      <td>
        <strong>${escapeHtml(activeHeadline)}</strong>
        <small>${escapeHtml(record.exactCandidates.length)} přesně | ${escapeHtml(record.pairCandidates.length)} přes prefix</small>
        <small>${escapeHtml(record.allCandidates.length)} shod celkem</small>
      </td>
      <td><div class="ean-reasons">${reasonHtml}${extraReasons}</div></td>
      <td>${renderEanAuditDetails(record)}</td>
    </tr>
  `;
}

function renderEanAudit() {
  if (!els.eansBody) return;
  const data = buildEanAuditData();
  renderEanShopFilter(data.records);
  renderEanMapTable();
  const filtered = sortEanAuditRecords(data.records.filter(eanAuditPassesFilters));
  const visible = filtered.slice(0, EAN_AUDIT_RENDER_LIMIT);
  const hiddenCount = filtered.length - visible.length;

  renderEanSummary(data, filtered);
  els.eansRowCount.textContent = `${filtered.length} EANů${hiddenCount > 0 ? ` | zobrazeno prvních ${EAN_AUDIT_RENDER_LIMIT}` : ""}`;

  if (!visible.length) {
    els.eansBody.innerHTML = `<tr><td colspan="6" class="empty">Nic nenalezeno.</td></tr>`;
    return;
  }

  els.eansBody.innerHTML = `
    ${visible.map(renderEanAuditRow).join("")}
    ${
      hiddenCount > 0
        ? `<tr><td colspan="6" class="empty">Dalších ${escapeHtml(hiddenCount)} EANů je skryto. Zpřesni filtr nebo hledání.</td></tr>`
        : ""
    }
  `;
}

function visibleItems() {
  const query = normalize(els.manualSearch.value.trim());
  return state.items.filter((item) => {
    if (!state.settings.showZero && item.remaining <= 0 && !zeroRowsKeptUntilRefresh.has(item.id)) return false;
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
    const imageCell = productImageHtml(item, "sorting-product-image");

    tr.innerHTML = `
      <td class="code">${escapeHtml(item.orderNumber)}</td>
      <td>${escapeHtml(item.sequence)}</td>
      <td>
        <div class="code">${escapeHtml(item.variantCode || item.productCode)}</div>
        <small>${escapeHtml(item.paircode)}</small>
      </td>
      <td>${renderEans(item)}</td>
      <td class="variant-cell">${escapeHtml(item.variant)}</td>
      <td><span class="qty ${item.remaining <= 0 ? "zero" : ""}">${item.remaining}</span></td>
      <td>
        <div class="row-actions deduct-actions">
          <button type="button" data-action="deduct" data-id="${escapeHtml(item.id)}" ${item.remaining <= 0 ? "disabled" : ""}>-1</button>
        </div>
      </td>
      <td>${escapeHtml(item.brand)}</td>
      <td class="product-name-cell">${escapeHtml(item.productName || item.info)}</td>
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
  if (els.eansView && !els.eansView.classList.contains("hidden")) {
    renderEanAudit();
  }
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
    datasetRowId: item.datasetRowId || "",
    orderNumber: item.orderNumber,
    sequence: item.sequence,
    remainingAfter: item.remaining,
    ean: context.ean || "",
    mode: context.mode || "",
    actor: context.actor || "",
    undone: false,
  };
}

function applyServerSortingRow(item, row) {
  if (!item || !row) return;
  item.remaining = Math.max(0, Math.trunc(toNumber(row.remaining, item.remaining)));
  item.orderNumber = row.orderNumber || item.orderNumber;
  item.sequence = row.sequence || item.sequence;
  item.variant = row.variant || item.variant;
  item.productCode = row.productCode || item.productCode;
  item.variantCode = row.variantCode || item.variantCode;
  item.paircode = row.paircode || item.paircode;
  item.info = row.info || item.info;
  item.productName = cleanInfo(item.info) || item.productName;
  item.brand = brandFromInfo(item.info) || item.brand;
}

async function changeItem(itemId, delta, context = {}) {
  const item = state.items.find((entry) => entry.id === itemId);
  if (!item) return null;
  const remainingBefore = item.remaining;

  if (delta < 0 && item.remaining <= 0) {
    setMessage("Tahle položka už má nulový zůstatek.", "warning");
    return null;
  }

  const amount = Math.abs(delta);
  const pendingKey = item.datasetRowId ? `row-${item.datasetRowId}` : "";
  if (pendingKey && pendingAdjustments.has(pendingKey)) {
    setMessage("Na tomhle řádku už čekám na potvrzení od serveru.", "warning");
    return null;
  }

  if (item.datasetRowId) {
    pendingAdjustments.add(pendingKey);
    try {
      const data = await fetchJson(`/api/sorting/rows/${encodeURIComponent(item.datasetRowId)}/adjust`, {
        method: "POST",
        body: JSON.stringify({
          delta,
          mode: context.mode || "",
          ean: context.ean || "",
        }),
      });
      applyServerSortingRow(item, data.row);
      context.actor = data.actor?.displayName || data.actor?.username || "";
    } catch (error) {
      if (error.data?.row) {
        applyServerSortingRow(item, error.data.row);
        saveState();
        renderAll();
      }
      setMessage(`Server odpis nepotvrdil: ${error.message}`, error.status === 409 ? "warning" : "error");
      return null;
    } finally {
      pendingAdjustments.delete(pendingKey);
    }
  } else if (delta < 0) {
    item.remaining = Math.max(0, item.remaining - amount);
  } else {
    item.remaining += amount;
  }

  if (delta < 0 && remainingBefore > 0 && item.remaining <= 0) {
    zeroRowsKeptUntilRefresh.add(item.id);
  }
  if (item.remaining > 0) {
    zeroRowsKeptUntilRefresh.delete(item.id);
  }

  const entry = historyEntry(item, amount, delta < 0 ? "deduct" : "restore", context);
  state.history.unshift(entry);
  state.history = state.history.slice(0, MAX_HISTORY);
  saveState();
  activeCandidates = activeCandidates.filter((candidate) => candidate.item.remaining > 0);
  renderAll();
  return entry;
}

async function undoHistory(historyId) {
  const entry = state.history.find((item) => item.id === historyId);
  if (!entry || entry.type !== "deduct" || entry.undone) return;
  const item = state.items.find((candidate) => candidate.id === entry.itemId);
  if (!item) return;

  const restoreEntry = await changeItem(item.id, entry.amount, { mode: "vrácení odpisu" });
  if (!restoreEntry) return;
  entry.undone = true;
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
      const rawMatchType = eanEntryMatchType(entry, item);
      if (!rawMatchType) return;

      const existing = candidates.get(item.id);
      const exact = rawMatchType === "exact";
      const matchType = exact ? "přesná varianta" : "paircode/prefix";
      if (!existing || exact) {
        candidates.set(item.id, {
          item,
          entry,
          exact,
          matchType,
        });
      }
    });
  });

  return {
    entries,
    candidates: sortEanCandidates(Array.from(candidates.values())),
  };
}

async function processScan(rawValue) {
  const ean = rawValue.replace(/\D/g, "");
  if (ean.length !== 13) return;
  if (scanInProgress) return;

  scanInProgress = true;
  try {
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

    const scanDecision = scanDecisionForCandidates(result.candidates);
    if (scanDecision.mode === "ok") {
      const target = scanDecision.candidates[0];
      const entry = await changeItem(target.item.id, -1, {
        ean,
        mode: "EAN jednoznačná varianta",
      });
      if (entry) {
        showScanResult(entry);
        setMessage(
          `Odepsáno 1 ks podle EANu: ${entry.variantCode}, obj. ${entry.orderNumber}, poř. ${entry.sequence}.`,
          "success"
        );
      }
      return;
    }

    activeCandidates = scanDecision.candidates;
    renderAll();
    setMessage(`EAN ${ean} má více možných shod. Vyber správnou položku.`, "warning");
  } finally {
    scanInProgress = false;
  }
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

els.loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  login();
});

els.passwordChangeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  changePassword();
});

document.addEventListener(
  "error",
  (event) => {
    const image = event.target;
    if (image instanceof HTMLImageElement) {
      image.closest(".product-image-frame")?.classList.add("broken");
    }
  },
  true
);

els.authLogout.addEventListener("click", logout);

els.eanInput.addEventListener("input", () => {
  const digits = els.eanInput.value.replace(/\D/g, "");
  if (digits !== els.eanInput.value) {
    els.eanInput.value = digits;
  }
  if (digits.length === 13) {
    processScan(digits).catch((error) => setMessage(`Sken se nepodařilo zpracovat: ${error.message}`, "error"));
  }
});

els.eanInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    processScan(els.eanInput.value).catch((error) => setMessage(`Sken se nepodařilo zpracovat: ${error.message}`, "error"));
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

els.sortingBody.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const id = button.dataset.id;
  if (button.dataset.action === "deduct") {
    const entry = await changeItem(id, -1, { mode: "ruční odpis" });
    if (entry) setMessage(`Odepsáno 1 ks: ${entry.variantCode}.`, "success");
  }
  if (button.dataset.action === "restore") {
    const entry = await changeItem(id, 1, { mode: "ruční navrácení" });
    if (entry) setMessage(`Vráceno 1 ks: ${entry.variantCode}.`, "success");
  }
});

els.candidateList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action='candidate-deduct']");
  if (!button) return;
  const entry = await changeItem(button.dataset.id, -1, { mode: "výběr z kandidátů" });
  if (entry) {
    showScanResult(entry);
    setMessage(`Odepsáno 1 ks: ${entry.variantCode}, poř. ${entry.sequence}.`, "success");
  }
});

els.historyList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action='undo-history']");
  if (!button) return;
  undoHistory(button.dataset.id).catch((error) => setMessage(`Vrácení odpisu selhalo: ${error.message}`, "error"));
});

els.expeditionRefresh.addEventListener("click", () => loadExpeditionDays(expeditionState.day?.date || ""));
els.expeditionDeleteDay?.addEventListener("click", deleteCurrentExpeditionDay);
els.expeditionDayLockChange?.addEventListener("click", () => {
  removeEmployeeDayLock();
  employeeDayLockState.choosing = true;
  clearSelectedExpeditionDayData();
  renderExpeditionDayOptions();
  setExpeditionDaySummary("", { employeeVisible: false });
});
els.expeditionShowInactive.addEventListener("change", () => loadExpeditionDays(expeditionState.day?.date || ""));
els.expeditionDayList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-date]");
  if (!button) return;
  saveEmployeeDayLock(button.dataset.date);
  loadExpeditionDay(button.dataset.date);
});

els.tabSorting.addEventListener("click", () => switchView("sorting"));
els.tabCompletion.addEventListener("click", () => switchView("completion"));
els.tabEans?.addEventListener("click", () => switchView("eans"));
els.tabSettings.addEventListener("click", () => switchView("settings"));
window.addEventListener("popstate", () => {
  if (!authState.user) return;
  switchView(viewFromRoute(), { updateRoute: false });
});
els.settingsSave.addEventListener("click", saveSettings);
els.settingsUiFont?.addEventListener("change", () => {
  const fontKey = uiFontKey(els.settingsUiFont.value);
  const densityKey = completionDensityKey(els.settingsCompletionDensity?.value);
  applyAppearanceSettings({ appearance: { font: fontKey, completionDensity: densityKey } });
  setSettingsStatus(
    els.settingsStatusFont,
    `${UI_FONT_OPTIONS[fontKey].label} / ${COMPLETION_DENSITY_OPTIONS[densityKey]}`,
    "ok"
  );
});
els.settingsCompletionDensity?.addEventListener("change", () => {
  const fontKey = uiFontKey(els.settingsUiFont?.value);
  const densityKey = completionDensityKey(els.settingsCompletionDensity.value);
  applyAppearanceSettings({ appearance: { font: fontKey, completionDensity: densityKey } });
  setSettingsStatus(
    els.settingsStatusFont,
    `${UI_FONT_OPTIONS[fontKey].label} / ${COMPLETION_DENSITY_OPTIONS[densityKey]}`,
    "ok"
  );
});
els.productFeedTest.addEventListener("click", testProductFeed);
els.usersRefresh.addEventListener("click", loadUsers);
els.userCreateSubmit.addEventListener("click", createUserFromForm);
els.usersList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  if (button.dataset.action === "reset-user-password") {
    resetUserPassword(button.dataset.userId);
  }
  if (button.dataset.action === "toggle-user-active") {
    patchUser(button.dataset.userId, { active: button.dataset.active === "1" }).catch((error) => {
      setSettingsMessage(`Změna stavu uživatele selhala: ${error.message}`, "error");
    });
  }
});
els.usersList.addEventListener("change", (event) => {
  const select = event.target.closest("select[data-action='change-user-role']");
  if (!select) return;
  patchUser(select.dataset.userId, { role: select.value }).catch((error) => {
    setSettingsMessage(`Změna role selhala: ${error.message}`, "error");
    loadUsers();
  });
});
els.sortingRefresh.addEventListener("click", () => {
  loadSortingDataset(els.sortingDataset.value);
});
els.sortingDataset.addEventListener("change", () => {
  loadSortingDataset(els.sortingDataset.value);
});
els.completionRefresh.addEventListener("click", () => loadCompletionDatasets());
els.paymentFeedSync.addEventListener("click", syncPaymentFeedsManually);
els.completionDataset.addEventListener("change", () => {
  loadCompletionDataset(els.completionDataset.value);
});
els.workflowBoxCode.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    scanWorkflowBox().catch((error) => setWorkflowMessage(`Načtení boxu selhalo: ${error.message}`, "error"));
  }
});
els.workflowBoxCode.addEventListener("input", () => {
  const code = els.workflowBoxCode.value.trim();
  if (/^x\s*\d+\s*s$/i.test(code)) {
    scanWorkflowBox().catch((error) => setWorkflowMessage(`Načtení boxu selhalo: ${error.message}`, "error"));
  }
});
els.workflowExpeditionNumber.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    selectWorkflowNumberFromInput();
  } else if (event.key === "Escape") {
    event.preventDefault();
    clearWorkflowNumberInputTimer();
    setWorkflowExpeditionNumberText(workflowExpeditionNumberText(completionWorkflowState.row));
    els.workflowBoxCode?.focus();
  }
});
els.workflowExpeditionNumber.addEventListener("input", scheduleWorkflowNumberInputSelection);
els.workflowExpeditionNumber.addEventListener("change", selectWorkflowNumberFromInput);
els.workflowExpeditionNumber.addEventListener("focus", () => {
  els.workflowExpeditionNumber.select?.();
});
els.workflowPrev.addEventListener("click", () => moveWorkflow(-1));
els.workflowNext.addEventListener("click", () => moveWorkflow(1));
els.workflowSaveOk.addEventListener("click", () => saveWorkflowAction("ok"));
els.workflowUnpaid.addEventListener("click", () => saveWorkflowActionAndPrint("unpaid", "unpaid"));
els.workflowError.addEventListener("click", () => saveWorkflowActionAndPrint("error", "error"));
els.workflowUnpaidError.addEventListener("click", () => saveWorkflowActionAndPrint("unpaid_error", "unpaid_error"));
els.workflowClearError.addEventListener("click", () => saveWorkflowAction("clear_error"));
els.workflowManualReprint.addEventListener("click", () => saveWorkflowAction("manual_reprint"));
els.workflowOpenOrder.addEventListener("click", openWorkflowOrder);
setInterval(pollPaymentFeedUpdates, 30000);

els.completionBody.addEventListener("click", (event) => {
  const interactiveTarget = event.target.closest("button, input, select, textarea, a, label");
  if (!interactiveTarget) {
    const mainRow = event.target.closest("tr.completion-main-row");
    if (mainRow?.dataset.completionRowId) {
      toggleCompletionDetail(mainRow.dataset.completionRowId);
    }
    return;
  }

  const button = event.target.closest("button[data-action]");
  if (!button) return;
  if (button.dataset.action === "save-completion-row") {
    saveCompletionRow(button.dataset.rowId);
  }
  if (button.dataset.action === "validate-address") {
    validateCompletionAddress(button.dataset.rowId);
  }
  if (button.dataset.action === "open-shop-order") {
    const row = completionState.rows.find((item) => String(item.id) === String(button.dataset.rowId));
    openCompletionOrder(row);
  }
  if (button.dataset.action === "send-carrier-row") {
    sendCompletionCarrier(button.dataset.rowId);
  }
  if (button.dataset.action === "print-carrier-label") {
    printCompletionCarrierLabel(button.dataset.rowId);
  }
  if (button.dataset.action === "download-carrier-label") {
    downloadCompletionCarrierLabel(button.dataset.rowId);
  }
});
els.completionFilterSearch?.addEventListener("input", () => {
  completionFilters.search = els.completionFilterSearch.value.trim();
  renderCompletion();
});
els.completionFilterCarrier?.addEventListener("change", () => {
  completionFilters.carrier = els.completionFilterCarrier.value;
  renderCompletion();
});
els.completionFilterFlow?.addEventListener("change", () => {
  completionFilters.flow = els.completionFilterFlow.value;
  renderCompletion();
});
els.completionFilterStatus?.addEventListener("change", () => {
  completionFilters.status = els.completionFilterStatus.value;
  renderCompletion();
});
els.completionFilterShop?.addEventListener("change", () => {
  completionFilters.shop = els.completionFilterShop.value;
  renderCompletion();
});
els.completionFilterReset?.addEventListener("click", () => {
  completionFilters.search = "";
  completionFilters.flow = "";
  completionFilters.carrier = "";
  completionFilters.status = "";
  completionFilters.shop = "";
  els.completionFilterSearch.value = "";
  if (els.completionFilterFlow) els.completionFilterFlow.value = "";
  els.completionFilterCarrier.value = "";
  els.completionFilterStatus.value = "";
  els.completionFilterShop.value = "";
  renderCompletion();
});
els.eansFilterSearch?.addEventListener("input", () => {
  eanFilters.search = els.eansFilterSearch.value.trim();
  renderEanAudit();
});
els.eansFilterRisk?.addEventListener("change", () => {
  eanFilters.risk = els.eansFilterRisk.value;
  renderEanAudit();
});
els.eansFilterMatch?.addEventListener("change", () => {
  eanFilters.match = els.eansFilterMatch.value;
  renderEanAudit();
});
els.eansFilterShop?.addEventListener("change", () => {
  eanFilters.shop = els.eansFilterShop.value;
  renderEanAudit();
});
els.eansFilterSort?.addEventListener("change", () => {
  eanFilters.sort = els.eansFilterSort.value;
  renderEanAudit();
});
els.eansFilterReset?.addEventListener("click", () => {
  eanFilters.search = "";
  eanFilters.risk = "ambiguous";
  eanFilters.match = "";
  eanFilters.shop = "";
  eanFilters.sort = "risk";
  if (els.eansFilterSearch) els.eansFilterSearch.value = "";
  if (els.eansFilterRisk) els.eansFilterRisk.value = eanFilters.risk;
  if (els.eansFilterMatch) els.eansFilterMatch.value = "";
  if (els.eansFilterShop) els.eansFilterShop.value = "";
  if (els.eansFilterSort) els.eansFilterSort.value = eanFilters.sort;
  renderEanAudit();
});
els.completionValidateAddresses?.addEventListener("click", validateAddressDeliveriesBulk);
els.addressValidationLogRefresh?.addEventListener("click", loadAddressValidationLog);
els.addressValidationLog?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action='revert-address-log']");
  if (!button) return;
  revertAddressValidationLog(button.dataset.logId);
});
els.packetaDryRun.addEventListener("click", runPacketaDryRun);
els.packetaValidate.addEventListener("click", runPacketaValidation);
els.packetaSend?.addEventListener("click", runPacketaSend);
els.labelCacheBatch?.addEventListener("click", runLabelCacheBatch);
els.dpdDryRun.addEventListener("click", runDpdDryRun);
els.dpdSend.addEventListener("click", runDpdSend);
els.printAgentTest?.addEventListener("click", testPrintAgent);
els.workflowItems?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action='workflow-check-item']");
  if (!button || !els.workflowItems.contains(button)) return;
  const key = button.dataset.checkKey;
  if (!key) return;
  if (completionWorkflowState.checkedItemKeys.has(key)) {
    completionWorkflowState.checkedItemKeys.delete(key);
  } else {
    completionWorkflowState.checkedItemKeys.add(key);
  }
  renderWorkflow();
  const physicalCheck = workflowPhysicalCheck(completionWorkflowState.row);
  setWorkflowMessage(
    physicalCheck.ok
      ? "Všechny položky v boxu jsou fyzicky odkontrolované. Teď můžeš uložit OK."
      : `Odkontrolováno ${physicalCheck.checked}/${physicalCheck.total} položek v boxu.`,
    physicalCheck.ok ? "success" : "neutral"
  );
});
els.expeditionBatchReport?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action='print-batch-report']");
  if (!button || !els.expeditionBatchReport.contains(button)) return;
  printExpeditionBatchReport();
});

checkAuth();

function ensurePrintInstallTopLink() {
  if (document.getElementById("print-install-top-link")) return;
  const logoutButton =
    document.getElementById("logout-button") ||
    document.getElementById("logout") ||
    Array.from(document.querySelectorAll("button")).find((button) => button.textContent.trim() === "Odhlásit");
  if (!logoutButton || !logoutButton.parentElement) return;

  const link = document.createElement("a");
  link.id = "print-install-top-link";
  link.href = "print-agent.html";
  link.className = "button-link secondary";
  link.textContent = "Instalace tisku";
  link.style.textDecoration = "none";
  link.style.whiteSpace = "nowrap";
  link.style.marginRight = "8px";

  logoutButton.parentElement.insertBefore(link, logoutButton);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", ensurePrintInstallTopLink);
} else {
  ensurePrintInstallTopLink();
}
