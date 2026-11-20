# ✈️ Full FMGC Wind Entry Decoder v7.2 (Pyto/iPad)
# - Select FL set before running
# - Select wind entry sensitivity before running
# - Reads PDFs from On My iPad → Pyto
# - Shows clean raw wind rows + FMGC chart
# - Turbulence: shear 4–5 = ⚠️, shear ≥6 = 🔴

import os
import re
import pypdf

# Wind token like 27045M52-02 or 29101M50-04
WIND_TOKEN = re.compile(r"^(\d{4,5})M\d{2}-\d{2}$")

RESERVED = {
    "START", "OF", "WIND", "AND", "TEMPERATURE", "SUMMARY",
    "FL", "/", "POS", "ALOFT", "PAGE", "PAGES",
    "END", "ROUTE", "ROUTES", "ALTERNATE", "ALTERNATES"
}

# Full PDF table order:
# WP FL180 FL240 FL300 FL340 FL380 FL410
TOKEN_MAP = {
    "FL300": 3,
    "FL340": 4,
    "FL380": 5,
    "FL410": 6,
}

def choose_levels():
    print("\nChoose flight levels:")
    print(" 1. FL340 / FL380 / FL410")
    print(" 2. FL300 / FL340 / FL380 / FL410")
    choice = input("Enter choice: ").strip()

    if choice == "2":
        return ["FL300", "FL340", "FL380", "FL410"]
    return ["FL340", "FL380", "FL410"]

def choose_rules():
    print("\nChoose FMGC entry rule:")
    print(" 1. Standard: 20° / 20 kt / 5°C")
    print(" 2. Less sensitive: 30° / 30 kt / 5°C")
    print(" 3. Custom")

    choice = input("Enter choice: ").strip()

    if choice == "2":
        return 30, 30, 5

    if choice == "3":
        try:
            d = int(input("Direction change in degrees: ").strip())
            s = int(input("Speed change in knots: ").strip())
            t = int(input("Temperature change in °C: ").strip())
            return d, s, t
        except:
            print("Invalid custom input. Using 20/20/5.")
            return 20, 20, 5

    return 20, 20, 5

def pdf_to_lines(path):
    reader = pypdf.PdfReader(path)
    lines = []
    for page in reader.pages:
        txt = page.extract_text() or ""
        lines.extend(txt.splitlines())
    return lines

def decode_wind(token):
    m = re.match(r"(\d{4,5})M(\d{2})-(\d{2})", token.strip())
    if not m:
        return None

    wind_part, temp_part, shear_part = m.groups()

    # Direction / speed decoding
    if len(wind_part) == 5 and wind_part[2] == "0":
        direction = int(wind_part[:3])
        speed = int(wind_part[3:])
    else:
        direction = int(wind_part[:2]) * 10
        speed = int(wind_part[2:])

    temp = -int(temp_part)
    shear = int(shear_part)

    return direction, speed, temp, shear

def fmt(decoded):
    if not decoded:
        return "-----"

    d, s, t, _ = decoded
    speed_text = f"{s:02d}" if s < 100 else f"{s:03d}"
    return f"{d:03d}/{speed_text}/{t:+d}"

def turb_flag(decoded, level):
    if not decoded:
        return ""

    shear = decoded[3]

    if shear >= 6:
        return f"🔴 {level} shear {shear}"
    if shear >= 4:
        return f"⚠️ {level} shear {shear}"
    return ""

def should_insert(ref, new, dir_change, spd_change, tmp_change):
    if ref is None:
        return True

    for i in range(len(new)):
        a = ref[i]
        b = new[i]

        if not a or not b:
            continue

        if abs(a[0] - b[0]) >= dir_change:
            return True
        if abs(a[1] - b[1]) >= spd_change:
            return True
        if abs(a[2] - b[2]) >= tmp_change:
            return True

    return False

