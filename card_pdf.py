"""
card_pdf.py — PDF Card Generator
==================================
Creates printable unit cards matching the official Trench Crusade
roster sheet layout (Warband Roster Sheet v1.3.2).

Uses the 'reportlab' library. Install with:
    pip install reportlab

PYTHON CONCEPTS:
  - Functions with parameters
  - Drawing on a canvas (x, y coordinates)
  - Loops to draw repeated elements
  - String formatting
"""

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, black, white
from reportlab.pdfgen import canvas


# ═══════════════════════════════════════════════════════════════════════
# CARD DIMENSIONS & STYLING
# ═══════════════════════════════════════════════════════════════════════

# Each card takes up roughly half an A4 page width
CARD_W = 180 * mm    # card width
CARD_H_ELITE = 95 * mm   # elite card height (with experience/injuries)
CARD_H_TROOP = 72 * mm   # troop card height (simpler)

# Colors matching the Trench Crusade aesthetic
DARK_RED = HexColor("#8B0000")
CREAM = HexColor("#F5F0E0")
DARK = HexColor("#1A1510")
MED_GREY = HexColor("#999999")
LIGHT_LINE = HexColor("#CCBBAA")


# ═══════════════════════════════════════════════════════════════════════
# HELPER: draw a single unit card
# ═══════════════════════════════════════════════════════════════════════

def draw_unit_card(c, x, y, unit, is_elite):
    """
    Draw one unit card on the canvas.

    Parameters:
        c        : the reportlab Canvas object
        x, y     : bottom-left corner position of the card
        unit     : dict with all unit data (from the warband list)
        is_elite : True if this is an ELITE unit (adds experience/injury rows)

    Coordinate system: (0,0) is bottom-left of the page,
    y increases upward, x increases rightward.
    """
    card_h = CARD_H_ELITE if is_elite else CARD_H_TROOP
    top = y + card_h  # top edge of the card

    # ── Outer border ──
    c.setStrokeColor(black)
    c.setLineWidth(1.5)
    c.rect(x, y, CARD_W, card_h)

    # ── Header bar: Name / Type / Keywords ──
    header_h = 10 * mm
    header_y = top - header_h
    c.setFillColor(CREAM)
    c.rect(x, header_y, CARD_W, header_h, fill=1, stroke=1)

    c.setFillColor(DARK_RED)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(x + 3 * mm, header_y + 5.5 * mm, "Name")
    c.setFillColor(black)
    c.setFont("Helvetica-Bold", 10)
    name_str = unit.get("name", "")
    c.drawString(x + 15 * mm, header_y + 5.5 * mm, name_str)

    c.setFillColor(DARK_RED)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(x + 80 * mm, header_y + 5.5 * mm, "Type")
    c.setFillColor(black)
    c.setFont("Helvetica", 9)
    c.drawString(x + 93 * mm, header_y + 5.5 * mm, unit["type"])

    # Keywords on second line of header
    c.setFillColor(DARK_RED)
    c.setFont("Helvetica-Bold", 6)
    c.drawString(x + 3 * mm, header_y + 1.5 * mm, "Keywords")
    c.setFillColor(black)
    c.setFont("Helvetica", 6.5)
    kw_str = ", ".join(unit.get("keywords", []))
    # Truncate if too long
    if len(kw_str) > 80:
        kw_str = kw_str[:77] + "..."
    c.drawString(x + 25 * mm, header_y + 1.5 * mm, kw_str)

    # ── Stats table: Movement | Ranged | Melee | Armour | Ducats ──
    table_y = header_y - 14 * mm
    table_h = 14 * mm
    col_w = CARD_W / 5

    # Header row
    c.setFont("Helvetica-Bold", 7)
    labels = ["Movement", "Ranged", "Melee", "Armour", "Total Cost"]
    for i, label in enumerate(labels):
        col_x = x + i * col_w
        c.setStrokeColor(black)
        c.setLineWidth(0.5)
        c.rect(col_x, table_y, col_w, 6 * mm, stroke=1)
        c.setFillColor(black)
        c.drawCentredString(col_x + col_w / 2, table_y + 2 * mm, label)

    # Value row
    total_cost = unit["base_cost"] + sum(e[1] for e in unit.get("equipment", []))
    values = [
        unit["movement"],
        unit["ranged"],
        unit["melee"],
        str(unit["armour"]),
        str(total_cost),
    ]
    c.setFont("Helvetica-Bold", 11)
    for i, val in enumerate(values):
        col_x = x + i * col_w
        c.rect(col_x, table_y - 8 * mm, col_w, 8 * mm, stroke=1)
        c.drawCentredString(col_x + col_w / 2, table_y - 5.5 * mm, val)

    # ── Equipment line ──
    equip_y = table_y - 8 * mm - 8 * mm
    c.setFont("Helvetica-Bold", 7)
    c.setFillColor(DARK_RED)
    c.drawString(x + 3 * mm, equip_y + 3.5 * mm, "Equipment:")
    c.setFillColor(black)
    c.setFont("Helvetica", 7)

    # Combine base equipment + purchased equipment
    base_eq = unit.get("base_equipment", [])
    purchased_eq = [f"{e[0]} ({e[1]}d)" for e in unit.get("equipment", [])]
    all_eq = base_eq + purchased_eq
    eq_str = ", ".join(all_eq) if all_eq else "None"
    if len(eq_str) > 90:
        eq_str = eq_str[:87] + "..."
    c.drawString(x + 25 * mm, equip_y + 3.5 * mm, eq_str)

    # Draw line under equipment
    c.setStrokeColor(LIGHT_LINE)
    c.setLineWidth(0.3)
    c.line(x + 3 * mm, equip_y + 1.5 * mm, x + CARD_W - 3 * mm, equip_y + 1.5 * mm)

    # ── Abilities section ──
    abil_y = equip_y - 2 * mm
    c.setFont("Helvetica-Bold", 7)
    c.setFillColor(DARK_RED)
    c.drawString(x + 3 * mm, abil_y, "Abilities:")
    c.setFillColor(black)
    c.setFont("Helvetica", 6)

    abilities = unit.get("abilities", [])
    for i, abil in enumerate(abilities[:4]):  # max 4 abilities to fit
        ay = abil_y - (i + 1) * 4 * mm + 2 * mm
        # Truncate long abilities
        display = abil if len(abil) <= 100 else abil[:97] + "..."
        c.drawString(x + 5 * mm, ay, f"■ {display}")

    # ── ELITE-only sections: Experience and Injuries ──
    if is_elite:
        xp_y = y + 16 * mm
        c.setFont("Helvetica-Bold", 7)
        c.setFillColor(DARK_RED)
        c.drawString(x + 3 * mm, xp_y + 5 * mm, "Experience")
        c.setFillColor(black)

        # Draw 18 experience checkboxes (squares and circles alternating)
        c.setFont("Helvetica", 8)
        for i in range(18):
            bx = x + 30 * mm + i * 7 * mm
            if i < 18:
                # Alternate square and circle like the official sheet
                if i % 2 == 0:
                    c.rect(bx, xp_y + 4 * mm, 4 * mm, 4 * mm, stroke=1, fill=0)
                else:
                    c.circle(bx + 2 * mm, xp_y + 6 * mm, 2 * mm, stroke=1, fill=0)

        # Scars
        c.setFont("Helvetica-Bold", 7)
        c.drawString(x + CARD_W - 30 * mm, xp_y + 5 * mm, "Scars")
        c.rect(x + CARD_W - 16 * mm, xp_y + 4 * mm, 5 * mm, 5 * mm, stroke=1, fill=0)
        c.rect(x + CARD_W - 9 * mm, xp_y + 4 * mm, 5 * mm, 5 * mm, stroke=1, fill=0)

        # Injuries line
        c.setFont("Helvetica-Bold", 7)
        c.setFillColor(DARK_RED)
        c.drawString(x + 3 * mm, y + 5 * mm, "Injuries:")
        c.setStrokeColor(LIGHT_LINE)
        c.line(x + 22 * mm, y + 5 * mm, x + CARD_W - 35 * mm, y + 5 * mm)


