import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as pdfjs from "../vendor/pdfjs/pdf.min.mjs";
import { findWindRows, buildChart, LEVEL_SETS, RULES } from "../decoder.js";
import { pdfToLines } from "../pdf-lines.js";
import {
  parseFixLine, parsePosLine, parseNavLog, buildProfile, nearestLevels, msaBand, shearBand, gapFt,
} from "../profile.js";
import { WINDS, FLIGHTPLAN, textLines } from "./sample-flightplan.js";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;

const LINES = textLines(FLIGHTPLAN);
const profileOf = (lines, rule = RULES.airbus, levels = LEVEL_SETS["3"]) =>
  buildProfile({ lines, rows: findWindRows(lines).rows, levels, rule });

test("fix line: airway, fix, optional frequency, FL in thousands", () => {
  assert.deepEqual(parseFixLine("T999 ABCDE 113.4534 465 470 020 0021 0/03 ..../....2/10 11000/......"),
    { awy: "T999", fix: "ABCDE", name: "ABCDE", freq: "113.45", fl: 340, dist: 21 });
  assert.deepEqual(parseFixLine("T999 FGHIJ/ 34 465 468 021 0033 0/05 ..../....2/05 11400/......"),
    { awy: "T999", fix: "FGHIJ/", name: "FGHIJ", freq: null, fl: 340, dist: 33 });
  assert.equal(parseFixLine("T999 UVWXY 112.3 36 475 490 050 0050 0/06 x").freq, "112.3");
  assert.equal(parseFixLine("T999 UVWXY 112.3 36 475 490 050 0050 0/06 x").fl, 360);
  assert.equal(parseFixLine("SID1A ABCDE 05 280 290 045 0012 0/03 x").fl, 50);
  assert.equal(parseFixLine("W1 ABC 111.034 470 480 046 0040 0/05 x").fl, 340); // 111.0 + 34
  // Not fix lines:
  assert.equal(parseFixLine("N01300E001300 098 120/025 046 0/17 18700/......"), null);
  assert.equal(parseFixLine("Page - 1 of 3"), null);
  assert.equal(parseFixLine("ABCDE 27020M05-01 27025M18-02 27030M30-01 27035M40-01 27030M51-00 27028M59-01"), null);
});

test("position line gives MSA in feet", () => {
  assert.deepEqual(parsePosLine("N01300E001300 098 120/025 046 0/17 18700/......"), { latlon: "N01300E001300", msa: 9800 });
  assert.equal(parsePosLine("T999 ABCDE 34 465 470 020 0021 0/03"), null);
});

test("nav log: page break, glued frequency, '/' names, alternate and second copy", () => {
  const { points, warnings } = parseNavLog(LINES);
  assert.deepEqual(points.map((p) => p.name),
    ["ABCDE", "FGHIJ", "TOC", "KLMNO", "ETP1", "PQRST", "UVWXY", "TOD", "VWXYZ", "QQQQ"]);
  assert.deepEqual(points.map((p) => p.fl), [50, 120, 340, 340, 340, 340, 360, 360, 200, 0]);
  assert.deepEqual(points.map((p) => p.msa), [4500, 6000, 9800, 9800, 15200, 9800, 13200, 11000, 8000, null]);
  assert.deepEqual(points.map((p) => p.mxsh), [1, 2, 2, 3, 5, 6, 4, 2, 1, null]);
  assert.equal(points[3].fix, "KLMNO/");
  assert.equal(points[3].freq, "113.45");
  assert.deepEqual(points.filter((p) => p.pseudo).map((p) => p.name), ["TOC", "ETP1", "TOD"]);
  assert.deepEqual(warnings, []); // the destination has no MSA line, which is normal
});

test("profile: waypoints, leg MSA (highest piece), planned FL, wind-table match", () => {
  const p = profileOf(LINES);
  assert.ok(p.hasNavLog);
  assert.deepEqual(p.waypoints.map((w) => w.name), ["ABCDE", "FGHIJ", "KLMNO", "PQRST", "UVWXY", "VWXYZ", "QQQQ"]);
  // KLMNO: TOC piece 9800 + KLMNO 9800; PQRST: ETP1 piece 15200 + 9800 -> 15200; VWXYZ: TOD 11000 + 8000 -> 11000
  assert.deepEqual(p.waypoints.map((w) => w.msa), [4500, 6000, 9800, 15200, 13200, 11000, null]);
  assert.deepEqual(p.waypoints.map((w) => w.plannedFl), [50, 120, 340, 340, 360, 200, 0]);
  assert.ok(p.waypoints.every((w) => w.inWindTable));
  // All six levels decoded for every waypoint.
  assert.deepEqual(p.waypoints[3].winds.map((c) => c.shear), [7, 5, 3, 6, 3, 2]);
  assert.deepEqual(p.waypoints[3].winds.map((c) => c.level), ["FL180", "FL240", "FL300", "FL340", "FL380", "FL410"]);
  assert.equal(p.waypoints[6].winds[0].temp, 2); // positive temperature at QQQQ
});

