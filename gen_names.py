#!/usr/bin/env python3
import json, random, csv, sys

with open('static/names.json') as f:
    data = json.load(f)

rows = []
for key in sorted(k for k in data if k != '$schemaVersion'):
    faction = data[key]
    display = faction['displayName']
    formula = faction.get('formula', {})
    
    for tier in ['grunt', 'elite', 'leader']:
        parts_keys = formula.get(tier, [])
        if not parts_keys:
            continue
        
        pools = [faction.get(pk, []) for pk in parts_keys]
        if any(len(p) == 0 for p in pools):
            continue
        
        limit = faction.get('lengthLimit', 30)
        
        for _ in range(100):
            parts = [random.choice(p) for p in pools]
            name = ' '.join(parts)
            if len(name) > limit:
                name = ' '.join(parts[:-1])
            rows.append([display, tier, name])

outfile = 'names_sample.csv'
with open(outfile, 'w', newline='', encoding='utf-8') as f:
    w = csv.writer(f)
    w.writerow(['Faction', 'Tier', 'Name'])
    w.writerows(rows)

print(f'Generated {len(rows)} names across {len(set(r[0] for r in rows))} factions → {outfile}')
