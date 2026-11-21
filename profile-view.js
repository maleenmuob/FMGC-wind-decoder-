// Draws the Shear & MSA profile (side view of the route), the waypoint detail
// card and the gap list. Everything is rebuilt from scratch on every call.

import { fmt } from "./decoder.js";
import { LEVEL_FLS, msaBand, shearBand, gapFt, nearestLevels } from "./profile.js";

const SVG = "http://www.w3.org/2000/svg";
const COL = 46; // px per waypoint
const PAD_L = 8, PAD_R = 16, TOP = 14, PLOT_H = 400, BOTTOM = 86;
const FL_MAX = 430; // top of the plot (FL430), true scale from 0
const HEIGHT = TOP + PLOT_H + BOTTOM;
const BOX_W = 28, BOX_H = 16;
const AXIS_TICKS = [0, 100, 140, 180, 240, 300, 340, 380, 410];

const y = (fl) => TOP + PLOT_H * (1 - fl / FL_MAX);
const x = (i) => PAD_L + COL * (i + 0.5);
const ftText = (ft) => (ft == null ? "—" : `${ft.toLocaleString("en-US")} ft`);
const ftNum = (ft) => (ft == null ? "—" : ft.toLocaleString("en-US")); // table cells: unit is in the header
const flText = (fl) => (fl == null ? "—" : `FL${String(fl).padStart(3, "0")}`);

function s(tag, attrs = {}, text) {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  if (text != null) n.textContent = text;
  return n;
}
function h(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  Object.assign(n, props);
  for (const k of kids) n.append(k);
  return n;
}

function axisSvg() {
  const svg = s("svg", { width: 52, height: HEIGHT, class: "pf-svg", "aria-hidden": "true" });
  for (const fl of AXIS_TICKS) {
    const isLevel = LEVEL_FLS.includes(fl);
    svg.append(
      s("line", { x1: 46, x2: 52, y1: y(fl), y2: y(fl), class: "pf-tick" }),
      s("text", { x: 43, y: y(fl) + 3.5, "text-anchor": "end", class: isLevel ? "pf-axis-label strong" : "pf-axis-label" }, fl === 0 ? "0" : flText(fl)),
    );
  }
  svg.append(s("line", { x1: 51.5, x2: 51.5, y1: y(FL_MAX), y2: y(0), class: "pf-axis-line" }));
  return svg;
}

