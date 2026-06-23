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
};

const completionFilters = {
  search: "",
  carrier: "",
  status: "",
  shop: "",
};

const expandedCompletionRows = new Set();

const completionWorkflowState = {
  row: null,
  index: -1,
};
const workflowAutoPrintedRows = new Set();

const settingsState = {
  loaded: false,
  settings: null,
};

const authState = {
  user: null,
  appStarted: false,
};

const VIEW_ROUTES = {
  sorting: "/roztrideni",
  completion: "/kompletace",
  settings: "/nastaveni",
};

const ROUTE_VIEWS = {
  "/": "sorting",
  "/roztrideni": "sorting",
  "/kompletace": "completion",
  "/nastaveni": "settings",
};

const usersState = {
  users: [],
  loaded: false,
};

const els = {
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
  expeditionShowInactive: document.getElementById("show-inactive-datasets"),
  expeditionDaySummary: document.getElementById("expedition-day-summary"),
  tabSorting: document.getElementById("tab-sorting"),
  tabCompletion: document.getElementById("tab-completion"),
  tabSettings: document.getElementById("tab-settings"),
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
  settingsView: document.getElementById("settings-view"),
  settingsSave: document.getElementById("settings-save"),
  settingsMessage: document.getElementById("settings-message"),
  settingsMapyKey: document.getElementById("settings-mapy-key"),
  settingsMapyStatus: document.getElementById("settings-mapy-status"),
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

async function fetchJson(path, options = {}) {
  const headers = options.body
    ? { "Content-Type": "application/json", ...(options.headers || {}) }
    : options.headers || {};
  const response = await fetch(path, { cache: "no-store", ...options, headers });
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
}

function isAdmin() {
  return authState.user?.role === "admin";
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
  setAuthMessage("Tohle je první přihlášení nebo reset hesla. Nejdřív prosím nastav nové heslo.", "warning");
  requestAnimationFrame(() => els.changeCurrentPassword.focus());
}

function applyRoleVisibility() {
  const admin = isAdmin();
  els.tabSettings.classList.toggle("hidden", !admin);
  els.sortingDelete.classList.toggle("hidden", !admin);
  els.completionDelete.classList.toggle("hidden", !admin);
  els.packetaValidate.classList.toggle("hidden", !admin);
  els.packetaSend?.classList.toggle("hidden", !admin);
  els.labelCacheBatch?.classList.toggle("hidden", !admin);
  els.dpdSend.classList.toggle("hidden", !admin);
  if (!admin && !els.settingsView.classList.contains("hidden")) {
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
  els.authView.classList.add("hidden");
  els.appShell.classList.remove("hidden");
  els.authUserName.textContent = `${user.displayName || user.username} · ${user.role === "admin" ? "admin" : "zaměstnanec"}`;
  applyRoleVisibility();

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
    if (data.user.mustChangePassword) {
      showPasswordChange(data.user);
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
    if (data.user?.mustChangePassword) {
      showPasswordChange(data.user);
      return;
    }
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

function switchView(view, options = {}) {
  if (view === "settings" && !isAdmin()) {
    setMessage("Nastavení je dostupné jen adminovi.", "warning");
    view = "sorting";
  }
  const completion = view === "completion";
  const settings = view === "settings";
  els.sortingView.classList.toggle("hidden", completion || settings);
  els.completionView.classList.toggle("hidden", !completion);
  els.settingsView.classList.toggle("hidden", !settings);
  els.tabSorting.classList.toggle("active", !completion && !settings);
  els.tabCompletion.classList.toggle("active", completion);
  els.tabSettings.classList.toggle("active", settings);

  if (completion && !completionState.loaded) {
    loadCompletionDatasets();
  }

  if (settings && !settingsState.loaded) {
    loadSettings();
  }

  if (settings && isAdmin() && !usersState.loaded) {
    loadUsers();
  }

  if (!completion && !settings) {
    requestAnimationFrame(() => els.eanInput.focus());
  }

  if (options.updateRoute !== false) {
    setRouteForView(view, Boolean(options.replaceRoute));
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
      completionWorkflowState.row = null;
      completionWorkflowState.index = -1;
      renderExpeditionDayOptions();
      renderSortingOptions();
      renderCompletionOptions();
      renderWorkflow();
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
      completionWorkflowState.row = null;
      completionWorkflowState.index = -1;
      renderCompletionOptions();
      renderWorkflow();
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
    completionWorkflowState.row = null;
    completionWorkflowState.index = -1;
    renderCompletionOptions();
    renderWorkflow();
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
  els.completionDelete.disabled = !completionState.dataset || completionState.dataset.status !== "active";
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
  await loadExpeditionDays();
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
  renderWorkflow();
  renderCompletion();
  loadAddressValidationLog();
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
        <h2>Příprava štítků dávky</h2>
      </div>
      <div class="dry-run-counts">
        <span>${escapeHtml(data.readyCount || 0)} připraveno</span>
        <span>${escapeHtml(data.skippedCount || 0)} přeskočeno</span>
        <span>${escapeHtml(data.errorCount || 0)} chyb</span>
      </div>
    </div>
    <div class="dry-run-note">
      Hotové štítky se uložily na server. Sken expedičního boxu už bude tisknout z cache bez volání API dopravce.
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
      `Připravit PDF štítky na server pro tuto konkrétní dávku?\n\n${datasetLabel(
        completionState.dataset
      )}\n\nSystém stáhne jen chybějící štítky. Už připravené štítky nepřepíše.`
    )
  ) {
    return;
  }

  els.labelCacheBatch.disabled = true;
  hidePacketaDryRunResult();
  setCompletionMessage("Připravuji štítky dávky na server...", "neutral");
  try {
    const data = await fetchJson("/api/labels/cache-batch", {
      method: "POST",
      body: JSON.stringify({ datasetId: completionState.dataset.id }),
    });
    (data.rows || []).forEach((row) => replaceCompletionRow(row));
    renderWorkflow();
    renderCompletion();
    renderLabelCacheResult(data);
    setCompletionMessage(
      `Příprava štítků hotová: ${data.readyCount || 0} připraveno, ${data.skippedCount || 0} přeskočeno, ${
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

function paymentCheckKind(row) {
  return normalize(row?.paymentCheckStatus || "");
}

function paymentCheckLabel(row) {
  const status = paymentCheckKind(row);
  if (status === "paid") return "Zaplaceno";
  if (status === "cod") return "Dobírka";
  if (status === "unpaid") return "Nezaplaceno";
  if (status === "storno") return "STORNO";
  if (status === "missing") return "Platba nezjištěna";
  if (status === "unknown") return "Platba nejasná";
  return "";
}

function paymentCheckTone(row) {
  const status = paymentCheckKind(row);
  if (status === "paid" || status === "cod") return "ok";
  if (status === "unpaid" || status === "missing" || status === "unknown") return "warning";
  if (status === "storno") return "danger";
  return "neutral";
}

function paymentCheckHtml(row) {
  const label = paymentCheckLabel(row);
  if (!label) return "";
  const tone = paymentCheckTone(row);
  const title = row?.paymentCheckMessage || row?.paymentCheckSourceStatus || "";
  return `<span class="payment-check-badge ${tone}" title="${escapeHtml(title)}">${escapeHtml(label)}</span>`;
}

function renderSettings(settings) {
  const mapy = settings.mapy || {};
  const paymentFeeds = settings.paymentFeeds || {};
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

  els.settingsMapyKey.value = "";
  els.settingsMapyStatus.textContent = mapy.hasApiKey ? "API key je uložený." : "API key zatím není uložený.";
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

async function loadSettings() {
  setSettingsMessage("Načítám nastavení...", "neutral");
  try {
    const data = await fetchJson("/api/settings");
    settingsState.settings = data.settings || {};
    settingsState.loaded = true;
    renderSettings(settingsState.settings);
    setSettingsMessage("Nastavení je načtené.", "success");
  } catch (error) {
    setSettingsMessage(`Nastavení se nepodařilo načíst: ${error.message}`, "error");
  }
}

function collectSettings() {
  return {
    mapy: {
      apiKey: els.settingsMapyKey.value.trim(),
    },
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
    setSettingsMessage("Nastavení je uložené.", "success");
  } catch (error) {
    setSettingsMessage(`Nastavení se nepodařilo uložit: ${error.message}`, "error");
  } finally {
    els.settingsSave.disabled = false;
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
  const params = new URLSearchParams({ datasetId: completionState.dataset.id });
  if (completionState.paymentUpdatesSince) {
    params.set("since", completionState.paymentUpdatesSince);
  }
  try {
    const data = await fetchJson(`/api/payment-feeds/updates?${params.toString()}`);
    completionState.paymentUpdatesSince = data.serverTime || new Date().toISOString();
    const rows = data.rows || [];
    if (!rows.length) return;
    let visibleChanged = false;
    rows.forEach((row) => {
      replaceCompletionRow(row);
      if (completionMatchesFilters(row)) visibleChanged = true;
      if (completionWorkflowState.row && String(completionWorkflowState.row.id) === String(row.id)) {
        completionWorkflowState.row = row;
        renderWorkflowRow(row);
      }
    });
    if (visibleChanged) {
      renderCompletionRows();
      setCompletionMessage(`Platební stavy aktualizovány: ${rows.length} změn.`, "warning");
    }
  } catch (error) {
    console.warn("Payment feed update polling failed", error);
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

async function sendCompletionCarrier(rowId) {
  const row = completionState.rows.find((item) => String(item.id) === String(rowId));
  const carrierLabel = row?.deliveryCarrierLabel || "dopravce";
  const orderNumber = row?.orderNumber || rowId;
  const alreadySent = row?.packetaShipmentId || row?.labelPrinted;
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

async function printCompletionCarrierLabel(rowId, setStatus = setCompletionMessage) {
  const row = completionState.rows.find((item) => String(item.id) === String(rowId));
  const labelNumber = row?.packetaShipmentId || "";
  if (!labelNumber) {
    setStatus("Řádek zatím nemá číslo zásilky/štítku.", "warning");
    return false;
  }

  const url = `/api/completion/rows/${encodeURIComponent(rowId)}/label?markPrinted=1`;
  const carrier = row.deliveryCarrier || (String(labelNumber).length === 14 ? "dpd" : "packeta");
  setStatus(`Posílám štítek ${labelNumber} do lokálního tiskového agenta...`, "neutral");

  try {
    const result = await printPdfViaAgent({
      pdfUrl: url,
      type: "carrier_label",
      carrier,
      filename: `${labelNumber}.pdf`,
    });
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
  const labelNumber = row?.packetaShipmentId || "";
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

async function printCompletionIssueDocument(rowId, kind, setStatus = setCompletionMessage) {
  const row = completionState.rows.find((item) => String(item.id) === String(rowId));
  const labels = {
    unpaid: "nezaplacenku",
    error: "errorku",
    unpaid_error: "nezaplaceno + error",
  };
  const label = labels[kind] || "kontrolní papír";
  const orderNumber = row?.orderNumber || rowId;
  const url = `/api/completion/rows/${encodeURIComponent(rowId)}/issue-document?kind=${encodeURIComponent(kind)}`;
  setStatus(`Tisknu ${label} pro objednávku ${orderNumber} na výchozí tiskárnu...`, "neutral");

  try {
    const result = await printPdfViaAgent({
      pdfUrl: url,
      type: "default",
      carrier: "",
      filename: `${kind}-${orderNumber}.pdf`,
    });
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
    window.alert(addressValidationPopupSummary({ checked: 0, skippedOk, failed: 0, addressErrors: 0, results: [] }));
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
    window.alert(addressValidationPopupSummary({ checked, skippedOk, failed, addressErrors, results }));
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
  if (normalize(row.paidStatus).includes("nezaplaceno")) return { label: "NEZAPLACENO", tone: "warning" };
  if (row.completionStatus) return { label: row.completionStatus, tone: "neutral" };
  return { label: "čeká", tone: "neutral" };
}

function renderCompletionSummary(rows) {
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

function addressValidationPopupSummary({ checked, skippedOk, failed, addressErrors, results }) {
  const verified = results.filter((item) => item.data?.valid).length;
  const replaced = results.filter((item) => item.data?.appliedSuggestion).length;
  const completed = results.filter((item) => item.data?.appliedAddressCompletion).length;
  const cleaned = results.filter((item) => item.data?.appliedAddressCleanup).length;
  const carrierNotes = results.filter((item) => item.data?.appliedCarrierNote).length;
  const notFound = results.filter((item) => item.data?.status === "not_found").length;
  return [
    "Ověření adres je hotové.",
    "",
    `Nově zkontrolováno: ${checked}`,
    `Již OK přeskočeno: ${skippedOk}`,
    `Ověřeno jako v pořádku: ${verified}`,
    `Přepsané návrhy adres: ${replaced}`,
    `Doplněné chybějící údaje: ${completed}`,
    `Očištěné adresy: ${cleaned}`,
    `Doplněné poznámky pro přepravce: ${carrierNotes}`,
    `Nenalezeno: ${notFound}`,
    `Chyby volání: ${failed}`,
    `Aktuálně problematické adresy: ${addressErrors}`,
    "",
    "Detail je uložený dole v Logu ověření adres.",
  ].join("\n");
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
  if (row.packetaShipmentId || row.labelPrinted) tones.push("has-label");
  return tones.join(" ");
}

function completionMainBadges(row, status) {
  const badges = [
    `<span class="completion-type-badge ${escapeHtml(completionCarrierTone(row))}">${escapeHtml(
      row.deliveryCarrierLabel || "Ruční"
    )}</span>`,
    `<span class="status-chip ${escapeHtml(status.tone)}">${escapeHtml(status.label)}</span>`,
  ];
  if (row.packetaShipmentId || row.labelPrinted) {
    badges.push(`<span class="completion-type-badge has-label">štítek</span>`);
  }
  const paymentBadge = paymentCheckHtml(row);
  if (paymentBadge) badges.push(paymentBadge);
  if (normalize(row.paidStatus).includes("nezaplaceno") || normalize(row.completionStatus).includes("nezaplaceno")) {
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
    return Boolean(row.packetaShipmentId || row.labelPrinted);
  }
  if (completionFilters.status === "address_error") {
    return completionRequiresAddressValidation(row) && completionAddressHasError(row);
  }
  if (completionFilters.status === "open") {
    return !row.completionStatus && status.tone !== "ok" && !row.packetaShipmentId && !row.labelPrinted;
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

function completionDetailHtml(row) {
  const editableAddress = row.streetWithNumber || [row.street, row.houseNumber].filter(Boolean).join(" ");
  return `
    <div class="completion-detail-grid">
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
  if (!row.packetaShipmentId) return "";
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
  const labelNumber = row.packetaShipmentId || "";
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

async function printPdfViaAgent({ pdfUrl, type, carrier, filename }) {
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
  const boxMatch = text.match(/^X\s*(\d+)\s*S$/);
  if (boxMatch) return boxMatch[1];
  if (/^\d+$/.test(text)) return text;
  return "";
}

function workflowRowsSorted() {
  return [...completionState.rows]
    .filter((row) => row.expeditionNumber || row.expeditionOrderCode)
    .sort((a, b) => toNumber(a.expeditionNumber || a.expeditionOrderCode, 0) - toNumber(b.expeditionNumber || b.expeditionOrderCode, 0));
}

function findWorkflowRowByNumber(number) {
  const normalized = String(number || "").replace(/^0+/, "");
  return workflowRowsSorted().find((row) => {
    const expeditionNumber = String(row.expeditionNumber || row.expeditionOrderCode || "").replace(/^0+/, "");
    return expeditionNumber === normalized;
  });
}

function workflowStatusTone(row) {
  const status = normalize(row?.completionStatus || "");
  const paymentStatus = paymentCheckKind(row);
  if (!row) return "neutral";
  if (paymentStatus === "storno") return "danger";
  if (["unpaid", "missing", "unknown"].includes(paymentStatus)) return "warning";
  if (status.includes("error")) return "danger";
  if (status.includes("nezaplac")) return "warning";
  if (status.includes("ok")) return "ok";
  return "neutral";
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
  return text.includes("nezaplac") || text.includes("neuhrazen");
}

async function autoPrintWorkflowDocuments(row, boxNumber) {
  if (!row?.id) return;
  const key = workflowAutoPrintKey(row);
  if (workflowAutoPrintedRows.has(key)) {
    setWorkflowMessage(`Načten box X${boxNumber}S: objednávka ${row.orderNumber || "-"}. Automatický tisk už v této relaci proběhl.`, "warning");
    return;
  }

  const hasCarrierLabel = Boolean(row.packetaShipmentId);
  const needsUnpaidDocument = workflowIsUnpaid(row);
  if (!hasCarrierLabel && !needsUnpaidDocument) return;

  workflowAutoPrintedRows.add(key);
  const printed = [];
  if (hasCarrierLabel) {
    const labelPrinted = await printCompletionCarrierLabel(row.id, setWorkflowMessage);
    if (labelPrinted) printed.push("štítek dopravce");
  }
  if (needsUnpaidDocument) {
    await printCompletionIssueDocument(row.id, "unpaid", setWorkflowMessage);
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

function workflowItemsHtml(row) {
  if (!row) return "Po načtení boxu zobrazím obsah objednávky.";
  const quantity = row.quantity || "";
  const parts = [
    row.orderNumber ? `Objednávka ${row.orderNumber}` : "",
    quantity ? `${quantity} ks` : "",
    row.weight ? `${row.weight} kg` : "",
    row.shippingMethod || "",
  ].filter(Boolean);
  const note = row.note ? `<small>${escapeHtml(row.note)}</small>` : "";
  return `
    <strong>${escapeHtml(parts.join(" | ") || "Objednávka")}</strong>
    ${note}
    <small>${escapeHtml(row.email || "")}${row.phone ? ` | ${escapeHtml(row.phone)}` : ""}</small>
  `;
}

function renderWorkflow() {
  const row = completionWorkflowState.row;
  const fullName = row ? `${row.firstName || ""} ${row.lastName || ""}`.trim() : "Načti expediční box";
  const expeditionNumber = row?.expeditionNumber || row?.expeditionOrderCode || "-";
  const tone = workflowStatusTone(row);
  const statusText = row?.completionStatus || (row ? "Rozpracováno" : "Čekám na sken boxu");
  const isDpd = row && (row.delivery?.isDpd || normalize(row.shippingMethod || "").includes("dpd"));
  const paymentWarning = row && ["storno", "unpaid", "missing", "unknown"].includes(paymentCheckKind(row));

  els.workflowExpeditionNumber.textContent = expeditionNumber;
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
  els.workflowItems.innerHTML = workflowItemsHtml(row);
  els.workflowNote.textContent = [row?.completionStatus ? `Stav kompletace: ${row.completionStatus}` : "", row?.paymentCheckSourceStatus ? `Feed: ${row.paymentCheckSourceStatus}` : ""]
    .filter(Boolean)
    .join(" | ");
  const warnings = [];
  if (paymentWarning) warnings.push(`${paymentCheckLabel(row)}: ${row.paymentCheckMessage || "zkontroluj objednávku před odesláním"}`);
  if (isDpd) warnings.push("Pozor: Doručení přes DPD = jiný svoz");
  els.workflowWarning.classList.toggle("hidden", !warnings.length);
  els.workflowWarning.textContent = warnings.join(" | ");

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
}

function selectWorkflowRow(row, message = "") {
  if (!row) return;
  const sorted = workflowRowsSorted();
  completionWorkflowState.row = row;
  completionWorkflowState.index = sorted.findIndex((entry) => entry.id === row.id);
  renderWorkflow();
  if (message) setWorkflowMessage(message, "success");
}

async function scanWorkflowBox() {
  const number = parseWorkflowBoxCode(els.workflowBoxCode.value);
  if (!number) {
    setWorkflowMessage("Box musí být ve tvaru X16S, případně jen číslo 16.", "warning");
    return;
  }
  if (!completionState.rows.length) {
    setWorkflowMessage("Nejdřív načti kompletaci pro expediční den.", "warning");
    return;
  }
  const row = findWorkflowRowByNumber(number);
  if (!row) {
    setWorkflowMessage(`Expediční číslo ${number} v načtené kompletaci nevidím.`, "error");
    return;
  }
  selectWorkflowRow(row, `Načten box X${number}S: objednávka ${row.orderNumber || "-"}.`);
  els.workflowBoxCode.value = "";
  await autoPrintWorkflowDocuments(row, number);
}

function moveWorkflow(delta) {
  const sorted = workflowRowsSorted();
  if (!sorted.length) return;
  const currentIndex = completionWorkflowState.index >= 0 ? completionWorkflowState.index : 0;
  const nextIndex = Math.max(0, Math.min(sorted.length - 1, currentIndex + delta));
  selectWorkflowRow(sorted[nextIndex], `Expediční číslo ${sorted[nextIndex].expeditionNumber || sorted[nextIndex].expeditionOrderCode}.`);
}

function updateCompletionRowInState(row) {
  const index = completionState.rows.findIndex((entry) => entry.id === row.id);
  if (index >= 0) completionState.rows[index] = row;
  if (completionWorkflowState.row?.id === row.id) {
    completionWorkflowState.row = row;
  }
}

async function saveWorkflowAction(action) {
  const row = completionWorkflowState.row;
  if (!row) return null;
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
  if (!row?.orderId && !row?.orderNumber) return;
  setWorkflowMessage(`V1 zatím jen označuje objednávku ${row.orderNumber || row.orderId}. Odkaz na e-shop doplníme podle URL administrací e-shopů.`, "warning");
}

function renderCompletion() {
  const allRows = completionState.rows;
  renderCompletionFilterOptions(allRows);
  const rows = filteredCompletionRows();
  els.completionRowCount.textContent = `${rows.length} / ${allRows.length} řádků`;
  renderCompletionSummary(rows);
  els.completionBody.innerHTML = "";
  els.completionDelete.disabled = !completionState.dataset || completionState.dataset.status !== "active";

  if (!rows.length) {
    els.completionBody.innerHTML = `<tr><td colspan="14" class="empty">Zadna kompletace k zobrazeni.</td></tr>`;
    return;
  }

  rows.forEach((row) => {
    const status = completionStatus(row);
    const customer = [row.firstName, row.lastName].filter(Boolean).join(" ");
    const address = [row.city, row.zipCode].filter(Boolean).join(" ");
    const shop = row.shopCode || completionState.dataset?.shopCode || "-";
    const labelOrShipment = row.labelPrinted || row.packetaShipmentId || "";
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
          ${carrierSendActionHtml(row)}
        </div>
      </td>
      <td class="completion-sequence">
        <strong class="code">${escapeHtml(row.expeditionNumber || row.rowNumber || "")}</strong>
        <span class="shop-chip">${escapeHtml(shop)}</span>
      </td>
      <td class="completion-order-cell">
        <strong class="code">${escapeHtml(row.orderNumber || "-")}</strong>
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
                  ${user.mustChangePassword ? `<span class="status-chip warning">musí změnit heslo</span>` : ""}
                </td>
                <td>
                  <select data-action="change-user-role" data-user-id="${escapeHtml(user.id)}" ${self ? "disabled" : ""}>
                    <option value="employee" ${user.role === "employee" ? "selected" : ""}>Zaměstnanec</option>
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
    setSettingsMessage("Uživatel byl vytvořený. Při prvním přihlášení si změní heslo.", "success");
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
  const password = prompt("Zadej nové dočasné heslo pro zaměstnance:");
  if (!password) return;
  try {
    await fetchJson(`/api/users/${userId}/reset-password`, {
      method: "POST",
      body: JSON.stringify({ password }),
    });
    setSettingsMessage("Heslo bylo resetované a uživatel ho po přihlášení změní.", "success");
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

    const exactCandidates = result.candidates.filter((candidate) => candidate.matchType === "přesná varianta");
    if (result.entries.length === 1 && exactCandidates.length === 1) {
      const entry = await changeItem(exactCandidates[0].item.id, -1, {
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
els.expeditionShowInactive.addEventListener("change", () => loadExpeditionDays(expeditionState.day?.date || ""));
els.expeditionDayList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-date]");
  if (!button) return;
  loadExpeditionDay(button.dataset.date);
});

els.tabSorting.addEventListener("click", () => switchView("sorting"));
els.tabCompletion.addEventListener("click", () => switchView("completion"));
els.tabSettings.addEventListener("click", () => switchView("settings"));
window.addEventListener("popstate", () => {
  if (!authState.user) return;
  switchView(viewFromRoute(), { updateRoute: false });
});
els.settingsSave.addEventListener("click", saveSettings);
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
  completionFilters.carrier = "";
  completionFilters.status = "";
  completionFilters.shop = "";
  els.completionFilterSearch.value = "";
  els.completionFilterCarrier.value = "";
  els.completionFilterStatus.value = "";
  els.completionFilterShop.value = "";
  renderCompletion();
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
