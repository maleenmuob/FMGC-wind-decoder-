// Which flight plan is this? Reads origin, destination, flight number,
// plan number and date from the plan's header lines. Pure functions only.
//
// Lines used, best first (the first copy of the plan wins):
//   PLAN 4321 TST123 05MAR PPPP TO QQQQ A320 20/F IFR 05/03/27
//   CFP 4321 TST123PPPP TO QQQQ IFR/A320/XTEST COMPUTED 0100Z 05/03/27
//   START OF WIND AND TEMPERATURE SUMMARY PPPP TO QQQQ   (origin/destination only)

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

const PLAN = /^PLAN\s+(\d+)\s+([A-Z0-9]{2,8})\s+(\d{1,2}[A-Z]{3})\s+([A-Z]{4})\s+TO\s+([A-Z]{4})\b(.*)$/;
const CFP = /^CFP\s+(\d+)\s+([A-Z0-9]{2,8}?)([A-Z]{4})\s+TO\s+([A-Z]{4})\b(.*)$/;
const SUMMARY = /^START OF WIND AND TEMPERATURE SUMMARY\s+([A-Z]{4})\s+TO\s+([A-Z]{4})\b/;
const DMY = /\b(\d{2})\/(\d{2})\/(\d{2})\b/;

/** "18/11/26" -> "18 Nov 2026"; "18NOV" -> "18 Nov" (no year printed). */
function niceDate(rest, ddmmm) {
  const m = DMY.exec(rest || "");
  if (m) {
    const [, d, mo, y] = m;
    const month = MONTHS[parseInt(mo, 10) - 1];
    if (month) return `${parseInt(d, 10)} ${month[0]}${month.slice(1).toLowerCase()} 20${y}`;
  }
  if (ddmmm) {
    const d = /^(\d{1,2})([A-Z]{3})$/.exec(ddmmm);
    if (d && MONTHS.includes(d[2])) return `${parseInt(d[1], 10)} ${d[2][0]}${d[2].slice(1).toLowerCase()}`;
  }
  return null;
}

/**
 * Returns { origin, destination, flight, plan, date } (any may be null),
 * or null when nothing was found.
 */
export function parseFlightInfo(lines) {
  // First match of each kind (first copy of the plan), then merged best first.
  const found = { plan: null, cfp: null, summary: null };
  for (const raw of lines) {
    const line = raw.trim().replace(/\s+/g, " ");
    let m;
    if (!found.plan && (m = PLAN.exec(line))) {
      found.plan = { plan: m[1], flight: m[2], origin: m[4], destination: m[5], date: niceDate(m[6], m[3]) };
    } else if (!found.cfp && (m = CFP.exec(line))) {
      found.cfp = { plan: m[1], flight: m[2], origin: m[3], destination: m[4], date: niceDate(m[5]) };
    } else if (!found.summary && (m = SUMMARY.exec(line))) {
      found.summary = { origin: m[1], destination: m[2] };
    }
    if (found.plan && found.cfp && found.summary) break;
  }
  const info = { origin: null, destination: null, flight: null, plan: null, date: null };
  for (const src of [found.plan, found.cfp, found.summary]) {
    if (!src) continue;
    for (const k of Object.keys(info)) if (info[k] == null && src[k]) info[k] = src[k];
  }
  return Object.values(info).some((v) => v != null) ? info : null;
}

/** One line for the screen and the copied text, e.g. "TST123 · PPPP → QQQQ · 5 Mar 2027 · Plan 4321". */
export function flightTitle(info) {
  if (!info) return "";
  const route = info.origin || info.destination ? `${info.origin || "?"} → ${info.destination || "?"}` : null;
  return [info.flight, route, info.date, info.plan && `Plan ${info.plan}`].filter(Boolean).join(" · ");
}