def find_wind_rows(lines, selected_levels):
    raw_lines = []
    rows = []

    for ln in lines:
        parts = ln.split()

        if len(parts) < 7:
            continue

        wp = parts[0]

        if wp.upper() in RESERVED:
            continue

        # Six wind tokens must exist after waypoint:
        # FL180 FL240 FL300 FL340 FL380 FL410
        six_tokens = parts[1:7]

        if not all(WIND_TOKEN.match(t) for t in six_tokens):
            continue

        selected_tokens = []
        for lvl in selected_levels:
            token_index = TOKEN_MAP[lvl]
            selected_tokens.append(parts[token_index])

        raw_lines.append(ln)
        rows.append((wp, selected_tokens))

    return raw_lines, rows

def main():
    print("✈️ Full FMGC Wind Entry Decoder v7.2")

    selected_levels = choose_levels()
    dir_change, spd_change, tmp_change = choose_rules()

    print("\nSelected levels:", " / ".join(selected_levels))
    print(f"Selected rule: {dir_change}° / {spd_change} kt / {tmp_change}°C")

    cwd = os.path.expanduser("~/Documents")

    try:
        files = [f for f in os.listdir(cwd) if f.lower().endswith(".pdf")]
    except PermissionError:
        print("⚠️ Permission error accessing On My iPad → Pyto folder.")
        print("Close Pyto fully and reopen, then try again.")
        return

    if not files:
        print("⚠️ No PDF files found in On My iPad → Pyto.")
        return

    print("\nAvailable PDFs:")
    for i, f in enumerate(files, 1):
        print(f" {i}. {f}")

    choice = input("\nEnter the number of the PDF to use: ").strip()

    try:
        pdf_file = files[int(choice) - 1]
    except:
        print("⚠️ Invalid PDF selection.")
        return

    pdf_path = os.path.join(cwd, pdf_file)
    print(f"\nUsing: {pdf_file}\n")

    try:
        lines = pdf_to_lines(pdf_path)
    except PermissionError:
        print("⚠️ Permission error opening the PDF.")
        print("Move the PDF into On My iPad → Pyto, then try again.")
        return
    except Exception as e:
        print("⚠️ Could not read PDF.")
        print(e)
        return

    raw_lines, items = find_wind_rows(lines, selected_levels)

    if not raw_lines:
        print("⚠️ Could not find valid wind rows in this PDF.")
        return

    print("\n--- RAW WIND & TEMP ROWS")
    print("Format: WP FL180 FL240 FL300 FL340 FL380 FL410")
    print("Selected for chart:", " / ".join(selected_levels))
    print("---")

    for ln in raw_lines:
        print(ln)

    print("--- END RAW ROWS ---\n")

    decoded_rows = []
    for wp, tokens in items:
        decoded = [decode_wind(t) for t in tokens]
        decoded_rows.append((wp, decoded))

    print("\n--- FMGC Wind Entry Chart ---\n")

    header = f"{'No.':<4} {'Waypoint':<10} "
    for lvl in selected_levels:
        header += f"{lvl:<12} "
    header += "Turbulence"

    print(header)
    print("-" * len(header))

    ref = None
    count = 1

    for wp, decoded_levels in decoded_rows:
        if should_insert(ref, decoded_levels, dir_change, spd_change, tmp_change):
            cells = []

            for i, lvl in enumerate(selected_levels):
                cell = fmt(decoded_levels[i])

                if ref and ref[i]:
                    a = ref[i]
                    b = decoded_levels[i]

                    if a and b:
                        if (
                            abs(a[0] - b[0]) >= dir_change or
                            abs(a[1] - b[1]) >= spd_change or
                            abs(a[2] - b[2]) >= tmp_change
                        ):
                            cell += "*"

                cells.append(cell)

            tb = []
            for i, lvl in enumerate(selected_levels):
                flag = turb_flag(decoded_levels[i], lvl)
                if flag:
                    tb.append(flag)

            tb_text = ", ".join(tb)

            line = f"{count:<4} {wp:<10} "
            for cell in cells:
                line += f"{cell:<12} "
            line += tb_text

            print(line)

            ref = decoded_levels
            count += 1

if __name__ == "__main__":
    main()
