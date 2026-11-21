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
      assert.deepEqual(first, { rawLists: 1, rawLines: 8, alphaInRaw: 1, tables: 1, chartRows: chartLen(RULES.airbus), headerCells: 6, warnings: 1 });
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
      assert.equal(c.headerCells, 7);
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
      assert.equal(c.headerCells, 6);
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
          const cells = [...document.querySelectorAll("#chart tbody td:not(.turb)")];
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
