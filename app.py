"""
app.py — Trench Crusade Warband Forge (Flask Server)
=====================================================
This connects the web UI to the JSON data files and PDF generator.

Run:
    pip3 install flask reportlab
    python3 app.py

Then open http://localhost:5000 in your browser.

WHAT THIS TEACHES:
  - Flask basics: routes, templates, JSON APIs
  - Serving static files and HTML templates
  - Receiving data from the browser via POST requests
  - Generating files (PDFs) on the server and sending them back
"""

from flask import Flask, render_template, jsonify, request, send_file
import json
import os
import tempfile

# Import our existing modules
from card_pdf import generate_warband_pdf

VERSION = "3.12"

# ═══════════════════════════════════════════════════════════════
# Create the Flask application
# ═══════════════════════════════════════════════════════════════

app = Flask(__name__)
app.json.sort_keys = False

# Find the directory where this script lives
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FACTIONS_DIR = os.path.join(BASE_DIR, "factions")
VARIANTS_DIR = os.path.join(BASE_DIR, "variants")
GEAR_FILE    = os.path.join(BASE_DIR, "gear.json")


# ═══════════════════════════════════════════════════════════════
# DATA LOADING
# ═══════════════════════════════════════════════════════════════

def load_gear():
    """Load gear.json — the single source of truth for item profiles."""
    try:
        with open(GEAR_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"  WARNING: Could not load gear.json: {e}")
        return {}


def run_startup_validation():
    """Run validate.py at startup and print any warnings/errors."""
    import subprocess, sys
    validate_script = os.path.join(BASE_DIR, "validate.py")
    if not os.path.exists(validate_script):
        return
    result = subprocess.run(
        [sys.executable, validate_script],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print("  ⚠  DATA VALIDATION ERRORS FOUND:")
        for line in result.stdout.splitlines():
            if line.strip():
                print(f"     {line}")
    else:
        # Only print warnings if present, otherwise silent
        lines = [l for l in result.stdout.splitlines() if "warning" in l.lower() or "⚠" in l]
        if lines:
            print("  ⚠  Data warnings:")
            for line in lines:
                print(f"     {line}")

def load_all_data():
    """Load all faction, variant, and mercenary data from JSON files."""

    factions = {}
    mercenaries = None

    # Load factions
    for filename in sorted(os.listdir(FACTIONS_DIR)):
        if not filename.endswith(".json"):
            continue

        filepath = os.path.join(FACTIONS_DIR, filename)
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)

        key = filename[:-5]  # remove .json

        if key == "mercenaries":
            mercenaries = data
        else:
            factions[key] = data

    # Load variants, grouped by parent faction
    variants = {}
    if os.path.isdir(VARIANTS_DIR):
        for filename in sorted(os.listdir(VARIANTS_DIR)):
            if not filename.endswith(".json"):
                continue

            filepath = os.path.join(VARIANTS_DIR, filename)
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)

            # Inject key from filename (stripped of .json) if not present
            if "key" not in data:
                data["key"] = filename[:-5]
            if "desc" not in data:
                data["desc"] = data.get("description", "")

            parent = data.get("parent_faction", "unknown")
            if parent not in variants:
                variants[parent] = []
            variants[parent].append(data)

    # Also inject a synthetic "standard" variant for each faction so the front-end
    # can treat "no variant" as just another option
    for fkey in factions:
        if fkey not in variants:
            variants[fkey] = []
        # Only prepend standard if not already there
        if not any(v.get("key") == "standard" for v in variants[fkey]):
            variants[fkey].insert(0, {
                "key": "standard",
                "name": "Standard",
                "desc": "Base faction with no variant.",
                "parent_faction": fkey
            })

    return factions, variants, mercenaries


# Load data once at startup
FACTIONS, VARIANTS, MERCENARIES = load_all_data()
GEAR = load_gear()


# ═══════════════════════════════════════════════════════════════
# ROUTES
# ═══════════════════════════════════════════════════════════════

@app.route("/")
def index():
    """Serve the main warband builder page."""
    return render_template("index.html", version=VERSION)


@app.route("/manifest.json")
def manifest():
    return send_file(
        os.path.join(BASE_DIR, "static", "manifest.json"),
        mimetype="application/manifest+json"
    )


@app.route("/service_worker.js")
def service_worker():
    response = send_file(
        os.path.join(BASE_DIR, "static", "service_worker.js"),
        mimetype="application/javascript"
    )
    response.headers["Cache-Control"] = "no-cache"
    return response


@app.route("/static/<path:filename>")
def static_files(filename):
    return send_file(os.path.join(BASE_DIR, "static", filename))


@app.route("/api/data")
def get_all_data():
    """
    Return ALL game data in one API call.
    The browser fetches this once on page load.

    Returns JSON with:
      - factions: all 6 faction objects
      - variants: grouped by parent faction key
      - mercenaries: the mercenaries list
    """
    return jsonify({
        "factions": FACTIONS,
        "variants": VARIANTS,
        "mercenaries": MERCENARIES.get("mercenaries", []) if MERCENARIES else [],
        "gear": GEAR,
    })


@app.route("/api/pdf", methods=["POST"])
def generate_pdf():
    """
    Receive warband data from the browser and generate a PDF.

    Expects JSON body with:
      - warband_name: string
      - faction_name: string
      - units: list of unit dicts
    """
    data = request.get_json()

    warband_name = data.get("warband_name", "Unnamed Warband")
    faction_name = data.get("faction_name", "Unknown Faction")
    units = data.get("units", [])

    if not units:
        return jsonify({"error": "No units in warband"}), 400

    # Create a temporary file for the PDF
    tmp = tempfile.NamedTemporaryFile(
        suffix=".pdf", delete=False, prefix="warband_"
    )
    tmp_path = tmp.name
    tmp.close()

    try:
        generate_warband_pdf(warband_name, faction_name, units, tmp_path)

        return send_file(
            tmp_path,
            mimetype="application/pdf",
            as_attachment=True,
            download_name=f"{warband_name.replace(' ', '_')}_roster.pdf",
        )
    finally:
        # Clean up temp file after sending
        # (send_file reads it first, then we delete)
        pass


# ═══════════════════════════════════════════════════════════════
# RUN THE SERVER
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print()
    print("  ╔═══════════════════════════════════════════════╗")
    print(f"  ║   Warband Forge Server v{VERSION}                 ║")
    print("  ╠═══════════════════════════════════════════════╣")
    print(f"  ║   Loaded {len(FACTIONS)} factions, "
          f"{sum(len(v) for v in VARIANTS.values())} variants, "
          f"{len(MERCENARIES.get('mercenaries', [])) if MERCENARIES else 0} mercenaries")
    print("  ║                                               ║")
    print("  ║   Open in browser: http://localhost:5000       ║")
    print("  ╚═══════════════════════════════════════════════╝")
    print()

    app.run(debug=True, port=5000)