function plotSvg(profile, onPick) {
  const wps = profile.waypoints;
  const width = PAD_L + COL * wps.length + PAD_R;
  const svg = s("svg", { width, height: HEIGHT, class: "pf-svg", role: "group", "aria-label": "Shear and MSA profile" });

  // Highlight for the selected waypoint (moved on selection).
  const sel = s("rect", { x: -100, y: TOP, width: COL, height: PLOT_H + 64, rx: 6, class: "pf-sel" });
  svg.append(sel);

  // Grid at the wind-table levels.
  for (const fl of LEVEL_FLS) svg.append(s("line", { x1: 0, x2: width, y1: y(fl), y2: y(fl), class: "pf-grid" }));

  // MSA step profile: one filled step per leg (previous fix -> this fix).
  wps.forEach((w, i) => {
    if (w.msa == null) return;
    const x0 = i === 0 ? PAD_L : x(i - 1), x1 = x(i);
    const top = y(w.msa / 100), band = msaBand(w.msa);
    svg.append(
      s("rect", { x: x0, y: top, width: x1 - x0, height: y(0) - top, class: `pf-msa ${band}` }),
      s("line", { x1: x0, x2: x1, y1: top, y2: top, class: `pf-msa-top ${band}` }),
    );
    // MSA number (hundreds of feet), shown when it changes or after a gap.
    if (i === 0 || wps[i - 1].msa !== w.msa) {
      const inside = y(0) - top > 14;
      svg.append(s("text", { x: (x0 + x1) / 2, y: inside ? top + 11 : top - 3, "text-anchor": "middle", class: "pf-msa-num" },
        String(w.msa / 100).padStart(3, "0")));
    }
  });
  svg.append(s("text", { x: PAD_L + 4, y: y(0) - 4, class: "pf-msa-label" }, "MSA (leg)"));

  // Planned flight level line.
  const pts = wps.map((w, i) => (w.plannedFl == null ? null : [x(i), y(w.plannedFl)])).filter(Boolean);
  if (pts.length > 1) svg.append(s("polyline", { points: pts.map((p) => p.join(",")).join(" "), class: "pf-fl" }));
  wps.forEach((w, i) => {
    if (w.plannedFl != null) svg.append(s("circle", { cx: x(i), cy: y(w.plannedFl), r: 2.5, class: "pf-fl-dot" }));
  });

  // Shear boxes with the number inside.
  wps.forEach((w, i) => {
    for (const c of w.winds) {
      if (c.shear == null) continue;
      const worst = profile.worst && profile.worst.index === i && profile.worst.level === c.level;
      const g = s("g", { class: `pf-box ${shearBand(c.shear)}${worst ? " worst" : ""}` });
      g.append(
        s("rect", { x: x(i) - BOX_W / 2, y: y(c.fl) - BOX_H / 2, width: BOX_W, height: BOX_H, rx: 3 }),
        s("text", { x: x(i), y: y(c.fl) + 4, "text-anchor": "middle" }, String(c.shear)),
      );
      svg.append(g);
    }
  });

  // Planned FL numbers where the level changes, in the gap after the column,
  // drawn on top with a halo so they stay readable next to the boxes.
  wps.forEach((w, i) => {
    if (w.plannedFl == null || (i > 0 && wps[i - 1].plannedFl === w.plannedFl)) return;
    svg.append(s("text", { x: x(i) + COL / 2, y: y(w.plannedFl) + 14, "text-anchor": "middle", class: "pf-fl-label" },
      flText(w.plannedFl)));
  });

  // X axis: FMGC dots and slanted waypoint names.
  svg.append(s("line", { x1: 0, x2: width, y1: y(0), y2: y(0), class: "pf-axis-line" }));
  wps.forEach((w, i) => {
    if (w.fmgc) svg.append(s("circle", { cx: x(i), cy: y(0) + 8, r: 3, class: "pf-fmgc-dot" }));
    svg.append(s("text", { x: x(i) + 4, y: y(0) + 20, "text-anchor": "end",
      transform: `rotate(-45 ${x(i) + 4} ${y(0) + 20})`, class: "pf-wp-label" }, w.name));
  });

  // Tap targets, one per waypoint column.
  wps.forEach((w, i) => {
    const hit = s("rect", { x: x(i) - COL / 2, y: 0, width: COL, height: HEIGHT, class: "pf-hit",
      tabindex: 0, role: "button", "aria-label": `${w.name} details`, "data-index": i });
    hit.addEventListener("click", () => onPick(i));
    hit.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(i); }
    });
    svg.append(hit);
  });

  return { svg, select: (i) => sel.setAttribute("x", i == null ? -100 : x(i) - COL / 2) };
}

function legend() {
  const item = (cls, text) => h("span", { className: "pf-leg" }, h("i", { className: cls }), text);
  return h("div", { className: "pf-legend" },
    item("sw box grey", "shear 0–3"),
    item("sw box amber", "shear 4–5"),
    item("sw box red", "shear 6+"),
    item("sw msa green", "MSA (leg) below FL100"),
    item("sw msa amber", "MSA FL100–140"),
    item("sw msa red", "MSA above FL140"),
    item("sw line", "planned FL"),
    item("sw dot", "in FMGC chart"),
    h("span", { className: "pf-leg note" }, "MSA numbers are in hundreds of feet (125 = 12,500 ft)."),
  );
}

function detailCard(w) {
  const near = nearestLevels(w.plannedFl);
  const facts = h("dl", { className: "pf-facts" });
  const fact = (k, v) => facts.append(h("dt", {}, k), h("dd", {}, v));
  fact("Planned FL", flText(w.plannedFl));
  fact("Leg MSA", ftText(w.msa));
  fact("Gap at planned FL", ftText(gapFt(w.plannedFl, w.msa)));
  if (w.mxsh != null) fact("Max shear (nav log)", String(w.mxsh));

  const card = h("div", { className: "pf-detail", id: "pfDetail" },
    h("div", { className: "pf-detail-head" },
      h("h3", {}, w.name + (w.fix !== w.name ? ` (${w.fix})` : "")),
      w.fmgc ? h("span", { className: "pf-badge" }, "● in FMGC chart") : ""),
    facts);

  if (!w.inWindTable) {
    card.append(h("p", { className: "meta" }, "This waypoint is not in the wind table."));
    return card;
  }
  const table = h("table", { className: "pf-table" });
  const head = h("tr");
  for (const t of ["Level", "Wind", "Temp", "Shear", "Above MSA (ft)"]) head.append(h("th", { textContent: t }));
  table.append(h("thead", {}, head));
  const body = h("tbody");
  for (const c of [...w.winds].reverse()) {
    const [wind, temp] = c.dir == null ? ["—", "—"] : (() => { const f = fmt(c).split("/"); return [`${f[0]}/${f[1]}`, `${f[2]}°C`]; })();
    const band = shearBand(c.shear);
    const flag = band === "red" ? " 🔴" : band === "amber" ? " ⚠️" : "";
    const atPlanned = near.includes(c.fl);
    const tr = h("tr", { className: atPlanned ? "planned" : "" },
      h("td", { textContent: c.level + (atPlanned ? " ●" : "") }),
      h("td", { textContent: wind }),
      h("td", { textContent: temp }),
      h("td", { textContent: c.shear == null ? "—" : `${c.shear}${flag}`, className: band ? `sh-${band}` : "" }),
      h("td", { textContent: ftNum(gapFt(c.fl, w.msa)) }));
    body.append(tr);
  }
  table.append(body);
  card.append(h("div", { className: "pf-table-wrap" }, table));
  if (near.length) card.append(h("p", { className: "meta" }, "● = wind-table level closest to the planned FL."));
  return card;
}

