"use strict";

(() => {
  const els = Object.fromEntries(["sort", "print", "reload", "status", "login", "sheet", "batch", "pieces", "summary", "rows"].map((id) => [id, document.getElementById(id)]));
  const datasetId = new URLSearchParams(location.search).get("dataset");
  const embeddedData = document.getElementById("warehouse-print-data");
  const standalone = embeddedData ? JSON.parse(embeddedData.textContent) : null;
  const state = { rows: [], images: {}, redBoxes: new Set(), ready: false, busy: false };
  const pageStyle = document.createElement("style");
  document.head.append(pageStyle);
  function setOrientation(value) {
    const orientation = value === "portrait" ? "portrait" : "landscape";
    document.documentElement.dataset.orientation = orientation;
    pageStyle.textContent = `@page { size: A4 ${orientation}; }`;
    els.print.textContent = orientation === "portrait" ? "Tisk A4 na výšku" : "Tisk A4 na šířku";
  }
  document.querySelectorAll('input[name="orientation"]').forEach((input) => {
    input.addEventListener("change", () => { if (input.checked) setOrientation(input.value); });
  });
  setOrientation(document.querySelector('input[name="orientation"]:checked')?.value);
  function setDensity(value) {
    document.documentElement.dataset.density = value === "compact" ? "compact" : "normal";
  }
  document.querySelectorAll('input[name="density"]').forEach((input) => {
    input.addEventListener("change", () => { if (input.checked) setDensity(input.value); });
  });
  setDensity(document.querySelector('input[name="density"]:checked')?.value);
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const key = (value) => String(value || "").trim().toUpperCase();
  const quantity = (row) => Number(row.initialQuantity || row.quantity || 0);
  function completionRedBoxes(data) {
    const cells = data.helperSheets?.KOMPLETACE?.cells;
    const boxes = new Set();
    if (!Array.isArray(cells)) return boxes;
    const decimal = (value) => {
      const text = String(value ?? "").trim().replace(",", ".");
      return /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : NaN;
    };
    // Helper sheets preserve Excel coordinates: Q = box, R = expedition code.
    for (const row of cells.slice(1)) {
      if (!Array.isArray(row)) continue;
      const box = decimal(row[16]);
      if (Number.isSafeInteger(box) && box > 0 && decimal(row[17]) === 0.8) boxes.add(box);
    }
    return boxes;
  }
  const secondQuality = (row) => [row.variantCode, row.productCode, row.raw?.productName, row.info].some((value) =>
    /(?:^|[^a-z0-9])(?:ii|2)[.\s_-]+(?:jakost|akost)(?:$|[^a-z0-9])/i.test(
      String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    ));
  function displayVariant(value) {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    const labels = [...text.matchAll(/(?:^|[\s,;|])(velikost|veľkosť|veľkost|velkost|barva|farba)\s*:\s*/giu)];
    const clean = (part) => part.replace(/^[\s,;|]+|[\s,;|]+$/g, "");
    if (labels.length && !clean(text.slice(0, labels[0].index))) {
      const parts = labels.map((label, index) => ({
        size: !/^(barva|farba)$/iu.test(label[1]),
        value: clean(text.slice(label.index + label[0].length, labels[index + 1]?.index)),
      }));
      return parts.sort((a, b) => Number(b.size) - Number(a.size)).map((part) => part.value).filter(Boolean).join(", ");
    }
    // Unlabelled Excel variants use both "colour / M/L" and "M/L, colour".
    // Match a complete size at either edge; never split the slash inside M/L.
    const size = "(?:X{0,3}[SL]|M|[2-9]XL|\\d{2,3}|UNI|ONE SIZE)(?:\\s*[/–-]\\s*(?:X{0,3}[SL]|M|[2-9]XL|\\d{2,3}))*";
    if (!text.includes(":")) {
      if (new RegExp(`^${size}$`, "i").test(text)) return text;
      const first = text.match(new RegExp(`^(${size})\\s*[,;|/]\\s*(.+)$`, "i"));
      const last = text.match(new RegExp(`^(.+?)\\s*[,;|/]\\s*(${size})$`, "i"));
      const match = first || last;
      if (match) {
        const sizeValue = first ? match[1] : match[2];
        const colour = first ? match[2] : match[1];
        return `${sizeValue.replace(/\s*([/–-])\s*/g, "$1")}, ${colour.trim()}`;
      }
    }
    return text;
  }
  const allocations = (row) => row.raw?.allocations || String(row.sequence || "").split(/[,;]/).map((part) => {
    const match = part.trim().match(/^(\d+)\s*[x×]\s*(\d+)$/i);
    return match ? { quantity: Number(match[1]), destination: Number(match[2]) } : null;
  }).filter(Boolean);

  async function json(url, options) {
    const response = await fetch(url, { cache: "no-store", ...options });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401) els.login.hidden = false;
      throw new Error(response.status === 401 ? "Pro zobrazení sestavy se přihlas do expedice." : data.error || "Data se nepodařilo načíst.");
    }
    return data;
  }

  function render() {
    const collator = new Intl.Collator("cs", { numeric: true, sensitivity: "base" });
    const rows = [...state.rows].sort((a, b) => {
      if (els.sort.value === "excel") return Number(a.rowNumber) - Number(b.rowNumber);
      if (els.sort.value === "box") {
        const difference = Math.min(...allocations(a).map((item) => item.destination)) - Math.min(...allocations(b).map((item) => item.destination));
        if (difference) return difference;
      }
      return (els.sort.value === "product" ? Number(secondQuality(a)) - Number(secondQuality(b)) : 0)
        || collator.compare(a.productCode || "", b.productCode || "")
        || collator.compare(a.variantCode || "", b.variantCode || "");
    });
    let lastProduct = null;
    let lastQuality = null;
    els.rows.innerHTML = rows.map((row) => {
      const name = row.raw?.productName || row.info || row.productCode;
      const image = state.images[key(row.variantCode)] || state.images[key(row.productCode)];
      const quality = secondQuality(row);
      const groupStart = lastProduct !== row.productCode || (els.sort.value === "product" && lastQuality !== quality);
      lastProduct = row.productCode;
      lastQuality = quality;
      return `<tr class="${groupStart ? "group-start" : ""}">
        <td>${image ? `<img src="${escape(image)}" alt="${escape(name)}" />` : '<span class="no-photo">Bez fotky</span>'}</td>
        <td><span class="product-name">${escape(name)}</span><span class="sku">${escape(row.variantCode)}</span></td>
        <td><span class="variant-value">${escape(displayVariant(row.variant))}</span></td><td class="quantity">${escape(quantity(row))}</td>
        <td><div class="allocations">${allocations(row).map((item) => `<span class="allocation${state.redBoxes.has(Number(item.destination)) ? " allocation-red" : ""}"><b>${escape(item.quantity)} ks</b> → box <b>${escape(item.destination)}</b></span>`).join("")}</div></td>
      </tr>`;
    }).join("");
  }

  async function settleImages() {
    const images = [...els.rows.querySelectorAll("img")];
    await Promise.all(images.map((img) => new Promise((resolve) => {
      let timer;
      const finish = () => { clearTimeout(timer); resolve(); };
      if (img.complete) return finish();
      img.onload = finish;
      img.onerror = finish;
      timer = setTimeout(finish, 15000);
    })));
    let missing = 0;
    for (const img of images) {
      if (!img.complete || !img.naturalWidth) {
        missing++;
        const placeholder = document.createElement("span");
        placeholder.className = "no-photo";
        placeholder.textContent = "Bez fotky";
        img.replaceWith(placeholder);
      }
    }
    return missing;
  }

  async function load() {
    if (state.busy) return;
    state.busy = true;
    state.ready = false;
    els.print.disabled = true;
    els.sort.disabled = true;
    els.sheet.hidden = true;
    els.status.textContent = "Načítám sestavu a fotografie…";
    try {
      if (!standalone && !/^\d+$/.test(datasetId || "")) throw new Error("Chybí číslo tiskové sestavy v odkazu z Excelu.");
      const data = standalone || await json(`/api/datasets/${datasetId}`);
      if (!["warehouse", "warehouse_print"].includes(data.dataset?.datasetKind)) throw new Error("Tato dávka není vyskladnění.");
      state.rows = data.rows || [];
      state.redBoxes = completionRedBoxes(data);
      if (!state.rows.length) throw new Error("Tato sestava neobsahuje žádné položky.");
      state.images = {};
      let imageWarning = standalone?.imageWarning || "";
      if (standalone) {
        state.images = Object.fromEntries(Object.entries(standalone.images || {}).map(([code, url]) => [key(code), url]));
      } else try {
        const codes = [...new Set(state.rows.flatMap((row) => [row.variantCode, row.productCode]).filter(Boolean))];
        const images = await json("/api/product-images", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ codes }) });
        state.images = Object.fromEntries(Object.entries(images.images || {}).map(([code, url]) => [key(code), url]));
        if (images.ok === false || images.configured === false) imageWarning = "Produktové fotografie nejsou dostupné. ";
      } catch (_) { imageWarning = "Produktové fotografie se nepodařilo načíst. "; }
      const dataset = data.dataset;
      els.batch.textContent = [dataset.batchName || dataset.datasetDate, dataset.datasetTime, dataset.worksheetName].filter(Boolean).join(" · ");
      els.pieces.textContent = `${state.rows.reduce((sum, row) => sum + quantity(row), 0)} ks`;
      els.summary.textContent = `${state.rows.length} variant · ${new Set(state.rows.flatMap((row) => allocations(row).map((item) => item.destination))).size} boxů`;
      document.title = `Vyskladnění ${dataset.datasetDate || ""}`;
      render();
      els.sheet.hidden = false;
      await settleImages();
      const missing = els.rows.querySelectorAll(".no-photo").length;
      els.status.textContent = `${imageWarning}${missing ? `Bez fotografie: ${missing} variant. ` : ""}Sestava je připravená k tisku.`;
      els.login.hidden = true;
      state.ready = true;
      els.print.disabled = false;
      els.sort.disabled = false;
    } catch (error) { els.status.textContent = error.message; }
    finally { state.busy = false; }
  }

  els.sort.addEventListener("change", async () => {
    els.print.disabled = true;
    render();
    await settleImages();
    els.print.disabled = !state.ready;
  });
  els.print.addEventListener("click", async () => {
    if (!state.ready) return;
    els.print.disabled = true;
    await settleImages();
    await document.fonts.ready;
    window.print();
    els.print.disabled = false;
  });
  els.reload.addEventListener("click", load);
  els.login.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fields = new FormData(els.login);
    try {
      await json("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: fields.get("username"), password: fields.get("password") }) });
      els.login.reset();
      await load();
    } catch (error) { els.status.textContent = error.message; }
  });
  load();
})();
