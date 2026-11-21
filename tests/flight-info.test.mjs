import test from "node:test";
import assert from "node:assert/strict";
import { parseFlightInfo, flightTitle } from "../flight-info.js";
import { FLIGHTPLAN, textLines } from "./sample-flightplan.js";

const LINES = textLines(FLIGHTPLAN);

test("reads origin, destination, flight, plan number and date (made-up plan)", () => {
  const info = parseFlightInfo(LINES);
  assert.deepEqual(info, { origin: "PPPP", destination: "QQQQ", flight: "TST123", plan: "4321", date: "5 Mar 2027" });
  assert.equal(flightTitle(info), "TST123 · PPPP → QQQQ · 5 Mar 2027 · Plan 4321");
});

test("the PLAN line wins even when the CFP line comes first", () => {
  const info = parseFlightInfo([
    "CFP 1111 AAA1ZZZZ TO YYYY IFR COMPUTED 0100Z 01/01/27",
    "PLAN 2222 BBB2 02FEB XXXX TO WWWW A320 IFR 02/02/27",
  ]);
  assert.deepEqual(info, { origin: "XXXX", destination: "WWWW", flight: "BBB2", plan: "2222", date: "2 Feb 2027" });
});

test("falls back to the CFP line, then the wind summary", () => {
  const noPlan = LINES.filter((l) => !l.startsWith("PLAN "));
  // The flight number runs into the origin on the CFP line: TST123PPPP.
  assert.deepEqual(parseFlightInfo(noPlan), { origin: "PPPP", destination: "QQQQ", flight: "TST123", plan: "4321", date: "5 Mar 2027" });
  const summaryOnly = LINES.filter((l) => !/^(PLAN|CFP) /.test(l));
  assert.deepEqual(parseFlightInfo(summaryOnly), { origin: "PPPP", destination: "QQQQ", flight: null, plan: null, date: null });
  assert.equal(flightTitle(parseFlightInfo(summaryOnly)), "PPPP → QQQQ");
});

test("date without a year, and nothing found", () => {
  assert.equal(parseFlightInfo(["PLAN 7 CCC3 09OCT AAAA TO BBBB A320"]).date, "9 Oct");
  assert.equal(parseFlightInfo(["nothing here", "START OF something"]), null);
  assert.equal(flightTitle(null), "");
});

test("only the first copy of the plan is used", () => {
  const info = parseFlightInfo([...LINES, "PLAN 9999 OTHER 01JAN EEEE TO FFFF A320 01/01/28"]);
  assert.equal(info.plan, "4321");
});
