#!/usr/bin/env node
/**
 * build_pokemon_images.js - where each English card's picture lives on
 * TCGdex, for phones to download (13 Nov 2026).
 *
 *   node tools/build_pokemon_images.js --out out
 *
 * Reads <out>/pokemon/_map.json (tools/build_pokemon_map.js) and
 * pokemon-catalog.json; writes <out>/pokemon/images.json:
 *   { built, map, cards, sets: { setId: [folder, rule] }, except: { key: path | 0 } }
 * The same table binder-tcg's tools/build_card_images.js bakes into the app
 * (cardImageTable.js), built here every day instead, so a new set gets its
 * TCGdex pictures as soon as TCGdex has them, with no app update. Phones use
 * it in place of the copy they shipped with (cardImageFeed.js there).
 *
 * rule: how a TCGdex picture name is made from our card number (same, pad2,
 * pad3, strip). except: cards that do not follow their set's rule, keyed the
 * way the app reads a picture address ('ex10/question.png' -> 'ex10-question'),
 * 0 when TCGdex has no picture for the card.
 */
const fs = require('fs');
const path = require('path');
const { pictureKey } = require('./export_pokemon_catalog');

const TDX = 'https://assets.tcgdex.net/en/';

// Same as binder-tcg cardImageRules.js RULES (the app applies them).
const RULES = {
  same: (n) => n,
  pad2: (n) => n.replace(/^([A-Za-z]*)(\d+)$/, (m, p, d) => p + d.padStart(2, '0')),
  pad3: (n) => n.replace(/^([A-Za-z]*)(\d+)$/, (m, p, d) => p + d.padStart(3, '0')),
  strip: (n) => n.replace(/^([A-Za-z]*)0+(\d)/, '$1$2'),
};

/**
 * map: { built, cards: { cardId: { img } } }; catalogue: { cards: [[id, set, number, name, picture?]] }
 * -> { sets, except, stats }
 */
function buildTable(map, catalogue) {
  const bySet = new Map();
  for (const [id, set, number, , picture] of catalogue.cards) {
    if (!bySet.has(set)) bySet.set(set, []);
    bySet.get(set).push({ id, set, number: String(number), picture });
  }
  const imgOf = (c) => {
    const e = map.cards && map.cards[c.id];
    return e && typeof e.img === 'string' && e.img.startsWith(TDX) ? e.img : null;
  };
  const sets = {};
  const except = {};
  const stats = { sets: 0, ruled: 0, excepted: 0, none: 0 };
  for (const [setId, list] of [...bySet].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const withImg = list.filter(imgOf);
    if (!withImg.length) { stats.none += list.length; continue; }
    // The set's folder: the one most of its pictures are in.
    const dirs = new Map();
    for (const c of withImg) { const d = imgOf(c).slice(TDX.length).replace(/\/[^/]+$/, ''); dirs.set(d, (dirs.get(d) || 0) + 1); }
    const dir = [...dirs].sort((a, b) => b[1] - a[1])[0][0];
    let best = null;
    let bestHits = -1;
    for (const [name, fn] of Object.entries(RULES)) {
      const hits = withImg.filter((c) => imgOf(c) === `${TDX}${dir}/${fn(c.number)}`).length;
      if (hits > bestHits) { best = name; bestHits = hits; }
    }
    sets[setId] = [dir, best];
    stats.sets++;
    for (const c of list) {
      const img = imgOf(c);
      const seen = (c.picture && pictureKey(c.picture)) || { id: c.id, number: c.number };
      const derived = `${TDX}${dir}/${RULES[best](seen.number)}`;
      if (img) {
        if (img === derived) stats.ruled++;
        else { except[seen.id] = img.slice(TDX.length); stats.excepted++; }
      } else {
        except[seen.id] = 0;
        stats.none++;
      }
    }
  }
  return { sets, except, stats };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const OUT = arg('--out', 'out');
  const map = JSON.parse(fs.readFileSync(path.join(OUT, 'pokemon', '_map.json'), 'utf8'));
  const catalogue = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'pokemon-catalog.json'), 'utf8'));
  const { sets, except, stats } = buildTable(map, catalogue);
  // A table that lost most of its sets is a broken map, not news: keep yesterday's.
  if (stats.sets < 100) {
    console.error(`Pokémon pictures: only ${stats.sets} sets found, keeping the previous images.json`);
    process.exit(1);
  }
  const out = { built: new Date().toISOString(), map: map.built || null, cards: catalogue.cards.length, sets, except };
  fs.writeFileSync(path.join(OUT, 'pokemon', 'images.json'), JSON.stringify(out));
  console.log(`Pokémon pictures: ${stats.sets} sets, ${stats.ruled} cards by rule, ${stats.excepted} exceptions, ` +
    `${stats.none} without a TCGdex picture; ${(JSON.stringify(out).length / 1024).toFixed(1)} KB`);
}

module.exports = { buildTable, RULES };
