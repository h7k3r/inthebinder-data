#!/usr/bin/env node
/**
 * build_pokemon_history.js - what every Pokémon card has been worth, week by
 * week, as far back as the free sources go (1 Nov 2026: "value with a chart
 * from the 1st print of the card as much as possible").
 *
 * Source: tcgcsv.com's daily archive of TCGplayer prices
 *   https://tcgcsv.com/archive/tcgplayer/prices-YYYY-MM-DD.ppmd.7z
 * which starts on 8 Feb 2024 (nothing older exists there). One archive a
 * week is read; each holds every TCGplayer price that day. A card printed
 * after Feb 2024 therefore has its whole life on the chart; an older one
 * starts in Feb 2024. Joined to the app's cards through pokemon/_map.json
 * (TCGplayer product id), like build_pokemon_prices.js.
 *
 *   node tools/build_pokemon_history.js --out out --backfill [--cache dir] [--from 2024-02-08]
 *       reads the archives (needs 7z / 7za on the PATH or in Program Files)
 *   node tools/build_pokemon_history.js --out out --fill [--cache dir]
 *       puts back the weeks missing from the files already there (a backfill
 *       or top-up that stopped part way: 9 Nov 2026, Sep 2025 - Oct 2026),
 *       from the archives, keeping every point already in them
 *   node tools/build_pokemon_history.js --out out
 *       the weekly top-up: if the newest point is 7+ days old, adds today's
 *       prices from tcgcsv's live files (one request per set)
 *
 * Writes <out>/pokemon/history/<setId>.json:
 *   { set, step: 7, first: "YYYY-MM-DD", days: ["YYYY-MM-DD", ...],
 *     cards: { "<cardId>": { "<variant>": [price | null, ...] } } }
 * variants are the app's own names (normal, holo, reverse, firstEdition,
 * firstEditionHolo); prices are TCGplayer market (else mid), USD, 2 decimals.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { TCGPLAYER_KEY } = require('./pokemon_match');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const OUT = opt('--out', 'out');
const BACKFILL = args.includes('--backfill');
const FILL = args.includes('--fill');
const CACHE = opt('--cache', path.join(os.tmpdir(), 'tcgcsv-archive'));
const FROM = opt('--from', '2024-02-08');
const ONLY = (opt('--sets', '') || '').split(',').filter(Boolean);
const STEP = 7;
const UA = { 'User-Agent': 'InTheBinder/1.16 (+https://inthebinder.com; support@inthebinder.com)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The app's printing names (prices.js VARIANT_FROM_TCGPLAYER).
const APP_VARIANT = {
  normal: 'normal', holofoil: 'holo', reverseHolofoil: 'reverse',
  '1stEditionHolofoil': 'firstEditionHolo', '1stEditionNormal': 'firstEdition', unlimitedHolofoil: 'holo',
};

function readJson(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; } }
const ymd = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
const price = (r) => {
  const v = typeof r.marketPrice === 'number' ? r.marketPrice : typeof r.midPrice === 'number' ? r.midPrice : null;
  return v != null && Number.isFinite(v) && v > 0 && v < 1e6 ? Math.round(v * 100) / 100 : null;
};

function sevenZip() {
  for (const c of ['7z', '7za', 'C:\\Program Files\\7-Zip\\7z.exe']) {
    try { execFileSync(c, ['i'], { stdio: 'ignore' }); return c; } catch (e) { /* next */ }
  }
  throw new Error('7z not found (apt install p7zip-full, or 7-Zip on Windows)');
}

async function download(url, file) {
  for (let i = 1; i <= 4; i++) {
    try {
      const res = await fetch(url, { headers: UA });
      if (res.status === 404) return false;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      return true;
    } catch (e) {
      if (i === 4) throw e;
      await sleep(3000 * i);
    }
  }
  return false;
}

/** Everything the run needs to know about the app's cards. */
function loadIndex() {
  const dir = path.join(OUT, 'pokemon');
  const map = readJson(path.join(dir, '_map.json'), null);
  const cat = readJson(path.join(__dirname, '..', 'pokemon-catalog.json'), null);
  if (!map || !cat) throw new Error('needs pokemon/_map.json and pokemon-catalog.json');
  const setOf = new Map(cat.cards.map(([id, set]) => [id, set]));
  const byProduct = new Map(); // productId -> [cardId]
  for (const [id, m] of Object.entries(map.cards || {})) {
    if (!m || !m.tp || !setOf.has(id)) continue;
    if (ONLY.length && !ONLY.includes(setOf.get(id))) continue;
    if (!byProduct.has(m.tp)) byProduct.set(m.tp, []);
    byProduct.get(m.tp).push(id);
  }
  const groups = new Set();
  for (const [s, v] of Object.entries(map.sets || {})) if (v && v.tp && (!ONLY.length || ONLY.includes(s))) groups.add(String(v.tp));
  return { setOf, byProduct, groups };
}

