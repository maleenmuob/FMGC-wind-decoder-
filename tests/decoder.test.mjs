import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { APP_VERSION } from "../version.js";
import * as pdfjs from "../vendor/pdfjs/pdf.min.mjs";
import { analyze, decodeWind, dirDiff, fmt, findWindRows, buildChart, reportText, RULES, LEVEL_SETS } from "../decoder.js";
import { pdfToLines, itemsToLines } from "../pdf-lines.js";
import { SAMPLE_LINES } from "./sample-rows.js";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;

test("decodeWind matches the Python rules", () => {
  assert.deepEqual(decodeWind("10022M03-01"), { dir: 100, spd: 22, temp: -3, shear: 1 });
  assert.deepEqual(decodeWind("27110M01-03"), { dir: 270, spd: 110, temp: -1, shear: 3 });
  assert.deepEqual(decodeWind("2799M37-01"), { dir: 270, spd: 99, temp: -37, shear: 1 });
  assert.deepEqual(decodeWind("05015P02-04"), { dir: 50, spd: 15, temp: 2, shear: 4 });
  assert.equal(decodeWind("27104X14-02"), null);
  assert.equal(decodeWind("37010M10-01"), null); // 370° is not a direction
});

test("fmt matches the Python output format", () => {
  assert.equal(fmt(decodeWind("09017M16-00")), "090/17/-16");
  assert.equal(fmt(decodeWind("27110M01-01")), "270/110/-1");
  assert.equal(fmt(decodeWind("05015P02-01")), "050/15/+2");
  assert.equal(fmt(decodeWind("05015M00-01")), "050/15/+0");
  assert.equal(fmt(null), "-----");
});

test("direction difference wraps around 360", () => {
  assert.equal(dirDiff(360, 10), 10);
  assert.equal(dirDiff(350, 10), 20);
  assert.equal(dirDiff(10, 350), 20);
  assert.equal(dirDiff(90, 270), 180);
  assert.equal(dirDiff(0, 360), 0);
});

test("finds rows and warns about undecodable ones", () => {
  const { rows, warnings } = findWindRows(SAMPLE_LINES);
  assert.deepEqual(rows.map((r) => r.wp), ["ALPHA", "BRAVO", "CHAR1", "DELTA", "ECHO", "FOXT", "GOLF", "HOTEL"]);
  assert.equal(rows[4].raw, "ECHO  05015P02-01 05018M15-01 06025M27-01 06044M38-01 06023M49-06 06021M57-02");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].line, /^BROKN/);
});

test("rows side by side on one line are both found", () => {
  const { rows, warnings } = findWindRows([SAMPLE_LINES[2] + "   " + SAMPLE_LINES[3]]);
  assert.deepEqual(rows.map((r) => r.wp), ["ALPHA", "BRAVO"]);
  assert.equal(warnings.length, 0);
});

test("chart: insert rule, * markers, wrap, turbulence", () => {
  const { rows } = findWindRows(SAMPLE_LINES);
  const chart = buildChart(rows, LEVEL_SETS["3"], RULES.standard);
  // BRAVO (360 vs 360) and CHAR1 (010 vs 360 = 10°) are not entries.
  assert.deepEqual(chart.map((c) => c.wp), ["ALPHA", "DELTA", "ECHO", "FOXT", "GOLF"]);
  assert.deepEqual(chart[0].cells.map((c) => c.text), ["360/28/-40", "360/26/-51", "360/24/-59"]);
  assert.deepEqual(chart[1].cells.map((c) => c.text), ["030/45/-39*", "030/24/-50*", "030/22/-58*"]);
  assert.deepEqual(chart[1].flags, ["⚠️ FL340 shear 5"]);
  assert.deepEqual(chart[2].flags, ["🔴 FL380 shear 6"]);
  // FOXT: positive temperature, 40° jump
  assert.equal(chart[3].cells[0].text, "080/40/+2*");
  // GOLF vs FOXT: all levels change
  assert.equal(chart[4].cells[0].text, "270/99/-37*");
  // HOTEL vs GOLF: every change is below 20/20/5, so no entry.
});

