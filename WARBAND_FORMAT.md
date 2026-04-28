# Warband Save Format — `warband-forge-v1`

This document describes the JSON format used by Warband Forge to save and load warbands.

## Overview

```json
{
  "_format": "warband-forge-v1",
  "_created": "2025-04-12T14:30:00Z",
  "_modified": "2025-04-12T16:45:00Z",

  "warband": { ... },
  "campaign": { ... },
  "units": [ ... ]
}
```

## Top-Level Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `_format` | string | ✓ | Must start with `"warband-forge"`. Current version: `"warband-forge-v1"` |
| `_created` | string | | ISO 8601 timestamp of first save |
| `_modified` | string | | ISO 8601 timestamp of last save |
| `warband` | object | ✓ | Warband metadata |
| `campaign` | object | | Campaign tracking (optional) |
| `units` | array | ✓ | Array of unit objects |

## `warband` Object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✓ | Warband name |
| `faction` | string | ✓ | Faction key: `new_antioch`, `trench_pilgrims`, `iron_sultanate`, `heretic_legion`, `black_grail`, `court_serpent` |
| `variant` | string | | Variant key or `"standard"` for base faction |
| `sin` | string \| null | | Deadly Sin name (Court of the Serpent only): `"Pride"`, `"Envy"`, `"Wrath"`, `"Sloth"`, `"Greed"`, `"Gluttony"`, `"Lust"` |
| `budget_ducats` | integer | | Ducat budget (default: 700) |
| `budget_glory` | integer | | Glory budget (default: 0) |
| `notes` | string | | Freeform warband notes |

## `campaign` Object (Optional)

| Field | Type | Description |
|-------|------|-------------|
| `games_played` | integer | Total games played |
| `wins` | integer | Games won |
| `losses` | integer | Games lost |
| `glory_earned` | integer | Total glory earned |
| `glory_spent` | integer | Total glory spent |
| `ducats_earned` | integer | Total ducats earned |
| `ducats_spent` | integer | Total ducats spent |

## `units` Array

Each element is a unit object:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | ✓ | Stable identifier, e.g. `"unit_001"` |
| `type` | string | ✓ | Unit type name, must match a unit in the faction data (e.g. `"Heretic Trooper"`, `"Praetor"`) |
| `name` | string | | Custom name given by the player |
| `is_elite` | boolean | ✓ | Whether the unit is an ELITE |
| `is_merc` | boolean | ✓ | Whether the unit is a Mercenary |
| `base_cost` | integer | ✓ | Base ducat cost before equipment |
| `glory_cost` | integer | | Glory cost (mercenaries only) |
| `equipment` | array | ✓ | Array of equipment objects |
| `goetic_powers` | array | | Array of Goetic Power objects (Court of the Serpent only) |
| `sin_aura` | string | | Desecrated Saint aura text |
| `total_cost` | integer | ✓ | Total cost including all equipment |
| `campaign_data` | object \| null | | Campaign tracking for this unit |

### `equipment` Object

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Equipment name, must match an armoury item |
| `cost` | integer | Ducat cost of this item |

### `goetic_powers` Object

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Power name |
| `cost` | integer | Ducat cost (0 if free/built-in) |

### `campaign_data` Object (Optional)

| Field | Type | Description |
|-------|------|-------------|
| `experience` | integer | XP earned |
| `promotions` | integer | Number of promotions |
| `kills` | integer | Kill count |
| `injuries` | array | Array of injury description strings |
| `scars` | integer | Scar count |
| `skills_gained` | array | Array of skill name strings |
| `stat_changes` | object | Stat modifications, e.g. `{"melee": "+1"}` |
| `notes` | string | Freeform notes for this unit |

## Example

```json
{
  "_format": "warband-forge-v1",
  "_created": "2025-04-12T14:30:00Z",
  "_modified": "2025-04-12T14:30:00Z",
  "warband": {
    "name": "The Iron Fist",
    "faction": "new_antioch",
    "variant": "standard",
    "sin": null,
    "budget_ducats": 700,
    "budget_glory": 0,
    "notes": ""
  },
  "campaign": null,
  "units": [
    {
      "id": "unit_001",
      "type": "Lieutenant",
      "name": "Captain Voss",
      "is_elite": true,
      "is_merc": false,
      "base_cost": 100,
      "glory_cost": 0,
      "equipment": [
        {"name": "Automatic Rifle", "cost": 40},
        {"name": "Standard Armour", "cost": 15}
      ],
      "goetic_powers": [],
      "sin_aura": "",
      "total_cost": 155,
      "campaign_data": null
    },
    {
      "id": "unit_002",
      "type": "Yeoman",
      "name": "",
      "is_elite": false,
      "is_merc": false,
      "base_cost": 25,
      "glory_cost": 0,
      "equipment": [
        {"name": "Bolt-Action Rifle", "cost": 10},
        {"name": "Bayonet", "cost": 2}
      ],
      "goetic_powers": [],
      "sin_aura": "",
      "total_cost": 37,
      "campaign_data": null
    }
  ]
}
```

## Validation Rules

- `_format` must start with `"warband-forge"`
- `warband.faction` must be a valid faction key
- `units` array max length: 50
- `equipment` array max length per unit: 20
- `goetic_powers` array max length per unit: 5
- All string fields max length: 500 characters
- No HTML tags in string fields
- Cost fields clamped to 0–99999 (ducats) or 0–999 (glory)
