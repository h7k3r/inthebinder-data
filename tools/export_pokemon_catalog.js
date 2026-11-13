#!/usr/bin/env node
/**
 * export_pokemon_catalog.js - the app's own English Pokémon card list, as a
 * small file this repo's jobs can read without pokemontcg.io.
 *
 *   node tools/export_pokemon_catalog.js <path to binder-tcg/assets/pokecard.db>
 *
 * Writes pokemon-catalog.json (committed on main):
 *   { built, source, sets: [ [id, name, code, printedTotal, releaseDate] ],
 *     cards: [ [id, setId, number, name, picture?] ] }
 * picture (13 Nov 2026) is the card's picture address, only for the few cards
 * whose address does not read as its own id and number (cel25c-15_A2 is
 * .../cel25c/15_B.png): the app finds a card's TCGdex picture from that
 * address, so tools/build_pokemon_images.js must key it the same way.
 * Run it again whenever the app's card database is rebuilt.
 */
const fs = require('fs');
const path = require('path');
const sqlite = require('node:sqlite');

/** What the app reads from a picture address (binder-tcg cardImageRules.parseCardImage). */
function pictureKey(url) {
  let m = String(url || '').match(/^https:\/\/images\.pokemontcg\.io\/([a-z0-9]+)\/([^/]+?)(_hires)?\.png$/i);
  if (m) return { id: `${m[1]}-${m[2]}`, number: m[2] };
  m = String(url || '').match(/^https:\/\/images\.scrydex\.com\/pokemon\/(([a-z0-9]+)-([^/]+))\/(small|large)$/i);
  if (m) return { id: m[1], number: m[3] };
  return null;
}

if (require.main === module) {
  const dbPath = process.argv[2];
  if (!dbPath || !fs.existsSync(dbPath)) {
    console.error('usage: node tools/export_pokemon_catalog.js <pokecard.db>');
    process.exit(1);
  }
  const db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
  const meta = Object.fromEntries(db.prepare('SELECT key, value FROM meta').all().map((r) => [r.key, r.value]));
  const sets = db.prepare('SELECT id, name, ptcgo_code, printed_total, release_date FROM sets ORDER BY release_date, id').all()
    .map((s) => [s.id, s.name, s.ptcgo_code || null, s.printed_total || null, s.release_date || null]);
  let odd = 0;
  const cards = db.prepare('SELECT id, set_id, number, name, image_small FROM cards ORDER BY set_id, number_int, number').all()
    .map((c) => {
      const row = [c.id, c.set_id, String(c.number), c.name];
      const k = pictureKey(c.image_small);
      if (k && (k.id !== c.id || k.number !== String(c.number))) { row.push(c.image_small); odd++; }
      return row;
    });
  db.close();

  const out = path.join(__dirname, '..', 'pokemon-catalog.json');
  fs.writeFileSync(out, JSON.stringify({ built: meta.built_at || null, source: 'In the Binder card database', sets, cards }));
  console.log(`pokemon-catalog.json: ${sets.length} sets, ${cards.length} cards (${odd} with their picture address; database built ${meta.built_at})`);
}

module.exports = { pictureKey };
