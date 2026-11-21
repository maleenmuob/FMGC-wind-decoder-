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

const require = createRequire(import.meta.url);
let chromium = null;
try { ({ chromium } = require("playwright")); } catch { /* not installed */ }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PDF = path.join(ROOT, "tests/fixtures/sample.pdf");
const PDF_REPEAT = path.join(ROOT, "tests/fixtures/sample-repeat.pdf");
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

    await t.test("running twice shows exactly one set of results", async () => {
      await pick(page, PDF);
      const first = await counts(page);
      assert.deepEqual(first, { rawLists: 1, rawLines: 8, alphaInRaw: 1, tables: 1, chartRows: 5, headerCells: 6, warnings: 1 });
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
      await page.click('button[data-rule="less"]');
      await page.click('button[data-rule="less"]'); // tapping the selected button again does nothing
      await page.click('button[data-rule="custom"]');
      await page.fill("#cDir", "40");
      await page.click('button[data-levels="3"]');
      c = await counts(page);
      assert.equal(c.rawLines, 8);
      assert.equal(c.alphaInRaw, 1);
      assert.equal(c.tables, 1);
      assert.equal(c.headerCells, 6);
      assert.equal(c.warnings, 1);
      assert.match(await page.textContent("#selRule"), /^40° \/ 20 kt/);
    });

    await t.test("a PDF with the table twice shows one set of rows", async () => {
      await page.click('button[data-rule="standard"]');
      await pick(page, PDF_REPEAT);
      const c = await counts(page);
      assert.equal(c.rawLines, 8);
      assert.equal(c.alphaInRaw, 1);
      assert.equal(c.chartRows, 5);
      assert.match(await page.textContent("#status"), /8 repeated rows ignored/);
    });

    await t.test("works offline", async () => {
      await ctx.setOffline(true);
      await page.reload();
      await pick(page, PDF);
      assert.equal((await counts(page)).rawLines, 8);
      await ctx.setOffline(false);
    });

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
