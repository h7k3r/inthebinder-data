#!/usr/bin/env node
/**
 * export_pokemon_catalog.js - the app's own English Pokémon card list, as a
 * small file this repo's jobs can read without pokemontcg.io.
 *
 *   node tools/export_pokemon_catalog.js <path to binder-tcg/assets/pokecard.db>
 *
 * Writes pokemon-catalog.json (committed on main):
 *   { built, source, sets: [ [id, name, code, printedTotal, releaseDate] ],
 *     cards: [ [id, setId, number, name] ] }
 * Run it again whenever the app's card database is rebuilt.
 */
const fs = require('fs');
const path = require('path');
const sqlite = require('node:sqlite');

const dbPath = process.argv[2];
if (!dbPath || !fs.existsSync(dbPath)) {
  console.error('usage: node tools/export_pokemon_catalog.js <pokecard.db>');
  process.exit(1);
}
const db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
const meta = Object.fromEntries(db.prepare('SELECT key, value FROM meta').all().map((r) => [r.key, r.value]));
const sets = db.prepare('SELECT id, name, ptcgo_code, printed_total, release_date FROM sets ORDER BY release_date, id').all()
  .map((s) => [s.id, s.name, s.ptcgo_code || null, s.printed_total || null, s.release_date || null]);
const cards = db.prepare('SELECT id, set_id, number, name FROM cards ORDER BY set_id, number_int, number').all()
  .map((c) => [c.id, c.set_id, String(c.number), c.name]);
db.close();

const out = path.join(__dirname, '..', 'pokemon-catalog.json');
fs.writeFileSync(out, JSON.stringify({ built: meta.built_at || null, source: 'In the Binder card database', sets, cards }));
console.log(`pokemon-catalog.json: ${sets.length} sets, ${cards.length} cards (database built ${meta.built_at})`);
