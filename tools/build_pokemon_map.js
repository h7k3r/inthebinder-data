#!/usr/bin/env node
/**
 * build_pokemon_map.js - links every card in the app's own list
 * (pokemon-catalog.json) to the free sources the daily price job reads:
 *
 *   TCGdex (api.tcgdex.net, MIT)  -> TCGdex card id, picture, Cardmarket product id
 *   tcgcsv.com (TCGplayer copy)   -> TCGplayer product id, for USD prices
 *
 *   node tools/build_pokemon_map.js [--out out] [--max-lookups N] [--report]
 *
 * Writes <out>/pokemon/_map.json:
 *   { built, sets: { setId: { dx, tp } },
 *     cards: { cardId: { dx, img, cm, cmAt, tp } } }
 * cm is the Cardmarket idProduct (0 = TCGdex has none yet; asked again after
 * 30 days). Ids found before are kept, so a weekly run only looks up new
 * cards: the first full run (~20,000 TCGdex lookups) is done once by hand.
 *
 * Polite: TCGdex asks for nothing formal, so 4 requests at a time with a
 * pause; tcgcsv asks for a User-Agent and 100 ms between requests.
 */
const fs = require('fs');
const path = require('path');
const M = require('./pokemon_match');

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const OUT = arg('--out', 'out');
const MAX_LOOKUPS = Number(arg('--max-lookups', '100000'));
const REPORT = args.includes('--report');
const UA = { 'User-Agent': 'InTheBinder/1.15 (+https://inthebinder.com; support@inthebinder.com)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RECHECK_DAYS = 30;

async function getJson(url, tries = 4) {
  for (let i = 1; ; i++) {
    let status = 0;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 60000);
      const res = await fetch(url, { headers: UA, signal: ctrl.signal });
      clearTimeout(t);
      status = res.status;
      if (res.ok) return await res.json();
      if (status === 404) return null;
    } catch (e) { status = -1; }
    if (i >= tries || (status > 0 && status !== 429 && status < 500)) throw new Error(`HTTP ${status} ${url}`);
    await sleep(Math.min(30000, 2000 * 2 ** (i - 1)));
  }
}

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; }
}

