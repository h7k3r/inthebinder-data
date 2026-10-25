#!/usr/bin/env node
/**
 * build_pokemon_hot.js - "Hot today" for the app's Home screen (25 Oct 2026).
 *
 *   node tools/build_pokemon_hot.js --out out
 *
 * Reads the per-set price files build_pokemon_prices.js has just written
 * (out/pokemon/<set>.json), compares each printing's TCGplayer market price
 * (USD) with the snapshot kept from the previous daily run, and writes
 *
 *   out/pokemon/hot.json  { updated, base, since, movers: [...], fallers: [...] }
 *     each entry: { id, variant, name, set_id, set_name, number, image,
 *                   price, prev, change_pct, currency }
 *
 * The snapshot (out/pokemon/_hot_snapshot.json) rides on the data branch
 * like everything else: { taken, prices: { "id::variant": usd }, prev }.
 * Only printings worth >= $2 are kept in it, so it stays small. A run less
 * than 20 hours after the last one (a manual re-run) compares with the
 * snapshot before, so the list does not go empty.
 *
 * No snapshot yet (the very first run): the list is built from Cardmarket's
 * own averages instead - last 7 days against last 30 days, in euros - and
 * `base` says so. Nothing here calls the network.
 */
const fs = require('fs');
const path = require('path');

const MIN_PRICE = 5;      // today, in the base currency
const MIN_PREV = 3;       // before
const MIN_PCT = 5;        // a mover moved at least this much
const KEEP_IN_SNAPSHOT = 2;
const DAY_GAP_H = 20;

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * entries: [{ key, price, prev }] -> { movers, fallers }. Movers: price >= 5,
 * prev >= 3, up >= 5%, by % then price; fewer than 3 such -> the biggest
 * absolute gainers instead. Fallers the same way, downwards.
 */
function rank(entries, { n = 12, nFall = 5, minPrice = MIN_PRICE, minPrev = MIN_PREV, minPct = MIN_PCT, maxPct = 300, maxPrice = Infinity } = {}) {
  const rows = [];
  for (const e of entries) {
    if (!(e.price > 0) || !(e.prev > 0) || e.price > maxPrice) continue;
    const change = ((e.price - e.prev) / e.prev) * 100;
    // A jump past maxPct in one go is almost always a one-off sale or a data
    // slip on a thinly traded card, not news: left out.
    if (Math.abs(change) > maxPct) continue;
    rows.push({ ...e, change_pct: round2(change), delta: e.price - e.prev });
  }
  const big = rows.filter((r) => r.price >= minPrice && r.prev >= minPrev);
  let movers = big.filter((r) => r.change_pct >= minPct)
    .sort((a, b) => b.change_pct - a.change_pct || b.price - a.price);
  if (movers.length < 3) {
    movers = rows.filter((r) => r.delta > 0).sort((a, b) => b.delta - a.delta || b.price - a.price);
  }
  let fallers = big.filter((r) => r.change_pct <= -minPct)
    .sort((a, b) => a.change_pct - b.change_pct || b.prev - a.prev);
  if (fallers.length < 3) {
    fallers = rows.filter((r) => r.delta < 0).sort((a, b) => a.delta - b.delta || b.prev - a.prev);
  }
  const clean = ({ delta, ...r }) => r;
  return { movers: movers.slice(0, n).map(clean), fallers: fallers.slice(0, nFall).map(clean) };
}

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; }
}

/** Today's prices from the per-set files: tcgplayer USD market and Cardmarket EUR averages. */
function readToday(dir) {
  const usd = new Map();
  const cm = new Map();
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json') || f.startsWith('_') || f === 'hot.json') continue;
    const j = readJson(path.join(dir, f), null);
    if (!j || !Array.isArray(j.data)) continue;
    for (const c of j.data) {
      const tp = c.tcgplayer && c.tcgplayer.prices;
      if (tp) {
        for (const [variant, p] of Object.entries(tp)) {
          if (p && p.market > 0) usd.set(`${c.id}::${variant}`, p.market);
        }
      }
      const cp = c.cardmarket && c.cardmarket.prices;
      if (cp && cp.avg7 > 0 && cp.avg30 > 0) cm.set(c.id, { price: cp.trendPrice > 0 ? cp.trendPrice : cp.avg7, now: cp.avg7, prev: cp.avg30 });
    }
  }
  return { usd, cm };
}

