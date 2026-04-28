#!/usr/bin/env python3
"""
main.py — Trench Crusade Warband Builder (CLI)
================================================
An interactive command-line program to build your warband and
generate printable PDF unit cards.

Run:  python3 main.py

PYTHON CONCEPTS DEMONSTRATED:
  - while loops for menus
  - input() for user interaction
  - try/except for error handling
  - f-strings for formatting
  - Importing from other files (modules)
  - Lists as mutable collections
"""

# Import our data and PDF generator from the other files
from data import FACTIONS
from card_pdf import generate_warband_pdf
import os


# ═══════════════════════════════════════════════════════════════════════
# HELPER FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════

def clear_screen():
    """Clear the terminal screen (works on Windows and Linux/Mac)."""
    os.system('cls' if os.name == 'nt' else 'clear')


def print_header(title):
    """Print a formatted section header."""
    width = 60
    print()
    print("═" * width)
    print(f"  ✠  {title}")
    print("═" * width)


def print_divider():
    """Print a thin divider line."""
    print("─" * 50)


def get_choice(prompt, max_val, allow_zero=False):
    """
    Ask the user for a number between 1 and max_val.
    Returns the number, or 0 if allow_zero and they type 0.
    Returns -1 if they type 'q' to go back.

    This demonstrates:
      - while True loops (keep asking until valid input)
      - try/except for handling non-number inputs
    """
    while True:
        try:
            raw = input(prompt).strip().lower()
            if raw == 'q' or raw == 'quit' or raw == 'back':
                return -1
            num = int(raw)
            if allow_zero and num == 0:
                return 0
            if 1 <= num <= max_val:
                return num
            print(f"  Please enter a number between 1 and {max_val}.")
        except ValueError:
            print("  Please enter a valid number (or 'q' to go back).")


# ═══════════════════════════════════════════════════════════════════════
# STEP 1: CHOOSE A FACTION
# ═══════════════════════════════════════════════════════════════════════

def choose_faction():
    """Let the user pick a faction. Returns the faction key string."""
    print_header("TRENCH ✠ CRUSADE — Warband Card Forge")
    print()
    print("  Choose your faction:")
    print()

    # Convert dict keys to a list so we can index them by number
    faction_keys = list(FACTIONS.keys())

    for i, key in enumerate(faction_keys, 1):
        faction = FACTIONS[key]
        side_icon = "☩" if faction["side"] == "Faithful" else "🜏"
        print(f"  [{i}] {side_icon} {faction['name']}  ({faction['side']})")

    print()
    choice = get_choice("  Enter number: ", len(faction_keys))
    if choice == -1:
        return None
    return faction_keys[choice - 1]


# ═══════════════════════════════════════════════════════════════════════
# STEP 2: BUILD THE WARBAND
# ═══════════════════════════════════════════════════════════════════════

def show_warband_summary(warband_name, faction, warband):
    """Display current warband status."""
    print_divider()
    print(f"  Warband: {warband_name}  |  {faction['name']}")

    total_cost = sum(
        u["base_cost"] + sum(e[1] for e in u.get("equipment", []))
        for u in warband
    )
    elite_count = sum(1 for u in warband if u.get("is_elite", False))
    troop_count = len(warband) - elite_count

    print(f"  Models: {len(warband)}  |  Ducats: {total_cost}/700")
    print(f"  Elites: {elite_count}  |  Troops: {troop_count}")
    print_divider()

    if warband:
        for i, u in enumerate(warband, 1):
            eq_cost = sum(e[1] for e in u.get("equipment", []))
            role = "‡" if u.get("is_elite") else "†"
            name_part = f' "{u["name"]}"' if u.get("name") else ""
            print(f"  {role} {i}. {u['type']}{name_part}  — {u['base_cost'] + eq_cost}d")
    else:
        print("  (No warriors recruited yet)")
    print()


def recruit_unit(faction):
    """
    Let the user pick a unit type to recruit.
    Returns a new unit dict, or None if cancelled.
    """
    print_header("Recruit a Warrior")
    print()

    # Combine elites and troops into one numbered list
    all_units = []

    print("  ‡ ELITES ‡")
    for unit_template in faction["elites"]:
        all_units.append((unit_template, True))
        idx = len(all_units)
        print(f"  [{idx}] {unit_template['type']}  "
              f"({unit_template['base_cost']}d)  "
              f"Limit: {unit_template['limit']}  "
              f"| {unit_template['movement']} R:{unit_template['ranged']} "
              f"M:{unit_template['melee']} A:{unit_template['armour']}")

    print()
    print("  † TROOPS †")
    for unit_template in faction["troops"]:
        all_units.append((unit_template, False))
        idx = len(all_units)
        print(f"  [{idx}] {unit_template['type']}  "
              f"({unit_template['base_cost']}d)  "
              f"Limit: {unit_template['limit']}  "
              f"| {unit_template['movement']} R:{unit_template['ranged']} "
              f"M:{unit_template['melee']} A:{unit_template['armour']}")

    print()
    choice = get_choice("  Select unit (or 'q' to cancel): ", len(all_units))
    if choice == -1:
        return None

    template, is_elite = all_units[choice - 1]

    # Create a new unit from the template
    # .copy() makes a shallow copy so we don't modify the original data
    new_unit = {
        "type": template["type"],
        "base_cost": template["base_cost"],
        "movement": template["movement"],
        "ranged": template["ranged"],
        "melee": template["melee"],
        "armour": template["armour"],
        "base_size": template["base_size"],
        "keywords": template["keywords"].copy(),  # copy the list!
        "abilities": template["abilities"].copy(),
        "base_equipment": template["base_equipment"].copy(),
        "equipment": [],  # purchased equipment goes here
        "is_elite": is_elite,
        "name": "",
    }

    # Ask for a name
    name = input(f"\n  Name your {template['type']} (or Enter to skip): ").strip()
    new_unit["name"] = name

    # Show abilities
    if template["abilities"]:
        print(f"\n  Abilities for {template['type']}:")
        for abil in template["abilities"]:
            print(f"    ■ {abil}")

    return new_unit


