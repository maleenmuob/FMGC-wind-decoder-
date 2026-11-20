# FMGC Wind Decoder (offline web app)

Reads the wind & temperature summary from a flight plan PDF and builds the
FMGC wind entry chart. It runs entirely in the browser and works offline once
it has been opened one time. **PDFs are read on the device and never uploaded.**

Open it from GitHub Pages, then in Safari tap **Share → Add to Home Screen**.

## What it does
- Flight levels: FL340/FL380/FL410 or FL300/FL340/FL380/FL410
- Entry rule: 20°/20 kt/5°C, 30°/30 kt/5°C, or custom
- Shows the raw wind rows, then the FMGC chart (`*` = the change that triggered the entry)
- Turbulence: shear 4–5 ⚠️, shear ≥ 6 🔴
- Direction changes wrap around 360° (360 → 010 is 10°)
- Positive temperatures (`P` instead of `M`) are accepted
- Rows that look like wind data but can't be decoded are listed as warnings
- "Copy as text" gives the same text layout as the original Python script

## Files
| File | Purpose |
| --- | --- |
| `index.html`, `styles.css`, `app.js` | The app page and buttons |
| `decoder.js` | Decoding and chart logic (port of the Python script) |
| `pdf-lines.js` | Rebuilds text lines from PDF.js text positions |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline support and Home Screen app |
| `vendor/pdfjs/` | PDF.js 4.10.38 (legacy build), stored locally |
| `Full_FMGC_Decoder_v7_2.py.py` | Original Pyto script |

When you change any app file, bump `VERSION` in `sw.js` so installed copies update.
The app will then show an **Update** button.

## Tests
Uses made-up rows only (`tests/sample-rows.js`, `tests/fixtures/sample.pdf`).

```
node --test tests/*.test.mjs
```