/** One day's TCGplayer rows -> Map("cardId|variant" -> price). */
function pricesFromRows(rows, byProduct) {
  const out = new Map();
  for (const r of rows || []) {
    const ids = byProduct.get(r.productId);
    const key = ids && APP_VARIANT[TCGPLAYER_KEY[r.subTypeName]];
    const v = key && price(r);
    if (v == null) continue;
    for (const id of ids) if (!out.has(`${id}|${key}`)) out.set(`${id}|${key}`, v);
  }
  return out;
}

/** Store one day's prices into the per-set tables. */
function addDay(tables, day, prices, setOf) {
  for (const t of tables.values()) t.days.push(day);
  for (const [k, v] of prices) {
    const [id, variant] = k.split('|');
    const set = setOf.get(id);
    if (!tables.has(set)) continue;
    const t = tables.get(set);
    if (!t.cards[id]) t.cards[id] = {};
    if (!t.cards[id][variant]) t.cards[id][variant] = [];
    const arr = t.cards[id][variant];
    while (arr.length < t.days.length - 1) arr.push(null);
    arr.push(v);
  }
}

function writeTables(tables) {
  const dir = path.join(OUT, 'pokemon', 'history');
  fs.mkdirSync(dir, { recursive: true });
  let files = 0, series = 0;
  for (const [set, t] of tables) {
    // Pad every series to the full length; drop cards never priced.
    let any = false;
    for (const [id, vs] of Object.entries(t.cards)) {
      for (const [v, arr] of Object.entries(vs)) {
        while (arr.length < t.days.length) arr.push(null);
        if (!arr.some((x) => x != null)) delete vs[v]; else series++;
      }
      if (!Object.keys(vs).length) delete t.cards[id]; else any = true;
    }
    if (!any) continue;
    const first = t.days.find((d, i) => Object.values(t.cards).some((vs) => Object.values(vs).some((a) => a[i] != null)));
    fs.writeFileSync(path.join(dir, `${set}.json`), JSON.stringify({ set, step: STEP, first, days: t.days, cards: t.cards }));
    files++;
  }
  return { files, series };
}