def equip_unit(unit, faction):
    """
    Let the user add equipment to a unit from the faction armoury.
    Modifies the unit dict in place.
    """
    armoury = faction["armoury"]

    while True:
        eq_cost = sum(e[1] for e in unit.get("equipment", []))
        unit_total = unit["base_cost"] + eq_cost

        print_header(f"Equip: {unit['type']}")
        if unit.get("name"):
            print(f'  Name: "{unit["name"]}"')
        print(f"  Current cost: {unit_total} Ducats")
        if unit["equipment"]:
            print(f"  Equipment: {', '.join(e[0] for e in unit['equipment'])}")
        else:
            print("  Equipment: None purchased yet")
        if unit["base_equipment"]:
            print(f"  Included: {', '.join(unit['base_equipment'])}")
        print()

        # List armoury categories
        categories = list(armoury.keys())
        for i, cat in enumerate(categories, 1):
            print(f"  [{i}] Browse {cat}")
        print(f"  [0] Done equipping")
        print()

        cat_choice = get_choice("  Category: ", len(categories), allow_zero=True)
        if cat_choice == 0 or cat_choice == -1:
            break

        cat_name = categories[cat_choice - 1]
        items = armoury[cat_name]

        print(f"\n  ── {cat_name} ──")
        for i, (item_name, cost) in enumerate(items, 1):
            cost_str = f"{cost}d" if isinstance(cost, int) else str(cost)
            # Mark already purchased items
            owned = "✓" if any(e[0] == item_name for e in unit["equipment"]) else " "
            print(f"  [{i}] {owned} {item_name}  — {cost_str}")

        print(f"  [0] Back")
        print()

        item_choice = get_choice("  Add item: ", len(items), allow_zero=True)
        if item_choice == 0 or item_choice == -1:
            continue

        item_name, cost = items[item_choice - 1]

        # Check if already owned
        if any(e[0] == item_name for e in unit["equipment"]):
            print(f"  Already equipped with {item_name}!")
            continue

        # Skip non-ducat costs (Glory items)
        if not isinstance(cost, int):
            print(f"  {item_name} costs {cost} — cannot purchase with Ducats.")
            continue

        unit["equipment"].append((item_name, cost))
        print(f"  ✠ Added {item_name} ({cost}d)")


# ═══════════════════════════════════════════════════════════════════════
# MAIN GAME LOOP
# ═══════════════════════════════════════════════════════════════════════

def main():
    """Main program loop — the entry point of the application."""

    clear_screen()

    # Step 1: Choose faction
    faction_key = choose_faction()
    if faction_key is None:
        print("  Goodbye!")
        return

    faction = FACTIONS[faction_key]

    # Step 2: Name the warband
    print()
    warband_name = input("  Name your Warband: ").strip()
    if not warband_name:
        warband_name = f"Unnamed {faction['name']} Warband"

    # The warband is stored as a list of unit dicts
    warband = []

    # Step 3: Main builder loop
    while True:
        clear_screen()
        show_warband_summary(warband_name, faction, warband)

        print("  What would you like to do?")
        print("  [1] Recruit a warrior")
        print("  [2] Equip a warrior")
        print("  [3] Remove a warrior")
        print("  [4] Generate PDF cards")
        print("  [5] Quit")
        print()

        action = get_choice("  Action: ", 5)

        if action == 1:
            # Recruit
            new_unit = recruit_unit(faction)
            if new_unit:
                warband.append(new_unit)
                print(f"\n  ✠ {new_unit['type']} recruited!")
                input("  Press Enter to continue...")

        elif action == 2:
            # Equip
            if not warband:
                print("  No warriors to equip! Recruit one first.")
                input("  Press Enter to continue...")
                continue
            print("\n  Which warrior to equip?")
            for i, u in enumerate(warband, 1):
                print(f"  [{i}] {u['type']} {u.get('name', '')}")
            idx = get_choice("  Select: ", len(warband))
            if idx != -1:
                equip_unit(warband[idx - 1], faction)

        elif action == 3:
            # Remove
            if not warband:
                print("  No warriors to remove!")
                input("  Press Enter to continue...")
                continue
            print("\n  Which warrior to remove?")
            for i, u in enumerate(warband, 1):
                print(f"  [{i}] {u['type']} {u.get('name', '')}")
            idx = get_choice("  Select: ", len(warband))
            if idx != -1:
                removed = warband.pop(idx - 1)
                print(f"  Removed {removed['type']}.")
                input("  Press Enter to continue...")

        elif action == 4:
            # Generate PDF
            if not warband:
                print("  No warriors in warband! Add some first.")
                input("  Press Enter to continue...")
                continue

            filename = generate_warband_pdf(
                warband_name,
                faction["name"],
                warband,
                filename="warband_cards.pdf"
            )
            print(f"  Cards generated! Open {filename} to print.")
            input("  Press Enter to continue...")

        elif action == 5 or action == -1:
            print("\n  May the Lord protect you in the trenches. ✠")
            break


# ═══════════════════════════════════════════════════════════════════════
# This is the standard Python way to run the main function
# when the script is executed directly (not imported).
# ═══════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    main()