test("worst shear and smallest gap en route (TOC to TOD)", () => {
  const p = profileOf(LINES);
  assert.deepEqual(p.worst, { index: 3, name: "PQRST", level: "FL180", shear: 7 });
  // Cruise pieces: TOC-KLMNO 24,200 · KLMNO-ETP1 18,800 · ETP1-PQRST 24,200 · PQRST-UVWXY 20,800 · UVWXY-TOD 25,000
  assert.deepEqual(p.minGap, { index: 3, name: "PQRST", fl: 340, msa: 15200, gap: 18800 });
});

test("gap list: every shear 4+, smallest gap first, planned level marked", () => {
  const p = profileOf(LINES);
  assert.deepEqual(p.gaps.map((g) => [g.name, g.level, g.shear, g.msa, g.gap, g.atPlanned]), [
    ["PQRST", "FL180", 7, 15200, 2800, false],
    ["PQRST", "FL240", 5, 15200, 8800, false],
    ["FGHIJ", "FL240", 4, 6000, 18000, false],
    ["PQRST", "FL340", 6, 15200, 18800, true],
    ["KLMNO", "FL300", 5, 9800, 20200, false],
    ["UVWXY", "FL340", 4, 13200, 20800, true], // FL360 is equally close to FL340 and FL380
    ["KLMNO", "FL340", 4, 9800, 24200, true],
    ["UVWXY", "FL380", 5, 13200, 24800, true],
  ]);
});

test("FMGC dots follow the FMGC chart for the chosen levels and rule", () => {
  const rows = findWindRows(LINES).rows;
  for (const rule of [RULES.airbus, RULES.more]) {
    for (const lv of ["3", "4"]) {
      const p = buildProfile({ lines: LINES, rows, levels: LEVEL_SETS[lv], rule });
      const chart = buildChart(rows, LEVEL_SETS[lv], rule).map((c) => c.wp);
      assert.deepEqual(p.waypoints.filter((w) => w.fmgc).map((w) => w.name), chart);
    }
  }
});

test("without a nav log: wind-table waypoints, no MSA", () => {
  const p = profileOf(WINDS);
  assert.equal(p.hasNavLog, false);
  assert.equal(p.waypoints.length, 7);
  assert.ok(p.waypoints.every((w) => w.msa == null && w.plannedFl == null));
  assert.equal(p.minGap, null);
  assert.equal(p.worst.shear, 7);
});

test("without the alternate line, the second copy is still ignored", () => {
  const lines = LINES.filter((l) => !/^ROUTE TO FIRST ALTERNATE/.test(l));
  // The destination's "ELEV ...FT" line ends the route instead.
  const { points } = parseNavLog(lines);
  assert.equal(points.at(-1).name, "QQQQ");
  assert.equal(points.length, 10);
});

test("colour bands and helpers", () => {
  assert.deepEqual([0, 3, 4, 5, 6, 9].map(shearBand), ["grey", "grey", "amber", "amber", "red", "red"]);
  assert.deepEqual([9900, 10000, 14000, 14100].map(msaBand), ["green", "amber", "amber", "red"]);
  assert.equal(gapFt(340, 15200), 18800);
  assert.deepEqual(nearestLevels(330), [340]);
  assert.deepEqual(nearestLevels(360), [340, 380]);
  assert.deepEqual(nearestLevels(50), []);
});

test("PDF.js reads the made-up flight plan PDF the same as the text", async () => {
  const data = new Uint8Array(await readFile(new URL("./fixtures/sample-flightplan.pdf", import.meta.url)));
  const { lines } = await pdfToLines(pdfjs, data);
  const fromPdf = profileOf(lines);
  const fromText = profileOf(LINES);
  assert.deepEqual(fromPdf.waypoints.map((w) => [w.name, w.msa, w.plannedFl]), fromText.waypoints.map((w) => [w.name, w.msa, w.plannedFl]));
  assert.deepEqual(fromPdf.gaps, fromText.gaps);
  assert.deepEqual(fromPdf.minGap, fromText.minGap);
});
