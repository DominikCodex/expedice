const STORAGE_KEY = "expedice-state-v1";

let state = {
  items: [],
  shipments: [],
};

const STATUS_LABELS = {
  received: "Příjem",
  sorted: "Rozřazeno",
  inShipment: "Připraveno k expedici",
  shipped: "Expedováno",
};

const STATUS_CLASS = {
  received: "badge sorting",
  sorted: "badge ready",
  inShipment: "badge ready",
  shipped: "badge shipped",
};

const storageKey = STORAGE_KEY;

const tabs = document.querySelectorAll("[data-tab]");
const arrivalBody = document.getElementById("arrival-body");
const sortingBody = document.getElementById("sorting-body");
const sortingFilter = document.getElementById("sorting-filter");
const candidatesBody = document.getElementById("shipment-candidates");
const shipmentsBody = document.getElementById("shipments-body");
const arrivalForm = document.getElementById("arrival-form");
const shipmentForm = document.getElementById("shipment-form");
const exportButton = document.getElementById("export-data");
const importInput = document.getElementById("import-data");
const shipAtInput = shipmentForm.querySelector('input[name="shipAt"]');

function uid(prefix = "it") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function fmtDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("cs-CZ", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function loadState() {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;
    state = {
      items: Array.isArray(parsed.items) ? parsed.items : [],
      shipments: Array.isArray(parsed.shipments) ? parsed.shipments : [],
    };
  } catch {
    console.warn("Nepodařilo se načíst uložená data.");
  }
}

function normalize(text = "") {
  return text.toString().toLowerCase();
}

function setShipDateDefault() {
  if (!shipAtInput.value) {
    shipAtInput.value = new Date().toISOString().slice(0, 10);
  }
}

function showTab(tabId) {
  document.querySelectorAll('[data-panel]').forEach((panel) => {
    panel.classList.add("hidden");
  });
  document.getElementById(tabId).classList.remove("hidden");
  tabs.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabId);
  });
}

function renderArrival() {
  const total = state.items.length;
  const sorted = state.items.filter((i) => i.status === "sorted").length;
  const inShipment = state.items.filter((i) => i.status === "inShipment").length;
  const shipped = state.items.filter((i) => i.status === "shipped").length;

  const panel = document.getElementById("arrival-stats");
  panel.textContent = `Celkem položek: ${total} | Rozřazené: ${sorted} | Na expedici: ${inShipment} | Odeslané: ${shipped}`;

  arrivalBody.innerHTML = "";
  state.items.forEach((item) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${fmtDate(item.createdAt)}</td>
      <td>${item.supplier}</td>
      <td>${item.document}</td>
      <td>${item.sku}</td>
      <td>${item.name}</td>
      <td>${item.quantity}</td>
      <td>${item.expectedLocation}</td>
      <td><span class="badge ${STATUS_CLASS[item.status]}">${STATUS_LABELS[item.status]}</span></td>
    `;
    arrivalBody.appendChild(tr);
  });
}

function renderSorting() {
  const query = normalize(sortingFilter.value);
  const rows = state.items.filter((item) => item.status !== "shipped").filter((item) => {
    const haystack = normalize(
      `${item.supplier} ${item.document} ${item.sku} ${item.name} ${item.note} ${item.status}`
    );
    return haystack.includes(query);
  });

  sortingBody.innerHTML = "";
  rows.forEach((item) => {
    const tr = document.createElement("tr");
    tr.dataset.id = item.id;
    tr.innerHTML = `
      <td>${fmtDate(item.createdAt)}</td>
      <td>${item.supplier}</td>
      <td>${item.sku}</td>
      <td>${item.name}</td>
      <td>${item.quantity}</td>
      <td>${item.expectedLocation}</td>
      <td>${item.storageLocation || "—"}</td>
      <td>
        <select class="zone-select">
          <option value="">Vyber zónu</option>
          ${["A", "B", "C", "D", "E"].map((zone) => `<option value="${zone}">${zone}</option>`).join("")}
        </select>
      </td>
      <td>
        <div class="item-actions">
          <button type="button" data-assign ${item.status === "shipped" ? "disabled" : ""}>Uložit</button>
          <span class="badge ${STATUS_CLASS[item.status]}">${STATUS_LABELS[item.status]}</span>
        </div>
      </td>
    `;
    sortingBody.appendChild(tr);
    if (item.storageLocation) {
      tr.querySelector("select").value = item.storageLocation;
    } else {
      tr.querySelector("select").value = item.expectedLocation;
    }
  });
}

function renderShipmentCandidates() {
  const candidates = state.items.filter((item) => item.status === "sorted");
  candidatesBody.innerHTML = "";
  candidates.forEach((item) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="checkbox" class="shipment-select" value="${item.id}" /></td>
      <td>${item.sku}</td>
      <td>${item.name}</td>
      <td>${item.quantity}</td>
      <td>${item.storageLocation || item.expectedLocation}</td>
      <td>${item.note || ""}</td>
    `;
    candidatesBody.appendChild(tr);
  });
}

