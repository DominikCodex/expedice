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
    brand: item.brand || "",
    unitPrice: item.unitPrice || "",
    lineTotal: item.lineTotal || "",
    productName: item.productName || cleanInfo(item.info),
    externalId: item.externalId || "",
    image: item.image || "",
  };
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
    els.sortingBody.innerHTML = `<tr><td colspan="10" class="empty">Nic nenalezeno.</td></tr>`;
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
        <div class="row-actions">
          <button type="button" data-action="deduct" data-id="${escapeHtml(item.id)}" ${item.remaining <= 0 ? "disabled" : ""}>-1</button>
          <button type="button" class="undo" data-action="restore" data-id="${escapeHtml(item.id)}">+1</button>
        </div>
      </td>
      <td>${escapeHtml(item.brand)}</td>
      <td>${escapeHtml(item.productName || item.info)}</td>
      <td>${imageCell}</td>
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
    div.innerHTML = `
      <strong>${escapeHtml(sign)}${entry.amount} ks - ${escapeHtml(entry.variantCode || entry.productCode)}${escapeHtml(undone)}</strong>
      <div>${escapeHtml(entry.variant || entry.productName || "")}</div>
      <div class="history-meta">
        ${escapeHtml(formatTime(entry.at))} | obj. ${escapeHtml(entry.orderNumber)} | poř. ${escapeHtml(entry.sequence || "-")} | zůstává ${escapeHtml(entry.remainingAfter)}
      </div>
      ${
        entry.ean
          ? `<div class="history-meta">EAN ${escapeHtml(entry.ean)} | ${escapeHtml(entry.mode || "")}</div>`
          : `<div class="history-meta">${escapeHtml(entry.mode || "ručně")}</div>`
      }
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

loadState();
renderAll();
setMessage(
  `Načteno ${state.items.length} řádků, ${Object.keys(state.eanMap).length} EAN kódů, objednávek: ${
    new Set(state.items.map((item) => item.orderNumber).filter(Boolean)).size
  }.`,
  "neutral"
);
requestAnimationFrame(() => els.eanInput.focus());