# ═══════════════════════════════════════════════════════════════════════
# MAIN FUNCTION: generate the full PDF
# ═══════════════════════════════════════════════════════════════════════

def generate_warband_pdf(warband_name, faction_name, units, filename="warband_cards.pdf"):
    """
    Generate a PDF with unit cards for the warband.

    Parameters:
        warband_name : str — name of the warband
        faction_name : str — faction display name
        units        : list of dicts — each unit with all its data
        filename     : str — output PDF path
    """
    page_w, page_h = A4
    c = canvas.Canvas(filename, pagesize=A4)
    c.setTitle(f"Trench Crusade - {warband_name}")

    # ── Title page / header ──
    c.setFont("Helvetica-Bold", 20)
    c.setFillColor(DARK_RED)
    c.drawCentredString(page_w / 2, page_h - 25 * mm, "TRENCH ✠ CRUSADE")
    c.setFont("Helvetica", 12)
    c.setFillColor(black)
    c.drawCentredString(page_w / 2, page_h - 33 * mm, "Warband Roster Sheet")

    c.setFont("Helvetica-Bold", 14)
    c.drawCentredString(page_w / 2, page_h - 45 * mm, warband_name)
    c.setFont("Helvetica", 10)
    c.drawCentredString(page_w / 2, page_h - 53 * mm, f"Faction: {faction_name}")

    # Calculate total cost
    total_ducats = sum(
        u["base_cost"] + sum(e[1] for e in u.get("equipment", []))
        for u in units
    )
    c.drawCentredString(
        page_w / 2, page_h - 61 * mm,
        f"Models: {len(units)}  |  Total Cost: {total_ducats} Ducats"
    )

    # ── Draw cards ──
    # Layout: 1 card per row, stacked vertically
    margin_x = 15 * mm
    start_y = page_h - 75 * mm
    current_y = start_y
    cards_on_page = 0

    # Separate elites and troops
    elites = [u for u in units if u.get("is_elite", False)]
    troops = [u for u in units if not u.get("is_elite", False)]

    # Draw elite header
    if elites:
        c.setFont("Helvetica-Bold", 14)
        c.setFillColor(DARK_RED)
        c.drawCentredString(page_w / 2, current_y + 5 * mm, "‡ Elites ‡")
        current_y -= 5 * mm

    all_units = [(u, True) for u in elites] + [(u, False) for u in troops]

    drew_troops_header = False

    for unit, is_elite in all_units:
        card_h = CARD_H_ELITE if is_elite else CARD_H_TROOP

        # Check if we need a troops header
        if not is_elite and not drew_troops_header:
            if current_y - 10 * mm < 20 * mm:
                c.showPage()
                current_y = page_h - 20 * mm
            c.setFont("Helvetica-Bold", 14)
            c.setFillColor(DARK_RED)
            c.drawCentredString(page_w / 2, current_y, "† Troops †")
            current_y -= 10 * mm
            drew_troops_header = True

        # Check if card fits on current page
        if current_y - card_h < 15 * mm:
            c.showPage()
            current_y = page_h - 20 * mm

        draw_unit_card(c, margin_x, current_y - card_h, unit, is_elite)
        current_y -= card_h + 5 * mm

    c.save()
    print(f"\n✠ PDF saved to: {filename}")
    return filename
