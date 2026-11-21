# Builds the test PDFs from the made-up data in tests/sample-rows.js and
# tests/sample-flightplan.js (never real flight plan data).
#   sample.pdf        - tokens drawn in pieces (some rows character by character)
#                       so the PDF.js line rebuild is actually exercised
#   sample-repeat.pdf - the wind table printed twice, and every row drawn twice
#                       on top of itself ("fake bold"), like some real PDFs do
import re, pathlib
from reportlab.pdfgen import canvas
from reportlab.pdfbase.pdfmetrics import stringWidth

here = pathlib.Path(__file__).parent
lines = re.findall(r'^\s*"(.*)",\s*$', (here / "sample-rows.js").read_text(), re.M)
font, size = "Courier", 10


def draw_line(c, ln, y, n, dx=0.0):
    x = 40 + dx
    for tok in re.split(r"(\s+)", ln):
        if not tok.strip():
            x += stringWidth(tok, font, size); continue
        if n % 3 == 0:  # char by char, with a tiny baseline jitter
            for i, ch in enumerate(tok):
                c.drawString(x, y + (0.4 if i % 2 else 0), ch); x += stringWidth(ch, font, size)
        elif "-" in tok:  # split token at the shear dash
            a, b = tok.split("-", 1)
            c.drawString(x, y, a); x += stringWidth(a, font, size)
            c.drawString(x, y, "-" + b); x += stringWidth("-" + b, font, size)
        else:
            c.drawString(x, y, tok); x += stringWidth(tok, font, size)


def build(name, copies=1, overprint=False):
    out = here / "fixtures" / name
    c = canvas.Canvas(str(out), pagesize=(842, 595))
    for _ in range(copies):
        y = 540
        for n, ln in enumerate(lines):
            if n == 7:  # rest of the table on the next page
                c.showPage(); y = 540
            c.setFont(font, size)
            draw_line(c, ln, y, n)
            if overprint:
                draw_line(c, ln, y, n, dx=0.4)
            y -= 16
        c.showPage()
    c.save()
    print("wrote", out)


build("sample.pdf")
build("sample-repeat.pdf", copies=2, overprint=True)


def build_flightplan(name="sample-flightplan.pdf"):
    """Made-up flight plan (tests/sample-flightplan.js) with page breaks,
    including one between line 1 and line 2 of a nav-log fix."""
    src = (here / "sample-flightplan.js").read_text()
    blocks = dict(re.findall(r"export const (\w+) = \[(.*?)\];", src, re.S))
    nav = re.findall(r'"(.*)",', blocks["NAVLOG"])
    winds = re.findall(r'"(.*)",', blocks["WINDS"])
    copy = ["TEST FLIGHT PLAN (MADE UP)", *nav, "@@PAGE", *winds]
    out = here / "fixtures" / name
    c = canvas.Canvas(str(out), pagesize=(842, 595))
    y = 560
    for n, ln in enumerate([*copy, "@@PAGE", *copy]):
        if ln == "@@PAGE":
            c.showPage(); y = 560; continue
        c.setFont(font, size)
        draw_line(c, ln, y, n)
        y -= 14
    c.showPage()
    c.save()
    print("wrote", out)


build_flightplan()