async function main() {
  const cat = readJson(path.join(__dirname, '..', 'pokemon-catalog.json'), null);
  if (!cat) throw new Error('pokemon-catalog.json is missing (tools/export_pokemon_catalog.js)');
  const ourSets = cat.sets.map(([id, name, code]) => ({ id, name, code }));
  const ourCards = cat.cards.map(([id, set, number, name]) => ({ id, set, number, name }));
  const mapPath = path.join(OUT, 'pokemon', '_map.json');
  const prev = readJson(mapPath, { cards: {} });
  const today = new Date().toISOString().slice(0, 10);

  // ---- TCGdex: sets, their card lists, pictures --------------------------
  const dxList = await getJson('https://api.tcgdex.net/v2/en/sets');
  const dxSets = [];
  for (const s of dxList) {
    const d = await getJson(`https://api.tcgdex.net/v2/en/sets/${encodeURIComponent(s.id)}`);
    if (d) dxSets.push({ id: d.id, name: d.name, abbr: d.abbreviation && d.abbreviation.official, cards: d.cards || [] });
    await sleep(80);
  }
  const dxSetOf = M.matchTcgdexSets(ourSets, dxSets);
  const dxCards = new Map(dxSets.map((s) => [s.id, s.cards]));

  // ---- tcgcsv: groups and products ---------------------------------------
  const groups = ((await getJson('https://tcgcsv.com/tcgplayer/3/groups')) || {}).results || [];
  const tpGroupOf = M.matchTcgcsvGroups(ourSets, groups);
  const products = new Map();
  for (const gid of new Set(Object.values(tpGroupOf).filter(Boolean))) {
    const j = await getJson(`https://tcgcsv.com/tcgplayer/3/${gid}/products`);
    products.set(gid, ((j && j.results) || [])
      .map((p) => ({ productId: p.productId, number: M.productNumber(p), name: M.productCardName(p) }))
      .filter((p) => p.number));
    await sleep(120);
  }

  // ---- match every card --------------------------------------------------
  // A source card claimed by two of ours (an alternate 'a' print matched by
  // name to the regular one) stays only with the card whose number is its own.
  const claims = (pick) => {
    const by = new Map();
    for (const c of ourCards) {
      const hit = pick(c);
      if (!hit) continue;
      if (!by.has(hit.key)) by.set(hit.key, []);
      by.get(hit.key).push({ c, sameNum: hit.sameNum });
    }
    const keep = new Set();
    for (const list of by.values()) {
      const own = list.length > 1 ? list.filter((x) => x.sameNum) : list;
      if (own.length === 1) keep.add(own[0].c.id);
    }
    return keep;
  };
  const dxHit = (c) => {
    const s = dxSetOf[c.set];
    const h = s ? M.matchCard(c, dxCards.get(s) || []) : null;
    return h ? { h, key: h.id, sameNum: M.normNum(h.localId) === M.normNum(c.number) } : null;
  };
  const tpHit = (c) => {
    const g = tpGroupOf[c.set];
    const h = g ? M.matchCard(c, products.get(g) || [], (p) => p.number) : null;
    return h ? { h, key: h.productId, sameNum: M.normNum(h.number) === M.normNum(c.number) } : null;
  };
  const dxKeep = claims(dxHit);
  const tpKeep = claims(tpHit);

  const cards = {};
  const lookups = [];
  for (const c of ourCards) {
    const old = prev.cards[c.id] || {};
    const e = {};
    const dxh = dxKeep.has(c.id) ? dxHit(c) : null;
    const dx = dxh && dxh.h;
    if (dx) {
      e.dx = dx.id;
      if (dx.image) e.img = dx.image;
      if (old.dx === dx.id && old.cm != null) { e.cm = old.cm; e.cmAt = old.cmAt; }
      const stale = e.cm === 0 && (Date.parse(today) - Date.parse(e.cmAt || '2000-01-01')) / 864e5 > RECHECK_DAYS;
      if (e.cm == null || stale) lookups.push([c.id, dx.id]);
    }
    const tph = tpKeep.has(c.id) ? tpHit(c) : null;
    if (tph) e.tp = tph.h.productId;
    cards[c.id] = e;
  }

  // ---- Cardmarket ids, from TCGdex's card pages (new cards only) --------
  const todo = lookups.slice(0, MAX_LOOKUPS);
  let done = 0;
  const worker = async () => {
    while (todo.length) {
      const [id, dxId] = todo.shift();
      try {
        const d = await getJson(`https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(dxId)}`);
        const cm = d && d.pricing && d.pricing.cardmarket && d.pricing.cardmarket.idProduct;
        cards[id].cm = Number.isInteger(cm) && cm > 0 ? cm : 0;
        cards[id].cmAt = today;
      } catch (e) { /* asked again next run */ }
      if (++done % 1000 === 0) console.log(`  Cardmarket ids: ${done}/${Math.min(lookups.length, MAX_LOOKUPS)}`);
      await sleep(150);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);

  const setsOut = {};
  for (const s of ourSets) setsOut[s.id] = { dx: dxSetOf[s.id] || null, tp: tpGroupOf[s.id] || null };
  fs.mkdirSync(path.dirname(mapPath), { recursive: true });
  fs.writeFileSync(mapPath, JSON.stringify({ built: new Date().toISOString(), catalog: cat.built, sets: setsOut, cards }));

  const n = ourCards.length;
  const count = (f) => Object.values(cards).filter(f).length;
  console.log(`Pokémon map: ${n} cards | TCGdex ${count((e) => e.dx)} | pictures ${count((e) => e.img)} | ` +
    `Cardmarket ${count((e) => e.cm > 0)} | TCGplayer ${count((e) => e.tp)} | lookups this run ${done}, left ${Math.max(0, lookups.length - MAX_LOOKUPS)}`);
  if (REPORT) {
    const noSet = (m) => ourSets.filter((s) => !m[s.id]).map((s) => s.id);
    console.log('sets without TCGdex:', noSet(dxSetOf).join(' ') || '-');
    console.log('sets without TCGplayer:', noSet(tpGroupOf).join(' ') || '-');
    const per = {};
    for (const c of ourCards) {
      const p = (per[c.set] = per[c.set] || [0, 0, 0]);
      p[0]++; if (cards[c.id].dx) p[1]++; if (cards[c.id].tp) p[2]++;
    }
    const weak = Object.entries(per).filter(([, [t, d, tp]]) => d < t * 0.9 || tp < t * 0.9)
      .map(([s, [t, d, tp]]) => `${s} ${d}/${tp}/${t}`);
    console.log('sets under 90% (TCGdex/TCGplayer/total):', weak.join(', ') || '-');
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
