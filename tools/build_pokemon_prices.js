#!/usr/bin/env node
/**
 * build_pokemon_prices.js - one copy a day of the Pokémon prices, so phones
 * download a file from this repo instead of calling a price service.
 *
 * Sources (since 23 Oct 2026, all free, no key):
 *   - Cardmarket's public daily price guide for Pokémon (one ~16 MB file,
 *     EUR), joined by Cardmarket product id from the card map;
 *   - tcgcsv.com, the daily copy of TCGplayer prices (USD), one request
 *     per set, joined by TCGplayer product id from the card map.
 * The card map (pokemon/_map.json) comes from tools/build_pokemon_map.js.
 * pokemontcg.io (deprecated; keys stop on 1 March 2027) is only asked for a
 * set the free sources priced nothing in, while it still answers.
 *
 *   node tools/build_pokemon_prices.js [--out out] [setId ...]
 *
 * Writes <out>/pokemon/<setId>.json - the same shape the app has always read:
 *   { set, day, fetched, source, count, data: [ { id,
 *       tcgplayer: { prices: { normal|holofoil|reverseHolofoil|...: { low, mid, high, market } } },
 *       cardmarket: { url?, prices: { averageSellPrice, lowPrice, trendPrice, avg1, avg7, avg30,
 *                                      reverseHoloSell, reverseHoloLow, reverseHoloTrend,
 *                                      reverseHoloAvg1, reverseHoloAvg7, reverseHoloAvg30 } } } ] }
 * A set that cannot be priced today keeps yesterday's file (the workflow
 * unpacks the previous data branch into <out> first).
 */
const fs = require('fs');
const path = require('path');
const { TCGPLAYER_KEY } = require('./pokemon_match');

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const OUT = outIdx >= 0 ? args[outIdx + 1] : 'out';
const only = args.filter((a, i) => !a.startsWith('--') && (outIdx < 0 || i !== outIdx + 1));
const UA = { 'User-Agent': 'InTheBinder/1.15 (+https://inthebinder.com; support@inthebinder.com)' };
const CM_GUIDE = 'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, { tries = 4, headers = {} } = {}) {
  for (let i = 1; ; i++) {
    let status = 0;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 120000);
      const res = await fetch(url, { headers: { ...UA, ...headers }, signal: ctrl.signal });
      clearTimeout(t);
      status = res.status;
      if (res.ok) return await res.json();
    } catch (e) { status = -1; }
    if (i >= tries || (status > 0 && status !== 429 && status < 500)) throw new Error(`HTTP ${status} ${url}`);
    await sleep(Math.min(60000, 3000 * 2 ** (i - 1)));
  }
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e7 ? v : undefined);
function block(pairs) {
  const r = {};
  for (const [k, v] of pairs) { const n = num(v); if (n !== undefined) r[k] = n; }
  return Object.keys(r).length ? r : undefined;
}

/** One Cardmarket price-guide row -> the field names the app reads. */
function cardmarketPrices(g) {
  return block([
    ['averageSellPrice', g.avg], ['lowPrice', g.low], ['trendPrice', g.trend],
    ['avg1', g.avg1], ['avg7', g.avg7], ['avg30', g.avg30],
    ['reverseHoloSell', g['avg-holo']], ['reverseHoloLow', g['low-holo']], ['reverseHoloTrend', g['trend-holo']],
    ['reverseHoloAvg1', g['avg1-holo']], ['reverseHoloAvg7', g['avg7-holo']], ['reverseHoloAvg30', g['avg30-holo']],
  ]);
}

/** tcgcsv price rows for one product -> { normal: {...}, reverseHolofoil: {...} } */
function tcgplayerPrices(rows) {
  const out = {};
  for (const r of rows || []) {
    const key = TCGPLAYER_KEY[r.subTypeName];
    if (!key || out[key]) continue;
    const b = block([['low', r.lowPrice], ['mid', r.midPrice], ['high', r.highPrice], ['market', r.marketPrice], ['directLow', r.directLowPrice]]);
    if (b) out[key] = b;
  }
  return Object.keys(out).length ? out : undefined;
}

