# FMGC Wind Decoder (offline web app)

Reads the wind & temperature summary from a flight plan PDF and builds the
FMGC wind entry chart. It runs entirely in the browser and works offline once
it has been opened one time. **PDFs are read on the device and never uploaded.**

Open it from GitHub Pages, then in Safari tap **Share → Add to Home Screen**.

## What it does
- Flight levels: FL340/FL380/FL410 or FL300/FL340/FL380/FL410
- Entry rule: Airbus standard 30°/30 kt/5°C (selected when the app opens), More sensitive 20°/20 kt/5°C, or Custom
- Shows the raw wind rows, then the FMGC chart (`*` = the change that triggered the entry)
- Turbulence: shear 4–5 ⚠️, shear ≥ 6 🔴
- Direction changes wrap around 360° (360 → 010 is 10°)
- Positive temperatures (`P` instead of `M`) are accepted
- Rows that look like wind data but can't be decoded are listed as warnings
- "Copy as text" gives the same text layout as the original Python script
- **Shear & MSA profile** (below the FMGC chart): a side view of the route.
  - Shear boxes at all six levels for every waypoint (grey 0–3, amber 4–5, red 6+),
    with the number inside each box.
  - MSA per leg as a step profile (green below FL100, amber FL100–140, red above FL140),
    from the navigation log. When TOC, TOD or ETP points split a leg, the highest MSA
    of the pieces is used.
  - The planned FL line, and dots under the waypoints that are in the FMGC chart.
  - Tap a waypoint for details, or use "Jump to worst shear".
  - The gap list shows every shear of 4+, with its height above MSA, smallest gap first.
    ● marks rows at your planned level (the closest wind-table level; both levels on a tie).
  - Above the list: the smallest gap between your planned level and MSA, from TOC to TOD.

## Files
| File | Purpose |
| --- | --- |
| `index.html`, `styles.css`, `app.js` | The app page and buttons |
| `version.js` | Version number shown in the app |
| `decoder.js` | Decoding and chart logic (port of the Python script) |
| `profile.js` | Navigation log parsing, Shear & MSA profile and gap list |
| `profile-view.js` | Draws the profile chart, detail card and gap list |
| `pdf-lines.js` | Rebuilds text lines from PDF.js text positions |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline support and Home Screen app |
| `vendor/pdfjs/` | PDF.js 4.10.38 (legacy build), stored locally |
| `Full_FMGC_Decoder_v7_2.py.py` | Original Pyto script |

## Version and updates
The version (e.g. `v8.3`) is shown at the top of the app. **For every change**, set the
same new version in both `version.js` (`APP_VERSION`) and `sw.js` (`VERSION`). A test
checks that they match.

The next time the app is opened with internet, it downloads the new version and
switches to it a moment later. If results are already on screen, it waits and
shows an **Update now** button instead, so nothing is lost.

## Tests
Uses made-up data only (`tests/sample-rows.js`, `tests/sample-flightplan.js`,
and PDFs built from them by `tests/make_fixture.py`). Never commit real flight
plan data. The browser test (`tests/app.e2e.test.mjs`) runs only if
Playwright is installed. It picks a PDF twice, switches every button, and checks that
exactly one set of results is shown. It also checks offline use and updating.

```
node --test tests/*.test.mjs
```
