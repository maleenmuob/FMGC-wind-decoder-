import { LEVEL_SETS, RULES, findWindRows, buildChart, reportText } from "./decoder.js";
import { pdfToLines } from "./pdf-lines.js";

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

const state = {
  levels: store.get("levels", "3"),
  rule: store.get("rule", "standard"),
  custom: (() => {
    try { return JSON.parse(store.get("custom", "")) || null; } catch { return null; }
  })() || { dir: 20, spd: 20, tmp: 5 },
  rows: null,
  warnings: [],
  fileName: "",
  lastText: "",
};

// ---------- settings UI ----------
function selectIn(groupId, attr, value) {
  for (const b of $(groupId).querySelectorAll("button")) {
    b.setAttribute("aria-checked", String(b.dataset[attr] === value));
  }
}

function currentRule() {
  if (state.rule !== "custom") return { ...RULES[state.rule], fallback: false };
  const c = state.custom;
  const ok = [c.dir, c.spd, c.tmp].every((v) => Number.isInteger(v) && v > 0);
  return ok ? { ...c, fallback: false } : { ...RULES.standard, fallback: true };
}

function syncSettings() {
  selectIn("levels", "levels", state.levels);
  selectIn("rules", "rule", state.rule);
  $("customBox").hidden = state.rule !== "custom";
  $("cDir").value = state.custom.dir ?? "";
  $("cSpd").value = state.custom.spd ?? "";
  $("cTmp").value = state.custom.tmp ?? "";
  const r = currentRule();
  $("customSummary").textContent =
    state.rule === "custom" && !r.fallback ? `${r.dir}° / ${r.spd} kt / ${r.tmp}°C` : "set below";
}

$("levels").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-levels]");
  if (!b) return;
  state.levels = b.dataset.levels;
  store.set("levels", state.levels);
  syncSettings();
  render();
});

$("rules").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-rule]");
  if (!b) return;
  state.rule = b.dataset.rule;
  store.set("rule", state.rule);
  syncSettings();
  render();
});

for (const [id, key] of [["cDir", "dir"], ["cSpd", "spd"], ["cTmp", "tmp"]]) {
  $(id).addEventListener("input", () => {
    const v = $(id).value.trim();
    state.custom[key] = /^\d+$/.test(v) ? parseInt(v, 10) : null;
    store.set("custom", JSON.stringify(state.custom));
    syncSettings();
    render();
  });
}

// ---------- PDF ----------
let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("./vendor/pdfjs/pdf.min.mjs").then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
      return lib;
    });
  }
  return pdfjsPromise;
}

function setStatus(text, error = false) {
  $("status").textContent = text;
  $("status").classList.toggle("error", error);
}

$("file").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = ""; // allow choosing the same file again
  if (!file) return;

  state.rows = null;
  state.fileName = file.name;
  $("results").hidden = true;
  $("warnBox").hidden = true;
  setStatus(`Reading ${file.name}…`);

  try {
    const [lib, buf] = await Promise.all([loadPdfjs(), file.arrayBuffer()]);
    const { lines, pages } = await pdfToLines(lib, new Uint8Array(buf));
    const { rows, warnings } = findWindRows(lines);
    state.warnings = warnings;
    if (!rows.length) {
      renderWarnings();
      setStatus(`⚠️ Could not find valid wind rows in ${file.name}.`, true);
      return;
    }
    state.rows = rows;
    setStatus(`Using: ${file.name} — ${pages} page${pages === 1 ? "" : "s"}, ${rows.length} wind rows.`);
    render();
  } catch (err) {
    console.error(err);
    const msg = err && err.name === "PasswordException"
      ? "this PDF is password protected"
      : (err && err.message) || String(err);
    setStatus(`⚠️ Could not read PDF: ${msg}`, true);
  }
});

// ---------- output ----------
function el(tag, props = {}, text) {
  const n = document.createElement(tag);
  Object.assign(n, props);
  if (text != null) n.textContent = text;
  return n;
}

function renderWarnings() {
  const list = $("warnList");
  list.replaceChildren();
  const rule = currentRule();
  const items = [...state.warnings];
  if (rule.fallback) items.unshift({ reason: "Invalid custom rule. Using 20 / 20 / 5.", line: "" });
  for (const w of items) {
    const li = el("li", {}, w.reason);
    if (w.line) {
      li.append(el("br"), el("code", {}, w.line));
    }
    list.append(li);
  }
  $("warnBox").hidden = items.length === 0;
}

function render() {
  renderWarnings();
  if (!state.rows) return;

  const levels = LEVEL_SETS[state.levels];
  const rule = currentRule();
  const chart = buildChart(state.rows, levels, rule);

  $("selLevels").textContent = levels.join(" / ");
  $("selRule").textContent = `${rule.dir}° / ${rule.spd} kt / ${rule.tmp}°C`;
  $("raw").textContent = state.rows.map((r) => r.raw).join("\n");

  const table = $("chart");
  table.replaceChildren();
  const head = el("tr");
  for (const h of ["No.", "Waypoint", ...levels, "Turbulence"]) head.append(el("th", {}, h));
  const thead = el("thead");
  thead.append(head);
  table.append(thead);
  const body = el("tbody");
  for (const r of chart) {
    const tr = el("tr");
    tr.append(el("td", {}, String(r.no)), el("td", {}, r.wp));
    for (const c of r.cells) {
      const cls = [c.marked && "mark", c.turb && `t-${c.turb}`].filter(Boolean).join(" ");
      tr.append(el("td", { className: cls }, c.text));
    }
    tr.append(el("td", { className: "turb" }, r.flags.join(", ")));
    if (r.cells.some((c) => c.turb === "red")) tr.className = "has-red";
    body.append(tr);
  }
  table.append(body);

  state.lastText = reportText(state.rows, chart, levels, rule);
  $("results").hidden = false;
}

$("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(state.lastText);
    $("copy").textContent = "Copied ✓";
  } catch {
    $("copy").textContent = "Copy failed";
  }
  setTimeout(() => ($("copy").textContent = "Copy as text"), 1500);
});

// ---------- offline / updates ----------
function updateNet() {
  $("net").textContent = navigator.onLine ? "Online" : "Offline";
}
addEventListener("online", updateNet);
addEventListener("offline", updateNet);
updateNet();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").then((reg) => {
    const offerUpdate = (w) => {
      $("update").hidden = false;
      $("reload").onclick = () => w.postMessage("skipWaiting");
    };
    if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      w && w.addEventListener("statechange", () => {
        if (w.state === "installed" && navigator.serviceWorker.controller) offerUpdate(w);
      });
    });
  }).catch((err) => console.warn("Service worker failed:", err));

  // Reload only when an update replaces an existing version, not on first install.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading || !hadController) return;
    reloading = true;
    location.reload();
  });
}

syncSettings();
