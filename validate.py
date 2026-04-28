"""
validate.py — Warband Forge data integrity checker
===================================================
Run this after any data change to catch errors before they reach users:

    python3 validate.py

Exit code 0 = all good. Exit code 1 = errors found.
"""

import json
import os
import sys

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FACTIONS_DIR = os.path.join(BASE_DIR, "factions")
VARIANTS_DIR = os.path.join(BASE_DIR, "variants")
GEAR_FILE    = os.path.join(BASE_DIR, "gear.json")

ERRORS   = []
WARNINGS = []

def err(msg):   ERRORS.append(msg)
def warn(msg):  WARNINGS.append(msg)

# ── Helpers ──────────────────────────────────────────────────────────────────

def load_json(path, label):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        err(f"{label}: JSON parse error — {e}")
        return None
    except FileNotFoundError:
        err(f"{label}: file not found")
        return None

def collect_armoury_names(armoury: dict) -> set:
    names = set()
    for items in armoury.values():
        for item in items:
            if isinstance(item, list) and len(item) >= 1:
                names.add(item[0])
    return names

def collect_unit_base_equip(units: list) -> list:
    """Return list of (unit_type, item_name) for all base_equipment entries."""
    result = []
    for u in units:
        for item in u.get("base_equipment", []):
            # base_equipment entries are plain strings, sometimes with extra notes in parens
            name = item.split("(")[0].split("+")[0].strip().rstrip(" -")
            result.append((u["type"], name))
    return result

# ── Required fields ───────────────────────────────────────────────────────────

GEAR_REQUIRED = {"cat", "hands", "range", "dice_mod", "inj_dice", "inj_mod", "heavy", "keywords"}
VALID_CATS    = {"ranged", "melee", "grenade", "shield", "armour", "equipment"}
VALID_HANDS   = {"1H", "2H", "special", None}

FACTION_REQUIRED = {"name", "side", "starting_ducats", "elites", "troops", "armoury"}
UNIT_REQUIRED    = {"type", "limit", "base_cost", "movement", "ranged", "melee", "armour", "base_size", "keywords", "abilities"}
VARIANT_REQUIRED = {"name", "parent_faction"}

# ── Load gear ────────────────────────────────────────────────────────────────

print("Loading gear.json...")
gear = load_json(GEAR_FILE, "gear.json")
if gear is None:
    print("\n✗ Cannot continue — gear.json failed to load.")
    sys.exit(1)

# Validate each gear entry
for name, g in gear.items():
    missing = GEAR_REQUIRED - set(g.keys())
    if missing:
        err(f"gear.json '{name}': missing fields {missing}")
    if g.get("cat") not in VALID_CATS:
        err(f"gear.json '{name}': invalid cat '{g.get('cat')}' (must be one of {VALID_CATS})")
    if g.get("hands") not in VALID_HANDS:
        err(f"gear.json '{name}': invalid hands '{g.get('hands')}'")
    for field in ("dice_mod", "inj_dice", "inj_mod"):
        if not isinstance(g.get(field), (int, float)):
            err(f"gear.json '{name}': '{field}' must be a number, got {type(g.get(field)).__name__}")

gear_names = set(gear.keys())
print(f"  {len(gear_names)} gear entries loaded.")

# ── Load and validate factions ───────────────────────────────────────────────

