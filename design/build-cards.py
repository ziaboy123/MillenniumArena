# Rebuilds the mockups' local card data from YGOPRODeck (run again after a new set or banlist):
#   python3 build-cards.py
# cards-index.json: one row per card for instant search
#   [id, name, frame, type, race, attribute, level/link, atk, def, tcgLimit, views]  (atk/def -1 = none, limit 3 = unlimited; views ranks search results)
# cards-text.json: {id: card text}, loaded in the background for the detail panel
# cards-alts.json: {alternate artwork id: main id}, so .ydk files from other sims resolve
import json, subprocess, pathlib

here = pathlib.Path(__file__).parent
raw = subprocess.run(['curl', '-s', 'https://db.ygoprodeck.com/api/v7/cardinfo.php?misc=yes'], capture_output=True, text=True, check=True).stdout
cards = [c for c in json.loads(raw)['data'] if c['frameType'] not in ('skill', 'token')]

BAN = {'Forbidden': 0, 'Limited': 1, 'Semi-Limited': 2}
index, text, alts = [], {}, {}
for c in cards:
    stat = lambda k: c[k] if c.get(k) is not None else -1
    index.append([c['id'], c['name'], c['frameType'], c['type'], c['race'], c.get('attribute', ''),
                  c.get('level') or c.get('linkval') or 0, stat('atk'), stat('def'),
                  BAN.get(c.get('banlist_info', {}).get('ban_tcg'), 3), (c.get('misc_info') or [{}])[0].get('views', 0)])
    text[c['id']] = c['desc']
    for img in c.get('card_images', []):
        if img['id'] != c['id']: alts[img['id']] = c['id']

(here / 'cards-index.json').write_text(json.dumps(index, separators=(',', ':'), ensure_ascii=False))
(here / 'cards-text.json').write_text(json.dumps(text, separators=(',', ':'), ensure_ascii=False))
(here / 'cards-alts.json').write_text(json.dumps(alts, separators=(',', ':')))
print(f'{len(index)} cards written')
