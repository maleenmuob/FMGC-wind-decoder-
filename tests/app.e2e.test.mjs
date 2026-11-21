// Browser test of the real app (needs Playwright with Chromium; skipped otherwise).
// Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { readFile, cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze, LEVEL_SETS, RULES } from "../decoder.js";
import { SAMPLE_LINES } from "./sample-rows.js";

const require = createRequire(import.meta.url);
let chromium = null;
try { ({ chromium } = require("playwright")); } catch { /* not installed */ }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PDF = path.join(ROOT, "tests/fixtures/sample.pdf");
const PDF_REPEAT = path.join(ROOT, "tests/fixtures/sample-repeat.pdf");
const PDF_PLAN = path.join(ROOT, "tests/fixtures/sample-flightplan.pdf"); // made-up flight plan
const chartLen = (rule, lv = "3") => analyze(SAMPLE_LINES, LEVEL_SETS[lv], rule).chart.length;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".png": "image/png", ".webmanifest": "application/manifest+json", ".pdf": "application/pdf" };

// Serves `dir` at /app/ like GitHub Pages serves the repo under a sub-path.
function serve(dir) {
  const server = http.createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/app\//, "/");
    if (p.endsWith("/")) p += "index.html";
    try {
      const body = await readFile(path.join(dir, path.normalize(p)));
      res.writeHead(200, { "Content-Type": TYPES[path.extname(p)] || "application/octet-stream", "Cache-Control": "no-cache" });
      res.end(body);
    } catch {
      res.writeHead(404); res.end();
    }
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

async function counts(page) {
  return page.evaluate(() => ({
    rawLists: document.querySelectorAll("#raw").length,
    rawLines: document.getElementById("raw").textContent.split("\n").filter(Boolean).length,
    alphaInRaw: (document.getElementById("raw").textContent.match(/^ALPHA /gm) || []).length,
    tables: document.querySelectorAll("#chart tbody").length,
    chartRows: document.querySelectorAll("#chart tbody tr").length,
    headerCells: document.querySelectorAll("#chart thead th").length,
    warnings: document.querySelectorAll("#warnList li").length,
  }));
}

async function pick(page, file) {
  await page.evaluate(() => { document.getElementById("status").textContent = ""; });
  await page.setInputFiles("#file", file);
  await page.waitForFunction(() => /^Using:/.test(document.getElementById("status").textContent));
}

test("app in the browser", { skip: !chromium && "Playwright not installed" }, async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "fmgc-app-"));
  await cp(ROOT, dir, { recursive: true, filter: (s) => !s.includes(`${path.sep}.git`) });
  const server = await serve(dir);
  const url = `http://127.0.0.1:${server.address().port}/app/`;
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();

    await t.test("shows the version at the top", async () => {
      const { APP_VERSION } = await import("../version.js");
      assert.equal(await page.textContent("#version"), APP_VERSION);
    });

    await t.test("Airbus standard is selected when the app opens", async () => {
      const checked = () => page.$$eval('#rules button', (bs) => bs.map((b) => [b.textContent.trim(), b.getAttribute("aria-checked")]));
      assert.deepEqual(await checked(), [
        ["Airbus standard30° / 30 kt / 5°C", "true"],
        ["More sensitive20° / 20 kt / 5°C", "false"],
        ["Customset below", "false"],
      ]);
      await page.click('button[data-rule="more"]');
      await page.reload();
      assert.equal((await checked())[0][1], "true"); // back to the default on the next open
      assert.match(await page.textContent(".hint"), /this device only/);
      assert.match(await page.textContent(".choose"), /Upload flight plan/);
      assert.doesNotMatch(await page.textContent("body"), /iPad/i);
    });

    await t.test("running twice shows exactly one set of results", async () => {
      await pick(page, PDF);
      const first = await counts(page);
      assert.deepEqual(first, { rawLists: 1, rawLines: 8, alphaInRaw: 1, tables: 1, chartRows: chartLen(RULES.airbus), headerCells: 5, warnings: 1 });
      assert.doesNotMatch(await page.$eval("#chart", (t) => t.closest(".card").textContent), /Turbulence|shear|⚠️|🔴/); // no turbulence in the wind chart
      assert.equal(await page.isHidden("#flightInfo"), true); // the plain test PDF has no plan header
      assert.equal(await page.textContent("#selRule"), "Airbus standard (30° / 30 kt / 5°C)");
      await pick(page, PDF);
      assert.deepEqual(await counts(page), first);
    });

    await t.test("changing buttons re-runs on the same PDF without duplicates", async () => {
      await page.click('button[data-levels="4"]');
      let c = await counts(page);
      assert.equal(c.rawLines, 8);
      assert.equal(c.alphaInRaw, 1);
      assert.equal(c.tables, 1);
      assert.equal(c.headerCells, 6);
      assert.equal(c.warnings, 1);
      await page.click('button[data-rule="more"]');
      assert.equal(await page.textContent("#selRule"), "More sensitive (20° / 20 kt / 5°C)");
      await page.click('button[data-rule="more"]'); // tapping the selected button again does nothing
      await page.click('button[data-rule="custom"]');
      await page.fill("#cDir", "40");
      await page.click('button[data-levels="3"]');
      c = await counts(page);
      assert.equal(c.rawLines, 8);
      assert.equal(c.alphaInRaw, 1);
      assert.equal(c.tables, 1);
      assert.equal(c.headerCells, 5);
      assert.equal(c.warnings, 1);
      assert.equal(await page.textContent("#selRule"), "Custom (40° / 20 kt / 5°C)");
    });

    await t.test("a PDF with the table twice shows one set of rows", async () => {
      await page.click('button[data-rule="more"]');
      await pick(page, PDF_REPEAT);
      const c = await counts(page);
      assert.equal(c.rawLines, 8);
      assert.equal(c.alphaInRaw, 1);
      assert.equal(c.chartRows, chartLen(RULES.more));
      assert.match(await page.textContent("#status"), /8 repeated rows ignored/);
    });

    await t.test("flight plan header, Shear & MSA profile: headline, jump, detail card, shear list", async () => {
      await page.click('button[data-rule="airbus"]');
      await page.click('button[data-levels="3"]');
      await pick(page, PDF_PLAN);
      await page.waitForSelector("#pfHeadline");
      // Which flight plan this is.
      assert.equal(await page.isVisible("#flightInfo"), true);
      assert.equal(await page.textContent("#flightRoute"), "PPPP → QQQQ");
      assert.deepEqual(await page.$$eval("#flightInfo dd", (d) => d.map((x) => x.textContent)), ["TST123", "5 Mar 2027", "4321"]);
      assert.equal(await page.textContent("#pfHeadline"), "Max shear 7 at PQRST (FL180)");
      assert.equal(await page.$$eval("#profile .pf-wp-label", (l) => l.map((x) => x.textContent).join(" ")),
        "ABCDE FGHIJ KLMNO PQRST UVWXY VWXYZ QQQQ");
      assert.equal(await page.$$eval("#profile .pf-box", (b) => b.length), 7 * 6);
      assert.equal(await page.$$eval("#profile .pf-box.red", (b) => b.map((x) => x.textContent).join(",")), "7,6");
      assert.equal(await page.$$eval("#profile .pf-msa-num", (b) => b.map((x) => x.textContent).join(",")), "045,060,098,152,132,110");
      assert.match(await page.textContent("#profile .pf-mingap"), /18,800 ft on the leg to PQRST \(FL340, MSA 15,200 ft\)/);

      // Shear list: 8 rows, highest shear first, 4 at the planned level, no "Above MSA".
      assert.doesNotMatch(await page.textContent("#profile"), /Above MSA/);
      const list = await page.$$eval("#profile .pf-gap-table tbody tr", (trs) => trs.map((tr) => [...tr.cells].map((c) => c.textContent).concat(tr.className)));
      assert.equal(list.length, 8);
      assert.deepEqual(list[0], ["PQRST", "FL180", "7 🔴", "15,200", ""]);
      assert.deepEqual(list[1], ["PQRST", "FL340 ●", "6 🔴", "15,200", "planned"]);
      assert.equal(list.filter((g) => g.at(-1) === "planned").length, 4);

      // Jump to worst shear opens the detail card.
      await page.click("#jumpWorst");
      assert.match(await page.textContent("#pfDetail h3"), /^PQRST/);
      const facts = await page.$$eval("#pfDetail dd", (d) => d.map((x) => x.textContent));
      assert.deepEqual(facts, ["FL340", "15,200 ft", "18,800 ft", "6"]);
      const rows = await page.$$eval("#pfDetail tbody tr", (trs) => trs.map((tr) => [...tr.cells].map((c) => c.textContent)));
      assert.equal(rows.length, 6);
      assert.deepEqual(rows[2], ["FL340 ●", "300/60", "-41°C", "6 🔴"]);
      assert.deepEqual(rows[5], ["FL180", "300/30", "-6°C", "7 🔴"]);

      // Tapping a waypoint shows its card (the slash name keeps its '/').
      await page.click('#profile .pf-hit[data-index="2"]');
      assert.equal(await page.textContent("#pfDetail h3"), "KLMNO (KLMNO/)");
      // Tapping a shear-list row selects that waypoint.
      await page.click("#profile .pf-gap-table tbody tr:nth-child(6)");
      assert.equal(await page.textContent("#pfDetail h3"), "FGHIJ");
    });

    await t.test("profile: dots follow the FMGC chart, and re-runs never duplicate it", async () => {
      const dots = async () => page.$$eval("#profile .pf-fmgc-dot", (d) => d.length);
      const chartRows = async () => page.$$eval("#chart tbody tr", (r) => r.length);
      assert.equal(await dots(), await chartRows());
      await page.click('button[data-rule="more"]');
      assert.equal(await dots(), await chartRows());
      assert.equal(await page.textContent("#pfDetail h3"), "FGHIJ"); // selection kept on re-run
      await pick(page, PDF_PLAN);
      await pick(page, PDF_PLAN);
      assert.equal(await page.$$eval("#profile .pf-scroll svg", (s) => s.length), 1);
      assert.equal(await page.$$eval("#profile .pf-gap-table", (s) => s.length), 1);
      assert.equal(await page.$$eval("#pfHeadline", (s) => s.length), 1);
      assert.equal(await page.$$eval("#pfDetail", (s) => s.length), 0); // new PDF: no stale card
    });

    for (const name of ["iPhone SE", "iPad Pro 11"]) {
      await t.test(`profile works on ${name}: sideways scroll with the FL axis pinned`, async () => {
        const { devices } = require("playwright");
        const dev = await browser.newContext({ ...devices[name] });
        const p = await dev.newPage();
        await p.goto(url);
        await pick(p, PDF_PLAN);
        await p.waitForSelector("#pfHeadline");
        const m = await p.evaluate(() => ({
          pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
          axisLeft: document.querySelector(".pf-axis").getBoundingClientRect().left,
        }));
        assert.ok(m.pageOverflow <= 0, "the page itself must not scroll sideways");
        await p.tap("#jumpWorst");
        await p.$eval(".pf-scroll", (s) => { s.scrollLeft = s.scrollWidth; });
        const after = await p.evaluate(() => ({
          axisLeft: document.querySelector(".pf-axis").getBoundingClientRect().left,
          axisText: document.querySelector(".pf-axis").textContent,
        }));
        assert.equal(after.axisLeft, m.axisLeft, "FL axis stays put while the chart scrolls");
        assert.match(after.axisText, /FL180.*FL240.*FL300.*FL340.*FL380.*FL410/);
        await p.$eval(".pf-scroll", (s) => { s.scrollLeft = 0; });
        await p.tap('#profile .pf-hit[data-index="0"]');
        assert.match(await p.textContent("#pfDetail h3"), /^ABCDE/);
        const tables = await p.$$eval(".pf-table-wrap", (ws) => ws.map((w) => w.scrollWidth - w.clientWidth));
        assert.deepEqual(tables, [0, 0], "detail and gap tables fit the screen without sideways scrolling");
        await p.screenshot({ path: path.join(tmpdir(), `fmgc-profile-${name.replace(/ /g, "-")}.png`), fullPage: true });
        await dev.close();
      });
    }

    await t.test("works offline", async () => {
      await ctx.setOffline(true);
      await page.reload();
      await pick(page, PDF);
      assert.equal((await counts(page)).rawLines, 8);
      await ctx.setOffline(false);
    });

    for (const name of ["iPhone 13", "iPhone SE", "Pixel 7"]) {
      await t.test(`chart stays readable on ${name} (scrolls sideways, not squashed)`, async () => {
        const { devices } = require("playwright");
        const phone = await browser.newContext({ ...devices[name] });
        const p = await phone.newPage();
        await p.goto(url);
        await p.click('button[data-levels="4"]');
        await pick(p, PDF);
        const m = await p.evaluate(() => {
          const wrap = document.querySelector(".table-wrap");
          const cells = [...document.querySelectorAll("#chart tbody td")];
          const lines = (c) => { const r = document.createRange(); r.selectNodeContents(c); return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size; };
          return {
            pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
            tableWider: wrap.scrollWidth > wrap.clientWidth,
            maxCellLines: Math.max(...cells.map(lines)),
            minLevelCellWidth: Math.min(...cells.filter((c) => c.cellIndex >= 2).map((c) => c.getBoundingClientRect().width)),
            hint: !document.getElementById("scrollHint").hidden,
          };
        });
        assert.ok(m.pageOverflow <= 0, "the page itself must not scroll sideways");
        assert.ok(m.tableWider, "the chart scrolls inside its box");
        assert.equal(m.maxCellLines, 1, "no chart cell wraps onto two lines");
        assert.ok(m.minLevelCellWidth >= 90, `level cells keep their width (${m.minLevelCellWidth}px)`);
        assert.ok(m.hint, "shows the swipe hint");
        // After swiping, the waypoint column stays in view.
        await p.$eval(".table-wrap", (w) => { w.scrollLeft = w.scrollWidth; });
        const wpLeft = await p.$eval("#chart tbody tr td:nth-child(2)", (td) =>
          td.getBoundingClientRect().left - td.closest(".table-wrap").getBoundingClientRect().left);
        assert.ok(wpLeft >= 0 && wpLeft < 80, `waypoint column stays visible (${wpLeft}px)`);
        await p.screenshot({ path: path.join(tmpdir(), `fmgc-${name.replace(/ /g, "-")}.png`), fullPage: true });
        await phone.close();
      });
    }

    await t.test("a new version is loaded the next time the app is opened online", async () => {
      await page.goto("about:blank");
      for (const f of ["sw.js", "version.js"]) {
        const p = path.join(dir, f);
        await writeFile(p, (await readFile(p, "utf8")).replace(/"v\d+\.\d+"/, '"v99.9"'));
      }
      await page.goto(url); // opens the old cached version, which finds the update
      await page.waitForFunction(() => document.getElementById("version").textContent === "v99.9", null, { timeout: 15000 });
    });

    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
