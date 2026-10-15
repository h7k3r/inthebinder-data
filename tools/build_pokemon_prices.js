#!/usr/bin/env node
/**
 * build_pokemon_prices.js - one copy a day of the Pokémon prices, so phones
 * download a file from this repo instead of each phone calling pokemontcg.io.
 *
 * Why: the free pokemontcg.io allowance is per IP address. With thousands of
 * phones (and everyone on a card shop's wifi sharing one address) the app
 * would hit the limit, and when the service changes, every copy of the app
 * would stop pricing at once. Fetching once here means the number of users
 * no longer matters, and the source can be changed without an app update.
 *
 *   node tools/build_pokemon_prices.js [--out out] [setId ...]
 *
 * Writes <out>/pokemon/<setId>.json:
 *   { set, day, fetched, count, data: [ { id, tcgplayer: { prices }, cardmarket: { url, prices } } ] }
 * data[] is the same shape the API returns, so the app reads either the same way.
 * A set that fails today keeps yesterday's file (the workflow unpacks the
 * previous data branch into <out> first).
 *
 * Polite to the API: one request at a time, a pause between requests,
 * retries with back-off on 429/5xx. POKEMONTCG_API_KEY (a repo secret) is
 * used when set.
 */
const fs = require('fs');
const path = require('path');

const API = 'https://api.pokemontcg.io/v2';
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const OUT = outIdx >= 0 ? args[outIdx + 1] : 'out';
const only = args.filter((a, i) => !a.startsWith('--') && (outIdx < 0 || i !== outIdx + 1));
const KEY = process.env.POKEMONTCG_API_KEY || '';
const HEADERS = { 'User-Agent': 'InTheBinder/1.0 (+https://inthebinder.com)', ...(KEY ? { 'X-Api-Key': KEY } : {}) };
const GAP_MS = KEY ? 300 : 2100; // without a key, stay under ~30 requests a minute
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 5) {
  for (let i = 1; ; i++) {
    let status = 0;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 60000);
      const res = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
      clearTimeout(t);
      status = res.status;
      if (res.ok) return await res.json();
    } catch (e) { status = -1; }
    if (i >= tries || (status > 0 && status !== 429 && status < 500)) throw new Error(`HTTP ${status} ${url}`);
    await sleep(Math.min(60000, 3000 * 2 ** (i - 1)));
  }
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e7 ? v : undefined);
function cleanBlock(o) {
  if (!o || typeof o !== 'object') return undefined;
  const r = {};
  for (const [k, v] of Object.entries(o)) { const n = num(v); if (n !== undefined) r[k] = n; }
  return Object.keys(r).length ? r : undefined;
}
/** Only what the app reads, numbers checked. */
function slim(card) {
  const out = { id: card.id };
  const tp = card.tcgplayer && card.tcgplayer.prices;
  if (tp) {
    const prices = {};
    for (const [variant, v] of Object.entries(tp)) { const c = cleanBlock(v); if (c) prices[variant] = c; }
    if (Object.keys(prices).length) out.tcgplayer = { prices };
  }
  const cm = card.cardmarket;
  if (cm && cm.prices) {
    const prices = cleanBlock(cm.prices);
    const url = typeof cm.url === 'string' && cm.url.startsWith('https://') ? cm.url : undefined;
    if (prices) out.cardmarket = { url, prices };
  }
  return out;
}

async function setCards(setId) {
  const all = [];
  for (let page = 1; page < 20; page++) {
    const j = await get(`${API}/cards?q=set.id:${encodeURIComponent(setId)}&pageSize=250&page=${page}&select=id,tcgplayer,cardmarket`);
    const data = j.data || [];
    all.push(...data);
    if (data.length < 250 || all.length >= (j.totalCount || 0)) break;
    await sleep(GAP_MS);
  }
  return all;
}

(async () => {
  const dir = path.join(OUT, 'pokemon');
  fs.mkdirSync(dir, { recursive: true });
  let ids = only;
  if (!ids.length) {
    const s = await get(`${API}/sets?pageSize=250&select=id`);
    ids = (s.data || []).map((x) => x.id).filter((id) => /^[a-z0-9.-]+$/i.test(id));
    await sleep(GAP_MS);
  }
  const day = new Date().toISOString().slice(0, 10);
  let okCount = 0;
  const failed = [];
  for (const id of ids) {
    try {
      const cards = (await setCards(id)).map(slim);
      fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ set: id, day, fetched: new Date().toISOString(), count: cards.length, data: cards }));
      okCount++;
    } catch (e) {
      failed.push(id);
      console.log(`kept yesterday's file for ${id}: ${e.message}`);
    }
    await sleep(GAP_MS);
  }
  console.log(`Pokémon prices: ${okCount}/${ids.length} sets refreshed${failed.length ? `, kept old: ${failed.join(' ')}` : ''}`);
  // Fail the step only if almost nothing came through (the old files are still published).
  if (okCount < Math.ceil(ids.length / 2)) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
