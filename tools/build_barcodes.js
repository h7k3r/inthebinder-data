#!/usr/bin/env node
/**
 * build_barcodes.js - barcodes of sealed products (booster boxes, ETBs,
 * tins, decks) from TCGplayer's catalogue via tcgcsv.com, so the app can
 * name a scanned box without asking UPCitemdb (100 free lookups a day,
 * shared by nobody, and not meant for production apps).
 *
 *   node tools/build_barcodes.js [--out out]
 *
 * Writes <out>/barcodes.json:
 *   { built, count, items: { "<digits>": [name, game, setName, productId] } }
 * game is 'pokemon' or one of the app's other game keys (op, lorcana, ...).
 * Run weekly by the Card data workflow; other days keep the last file.
 * Polite to tcgcsv the same way build_games.js is (custom User-Agent,
 * one request at a time, a pause between requests).
 */
const fs = require('fs');
const path = require('path');

const CATEGORIES = { pokemon: 3, op: 68, lorcana: 71, dbsfw: 80, mtg: 1, ygo: 2 };
const UA = { 'User-Agent': 'InTheBinder/1.0 (+https://inthebinder.com; support@inthebinder.com)' };
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const OUT = outIdx >= 0 ? args[outIdx + 1] : 'out';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: UA });
      if (res.ok) return await res.json();
      if (res.status < 500 && res.status !== 429) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      if (i >= tries) throw e;
    }
    if (i >= tries) throw new Error(`gave up on ${url}`);
    await sleep(2000 * i);
  }
}

const ext = (p, name) => { const e = (p.extendedData || []).find((x) => x.name === name); return e ? String(e.value || '') : ''; };

(async () => {
  const items = {};
  let groupsDone = 0, failed = 0;
  for (const [game, cat] of Object.entries(CATEGORIES)) {
    let groups = [];
    try { groups = (await get(`https://tcgcsv.com/tcgplayer/${cat}/groups`)).results || []; } catch (e) { failed++; continue; }
    for (const g of groups) {
      await sleep(120);
      let products;
      try { products = (await get(`https://tcgcsv.com/tcgplayer/${cat}/${g.groupId}/products`)).results || []; } catch (e) { failed++; continue; }
      groupsDone++;
      for (const p of products) {
        if (ext(p, 'Number')) continue;               // a single card, not sealed
        // Keyed without leading zeros: a UPC-A and its EAN-13 form ("0" + UPC)
        // are the same product, and the app normalises a scan the same way.
        const digits = ext(p, 'UPC').replace(/\D/g, '');
        if (digits.length < 8 || digits.length > 14) continue;
        const upc = digits.replace(/^0+/, '');
        const name = String(p.name || '').slice(0, 160);
        const had = items[upc];
        if (!had) { items[upc] = [name, game, String(g.name || '').slice(0, 120), p.productId]; continue; }
        // One barcode, several listings (e.g. "Sticker Collection [Lucario]" and
        // "[Set of 2]"): keep the shared part of the name and no single price.
        const base = (s) => s.replace(/\s*\[[^\]]*\]\s*$/, '').trim();
        if (had[0] !== name) { if (base(had[0]) === base(name)) had[0] = base(name); had[3] = null; }
      }
    }
    console.log(`${game}: ${groups.length} sets read, ${Object.keys(items).length} barcodes so far`);
  }
  const count = Object.keys(items).length;
  if (count < 100) { console.log(`only ${count} barcodes - keeping the previous file`); process.exitCode = 1; return; }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'barcodes.json'), JSON.stringify({ built: new Date().toISOString(), count, items }));
  console.log(`barcodes.json: ${count} sealed products (${groupsDone} sets, ${failed} failed requests)`);
})().catch((e) => { console.error(e); process.exitCode = 1; });
