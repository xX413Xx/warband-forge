"""
data.py — Load faction data from JSON files
=============================================
Instead of hard-coding all the game data in Python, we store it in
separate .json files (one per faction) in the 'factions/' folder.

This teaches you:
  - The json module (built into Python, no pip install needed)
  - File I/O (opening and reading files)
  - os.path for finding files relative to the script
  - Error handling with try/except
  - The difference between JSON and Python dicts:
      JSON                    Python
      ─────────────────       ──────────────────
      true / false            True / False
      null                    None
      keys must be "strings"  keys can be anything
      no trailing commas      trailing commas OK
      no comments             # comments OK
      double quotes only      single or double quotes
"""

import json
import os


def load_factions():
    """
    Scan the 'factions/' folder and load every .json file.

    Returns a dictionary like:
        {
            "new_antioch": { ... faction data ... },
            "heretic_legion": { ... faction data ... },
        }

    The key for each faction is the filename without .json.
    So 'factions/new_antioch.json' becomes key 'new_antioch'.
    """

    # Find the folder where THIS script lives
    # __file__ is a special Python variable = path to current file
    script_dir = os.path.dirname(os.path.abspath(__file__))
    factions_dir = os.path.join(script_dir, "factions")

    # Check the folder exists
    if not os.path.isdir(factions_dir):
        print(f"  ERROR: 'factions/' folder not found at {factions_dir}")
        print(f"  Make sure the 'factions/' folder is next to this script.")
        return {}

    factions = {}

    # Loop through every file in the factions/ folder
    for filename in sorted(os.listdir(factions_dir)):

        # Only process .json files (skip anything else)
        if not filename.endswith(".json"):
            continue

        # Build the full path to the file
        filepath = os.path.join(factions_dir, filename)

        # The faction key is the filename without the .json extension
        # e.g. "new_antioch.json" -> "new_antioch"
        faction_key = filename[:-5]  # chop off last 5 chars (.json)

        try:
            # Open the file and parse the JSON into a Python dict
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)

            factions[faction_key] = data

        except json.JSONDecodeError as e:
            # This happens if the JSON file has a syntax error
            print(f"  WARNING: Could not parse {filename}: {e}")

        except Exception as e:
            print(f"  WARNING: Error loading {filename}: {e}")

    return factions


# ═══════════════════════════════════════════════════════════════════
# Load all factions when this module is imported.
# Other files can do:  from data import FACTIONS
# ═══════════════════════════════════════════════════════════════════

FACTIONS = load_factions()


# If you run this file directly, it prints what was loaded
if __name__ == "__main__":
    print(f"\nLoaded {len(FACTIONS)} factions:\n")
    for key, faction in FACTIONS.items():
        elites = len(faction.get("elites", []))
        troops = len(faction.get("troops", []))
        print(f"  {faction['name']:45s}  ({faction['side']:8s})"
              f"  {elites} elites, {troops} troops")
