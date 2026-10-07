#!/usr/bin/env node
/**
 * tools/build_games.js - card catalogues for the games beyond Pokémon, from
 * tcgcsv.com (a daily public copy of TCGplayer's catalogue and prices).
 *
 *   node tools/build_games.js [game ...] [--out games] [--prices-only]
 *   games: op lorcana dbsfw mtg ygo   (default: all)
 *
 * Writes, per game:
 *   <out>/<game>.db          SQLite: meta, sets, cards, slots, sealed
 *   <out>/<game>-prices.json { day, currency: 'USD', prices: { "<productId>|<variant>": market } }
 *   <out>/games.json         what each catalogue holds (counts, sizes, sha256, built_at)
 *   <out>/<game>-web.json    the same catalogue as compact JSON for the web version
 *                            (inthebinder.com/app loads it only when a backup has that game)
 *   --web-from-db            only (re)write <game>-web.json from <out>/<game>.db already there
 *
 * IDS (stable: TCGplayer product ids never change):
 *   set  'op~24736'      card 'op~712666'      slot 'op~712666::normal'
 * The '~' keeps them apart from Pokémon ids ('sv3pt5-25::holo') and from the
 * Japanese/Korean/Chinese ones ('ja:SV1S-001::normal' - isI18nId looks for ':').
 *
 * A "card" is one TCGplayer product (one picture: a Parallel or Manga art is
 * its own card), and every printing finish TCGplayer prices for it (Normal,
 * Foil, Holofoil, Cold Foil, 1st Edition, Unlimited...) is a pocket (slot).
 * Products without a card number are sealed products (boxes, packs, decks).
 *
 * tcgcsv asks for: a custom User-Agent, 100 ms between requests, at most one
 * full pull a day and under 10,000 requests. A full run of all five games is
 * about 2,500 requests.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const GAMES = {
  op:      { category: 68, name: 'One Piece Card Game', search: 'one piece card game' },
  lorcana: { category: 71, name: 'Disney Lorcana', search: 'disney lorcana' },
  dbsfw:   { category: 80, name: 'Dragon Ball Super Fusion World', search: 'dragon ball super fusion world' },
  mtg:     { category: 1,  name: 'Magic: The Gathering', search: 'mtg' },
  ygo:     { category: 2,  name: 'Yu-Gi-Oh!', search: 'yugioh' },
};
const UA = { 'User-Agent': 'InTheBinder/1.0 (+https://inthebinder.com; support@inthebinder.com)' };
const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const outArg = args.indexOf('--out');
const OUT = path.resolve(ROOT, outArg >= 0 ? args[outArg + 1] : 'games');
const PRICES_ONLY = args.includes('--prices-only');
const WEB_FROM_DB = args.includes('--web-from-db');
// Where the .db files will be downloadable from (the GitHub release the
// workflow creates), written into games.json for the app.
const urlArg = args.indexOf('--db-url');
const DB_URL = urlArg >= 0 ? args[urlArg + 1].replace(/\/$/, '') : '';
const wanted = args.filter((a, i) => GAMES[a] && args[i - 1] !== '--out' && args[i - 1] !== '--db-url');
const games = wanted.length ? wanted : Object.keys(GAMES);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let requests = 0;
async function get(url, tries = 3) {
  for (let t = 1; ; t++) {
    try {
      requests++;
      const r = await fetch(url, { headers: UA });
      await sleep(110);
      if (r.status === 404) return [];
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      return j.results || [];
    } catch (e) {
      if (t >= tries) throw new Error(`${url}: ${e.message}`);
      await sleep(1500 * t);
    }
  }
}

/** 'Cold Foil' -> 'coldFoil', '1st Edition' -> 'firstEdition'. */
function variantKey(subType) {
  const s = String(subType || 'Normal').trim();
  if (/^1st edition$/i.test(s)) return 'firstEdition';
  if (/^1st edition holofoil$/i.test(s)) return 'firstEditionHolo';
  const words = s.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  return words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join('') || 'normal';
}
const VARIANT_ORDER = ['normal', 'unlimited', 'firstEdition', 'limited', 'holofoil', 'foil', 'coldFoil', 'reverseHolofoil'];
const variantRank = (v) => { const i = VARIANT_ORDER.indexOf(v); return i < 0 ? 50 : i; };

