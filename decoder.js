// FMGC wind decoder logic (port of Full_FMGC_Decoder_v7_2.py).
// Pure functions only: no DOM, no network. Shared by the app and the tests.

// Wind token like 27045M52-02, 29101M50-04, or with a positive temp 27045P05-01.
export const WIND_TOKEN = /^(\d{4,5})([MP])(\d{2})-(\d{2})$/;

// Anything that looks roughly like a wind/temp token, used to warn about
// rows that look like wind data but could not be decoded.
const WIND_LIKE = /^\d{4,5}[MP]\d|^\d{4,5}[A-Z]\d{2}-\d{1,2}$|^\d{4,5}[MP]?\d{2}[-+]\d{1,2}$/;

export const RESERVED = new Set([
  "START", "OF", "WIND", "AND", "TEMPERATURE", "SUMMARY",
  "FL", "/", "POS", "ALOFT", "PAGE", "PAGES",
  "END", "ROUTE", "ROUTES", "ALTERNATE", "ALTERNATES",
]);

// Full PDF table order: WP FL180 FL240 FL300 FL340 FL380 FL410
export const ALL_LEVELS = ["FL180", "FL240", "FL300", "FL340", "FL380", "FL410"];
export const TOKEN_MAP = { FL300: 3, FL340: 4, FL380: 5, FL410: 6 };

export const LEVEL_SETS = {
  "3": ["FL340", "FL380", "FL410"],
  "4": ["FL300", "FL340", "FL380", "FL410"],
};

// Entry-rule presets, in the order shown in the app. The first is the default.
export const RULES = {
  airbus: { name: "Airbus standard", dir: 30, spd: 30, tmp: 5 },
  more: { name: "More sensitive", dir: 20, spd: 20, tmp: 5 },
};
export const DEFAULT_RULE = "airbus";

/** e.g. "Airbus standard (30° / 30 kt / 5°C)" */
export function ruleLabel(rule) {
  const values = `${rule.dir}° / ${rule.spd} kt / ${rule.tmp}°C`;
  return rule.name ? `${rule.name} (${values})` : values;
}

/** Decode one token into {dir, spd, temp, shear}, or null if invalid. */
export function decodeWind(token) {
  const m = WIND_TOKEN.exec(String(token).trim());
  if (!m) return null;
  const [, wind, sign, tempPart, shearPart] = m;

  let dir, spd;
  if (wind.length === 5 && wind[2] === "0") {
    dir = parseInt(wind.slice(0, 3), 10);
    spd = parseInt(wind.slice(3), 10);
  } else {
    dir = parseInt(wind.slice(0, 2), 10) * 10;
    spd = parseInt(wind.slice(2), 10);
  }
  if (dir > 360) return null; // not a real direction: treat as undecodable

  const t = parseInt(tempPart, 10);
  return { dir, spd, temp: sign === "M" ? -t : t, shear: parseInt(shearPart, 10) };
}

/** Same text format as the Python script: 100/22/-3 */
export function fmt(d) {
  if (!d) return "-----";
  const dir = String(d.dir).padStart(3, "0");
  const spd = d.spd < 100 ? String(d.spd).padStart(2, "0") : String(d.spd).padStart(3, "0");
  const temp = d.temp >= 0 ? `+${d.temp}` : String(d.temp);
  return `${dir}/${spd}/${temp}`;
}

/** Smallest angle between two directions, wrapping around 360 (360→010 = 10). */
export function dirDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

function changed(a, b, rule) {
  if (!a || !b) return false;
  return (
    dirDiff(a.dir, b.dir) >= rule.dir ||
    Math.abs(a.spd - b.spd) >= rule.spd ||
    Math.abs(a.temp - b.temp) >= rule.tmp
  );
}

export function shouldInsert(ref, next, rule) {
  if (ref == null) return true;
  return next.some((b, i) => changed(ref[i], b, rule));
}

function isWaypoint(tok) {
  return !RESERVED.has(tok.toUpperCase()) && !WIND_TOKEN.test(tok) && !WIND_LIKE.test(tok);
}

/**
 * Find wind rows in text lines.
 * A row is a waypoint followed by six valid wind tokens (FL180..FL410).
 * Rows are searched anywhere in a line, so two tables printed side by side
 * on the same line are both found.
 * A row that exactly repeats an earlier one (same waypoint, same six tokens),
 * e.g. because the PDF prints the wind table twice, is counted once.
 * Returns { rows: [{wp, tokens[6], raw}], warnings: [{line, reason}], repeated }.
 */
