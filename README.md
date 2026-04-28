# Warband Forge

An interactive warband builder for [Trench Crusade](https://www.trenchcrusade.com/), the tabletop miniature wargame by Factory Fortress.

Build your warband, equip your warriors, and generate printable roster cards — all in the browser.

## Features

- **All 6 factions** — New Antioch, Trench Pilgrims, Iron Sultanate, Heretic Legion, Cult of the Black Grail, Court of the Seven-Headed Serpent
- **15 warband variants** — Éire Rangers, Trench Ghosts, Naval Raiders, Fida'i of Alamut, and more
- **10 mercenaries** — filtered by faction availability
- **Court of the Serpent** — full Sin selection system with 23 Goetic Powers and Desecrated Saint auras
- **Equipment restrictions enforced** — unit-specific items, Limits, ELITE-only, and variant overrides
- **Unit limits** — tracks how many of each type you've recruited vs. allowed
- **Live ducat/glory tracking** — editable budget with overspend warnings
- **Printable unit cards** — A6 landscape for elites, A7 portrait for troops. Stats, keywords, abilities, equipment, Goetic Powers, and campaign tracking
- **A4 warband roster** — two-page printable overview with quick-reference table, unit details, and campaign battle log
- **Save/load warbands** — export as .json file, import later to continue editing. Your data, your files.
- **PDF export** — server-generated printable roster sheets

## Getting Started

### Requirements

- Python 3.9+
- pip

### Install & Run

```bash
git clone https://github.com/xX413Xx/warband-forge.git
cd warband-forge
pip install -r requirements.txt
python3 app.py
```

Open **http://localhost:5000** in your browser.

## Project Structure

```
warband-forge/
├── app.py                  ← Flask server (run this)
├── card_pdf.py             ← PDF card generator
├── data.py                 ← JSON data loader
├── main.py                 ← CLI warband builder
├── requirements.txt
├── templates/
│   └── index.html          ← Web UI (all building happens here, client-side)
├── factions/               ← Game data (6 factions + mercenaries)
│   ├── new_antioch.json
│   ├── trench_pilgrims.json
│   ├── iron_sultanate.json
│   ├── heretic_legion.json
│   ├── black_grail.json
│   ├── court_serpent.json
│   └── mercenaries.json
└── variants/               ← 15 warband variant modifiers
    ├── naval_raiders.json
    ├── trench_ghosts.json
    └── ... (13 more)
```

## Data Sources

All game data is from the official **Warbands of Trench Crusade v1.0.2** rulebook and the **Trench Crusade Digital Rulebook** by Factory Fortress.

## Disclaimer

This is an **unofficial fan project**. Trench Crusade, all game rules, unit profiles, stats, abilities, keywords, artwork, and lore are © Factory Fortress Inc. This tool is not affiliated with or endorsed by Factory Fortress.

This project exists to help players build warbands and is intended for personal, non-commercial use during play.

## License

This project's code and tool design are licensed under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/). See [LICENSE](LICENSE) for details.

## Contributing

Found a bug or missing data? Open an issue or submit a pull request.
