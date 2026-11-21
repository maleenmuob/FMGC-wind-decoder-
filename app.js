import { LEVEL_SETS, RULES, DEFAULT_RULE, analyze, ruleLabel } from "./decoder.js";
import { pdfToLines } from "./pdf-lines.js";
import { APP_VERSION } from "./version.js";
import { buildProfile } from "./profile.js";
import { renderProfile } from "./profile-view.js";
import { parseFlightInfo, flightTitle } from "./flight-info.js";

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

$("version").textContent = APP_VERSION;

const state = {
  levels: store.get("levels", "3"),
  // The entry rule always starts on the default (Airbus standard) when the app opens.
  rule: DEFAULT_RULE,
  custom: (() => {
    try { return JSON.parse(store.get("custom", "")) || null; } catch { return null; }
  })() || { dir: 20, spd: 20, tmp: 5 },
  // The current PDF: its text lines are kept so button changes can re-run on it.
  pdf: null, // { name, pages, lines }
  profileSel: null, // waypoint shown in the profile detail card
  lastText: "",
};

// Every file pick gets a new id; results from an older pick are thrown away.
let fileRun = 0;

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
  return ok
    ? { name: "Custom", dir: c.dir, spd: c.spd, tmp: c.tmp, fallback: false }
    : { ...RULES[DEFAULT_RULE], fallback: true };
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
  if (!b || b.dataset.levels === state.levels) return; // already selected: nothing to do
  state.levels = b.dataset.levels;
  store.set("levels", state.levels);
  syncSettings();
  run();
});

$("rules").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-rule]");
  if (!b || b.dataset.rule === state.rule) return;
  state.rule = b.dataset.rule;
  syncSettings();
  run();
});

for (const [id, key] of [["cDir", "dir"], ["cSpd", "spd"], ["cTmp", "tmp"]]) {
  $(id).addEventListener("input", () => {
    const v = $(id).value.trim();
    const next = /^\d+$/.test(v) ? parseInt(v, 10) : null;
    if (next === state.custom[key]) return;
    state.custom[key] = next;
    store.set("custom", JSON.stringify(state.custom));
    syncSettings();
    run();
  });
}

// ---------- PDF ----------
let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("./vendor/pdfjs/pdf.min.mjs").then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
      return lib;
    }).catch((err) => { pdfjsPromise = null; throw err; });
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

  const id = ++fileRun;
  state.pdf = null;
  state.profileSel = null;
  clearResults();
  setStatus(`Reading ${file.name}…`);

  try {
    const [lib, buf] = await Promise.all([loadPdfjs(), file.arrayBuffer()]);
    const { lines, pages } = await pdfToLines(lib, new Uint8Array(buf));
    if (id !== fileRun) return; // a newer file was picked meanwhile
    state.pdf = { name: file.name, pages, lines };
    run();
  } catch (err) {
    if (id !== fileRun) return;
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

/** Remove every trace of the previous run. */
function clearResults() {
  $("results").hidden = true;
  $("flightInfo").hidden = true;
  $("flightInfo").replaceChildren();
  $("raw").textContent = "";
  $("chart").replaceChildren();
  $("warnList").replaceChildren();
  $("profile").replaceChildren();
  $("warnBox").hidden = true;
  state.lastText = "";
}

function showWarnings(warnings) {
  const items = [...warnings];
  if (currentRule().fallback) {
    items.unshift({ reason: `Invalid custom rule. Using ${ruleLabel(RULES[DEFAULT_RULE])}.`, line: "" });
  }
  const list = $("warnList");
  list.replaceChildren(...items.map((w) => {
    const li = el("li", {}, w.reason);
    if (w.line) li.append(el("br"), el("code", {}, w.line));
    return li;
  }));
  $("warnBox").hidden = items.length === 0;
}

/** Which flight plan this is: route big, then flight, date and plan number. */
function showFlightInfo(info) {
  const box = $("flightInfo");
  if (!info) return;
  const route = info.origin || info.destination ? `${info.origin || "?"} → ${info.destination || "?"}` : "";
  const facts = el("dl", { className: "flight-facts" });
  for (const [k, v] of [["Flight", info.flight], ["Date", info.date], ["Plan no.", info.plan]]) {
    if (v) facts.append(el("dt", {}, k), el("dd", {}, v));
  }
  box.replaceChildren(...[route && el("p", { className: "flight-route", id: "flightRoute" }, route), facts].filter(Boolean));
  box.hidden = false;
}

/**
 * One run: decode the current PDF with the current buttons and show exactly
 * one fresh copy of the results. Safe to call any number of times.
 */
function run() {
  clearResults();
  const pdf = state.pdf;
  if (!pdf) {
    showWarnings([]);
    return;
  }

  const info = parseFlightInfo(pdf.lines);
  showFlightInfo(info);

  const levels = LEVEL_SETS[state.levels];
  const rule = currentRule();
  const res = analyze(pdf.lines, levels, rule, flightTitle(info));
  const profile = res.rows.length ? buildProfile({ lines: pdf.lines, rows: res.rows, levels, rule }) : null;
  showWarnings([...res.warnings, ...(profile ? profile.warnings : [])]);

  if (!res.rows.length) {
    setStatus(`⚠️ Could not find valid wind rows in ${pdf.name}.`, true);
    return;
  }
  const rep = res.repeated ? ` (${res.repeated} repeated row${res.repeated === 1 ? "" : "s"} ignored)` : "";
  setStatus(`Using: ${pdf.name} — ${pdf.pages} page${pdf.pages === 1 ? "" : "s"}, ${res.rows.length} wind rows${rep}.`);

  $("selLevels").textContent = levels.join(" / ");
  $("selRule").textContent = ruleLabel(rule);
  $("raw").textContent = res.rows.map((r) => r.raw).join("\n");

  const head = el("tr");
  for (const h of ["No.", "Waypoint", ...levels]) head.append(el("th", {}, h));
  const thead = el("thead");
  thead.append(head);
  const body = el("tbody");
  for (const r of res.chart) {
    const tr = el("tr");
    tr.append(el("td", {}, String(r.no)), el("td", {}, r.wp));
    for (const c of r.cells) tr.append(el("td", { className: c.marked ? "mark" : "" }, c.text));
    body.append(tr);
  }
  $("chart").replaceChildren(thead, body);
  updateScrollHint();

  state.lastText = res.text;
  $("results").hidden = false;
  updateScrollHint();
  renderProfile($("profile"), profile, state.profileSel, (i) => { state.profileSel = i; });
}

// On narrow screens the chart scrolls sideways; say so when it doesn't fit.
function updateScrollHint() {
  const wrap = $("chart").parentElement;
  $("scrollHint").hidden = $("results").hidden || wrap.scrollWidth <= wrap.clientWidth + 1;
}
addEventListener("resize", updateScrollHint);

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

// A new version installs itself in the background when the app is opened
// online. The page then reloads to it straight away, unless results are on
// screen; in that case an Update button is shown so nothing is lost.
if ("serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading || !hadController) return;
    if (state.pdf) {
      $("update").hidden = false;
      $("reload").onclick = () => location.reload();
      return;
    }
    reloading = true;
    location.reload();
  });

  navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).then((reg) => {
    // Home Screen apps are often resumed rather than reopened: check then too.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && navigator.onLine) reg.update().catch(() => {});
    });
  }).catch((err) => console.warn("Service worker failed:", err));
}

syncSettings();