function main() {
  const i = process.argv.indexOf('--out');
  const OUT = i > 0 ? process.argv[i + 1] : 'out';
  const dir = path.join(OUT, 'pokemon');
  const cat = readJson(path.join(__dirname, '..', 'pokemon-catalog.json'), null);
  const map = readJson(path.join(dir, '_map.json'), { cards: {} });
  if (!cat) throw new Error('needs pokemon-catalog.json');
  const setName = new Map(cat.sets.map((s) => [s[0], s[1]]));
  const cardInfo = new Map(cat.cards.map((c) => [c[0], { set_id: c[1], number: c[2], name: c[3] }]));

  const now = new Date();
  const { usd, cm } = readToday(dir);
  const snapPath = path.join(dir, '_hot_snapshot.json');
  const snap = readJson(snapPath, null);
  const todayKept = {};
  for (const [k, v] of usd) if (v >= KEEP_IN_SNAPSHOT) todayKept[k] = v;

  let base = null;
  let since = null;
  let nextSnap;
  const ageH = snap && snap.taken ? (now - new Date(snap.taken)) / 3600000 : null;
  if (snap && snap.prices && ageH >= DAY_GAP_H) {
    base = snap.prices; since = snap.taken;
    nextSnap = { taken: now.toISOString(), prices: todayKept, prev: { taken: snap.taken, prices: snap.prices } };
  } else if (snap && snap.prev && snap.prev.prices) {
    base = snap.prev.prices; since = snap.prev.taken;
    nextSnap = { taken: snap.taken, prices: todayKept, prev: snap.prev };
  } else {
    nextSnap = { taken: snap && snap.taken ? snap.taken : now.toISOString(), prices: todayKept };
  }

  const describe = (key, r, currency) => {
    const [id, variant] = key.split('::');
    const info = cardInfo.get(id);
    if (!info) return null;
    const m = (map.cards && map.cards[id]) || {};
    return {
      id, variant: variant || null, name: info.name, set_id: info.set_id, set_name: setName.get(info.set_id) || info.set_id,
      number: info.number, image: m.img ? `${m.img}/low.webp` : null,
      price: round2(r.price), prev: round2(r.prev), change_pct: r.change_pct, currency,
    };
  };

  let result;
  let baseName;
  if (base) {
    const entries = [];
    for (const [key, price] of usd) {
      const prev = base[key];
      if (prev > 0 && cardInfo.has(key.split('::')[0])) entries.push({ key, price, prev });
    }
    result = rank(entries);
    baseName = 'tcgplayer-usd';
    result.movers = result.movers.map((r) => describe(r.key, r, 'USD')).filter(Boolean);
    result.fallers = result.fallers.map((r) => describe(r.key, r, 'USD')).filter(Boolean);
  } else {
    // First run: Cardmarket's 7-day average against its 30-day average.
    const entries = [];
    for (const [id, v] of cm) if (cardInfo.has(id)) entries.push({ key: id, price: v.now, prev: v.prev, shown: v.price });
    // Monthly averages on rare cards swing on a single sale: steadier limits.
    result = rank(entries, { maxPct: 60, maxPrice: 1000 });
    baseName = 'cardmarket-eur-7d-vs-30d';
    result.movers = result.movers.map((r) => describe(r.key, r, 'EUR')).filter(Boolean);
    result.fallers = result.fallers.map((r) => describe(r.key, r, 'EUR')).filter(Boolean);
  }

  // Two printings sharing one market listing (same name, same figures) show once.
  const once = (list) => {
    const seen = new Set();
    return list.filter((m) => { const k = `${m.name}|${m.price}|${m.prev}`; if (seen.has(k)) return false; seen.add(k); return true; });
  };
  const hot = { updated: now.toISOString(), base: baseName, since, movers: once(result.movers), fallers: once(result.fallers) };
  fs.writeFileSync(path.join(dir, 'hot.json'), JSON.stringify(hot));
  fs.writeFileSync(snapPath, JSON.stringify(nextSnap));
  console.log(`hot.json: ${hot.movers.length} movers, ${hot.fallers.length} fallers (${baseName}${since ? ` since ${since}` : ''}); snapshot ${Object.keys(todayKept).length} printings`);
  for (const m of hot.movers.slice(0, 5)) console.log(`  +${m.change_pct}%  ${m.name} (${m.set_name} ${m.number}, ${m.variant || '-'})  ${m.prev} -> ${m.price} ${m.currency}`);
}

if (require.main === module) {
  try { main(); } catch (e) { console.error(e); process.exitCode = 1; }
}
module.exports = { rank };
