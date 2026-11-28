#!/usr/bin/env node
/**
 * build_pokemon_sealed_cm.js - Cardmarket's price for each sealed product in
 * pokemon-sealed.json (28 Nov 2026), so a UK or European collector can count a
 * box at what it sells for in Europe instead of TCGplayer's US price.
 *
 *   node tools/build_pokemon_sealed_cm.js [--out out] [--cache dir] [--report]
 *
 * Reads <out>/pokemon-sealed.json (built just before) and Cardmarket's public
 * daily downloads (cardmarket.com > Pokémon > Data > Price Guide / Product List):
 *   productCatalog/productList/products_nonsingles_6.json
 *   productCatalog/priceGuide/price_guide_6.json
 * Writes <out>/pokemon-sealed-cm.json:
 *   { built, guide: <Cardmarket's createdAt>, currency: 'EUR', count,
 *     items: { <tcgplayerId>: [cardmarketId, trend|null, avg|null, low|null] } }
 * English products only. Cardmarket's "trend" and "avg" (average sell price)
 * come from sales on Cardmarket; "low" is the cheapest listing.
 */
const fs = require('fs');
const path = require('path');
const { indexCm, matchCm } = require('./pokemon_sealed_cm_match');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const OUT = opt('--out', 'out');
const CACHE = opt('--cache', null);
const BASE = 'https://downloads.s3.cardmarket.com/productCatalog';
const UA = { 'User-Agent': 'InTheBinder/1.0 (+https://inthebinder.com; support@inthebinder.com)' };

async function getJson(url, file) {
  if (CACHE && fs.existsSync(path.join(CACHE, file))) return JSON.parse(fs.readFileSync(path.join(CACHE, file), 'utf8'));
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: UA });
      if (r.ok) return await r.json();
      if (r.status < 500 && r.status !== 429) throw new Error(`HTTP ${r.status} ${url}`);
    } catch (e) { if (i >= 4) throw e; }
    if (i >= 4) throw new Error(`gave up on ${url}`);
    await new Promise((res) => setTimeout(res, 3000 * i));
  }
}
const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null);

(async () => {
  const sealed = JSON.parse(fs.readFileSync(path.join(OUT, 'pokemon-sealed.json'), 'utf8'));
  const list = await getJson(`${BASE}/productList/products_nonsingles_6.json`, 'products_nonsingles_6.json');
  const guide = await getJson(`${BASE}/priceGuide/price_guide_6.json`, 'price_guide_6.json');
  const price = new Map((guide.priceGuides || []).map((g) => [g.idProduct, g]));
  const idx = indexCm(list.products);
  const items = {};
  const seen = new Map();
  let tried = 0;
  for (const it of sealed.items || []) {
    const [id, name, set, , lang] = it;
    if (lang !== 'EN') continue;
    tried += 1;
    const c = matchCm(idx, name, set);
    if (!c) continue;
    const g = price.get(c.id) || {};
    const row = [c.id, num(g.trend), num(g.avg), num(g.low)];
    if (row[1] == null && row[2] == null) continue;
    items[id] = row;
    seen.set(c.id, [...(seen.get(c.id) || []), name]);
  }
  // Two of ours on one Cardmarket product: neither is sure, drop both.
  for (const [cid, names] of seen) {
    if (names.length < 2) continue;
    for (const [k, v] of Object.entries(items)) if (v[0] === cid) delete items[k];
  }
  const out = { built: new Date().toISOString(), guide: guide.createdAt || null, currency: 'EUR', count: Object.keys(items).length, items };
  fs.writeFileSync(path.join(OUT, 'pokemon-sealed-cm.json'), JSON.stringify(out));
  console.log(`pokemon-sealed-cm.json: ${out.count} of ${tried} English products priced from Cardmarket (guide ${out.guide})`);
  if (args.includes('--report')) {
    for (const [cid, names] of seen) if (names.length > 1) console.log('  shared, dropped:', cid, names.join(' | '));
  }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