// ---- the old source, kept only as a fallback until it switches off --------
const PTCG = 'https://api.pokemontcg.io/v2';
const PTCG_KEY = process.env.POKEMONTCG_API_KEY || '';
async function ptcgSet(setId) {
  const all = [];
  for (let page = 1; page < 20; page++) {
    const j = await get(`${PTCG}/cards?q=set.id:${encodeURIComponent(setId)}&pageSize=250&page=${page}&select=id,tcgplayer,cardmarket`,
      { headers: PTCG_KEY ? { 'X-Api-Key': PTCG_KEY } : {} });
    const data = j.data || [];
    all.push(...data);
    if (data.length < 250 || all.length >= (j.totalCount || 0)) break;
    await sleep(PTCG_KEY ? 300 : 2100);
  }
  return all.map((card) => {
    const o = { id: card.id };
    const tp = card.tcgplayer && card.tcgplayer.prices;
    if (tp) {
      const prices = {};
      for (const [k, v] of Object.entries(tp)) { const b = block(Object.entries(v || {})); if (b) prices[k] = b; }
      if (Object.keys(prices).length) o.tcgplayer = { prices };
    }
    const cm = card.cardmarket;
    const p = cm && cm.prices && block(Object.entries(cm.prices));
    if (p) o.cardmarket = { url: typeof cm.url === 'string' && cm.url.startsWith('https://') ? cm.url : undefined, prices: p };
    return o;
  }).filter((c) => c.tcgplayer || c.cardmarket);
}

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; }
}

async function main() {
  const dir = path.join(OUT, 'pokemon');
  fs.mkdirSync(dir, { recursive: true });
  const map = readJson(path.join(dir, '_map.json'), null);
  const cat = readJson(path.join(__dirname, '..', 'pokemon-catalog.json'), null);
  if (!map || !cat) throw new Error('needs pokemon/_map.json (build_pokemon_map.js) and pokemon-catalog.json');

  const cardsBySet = new Map();
  for (const [id, set] of cat.cards) {
    if (!cardsBySet.has(set)) cardsBySet.set(set, []);
    cardsBySet.get(set).push(id);
  }
  const setIds = only.length ? only : [...cardsBySet.keys()];

  // Cardmarket: one file for every Pokémon product.
  let cmGuide = new Map();
  try {
    const g = await get(CM_GUIDE);
    cmGuide = new Map((g.priceGuides || []).map((r) => [r.idProduct, r]));
    console.log(`Cardmarket price guide: ${cmGuide.size} products (${g.createdAt})`);
  } catch (e) { console.log(`Cardmarket price guide unavailable today: ${e.message}`); }

  // TCGplayer via tcgcsv: one request per group the map uses.
  const tpRows = new Map();
  const groups = new Set(setIds.map((s) => map.sets[s] && map.sets[s].tp).filter(Boolean));
  let groupsOk = 0;
  for (const gid of groups) {
    try {
      const j = await get(`https://tcgcsv.com/tcgplayer/3/${gid}/prices`);
      for (const r of (j && j.results) || []) {
        if (!tpRows.has(r.productId)) tpRows.set(r.productId, []);
        tpRows.get(r.productId).push(r);
      }
      groupsOk++;
    } catch (e) { console.log(`tcgcsv group ${gid}: ${e.message}`); }
    await sleep(120);
  }
  console.log(`tcgcsv: ${groupsOk}/${groups.size} groups, ${tpRows.size} products`);

  const day = new Date().toISOString().slice(0, 10);
  let fresh = 0, fallback = 0, kept = 0, priced = 0;
  for (const setId of setIds) {
    const file = path.join(dir, `${setId}.json`);
    // Keep yesterday's Cardmarket page links (they came from pokemontcg.io);
    // without one the app opens a Cardmarket search instead.
    const prevUrls = new Map(((readJson(file, {}).data) || [])
      .filter((c) => c.cardmarket && c.cardmarket.url).map((c) => [c.id, c.cardmarket.url]));
    const data = [];
    for (const id of cardsBySet.get(setId) || []) {
      const m = map.cards[id] || {};
      const o = { id };
      const tp = m.tp && tcgplayerPrices(tpRows.get(m.tp));
      if (tp) o.tcgplayer = { prices: tp };
      const cmRow = m.cm > 0 ? cmGuide.get(m.cm) : null;
      const cm = cmRow && cardmarketPrices(cmRow);
      if (cm) o.cardmarket = { url: prevUrls.get(id), prices: cm };
      if (o.tcgplayer || o.cardmarket) data.push(o);
    }
    let source = 'cardmarket price guide + tcgcsv.com';
    let out = data;
    if (!data.length) {
      try { out = await ptcgSet(setId); source = 'pokemontcg.io (fallback)'; } catch (e) { out = []; }
      await sleep(PTCG_KEY ? 300 : 2100);
    }
    if (!out.length) { kept++; continue; }
    if (source.startsWith('pokemontcg')) fallback++; else fresh++;
    priced += out.length;
    fs.writeFileSync(file, JSON.stringify({ set: setId, day, fetched: new Date().toISOString(), source, count: out.length, data: out }));
  }
  console.log(`Pokémon prices: ${fresh} sets from the free sources, ${fallback} from pokemontcg.io, ${kept} kept from before; ${priced} cards priced`);
  if (fresh + fallback < Math.ceil(setIds.length / 2)) process.exitCode = 1;
}

if (require.main === module) main().catch((e) => { console.error(e); process.exitCode = 1; });
module.exports = { cardmarketPrices, tcgplayerPrices };
