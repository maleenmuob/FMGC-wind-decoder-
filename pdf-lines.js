// Rebuild text lines from PDF.js text items using their position on the page.
// PDF.js returns text in fragments (sometimes one per word, sometimes split
// mid-token), so we group fragments by baseline (y) and order them by x.

/**
 * items: [{str, x, y, w, h}] in device space (y grows downward).
 * Returns an array of line strings, top to bottom.
 */
export function itemsToLines(items) {
  const frags = items.filter((it) => it.str && it.str.length);
  if (!frags.length) return [];
  frags.sort((a, b) => a.y - b.y || a.x - b.x);

  const groups = [];
  for (const f of frags) {
    const tol = Math.max(2, (f.h || 10) * 0.5);
    const g = groups[groups.length - 1];
    if (g && Math.abs(f.y - g.y) <= tol) {
      g.items.push(f);
      g.y = (g.y * (g.items.length - 1) + f.y) / g.items.length;
    } else {
      groups.push({ y: f.y, items: [f] });
    }
  }

  return groups
    .map((g) => {
      const parts = g.items.sort((a, b) => a.x - b.x);
      let line = "";
      let end = null;
      for (const p of parts) {
        const gap = end == null ? 0 : p.x - end;
        // Insert a space only when there's a visible gap between fragments.
        if (end != null && gap > Math.max(1, (p.h || 10) * 0.2)) line += " ";
        line += p.str;
        end = p.x + (p.w || 0);
      }
      return line.replace(/\s+/g, " ").trim();
    })
    .filter(Boolean);
}

/** Convert one PDF.js page into position-sorted text items. */
export async function pageItems(page, Util) {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const items = [];
  for (const it of content.items) {
    if (typeof it.str !== "string") continue; // marked-content markers
    const t = Util.transform(viewport.transform, it.transform);
    const h = Math.hypot(t[2], t[3]) || it.height || 10;
    items.push({ str: it.str, x: t[4], y: t[5], w: it.width * viewport.scale, h });
  }
  return items;
}

/** Read a PDF (ArrayBuffer/Uint8Array) and return all lines from all pages. */
export async function pdfToLines(pdfjsLib, data) {
  const doc = await pdfjsLib.getDocument({
    data,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    // Never fetch anything extra: everything stays on the device.
    disableAutoFetch: true,
    disableStream: true,
  }).promise;
  try {
    const lines = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      lines.push(...itemsToLines(await pageItems(page, pdfjsLib.Util)));
      page.cleanup();
    }
    return { lines, pages: doc.numPages };
  } finally {
    doc.destroy();
  }
}