/** Natural sort key for card numbers: 'OP05-119' / '75/204' / 'LOB-EN001' / '12a'. */
function numberSort(n) {
  const s = String(n || '');
  const first = s.split('/')[0];
  const m = first.match(/(\d+)(?!.*\d)/);       // the last run of digits
  const num = m ? parseInt(m[1], 10) : 999999;
  const prefix = m ? first.slice(0, m.index) : first;
  return { prefix, num };
}

/**
 * TCGplayer product names carry the printing in brackets:
 *   'Roronoa Zoro (001) (Parallel)'  -> name 'Roronoa Zoro', tag 'Parallel'
 *   'Monster Reborn (LART-EN001)'    -> name 'Monster Reborn', tag ''
 *   'Hades - King of Olympus (Oversized)' -> tag 'Oversized'
 * Brackets holding only a number, a card code or a year are dropped (they
 * only tell same-named cards apart; the card number already does that).
 */
function splitName(raw, number) {
  let name = String(raw || '').trim();
  const tags = [];
  for (;;) {
    const m = name.match(/\s*\(([^()]*)\)\s*$/);
    if (!m) break;
    const inside = m[1].trim();
    name = name.slice(0, m.index).trim();
    const isCode = /^\d+$/.test(inside) || /^[A-Z0-9]{2,6}-[A-Z]{0,2}\d+[a-z]?$/i.test(inside) || inside === number;
    if (!isCode) tags.unshift(inside);
  }
  // DBS: 'Krillin - FB10-005' -> 'Krillin'
  if (number) name = name.replace(new RegExp(`\\s*-\\s*${number.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), '');
  return { name: name || String(raw), tag: tags.join(' · ') };
}

const ext = (p, name) => {
  const e = (p.extendedData || []).find((x) => x.name === name);
  return e ? String(e.value) : '';
};
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const today = () => new Date().toISOString().slice(0, 10);

async function buildGame(key) {
  const g = GAMES[key];
  const t0 = Date.now();
  const groups = (await get(`https://tcgcsv.com/tcgplayer/${g.category}/groups`))
    .filter((x) => !x.publishedOn || new Date(x.publishedOn) <= new Date(Date.now() + 45 * 864e5));
  const sets = [], cards = [], slots = [], sealed = [], prices = {};
  let n = 0;
  for (const grp of groups) {
    n++;
    if (n % 50 === 0) console.log(`  ${key}: ${n}/${groups.length} sets…`);
    const pr = await get(`https://tcgcsv.com/tcgplayer/${g.category}/${grp.groupId}/prices`);
    const subByProduct = new Map();
    for (const p of pr) {
      const v = variantKey(p.subTypeName);
      if (!subByProduct.has(p.productId)) subByProduct.set(p.productId, []);
      subByProduct.get(p.productId).push({ v, label: p.subTypeName || 'Normal' });
      if (p.marketPrice != null) prices[`${p.productId}|${v}`] = p.marketPrice;
      else if (p.midPrice != null) prices[`${p.productId}|${v}`] = p.midPrice;
    }
    if (PRICES_ONLY) continue;
    const products = await get(`https://tcgcsv.com/tcgplayer/${g.category}/${grp.groupId}/products`);
    const setId = `${key}~${grp.groupId}`;
    let count = 0;
    const setCards = [];
    for (const p of products) {
      const number = ext(p, 'Number');
      if (!number) {
        sealed.push([`${key}~${p.productId}`, setId, p.productId, p.name, p.imageUrl || '']);
        continue;
      }
      count++;
      setCards.push({ p, number, ns: numberSort(number) });
    }
    setCards.sort((a, b) => a.ns.prefix.localeCompare(b.ns.prefix) || a.ns.num - b.ns.num || a.number.localeCompare(b.number) || a.p.name.localeCompare(b.p.name));
    let order = 0;
    for (const { p, number } of setCards) {
      const cardId = `${key}~${p.productId}`;
      const { name, tag } = splitName(p.name, number);
      cards.push([cardId, setId, p.productId, number, name, name, ext(p, 'Rarity'), p.imageUrl ? 1 : 0, tag]);
      const subs = (subByProduct.get(p.productId) || [{ v: 'normal', label: 'Normal' }])
        .sort((a, b) => variantRank(a.v) - variantRank(b.v));
      const seen = new Set();
      for (const s of subs) {
        if (seen.has(s.v)) continue;
        seen.add(s.v);
        // The pocket's label: the printing ('Parallel', 'Manga', 'Enchanted')
        // and the finish when it adds something ('Parallel · Foil' is just
        // 'Parallel' - a parallel is always foil).
        const finish = s.label === 'Normal' ? '' : s.label;
        const label = tag && subs.length === 1 ? tag : [tag, finish].filter(Boolean).join(' · ') || 'Normal';
        slots.push([`${cardId}::${s.v}`, setId, cardId, s.v, label, order++]);
      }
    }
    sets.push([setId, grp.groupId, grp.name, grp.abbreviation || '', (grp.publishedOn || '').slice(0, 10), count, grp.isSupplemental ? 1 : 0]);
  }

  fs.mkdirSync(OUT, { recursive: true });
  const day = today();
  const priceFile = path.join(OUT, `${key}-prices.json`);
  fs.writeFileSync(priceFile, JSON.stringify({ game: key, day, currency: 'USD', source: 'tcgcsv.com (TCGplayer market)', prices }));
  if (PRICES_ONLY) return { key, prices: Object.keys(prices).length };

  const dbPath = path.join(OUT, `${key}.db`);
  for (const f of [dbPath, `${dbPath}-journal`]) { try { fs.unlinkSync(f); } catch (e) { /* none */ } }
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = OFF;
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE sets (id TEXT PRIMARY KEY, group_id INTEGER NOT NULL, name TEXT NOT NULL, code TEXT,
      release_date TEXT, card_count INTEGER, supplemental INTEGER);
    CREATE TABLE cards (id TEXT PRIMARY KEY, set_id TEXT NOT NULL, product_id INTEGER NOT NULL, number TEXT NOT NULL,
      name TEXT NOT NULL, name_norm TEXT NOT NULL COLLATE NOCASE, rarity TEXT, has_image INTEGER, printing TEXT);
    CREATE TABLE slots (slot_id TEXT PRIMARY KEY, set_id TEXT NOT NULL, card_id TEXT NOT NULL, variant TEXT NOT NULL,
      variant_label TEXT NOT NULL, sort_key INTEGER NOT NULL);
    CREATE TABLE sealed (id TEXT PRIMARY KEY, set_id TEXT NOT NULL, product_id INTEGER NOT NULL, name TEXT NOT NULL, image TEXT);
  `);
  const ins = (sql, rows) => { const st = db.prepare(sql); db.exec('BEGIN'); for (const r of rows) st.run(...r); db.exec('COMMIT'); };
  ins(`INSERT INTO sets VALUES (?,?,?,?,?,?,?)`, sets);
  ins(`INSERT INTO cards VALUES (?,?,?,?,?,?,?,?,?)`, cards.map((c) => [c[0], c[1], c[2], c[3], c[4], c[5].toLowerCase(), c[6], c[7], c[8] || '']));
  ins(`INSERT INTO slots VALUES (?,?,?,?,?,?)`, slots);
  ins(`INSERT OR IGNORE INTO sealed VALUES (?,?,?,?,?)`, sealed);
  const builtAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  ins(`INSERT INTO meta VALUES (?,?)`, [
    ['game', key], ['name', g.name], ['built_at', builtAt], ['source', 'tcgcsv.com'], ['category', String(g.category)],
    ['sets', String(sets.length)], ['cards', String(cards.length)], ['slots', String(slots.length)], ['sealed', String(sealed.length)],
  ]);
  db.exec(`
    CREATE INDEX idx_cards_set ON cards(set_id);
    CREATE INDEX idx_cards_number ON cards(number);
    CREATE INDEX idx_cards_name ON cards(name_norm);
    CREATE INDEX idx_slots_set ON slots(set_id, sort_key);
    CREATE INDEX idx_slots_card ON slots(card_id);
    CREATE INDEX idx_sealed_set ON sealed(set_id);
    VACUUM;
  `);
  db.close();
  const web = writeWebJson(key, dbPath);
  const buf = fs.readFileSync(dbPath);
  const pbuf = fs.readFileSync(priceFile);
  return {
    key, name: g.name, built_at: builtAt, sets: sets.length, cards: cards.length, slots: slots.length, sealed: sealed.length,
    db: { file: `${key}.db`, bytes: buf.length, sha256: sha(buf), url: DB_URL ? `${DB_URL}/${key}.db` : null },
    prices: { file: `${key}-prices.json`, bytes: pbuf.length, day, count: Object.keys(prices).length },
    web,
    seconds: Math.round((Date.now() - t0) / 1000),
  };
}

/** <game>-web.json from a built catalogue: columns once, rows as arrays (no SQLite in the browser). */
function writeWebJson(key, dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const q = (sql) => db.prepare(sql).all().map((r) => Object.values(r));
  const out = {
    v: 1,
    game: key,
    built: new Date().toISOString(),
    sets: { cols: ['id', 'name', 'code', 'release_date', 'card_count'], rows: q(`SELECT id, name, code, release_date, card_count FROM sets ORDER BY release_date DESC, name`) },
    cards: { cols: ['id', 'set_id', 'number', 'name', 'rarity', 'product_id', 'printing'], rows: q(`SELECT id, set_id, number, name, COALESCE(rarity, ''), product_id, COALESCE(printing, '') FROM cards`) },
    slots: { cols: ['card_id', 'variant', 'label'], rows: q(`SELECT card_id, variant, variant_label FROM slots ORDER BY set_id, sort_key`) },
  };
  db.close();
  const file = path.join(OUT, `${key}-web.json`);
  fs.writeFileSync(file, JSON.stringify(out));
  return { file: `${key}-web.json`, bytes: fs.statSync(file).size };
}

(async () => {
  if (WEB_FROM_DB) {
    for (const key of games) {
      const dbPath = path.join(OUT, `${key}.db`);
      if (!fs.existsSync(dbPath)) { console.log(`${key}: no ${dbPath}`); continue; }
      console.log(key, JSON.stringify(writeWebJson(key, dbPath)));
    }
    return;
  }
  const listPath = path.join(OUT, 'games.json');
  let list = {};
  try { list = JSON.parse(fs.readFileSync(listPath, 'utf8')).games || {}; } catch (e) { list = {}; }
  for (const key of games) {
    console.log(`${key}: ${GAMES[key].name}`);
    const r = await buildGame(key);
    if (!PRICES_ONLY) list[key] = r;
    else if (list[key]) list[key].prices = { ...list[key].prices, day: today(), count: r.prices };
    console.log(`  done`, JSON.stringify(r));
  }
  fs.writeFileSync(listPath, JSON.stringify({ format: 1, updated: new Date().toISOString(), games: list }, null, 1));
  console.log(`requests: ${requests}`);
})().catch((e) => { console.error(e); process.exit(1); });