function renderShipments() {
  shipmentsBody.innerHTML = "";
  state.shipments.forEach((shipment) => {
    const tr = document.createElement("tr");
    tr.dataset.id = shipment.id;
    tr.innerHTML = `
      <td>${shipment.orderNumber}</td>
      <td>${shipment.carrier}</td>
      <td>${shipment.items.length}</td>
      <td>${shipment.shipAt}</td>
      <td>${shipment.status === "shipped" ? "Expedováno" : "Čeká na odeslání"}</td>
      <td>
        ${
          shipment.status === "shipped"
            ? `<span class="badge shipped">Hotovo</span>`
            : `<button type="button" data-ship="${shipment.id}">Odeslat</button>`
        }
      </td>
    `;
    shipmentsBody.appendChild(tr);
  });
}

function renderAll() {
  renderArrival();
  renderSorting();
  renderShipmentCandidates();
  renderShipments();
}

function toSortedState(id, location) {
  const item = state.items.find((i) => i.id === id);
  if (!item) return;
  if (item.status === "shipped") return;
  item.status = "sorted";
  item.storageLocation = location;
  item.sortedAt = new Date().toISOString();
  saveState();
  renderAll();
}

function markShipmentSent(id) {
  const shipment = state.shipments.find((s) => s.id === id);
  if (!shipment || shipment.status === "shipped") return;
  shipment.status = "shipped";
  shipment.shippedAt = new Date().toISOString();
  shipment.items.forEach((entry) => {
    const item = state.items.find((i) => i.id === entry.id);
    if (item) item.status = "shipped";
  });
  saveState();
  renderAll();
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `expedice-data-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed || typeof parsed !== "object") return;
      state = {
        items: Array.isArray(parsed.items) ? parsed.items : [],
        shipments: Array.isArray(parsed.shipments) ? parsed.shipments : [],
      };
      saveState();
      renderAll();
      alert("Data byla naimportovaná.");
    } catch {
      alert("Import se nepodařil. Ověř, že soubor má správný JSON formát.");
    }
  };
  reader.readAsText(file);
}

function handleShipmentSubmit(event) {
  event.preventDefault();
  const payload = new FormData(shipmentForm);
  const selected = Array.from(document.querySelectorAll(".shipment-select:checked"));
  if (!selected.length) {
    alert("Vyber alespoň jednu položku k expedici.");
    return;
  }

  const shipmentItems = [];
  const itemIds = selected.map((el) => el.value);
  itemIds.forEach((id) => {
    const item = state.items.find((entry) => entry.id === id);
    if (!item) return;
    shipmentItems.push({
      id: item.id,
      sku: item.sku,
      name: item.name,
      quantity: item.quantity,
      storageLocation: item.storageLocation || item.expectedLocation,
    });
  });
  if (!shipmentItems.length) return;

  const newShipment = {
    id: uid("ship"),
    orderNumber: payload.get("orderNumber"),
    carrier: payload.get("carrier"),
    note: payload.get("shipmentNote"),
    shipAt: payload.get("shipAt"),
    createdAt: new Date().toISOString(),
    status: "planning",
    shippedAt: null,
    items: shipmentItems,
  };
  state.shipments.unshift(newShipment);

  itemIds.forEach((id) => {
    const item = state.items.find((entry) => entry.id === id);
    if (item) {
      item.status = "inShipment";
      item.shipmentId = newShipment.id;
    }
  });

  saveState();
  shipmentForm.reset();
  renderAll();
  alert(`Expedice ${newShipment.orderNumber} vytvořena.`);
}

tabs.forEach((button) => {
  button.addEventListener("click", () => {
    showTab(button.dataset.tab);
  });
});

arrivalForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const payload = new FormData(arrivalForm);
  const item = {
    id: uid("item"),
    createdAt: new Date().toISOString(),
    supplier: payload.get("supplier").trim(),
    document: payload.get("document").trim(),
    sku: payload.get("sku").trim(),
    name: payload.get("name").trim(),
    quantity: Number(payload.get("quantity")),
    expectedLocation: payload.get("expectedLocation"),
    storageLocation: "",
    note: payload.get("note").trim(),
    status: "received",
  };

  state.items.unshift(item);
  saveState();
  arrivalForm.reset();
  renderAll();
});

sortingBody.addEventListener("click", (event) => {
  const button = event.target.closest("[data-assign]");
  if (!button) return;
  const row = button.closest("tr");
  const itemId = row.dataset.id;
  const zone = row.querySelector("select").value || row.querySelector("select").options[0].value;
  if (!zone) return;
  toSortedState(itemId, zone);
});

shipmentsBody.addEventListener("click", (event) => {
  const shipmentId = event.target.getAttribute("data-ship");
  if (!shipmentId) return;
  markShipmentSent(shipmentId);
});

shipmentForm.addEventListener("submit", handleShipmentSubmit);
sortingFilter.addEventListener("input", renderSorting);
exportButton.addEventListener("click", exportData);
importInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  importData(file);
  importInput.value = "";
});

loadState();
setShipDateDefault();
showTab("arrival");
renderAll();
