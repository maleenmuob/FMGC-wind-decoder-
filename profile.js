// Shear & MSA profile: navigation-log parsing and route profile building.
// Pure functions only (no DOM, no network), shared by the app and the tests.

import { ALL_LEVELS, decodeWind, buildChart } from "./decoder.js";

// Wind-table levels as numbers: [180, 240, 300, 340, 380, 410]
export const LEVEL_FLS = ALL_LEVELS.map((l) => parseInt(l.slice(2), 10));

// Points that split a leg but are not in the wind table.
const PSEUDO = /^(TOC|TOD|ETP\d*)$/;
const LATLON = /^[NS]\d{4,5}[EW]\d{5,6}$/;
const ZTIME = /^\d{1,2}\/\d{2}$/;
const NAV_HEADER = /^AWY\s+FIX\s+FREQ\s+FL\b/;
// End of the main route: the alternate's route, or the destination elevation.
const NAV_STOP = /^ROUTE TO (FIRST )?ALTERNATE\b|^ELEV \d+FT$/;

/** "FGHIJ/" -> "FGHIJ" */
export const cleanFix = (name) => name.replace(/\/+$/, "");
export const isPseudo = (name) => PSEUDO.test(cleanFix(name));

/** MSA colour band: green below FL100, amber FL100–140, red above FL140. */
export function msaBand(msaFt) {
  if (msaFt == null) return null;
  if (msaFt > 14000) return "red";
  if (msaFt >= 10000) return "amber";
  return "green";
}

/** Shear colour band: grey 0–3, amber 4–5, red 6+. */
export function shearBand(shear) {
  if (shear == null) return null;
  if (shear >= 6) return "red";
  if (shear >= 4) return "amber";
  return "grey";
}

/**
 * Line 1 of a nav-log fix:
 *   AWY FIX [FREQ] FL TAS GS MCSE ZDIST ZTIME ...
 * The frequency can run into the FL: "116.3534" = 116.35 + FL34.
 * The FL is printed in thousands of feet (34 = FL340); `fl` is returned as a
 * flight level (340).
 * Returns {awy, fix, name, freq, fl, dist} or null.
 */
export function parseFixLine(line) {
  const t = line.trim().split(/\s+/);
  const z = t.findIndex((x, i) => i >= 2 && ZTIME.test(x));
  if (z < 6) return null;
  const [tas, gs, mcse, zdist] = t.slice(z - 4, z);
  if (!/^\d{3}$/.test(tas) || !/^\d{3}$/.test(gs) || !/^\d{3}$/.test(mcse) || !/^\d{4}$/.test(zdist)) return null;

  const before = t.slice(0, z - 4);
  let awy = null, fix, rest;
  if (before.length >= 2 && !/^\d{2}$/.test(before[1]) && !/^\d+\.\d+$/.test(before[1])) {
    [awy, fix] = before;
    rest = before.slice(2);
  } else {
    fix = before[0];
    rest = before.slice(1);
  }
  if (!fix || !/^[A-Z0-9]{2,7}\/?$/.test(fix)) return null;

  let freq = null, fl = null;
  for (const tok of rest) {
    let m;
    if (/^\d{2}$/.test(tok)) fl = parseInt(tok, 10) * 10;
    else if ((m = /^(\d{3}\.\d{1,2})(\d{2})$/.exec(tok)) && tok.split(".")[1].length >= 3) {
      freq = m[1];
      fl = parseInt(m[2], 10) * 10;
    } else if (/^\d{3}\.\d{1,2}$/.test(tok)) freq = tok;
    else return null; // something we don't understand: not a fix line
  }
  return { awy, fix, name: cleanFix(fix), freq, fl, dist: parseInt(zdist, 10) };
}

/** Line 2: LATLON MSA WIND ... -> {latlon, msa (ft)} or null. */
export function parsePosLine(line) {
  const t = line.trim().split(/\s+/);
  if (!LATLON.test(t[0] || "")) return null;
  const msa = /^\d{3}$/.test(t[1] || "") ? parseInt(t[1], 10) * 100 : null;
  return { latlon: t[0], msa };
}

/**
 * Read the navigation log (main route only).
 * Each fix has 3 lines (fix, position+MSA, max shear); a page break may put
 * footer lines between them, which are skipped. Stops at
 * "ROUTE TO FIRST ALTERNATE" or the destination's "ELEV ...FT" line, or when
 * the plan starts again (second copy).
 * Returns { points: [{name, fix, awy, freq, fl, msa, mxsh, pseudo}], warnings }.
 */
export function parseNavLog(lines) {
  const points = [];
  const warnings = [];
  // If the PDF has a nav-log header, only read after it.
  let started = !lines.some((l) => NAV_HEADER.test(l.trim()));
  let cur = null; // the fix waiting for its line 2 / line 3
  let stage = 0; // 1 = have line 1, 2 = have line 2

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (NAV_HEADER.test(line)) {
      started = true; // may repeat on every page
      continue;
    }
    if (!started) continue;
    if (NAV_STOP.test(line)) {
      if (points.length) break;
      continue;
    }

    if (stage === 1) {
      const pos = parsePosLine(line);
      if (pos) {
        Object.assign(cur, pos);
        stage = 2;
        continue;
      }
    }
    if (stage === 2 && /^\d{2}$/.test(line)) {
      cur.mxsh = parseInt(line, 10);
      stage = 0;
      continue;
    }
    if (parsePosLine(line)) continue; // stray position line

    const fx = parseFixLine(line);
    if (!fx) continue; // page footer or other text
    if (points.length >= 2 && fx.name === points[0].name) break; // second copy of the plan
    cur = { ...fx, msa: null, latlon: null, mxsh: null, pseudo: isPseudo(fx.fix) };
    points.push(cur);
    stage = 1;
  }

  points.forEach((p, i) => {
    if (p.msa == null && i < points.length - 1) {
      warnings.push({ line: p.fix, reason: `Nav log: no MSA found for ${p.name}` });
    }
  });
  return { points, warnings };
}

