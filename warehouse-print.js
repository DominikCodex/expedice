"use strict";

(() => {
  const els = Object.fromEntries(["sort", "print", "reload", "status", "login", "sheet", "batch", "pieces", "summary", "rows"].map((id) => [id, document.getElementById(id)]));
  const datasetId = new URLSearchParams(location.search).get("dataset");
  const embeddedData = document.getElementById("warehouse-print-data");
  const standalone = embeddedData ? JSON.parse(embeddedData.textContent) : null;
  const state = { rows: [], images: {}, redBoxes: new Set(), ginaVariants: new Set(), ready: false, busy: false };
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
  function excelGinaVariants(data) {
    const cells = data.helperSheets?.EXCEL?.cells;
    if (!Array.isArray(cells) || !Array.isArray(cells[0])) return new Set();
    const header = (value) => key(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/:\s*$/, "");
    const codeColumn = cells[0].findIndex((value) => header(value) === "OZNACENI VARIANTY");
    const infoColumn = cells[0].findIndex((value) => header(value) === "DOPLNKOVE INFO");
    if (codeColumn < 0 || infoColumn < 0) return new Set();
    const brands = new Map();
    // Repeated order lines must agree on the brand; missing/conflicting evidence is not Gina.
    for (const row of cells.slice(1)) {
      if (!Array.isArray(row)) continue;
      const code = key(row[codeColumn]);
      if (!code) continue;
      const brand = key(String(row[infoColumn] ?? "").match(/^\s*\/\/\s*([^/]+?)\s*\/\//)?.[1]);
      if (!brands.has(code)) brands.set(code, new Set());
      brands.get(code).add(brand);
    }
    return new Set([...brands].filter(([, values]) => values.size === 1 && values.has("GINA")).map(([code]) => code));
  }
  function productGroup(row) {
    const code = key(row.variantCode) || key(row.productCode);
    const parts = code.split("-");
    if (parts.some((part) => !part.trim())) return code;
    const count = parts[0] === "BOXERKY" && parts[1] === "BASIC" ? 3
      : state.ginaVariants.has(key(row.variantCode)) ? 1 : 2;
    return parts.slice(0, count).join("-");
  }
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

  function splitPriorityPieces(row) {
    const items = allocations(row);
    const priority = items.filter((item) => state.redBoxes.has(Number(item.destination)));
    const other = items.filter((item) => !state.redBoxes.has(Number(item.destination)));
    if (!priority.length || !other.length) return [row];
    // Split only display rows. Source quantities and allocations remain unchanged.
    return [priority, other].map((part) => {
      const total = part.reduce((sum, item) => sum + Number(item.quantity), 0);
      return { ...row, initialQuantity: total, quantity: total, raw: { ...row.raw, allocations: part } };
    });
  }

  function variantSortParts(row) {
    const value = displayVariant(row.variant);
    const [size, ...colour] = value.split(",");
    const normalized = key(size).replace(/\s+/g, "");
    const alpha = { XXXS: -3, XXS: -2, XS: -1, S: 0, M: 1, L: 2, XL: 3, XXL: 4, XXXL: 5 };
    const rank = (part) => alpha[part] ?? (/^[2-9]XL$/.test(part) ? Number(part[0]) + 2 : NaN);
    const parts = normalized.split(/[/–-]/);
    const ranks = parts.map(rank);
    if (ranks.every(Number.isFinite)) return [0, ranks[0], ranks.at(-1), normalized, colour.join(",").trim()];
    if (parts.every((part) => /^\d{2,3}$/.test(part))) return [1, Number(parts[0]), Number(parts.at(-1)), normalized, colour.join(",").trim()];
    if (["UNI", "ONESIZE"].includes(normalized)) return [2, 0, 0, normalized, colour.join(",").trim()];
    return [3, 0, 0, "", value];
  }

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
    const priorityMode = document.querySelector('input[name="priority"]:checked')?.value;
    const priorityFirst = priorityMode === "first" || priorityMode === "split";
    const displayRows = priorityMode === "split" ? state.rows.flatMap(splitPriorityPieces) : [...state.rows];
    const priorityRows = new Set(displayRows.filter((row) => allocations(row).some((item) => state.redBoxes.has(Number(item.destination)))));
    const groups = new Map(displayRows.map((row) => [row, productGroup(row)]));
    const variants = new Map(displayRows.map((row) => [row, variantSortParts(row)]));
    const rows = displayRows.sort((a, b) => {
      if (priorityFirst) {
        const difference = Number(priorityRows.has(b)) - Number(priorityRows.has(a))
          || Number(secondQuality(a)) - Number(secondQuality(b));
        if (difference) return difference;
      }
      if (els.sort.value === "excel") return Number(a.rowNumber) - Number(b.rowNumber);
      if (els.sort.value === "box") {
        const difference = Math.min(...allocations(a).map((item) => item.destination)) - Math.min(...allocations(b).map((item) => item.destination));
        if (difference) return difference;
      }
      if (els.sort.value === "product") {
        const groupA = groups.get(a), groupB = groups.get(b);
        const va = variants.get(a), vb = variants.get(b);
        return Number(secondQuality(a)) - Number(secondQuality(b))
          || collator.compare(groupA, groupB)
          || (groupA === groupB ? 0 : groupA < groupB ? -1 : 1)
          || va[0] - vb[0] || va[1] - vb[1] || va[2] - vb[2]
          || collator.compare(va[4], vb[4]) || collator.compare(va[3], vb[3])
          || collator.compare(a.variantCode || "", b.variantCode || "");
      }
      return collator.compare(a.productCode || "", b.productCode || "") || collator.compare(a.variantCode || "", b.variantCode || "");
    });
    const blocks = [];
    for (const row of rows) {
      const group = groups.get(row), quality = secondQuality(row), priority = priorityFirst && priorityRows.has(row);
      const last = blocks.at(-1);
      if (last && last.group === group && last.quality === quality && last.priority === priority) last.rows.push(row);
      else blocks.push({ group, quality, priority, rows: [row] });
    }
    let lastSection = null;
    els.rows.innerHTML = blocks.map((block, blockIndex) => {
      const section = `${block.priority}:${block.quality}`;
      const sectionStart = (priorityFirst || els.sort.value === "product") && section !== lastSection;
      lastSection = section;
      const label = priorityFirst ? `${block.priority ? "PRIORITNÍ" : "OSTATNÍ"}${priorityMode === "split" ? " KUSY" : ""}${block.quality ? " – II. JAKOST" : ""}`
        : block.quality ? "II. JAKOST" : "BĚŽNÉ ZBOŽÍ";
      const sectionHeading = sectionStart ? `<tr class="section-heading"><th colspan="5" scope="rowgroup">${escape(label)}</th></tr>` : "";
      const first = block.rows[0];
      const productHeading = block.rows.length > 1 ? `<tr class="product-heading"><th colspan="5" scope="rowgroup"><span>${escape(first.raw?.productName || first.info || first.productCode)}</span><small>${escape(block.group)} · ${block.rows.length} ${block.rows.length < 5 ? "varianty" : "variant"}</small></th></tr>` : "";
      const content = block.rows.map((row, index) => {
        const name = row.raw?.productName || row.info || row.productCode;
        const image = state.images[key(row.variantCode)] || state.images[key(row.productCode)];
        const quality = secondQuality(row);
        return `<tr class="item-row${index === 0 ? " group-start" : ""}${index === block.rows.length - 1 ? " group-end" : ""}">
          <td><span class="product-name">${escape(name)}</span><span class="product-meta"><span class="sku">${escape(row.variantCode)}</span>${quality ? '<span class="quality-label">II. JAKOST</span>' : ""}</span></td>
          <td>${image ? `<img src="${escape(image)}" alt="${escape(name)}" />` : '<span class="no-photo">Bez fotky</span>'}</td>
          <td><span class="variant-value">${escape(displayVariant(row.variant))}</span></td><td class="quantity">${escape(quantity(row))}</td>
          <td><div class="allocations">${allocations(row).map((item) => `<span class="allocation${Number(item.quantity) > 1 ? " allocation-multiple" : ""}${state.redBoxes.has(Number(item.destination)) ? " allocation-red" : ""}"><b>${escape(item.quantity)} ks</b> → box <b>${escape(item.destination)}</b></span>`).join("")}</div></td>
        </tr>`;
      }).join("");
      return `${blockIndex ? '<tr class="group-gap" aria-hidden="true"><td colspan="5"></td></tr>' : ""}${sectionHeading}${productHeading}${content}`;
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
      state.ginaVariants = excelGinaVariants(data);
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
      els.summary.textContent = `${state.rows.length} variant · ${new Set(state.rows.flatMap((row) => allocations(row).map((item) => Number(item.destination)))).size} boxů`;
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

  async function rerender() {
    if (!state.ready) return;
    els.print.disabled = true;
    render();
    await settleImages();
    els.print.disabled = !state.ready;
  }
  els.sort.addEventListener("change", rerender);
  document.querySelectorAll('input[name="priority"]').forEach((input) => input.addEventListener("change", rerender));
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
