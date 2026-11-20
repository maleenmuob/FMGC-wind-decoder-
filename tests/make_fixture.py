# Builds tests/fixtures/sample.pdf from the made-up rows in tests/sample-rows.js.
# Tokens are drawn as separate pieces (and some rows character by character)
# so the PDF.js line rebuild is actually exercised.
import re, pathlib
from reportlab.pdfgen import canvas
from reportlab.pdfbase.pdfmetrics import stringWidth

here = pathlib.Path(__file__).parent
lines = re.findall(r'^\s*"(.*)",\s*$', (here / "sample-rows.js").read_text(), re.M)
out = here / "fixtures" / "sample.pdf"
c = canvas.Canvas(str(out), pagesize=(842, 595))
font, size = "Courier", 10
y = 540
for n, ln in enumerate(lines):
    if n == 7:  # second page for the rest
        c.showPage(); y = 540
    c.setFont(font, size)
    x = 40
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
    y -= 16
c.save()
print("wrote", out)
