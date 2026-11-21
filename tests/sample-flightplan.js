// A completely made-up flight plan for testing the Shear & MSA profile.
// Fix names, positions and values are invented. Never put real data here.
//
// It contains the traps found in real plans:
// - a page break between line 1 and line 2 of a fix (PQRST), with footer lines
// - a VOR frequency running into the FL: "113.4534" = 113.45 + FL340 (KLMNO)
// - a fix name ending in "/" (KLMNO/), matched to "KLMNO" in the wind table
// - TOC, ETP1 and TOD splitting legs (not in the wind table)
// - a destination with no position/MSA line (QQQQ)
// - "ROUTE TO FIRST ALTERNATE" followed by the alternate's nav log (ignored)
// - the whole plan printed twice (only the first copy is used)
// "@@PAGE" marks a page break in the test PDF; it is not part of the text.

export const NAVLOG = [
  "AWY FIX FREQ FL TAS GS MCSE ZDIST ZTIME ETA/ATA REMT FU",
  "MSA WIND ITCS CTIME REMF",
  "MXSH",
  "SID1A ABCDE 05 280 290 045 0012 0/03 ..../....3/10 00500/......",
  "N01000E001000 045 090/010 045 0/03 20000/......",
  "01",
  "T999 FGHIJ 12 330 340 046 0020 0/04 ..../....3/06 00900/......",
  "N01100E001100 060 100/015 046 0/07 19600/......",
  "02",
  "T999 TOC 34 460 470 046 0030 0/05 ..../....3/01 01500/......",
  "N01200E001200 098 110/020 046 0/12 19000/......",
  "02",
  "T999 KLMNO/ 113.4534 470 480 046 0040 0/05 ..../....2/56 01800/......",
  "N01300E001300 098 120/025 046 0/17 18700/......",
  "03",
  "T999 ETP1 34 470 480 046 0030 0/04 ..../....2/52 02100/......",
  "N01400E001400 152 130/030 046 0/21 18400/......",
  "05",
  "T999 PQRST 34 470 485 046 0030 0/04 ..../....2/48 02400/......",
  "Page - 1 of 3",
  "Page 2",
  "@@PAGE",
  "N01500E001500 098 140/035 046 0/25 18100/......",
  "06",
  "T999 UVWXY 112.3 36 475 490 050 0050 0/06 ..../....2/42 02900/......",
  "N01600E001600 132 150/040 050 0/31 17600/......",
  "04",
  "T999 TOD 36 475 490 050 0020 0/02 ..../....2/40 03100/......",
  "N01700E001700 110 160/045 050 0/33 17400/......",
  "02",
  "STAR1 VWXYZ 20 400 410 060 0040 0/06 ..../....2/34 03500/......",
  "N01800E001800 080 170/030 060 0/39 17000/......",
  "01",
  "STAR1 QQQQ 00 250 260 070 0030 0/08 ..../....2/26 03900/......",
  "15000/......",
  "ELEV 00100FT",
  "ROUTE TO FIRST ALTERNATE: TEST1",
  "AWY FIX FREQ FL TAS GS MCSE ZDIST ZTIME ETA/ATA REMT FU",
  "ALT1 ALTAA 300 310 100 0010 0/02 ..../.... 00100 /......",
  "N01900E001900 050 180/010 100 0/02 14000 /......",
  "00",
];

// FL180 FL240 FL300 FL340 FL380 FL410
export const WINDS = [
  "START OF WIND AND TEMPERATURE SUMMARY TEST TO QQQQ",
  "FL / 18000 24000 30000 34000 38000 41000",
  "ABCDE 27020M05-01 27025M18-02 27030M30-01 27035M40-01 27030M51-00 27028M59-01",
  "FGHIJ 28022M05-02 28027M18-04 28032M30-02 28036M40-02 28031M51-01 28029M59-01",
  "KLMNO 29025M06-03 29030M19-03 29040M31-05 29045M41-04 29040M52-02 29035M60-01",
  "PQRST 30030M06-07 30035M19-05 30050M31-03 30060M41-06 30050M52-03 30040M60-02",
  "UVWXY 31028M06-02 31033M19-02 31045M31-02 31055M41-04 31045M52-05 31038M60-01",
  "VWXYZ 32020M05-01 32025M18-01 32030M30-01 32035M40-01 32030M51-01 32028M59-01",
  "QQQQ  33010P02-00 33015M15-01 33020M28-01 33025M38-01 33020M49-01 33018M57-01",
];

const ONE_COPY = ["TEST FLIGHT PLAN (MADE UP)", ...NAVLOG, "@@PAGE", ...WINDS];

// The full document: the plan printed twice.
export const FLIGHTPLAN = [...ONE_COPY, "@@PAGE", ...ONE_COPY];

/** Text lines as the app sees them (page-break markers removed). */
export const textLines = (lines) => lines.filter((l) => l !== "@@PAGE");