print("\nLoading factions...")
factions = {}
for filename in sorted(os.listdir(FACTIONS_DIR)):
    if not filename.endswith(".json"):
        continue
    path = os.path.join(FACTIONS_DIR, filename)
    label = f"factions/{filename}"
    data = load_json(path, label)
    if data is None:
        continue
    key = filename[:-5]
    factions[key] = data

    # mercenaries.json has a different structure — skip faction-level checks
    if key == "mercenaries":
        continue

    # Required fields
    for field in FACTION_REQUIRED:
        if field not in data:
            err(f"{label}: missing top-level field '{field}'")

    # Units
    for section in ("elites", "troops"):
        for u in data.get(section, []):
            for field in UNIT_REQUIRED:
                if field not in u:
                    err(f"{label} › {u.get('type','?')}: missing field '{field}'")
            if not isinstance(u.get("base_cost"), (int, float)):
                err(f"{label} › {u.get('type','?')}: base_cost must be a number")

    # Base equipment references
    # Some entries are freeform notes rather than gear names — skip known ones
    FREEFORM_NOTES = {
        "Reinforced or Machine Armour (included)",
        "Reinforced or Machine Armour",
        "Chainsaw Mouth (+1 DICE, +1 INJ, IGNORE ARMOUR, RISKY)",
        "Shredding Claws (+1 INJ, CUMBERSOME, RISKY)",
    }
    all_units = data.get("elites", []) + data.get("troops", [])
    for unit_type, item_name in collect_unit_base_equip(all_units):
        if item_name in FREEFORM_NOTES:
            continue
        if len(item_name) > 3 and item_name not in gear_names:
            warn(f"{label} › {unit_type}: base_equipment '{item_name}' not in gear.json")

    # Armoury references
    armoury = data.get("armoury", {})
    for item_name in collect_armoury_names(armoury):
        if item_name not in gear_names:
            err(f"{label} armoury: '{item_name}' not in gear.json")

print(f"  {len(factions)} factions loaded.")

# ── Load and validate variants ───────────────────────────────────────────────

print("\nLoading variants...")
variants = {}
for filename in sorted(os.listdir(VARIANTS_DIR)):
    if not filename.endswith(".json"):
        continue
    path = os.path.join(VARIANTS_DIR, filename)
    label = f"variants/{filename}"
    data = load_json(path, label)
    if data is None:
        continue
    key = filename[:-5]
    variants[key] = data

    # Required fields
    for field in VARIANT_REQUIRED:
        if field not in data:
            err(f"{label}: missing field '{field}'")

    # Parent faction must exist
    parent = data.get("parent_faction")
    if parent and parent not in factions:
        err(f"{label}: parent_faction '{parent}' not found in factions/")

    # Restricted units must exist in parent faction
    parent_data = factions.get(parent, {})
    parent_unit_types = {u["type"] for u in parent_data.get("elites", []) + parent_data.get("troops", [])}
    for restricted in data.get("restrict_units", []):
        if restricted not in parent_unit_types:
            warn(f"{label}: restrict_units '{restricted}' not found in parent faction units")

    # add_armoury references
    for item_name in collect_armoury_names(data.get("add_armoury", {})):
        if item_name not in gear_names:
            err(f"{label} add_armoury: '{item_name}' not in gear.json")

    # remove_armoury items should exist in parent armoury or be knowable
    parent_armoury_names = collect_armoury_names(parent_data.get("armoury", {}))
    for item_name in data.get("remove_armoury", []):
        if item_name not in parent_armoury_names and item_name not in gear_names:
            warn(f"{label} remove_armoury: '{item_name}' not in parent armoury or gear.json")

    # add_units validation
    for u in data.get("add_units", []):
        for field in UNIT_REQUIRED:
            if field not in u:
                err(f"{label} › add_units › {u.get('type','?')}: missing field '{field}'")
        for unit_type, item_name in collect_unit_base_equip([u]):
            if len(item_name) > 3 and item_name not in gear_names:
                warn(f"{label} › add_units › {unit_type}: base_equipment '{item_name}' not in gear.json")

print(f"  {len(variants)} variants loaded.")

# ── Cross-check: limit_overrides reference real unit types ───────────────────

print("\nCross-checking limit_overrides...")
for key, v in variants.items():
    parent = factions.get(v.get("parent_faction", ""), {})
    parent_types = {u["type"] for u in parent.get("elites", []) + parent.get("troops", [])}
    for unit_type in v.get("limit_overrides", {}):
        if unit_type not in parent_types:
            warn(f"variants/{key}: limit_overrides '{unit_type}' not in parent faction")

# ── Report ────────────────────────────────────────────────────────────────────

print()
if WARNINGS:
    print(f"⚠  {len(WARNINGS)} warning(s):")
    for w in WARNINGS:
        print(f"   {w}")
    print()

if ERRORS:
    print(f"✗  {len(ERRORS)} error(s):")
    for e in ERRORS:
        print(f"   {e}")
    print()
    print("Fix these errors before deploying.")
    sys.exit(1)
else:
    if WARNINGS:
        print("✓  No errors. Warnings above are non-blocking.")
    else:
        print("✓  All checks passed — data is clean.")
    sys.exit(0)