/**
 * Build the route profile.
 * - waypoints: real fixes from the nav log (TOC/TOD/ETP folded into legs), in order.
 *   Without a nav log, the wind-table rows are used (no MSA / planned FL).
 * - Each waypoint: wind at all six levels, planned FL, leg MSA (highest of the
 *   pieces when TOC/TOD/ETP split the leg), lowest planned FL on the leg, and
 *   whether it is an FMGC-chart entry.
 */
export function buildProfile({ lines, rows, levels, rule }) {
  const { points, warnings } = parseNavLog(lines);
  const fmgc = new Set(buildChart(rows, levels, rule).map((c) => c.wp));
  const winds = (row) => ALL_LEVELS.map((lvl, i) => ({ level: lvl, fl: LEVEL_FLS[i], token: row?.tokens[i] ?? null, ...(row ? decodeWind(row.tokens[i]) : null) }));

  const waypoints = [];
  if (points.length) {
    // Match nav-log fixes to wind-table rows in order (names may repeat).
    let ptr = 0;
    let legPieces = [];
    let prev = null; // last point (real or pseudo) before the current leg piece
    let inCruise = !points.some((p) => p.name === "TOC");
    let afterTod = false;
    for (const p of points) {
      legPieces.push({ msa: p.msa, fromFl: prev ? prev.fl : p.fl, toFl: p.fl, cruise: inCruise && !afterTod });
      if (p.name === "TOC") inCruise = true;
      if (p.name === "TOD") afterTod = true;
      prev = p;
      if (p.pseudo) continue;

      let row = null;
      for (let k = ptr; k < rows.length; k++) {
        if (rows[k].wp === p.name) { row = rows[k]; ptr = k + 1; break; }
      }
      const msas = legPieces.map((x) => x.msa).filter((v) => v != null);
      const legMsa = msas.length ? Math.max(...msas) : null;
      waypoints.push({
        name: p.name,
        fix: p.fix,
        plannedFl: p.fl,
        msa: legMsa,
        legPieces,
        mxsh: p.mxsh,
        inWindTable: !!row,
        winds: winds(row),
        fmgc: fmgc.has(p.name),
      });
      legPieces = [];
    }
  } else {
    for (const row of rows) {
      waypoints.push({ name: row.wp, fix: row.wp, plannedFl: null, msa: null, legPieces: [], mxsh: null,
        inWindTable: true, winds: winds(row), fmgc: fmgc.has(row.wp) });
    }
  }

  // Worst shear on the route (first occurrence wins ties).
  let worst = null;
  waypoints.forEach((w, i) => {
    for (const c of w.winds) {
      if (c.shear != null && (!worst || c.shear > worst.shear)) worst = { index: i, name: w.name, level: c.level, shear: c.shear };
    }
  });

  return { waypoints, worst, hasNavLog: points.length > 0, warnings, shears: shearList(waypoints), minGap: minCruiseGap(waypoints) };
}

/** Height of a flight level above an MSA, in ft (FL × 100 − MSA). */
export const gapFt = (fl, msa) => (fl == null || msa == null ? null : fl * 100 - msa);

/**
 * Wind-table level(s) closest to the planned FL, if within 2,000 ft.
 * Both levels are returned on a tie (FL360 -> FL340 and FL380).
 */
export function nearestLevels(plannedFl) {
  if (plannedFl == null) return [];
  const d = Math.min(...LEVEL_FLS.map((fl) => Math.abs(fl - plannedFl)));
  return d <= 20 ? LEVEL_FLS.filter((fl) => Math.abs(fl - plannedFl) === d) : [];
}

/**
 * One row per shear value of 4+: waypoint, FL, shear, MSA.
 * Rows at (nearest wind-table level to) the planned FL are marked.
 * Sorted highest shear first, then in route order.
 */
export function shearList(waypoints) {
  const out = [];
  waypoints.forEach((w, index) => {
    const near = nearestLevels(w.plannedFl);
    for (const c of w.winds) {
      if (c.shear == null || c.shear < 4) continue;
      out.push({ index, name: w.name, level: c.level, fl: c.fl, shear: c.shear, msa: w.msa,
        atPlanned: near.includes(c.fl) });
    }
  });
  return out.sort((a, b) => b.shear - a.shear || a.index - b.index || b.fl - a.fl);
}

/**
 * Smallest gap between the planned level and the leg MSA, en route (TOC to TOD).
 * For each leg piece the lower planned FL at its two ends is used.
 */
export function minCruiseGap(waypoints) {
  let best = null;
  waypoints.forEach((w, index) => {
    for (const p of w.legPieces) {
      if (!p.cruise || p.msa == null || p.fromFl == null || p.toFl == null) continue;
      const fl = Math.min(p.fromFl, p.toFl);
      const gap = gapFt(fl, p.msa);
      if (!best || gap < best.gap) best = { index, name: w.name, fl, msa: p.msa, gap };
    }
  });
  return best;
}