test("less sensitive rule produces fewer entries", () => {
  const { rows } = findWindRows(SAMPLE_LINES);
  const a = buildChart(rows, LEVEL_SETS["4"], RULES.standard);
  const b = buildChart(rows, LEVEL_SETS["4"], RULES.less);
  assert.ok(b.length <= a.length);
  assert.equal(a[0].cells.length, 4);
});

test("text report has the Python layout", () => {
  const { rows } = findWindRows(SAMPLE_LINES);
  const levels = LEVEL_SETS["3"];
  const txt = reportText(rows, buildChart(rows, levels, RULES.standard), levels, RULES.standard);
  assert.match(txt, /^--- RAW WIND & TEMP ROWS\nFormat: WP FL180 FL240 FL300 FL340 FL380 FL410\nSelected for chart: FL340 \/ FL380 \/ FL410\n---\n/);
  assert.match(txt, /No\.  Waypoint   FL340        FL380        FL410        Turbulence/);
  assert.match(txt, /\n2    DELTA      030\/45\/-39\*  030\/24\/-50\*  030\/22\/-58\*  ⚠️ FL340 shear 5/);
});

test("itemsToLines joins split fragments by position", () => {
  const items = [
    { str: "-01", x: 104, y: 100.3, w: 18, h: 10 },
    { str: "ALPHA", x: 10, y: 100, w: 30, h: 10 },
    { str: "10022M03", x: 56, y: 100, w: 48, h: 10 },
    { str: "NEXT", x: 10, y: 116, w: 24, h: 10 },
  ];
  assert.deepEqual(itemsToLines(items), ["ALPHA 10022M03-01", "NEXT"]);
});

test("PDF.js reads the fixture PDF into the same rows", async () => {
  const data = new Uint8Array(await readFile(new URL("./fixtures/sample.pdf", import.meta.url)));
  const { lines, pages } = await pdfToLines(pdfjs, data);
  assert.equal(pages, 2);
  const fromPdf = findWindRows(lines);
  const fromText = findWindRows(SAMPLE_LINES);
  assert.deepEqual(fromPdf.rows, fromText.rows);
  assert.equal(fromPdf.warnings.length, 1);
});

test("running twice gives exactly one identical set of results", () => {
  const levels = LEVEL_SETS["3"];
  const a = analyze(SAMPLE_LINES, levels, RULES.standard);
  const b = analyze(SAMPLE_LINES, levels, RULES.standard);
  assert.deepEqual(b, a);
  assert.equal(b.rows.length, 8);
  assert.equal(b.text.match(/RAW WIND & TEMP ROWS/g).length, 1);
  assert.equal(b.text.match(/^ALPHA /gm).length, 1);
});

test("a wind table printed twice is counted once", () => {
  const { rows, repeated } = findWindRows([...SAMPLE_LINES, ...SAMPLE_LINES]);
  assert.equal(rows.length, 8);
  assert.equal(repeated, 8);
});

test("PDF with a repeated table and fake-bold text gives one set of rows", async () => {
  const data = new Uint8Array(await readFile(new URL("./fixtures/sample-repeat.pdf", import.meta.url)));
  const { lines } = await pdfToLines(pdfjs, data);
  const fromPdf = findWindRows(lines);
  assert.deepEqual(fromPdf.rows, findWindRows(SAMPLE_LINES).rows);
  assert.equal(fromPdf.repeated, 8);
});

test("app version matches the service worker version, and every cached file exists", async () => {
  const sw = await readFile(new URL("../sw.js", import.meta.url), "utf8");
  const swVersion = /const VERSION = "([^"]+)"/.exec(sw)[1];
  assert.equal(swVersion, APP_VERSION);
  assert.match(APP_VERSION, /^v\d+\.\d+$/);
  const assets = [...sw.matchAll(/^\s*"\.\/([^"]*)",?$/gm)].map((m) => m[1]).filter(Boolean);
  assert.ok(assets.length > 5);
  for (const a of assets) await access(new URL("../" + a, import.meta.url));
});