export function findWindRows(lines) {
  const rows = [];
  const warnings = [];
  const seen = new Set();
  let repeated = 0;

  for (const ln of lines) {
    const parts = ln.split(/\s+/).filter(Boolean);
    if (!parts.length) continue;
    const used = new Array(parts.length).fill(false);
    let foundInLine = false;

    for (let i = 0; i + 6 < parts.length; i++) {
      if (!isWaypoint(parts[i])) continue;
      const six = parts.slice(i + 1, i + 7);
      if (!six.every((t) => WIND_TOKEN.test(t))) continue;

      const wp = parts[i];
      const bad = six.filter((t) => !decodeWind(t));
      for (let k = i; k < i + 7; k++) used[k] = true;
      foundInLine = true;
      const key = `${wp} ${six.join(" ")}`;
      if (seen.has(key)) {
        repeated++;
        i += 6;
        continue;
      }
      seen.add(key);
      rows.push({ wp, tokens: six, raw: `${wp.padEnd(5)} ${six.join(" ")}` });
      if (bad.length) {
        warnings.push({ line: ln.trim(), reason: `${wp}: can't decode ${bad.join(", ")}` });
      }
      i += 6;
    }

    // Leftover tokens that look like wind data mean a row we couldn't read.
    const stray = parts.filter((t, k) => !used[k] && (WIND_TOKEN.test(t) || WIND_LIKE.test(t)));
    if (stray.length) {
      warnings.push({
        line: ln.trim(),
        reason: foundInLine
          ? `extra wind-like data not decoded: ${stray.join(" ")}`
          : "looks like a wind row but couldn't be decoded",
      });
    }
  }
  return { rows, warnings, repeated };
}

/** Everything one run produces, built from scratch each time. */
export function analyze(lines, levels, rule, title = "") {
  const { rows, warnings, repeated } = findWindRows(lines);
  const chart = buildChart(rows, levels, rule);
  return { rows, warnings, repeated, chart, text: reportText(rows, chart, levels, rule, title) };
}

/**
 * Build the FMGC chart.
 * levels: e.g. ["FL340","FL380","FL410"]; rule: {dir, spd, tmp}.
 * Returns [{no, wp, cells:[{text, marked, decoded}]}]
 */
export function buildChart(rows, levels, rule) {
  const out = [];
  let ref = null;
  let no = 1;
  for (const row of rows) {
    const decoded = levels.map((lvl) => decodeWind(row.tokens[TOKEN_MAP[lvl] - 1]));
    if (!shouldInsert(ref, decoded, rule)) continue;

    const cells = decoded.map((d, i) => {
      const marked = !!(ref && changed(ref[i], d, rule));
      return { text: fmt(d) + (marked ? "*" : ""), marked, decoded: d };
    });
    out.push({ no, wp: row.wp, cells });
    ref = decoded;
    no++;
  }
  return out;
}

/**
 * Plain-text report in the same layout as the Python script's output.
 * `title` (optional) is a first line naming the flight plan.
 */
export function reportText(rows, chart, levels, rule, title = "") {
  const L = [];
  if (title) L.push(title, "");
  L.push("--- RAW WIND & TEMP ROWS");
  L.push(`Format: WP ${ALL_LEVELS.join(" ")}`);
  L.push(`Selected for chart: ${levels.join(" / ")}`);
  L.push("---");
  for (const r of rows) L.push(r.raw);
  L.push("--- END RAW ROWS ---", "", "");
  L.push("--- FMGC Wind Entry Chart ---");
  L.push(`Rule: ${ruleLabel(rule)}`, "");
  let header = `${"No.".padEnd(4)} ${"Waypoint".padEnd(10)} `;
  for (const lvl of levels) header += `${lvl.padEnd(12)} `;
  header = header.trimEnd();
  L.push(header, "-".repeat(header.length));
  for (const c of chart) {
    let line = `${String(c.no).padEnd(4)} ${c.wp.padEnd(10)} `;
    for (const cell of c.cells) line += `${cell.text.padEnd(12)} `;
    L.push(line.trimEnd());
  }
  return L.join("\n");
}