function gapSection(profile, onPick) {
  const box = h("div", { className: "pf-gaps" }, h("h3", {}, "Shear 4+ and height above MSA"));
  if (!profile.hasNavLog) {
    box.append(h("p", { className: "meta" }, "No navigation log found in this PDF, so MSA and planned FL can't be shown."));
  } else if (profile.minGap) {
    const g = profile.minGap;
    box.append(h("p", { className: "pf-mingap" },
      "Smallest gap between planned level and MSA (TOC to TOD): ",
      h("b", { textContent: ftText(g.gap) }),
      ` on the leg to ${g.name} (${flText(g.fl)}, MSA ${ftText(g.msa)}).`));
  }
  if (!profile.gaps.length) {
    box.append(h("p", { className: "meta" }, "No shear of 4 or more on the route."));
    return box;
  }
  const table = h("table", { className: "pf-table pf-gap-table" });
  const head = h("tr");
  for (const t of ["Waypoint", "FL", "Shear", "MSA (ft)", "Above MSA (ft)"]) head.append(h("th", { textContent: t }));
  table.append(h("thead", {}, head));
  const body = h("tbody");
  for (const g of profile.gaps) {
    const band = shearBand(g.shear);
    const tr = h("tr", { className: g.atPlanned ? "planned" : "", tabIndex: 0 },
      h("td", { textContent: g.name }),
      h("td", { textContent: g.level + (g.atPlanned ? " ●" : "") }),
      h("td", { textContent: `${g.shear} ${band === "red" ? "🔴" : "⚠️"}`, className: `sh-${band}` }),
      h("td", { textContent: ftNum(g.msa) }),
      h("td", { textContent: ftNum(g.gap) }));
    tr.addEventListener("click", () => onPick(g.index, true));
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter") onPick(g.index, true); });
    body.append(tr);
  }
  table.append(body);
  box.append(h("p", { className: "meta" }, "Smallest gap first. ● = at your planned level (the wind-table level closest to your planned FL). Tap a row to see it on the chart."),
    h("div", { className: "pf-table-wrap" }, table));
  return box;
}

/**
 * Render the whole section into `root`. `selected` is the waypoint index to
 * show in the detail card (kept across re-runs). Returns the selected index.
 */
export function renderProfile(root, profile, selected, onSelect) {
  root.replaceChildren();
  if (!profile.waypoints.length) {
    root.append(h("p", { className: "meta" }, "No waypoints to show."));
    return;
  }

  const scroll = h("div", { className: "pf-scroll" });
  const detailSlot = h("div");
  let plot;
  const pick = (i, jump = false) => {
    plot.select(i);
    detailSlot.replaceChildren(detailCard(profile.waypoints[i]));
    onSelect(i);
    if (jump) {
      scroll.scrollLeft = Math.max(0, x(i) - scroll.clientWidth / 2);
      scroll.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  };
  plot = plotSvg(profile, (i) => pick(i));
  scroll.append(plot.svg);

  const head = h("div", { className: "pf-head" });
  if (profile.worst) {
    const w = profile.worst;
    const btn = h("button", { type: "button", className: "small", id: "jumpWorst", textContent: "Jump to worst shear" });
    btn.addEventListener("click", () => pick(w.index, true));
    head.append(h("p", { className: `pf-headline sh-${shearBand(w.shear)}`, id: "pfHeadline" },
      `Max shear ${w.shear} at ${w.name}`, h("small", { textContent: ` (${w.level})` })), btn);
  }

  root.append(
    head,
    h("p", { className: "meta" }, "Tap a waypoint for details. Swipe sideways on long routes."),
    h("div", { className: "pf-wrap" }, h("div", { className: "pf-axis" }, axisSvg()), scroll),
    legend(),
    detailSlot,
    gapSection(profile, pick),
  );
  if (selected != null && selected < profile.waypoints.length) pick(selected);
}