async function backfill() {
  const z = sevenZip();
  const { setOf, byProduct, groups } = loadIndex();
  fs.mkdirSync(CACHE, { recursive: true });
  const tables = new Map([...new Set(setOf.values())].filter((s) => !ONLY.length || ONLY.includes(s)).map((s) => [s, { days: [], cards: {} }]));
  const today = ymd(new Date());
  const days = [];
  for (let d = FROM; d <= today; d = addDays(d, STEP)) days.push(d);
  for (const day of days) {
    const file = path.join(CACHE, `prices-${day}.ppmd.7z`);
    let have = fs.existsSync(file) && fs.statSync(file).size > 0;
    if (!have) have = await download(`https://tcgcsv.com/archive/tcgplayer/prices-${day}.ppmd.7z`, file).catch(() => false);
    if (!have) { console.log(`${day}: no archive`); continue; }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tcgh-'));
    try {
      execFileSync(z, ['x', file, `-o${tmp}`, `-ir!${day}${path.sep}3${path.sep}*`, '-y'], { stdio: 'ignore' });
      const base = path.join(tmp, day, '3');
      const rows = [];
      for (const g of fs.existsSync(base) ? fs.readdirSync(base) : []) {
        if (!groups.has(g)) continue;
        const j = readJson(path.join(base, g, 'prices'), null);
        if (j && Array.isArray(j.results)) rows.push(...j.results);
      }
      const p = pricesFromRows(rows, byProduct);
      addDay(tables, day, p, setOf);
      console.log(`${day}: ${p.size} prices`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  const r = writeTables(tables);
  console.log(`History: ${r.files} sets, ${r.series} price series, ${days.length} weeks`);
}

/** One archive day -> Map("cardId|variant" -> price), or null when there is none. */
async function archiveDay(z, day, groups, byProduct) {
  const file = path.join(CACHE, `prices-${day}.ppmd.7z`);
  let have = fs.existsSync(file) && fs.statSync(file).size > 0;
  if (!have) have = await download(`https://tcgcsv.com/archive/tcgplayer/prices-${day}.ppmd.7z`, file).catch(() => false);
  if (!have) return null;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tcgh-'));
  try {
    execFileSync(z, ['x', file, `-o${tmp}`, `-ir!${day}${path.sep}3${path.sep}*`, '-y'], { stdio: 'ignore' });
    const base = path.join(tmp, day, '3');
    const rows = [];
    for (const g of fs.existsSync(base) ? fs.readdirSync(base) : []) {
      if (!groups.has(g)) continue;
      const j = readJson(path.join(base, g, 'prices'), null);
      if (j && Array.isArray(j.results)) rows.push(...j.results);
    }
    return pricesFromRows(rows, byProduct);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** The weeks missing from the files already there, put back in date order. */
async function fill() {
  const z = sevenZip();
  const { setOf, byProduct, groups } = loadIndex();
  fs.mkdirSync(CACHE, { recursive: true });
  const dir = path.join(OUT, 'pokemon', 'history');
  const tables = new Map();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const t = readJson(path.join(dir, f), null);
    if (t && Array.isArray(t.days) && t.cards && (!ONLY.length || ONLY.includes(t.set))) tables.set(t.set, t);
  }
  const known = new Set();
  for (const t of tables.values()) for (const d of t.days) known.add(d);
  const near = (d) => { for (let k = -3; k <= 3; k++) if (known.has(addDays(d, k))) return true; return false; };
  const today = ymd(new Date());
  const missing = [];
  for (let d = FROM; d <= today; d = addDays(d, STEP)) if (!near(d)) missing.push(d);
  console.log(`${missing.length} weeks missing`);
  const got = new Map();   // day -> Map(cardId|variant -> price)
  for (const day of missing) {
    const p = await archiveDay(z, day, groups, byProduct);
    if (!p || p.size < 1000) { console.log(`${day}: ${p ? `only ${p.size} prices` : 'no archive'}`); continue; }
    got.set(day, p);
    console.log(`${day}: ${p.size} prices`);
  }
  if (!got.size) { console.log('Nothing to add.'); return; }
  // Which set each new price belongs to, per day.
  const bySet = new Map();   // set -> Map(day -> [[id, variant, v]])
  for (const [day, p] of got) {
    for (const [k, v] of p) {
      const [id, variant] = k.split('|');
      const set = setOf.get(id);
      if (!tables.has(set)) continue;
      if (!bySet.has(set)) bySet.set(set, new Map());
      const m = bySet.get(set);
      if (!m.has(day)) m.set(day, []);
      m.get(day).push([id, variant, v]);
    }
  }
  for (const [set, t] of tables) {
    const add = bySet.get(set) || new Map();
    const days = [...new Set([...t.days, ...got.keys()])].sort();
    const oldAt = new Map(t.days.map((d, i) => [d, i]));
    const cards = {};
    for (const [id, vs] of Object.entries(t.cards)) {
      cards[id] = {};
      for (const [v, arr] of Object.entries(vs)) cards[id][v] = days.map((d) => (oldAt.has(d) ? (arr[oldAt.get(d)] ?? null) : null));
    }
    for (const [day, list] of add) {
      const i = days.indexOf(day);
      for (const [id, variant, v] of list) {
        if (!cards[id]) cards[id] = {};
        if (!cards[id][variant]) cards[id][variant] = days.map(() => null);
        cards[id][variant][i] = v;
      }
    }
    t.days = days;
    t.cards = cards;
  }
  const r = writeTables(tables);
  console.log(`History filled: ${got.size} weeks added to ${r.files} sets`);
}

/** The weekly top-up from tcgcsv's live files. */
async function topUp() {
  const dir = path.join(OUT, 'pokemon', 'history');
  const { setOf, byProduct, groups } = loadIndex();
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
  if (!files.length) { console.log('No history yet: run with --backfill once.'); return; }
  const today = ymd(new Date());
  const tables = new Map();
  for (const f of files) {
    const t = readJson(path.join(dir, f), null);
    if (!t || !Array.isArray(t.days)) continue;
    const last = t.days[t.days.length - 1];
    if (last && addDays(last, STEP) > today) continue;
    tables.set(t.set, t);
  }
  if (!tables.size) { console.log('History is up to date.'); return; }
  const rows = [];
  for (const g of groups) {
    try {
      const res = await fetch(`https://tcgcsv.com/tcgplayer/3/${g}/prices`, { headers: UA });
      if (res.ok) rows.push(...(((await res.json()) || {}).results || []));
    } catch (e) { /* that set keeps last week's point */ }
    await sleep(120);
  }
  const p = pricesFromRows(rows, byProduct);
  if (p.size < 1000) { console.log(`Only ${p.size} prices today: history left as it was.`); return; }
  for (const t of tables.values()) {
    for (const vs of Object.values(t.cards)) for (const arr of Object.values(vs)) while (arr.length < t.days.length) arr.push(null);
  }
  addDay(tables, today, p, setOf);
  const r = writeTables(tables);
  console.log(`History topped up: ${r.files} sets`);
}

if (require.main === module) (FILL ? fill() : BACKFILL ? backfill() : topUp()).catch((e) => { console.error(e); process.exitCode = 1; });
module.exports = { pricesFromRows, APP_VARIANT };
