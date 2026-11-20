#!/usr/bin/env node
/**
 * build_pokemon_sealed.js - every sealed Pokémon product TCGplayer lists
 * (English and Japanese), with what kind of box it is and today's price, so
 * the app's Sealed tab can find an Elite Trainer Box by name, add it without
 * a barcode and give it a value (20 Nov 2026).
 *
 *   node tools/build_pokemon_sealed.js [--out out]
 *
 * Writes <out>/pokemon-sealed.json:
 *   { built, currency: 'USD', count,
 *     items: [[productId, name, setName, type, lang, price|null, 'YYYY-MM'], ...] }
 * newest set first. type is one of TYPES below; lang is 'EN' or 'JP'.
 * Same source and manners as build_games.js / build_barcodes.js: tcgcsv.com,
 * custom User-Agent, one request at a time with a pause.
 */
const fs = require('fs');
const path = require('path');

const CATEGORIES = [[3, 'EN'], [85, 'JP']];
const UA = { 'User-Agent': 'InTheBinder/1.0 (+https://inthebinder.com; support@inthebinder.com)' };
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const OUT = outIdx >= 0 ? args[outIdx + 1] : 'out';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** First match wins, so the specific kinds come before the general ones. */
const TYPES = [
  [/pok[eé]mon cent(er|re) elite trainer box|\bpc etb\b/i, 'Pokémon Center ETB'],
  [/\b(case|display)\b/i, 'Case / Display'],
  [/elite trainer box/i, 'Elite Trainer Box'],
  [/booster box/i, 'Booster Box'],
  [/booster bundle/i, 'Booster Bundle'],
  [/\bpromo\b|classic collection pack/i, 'Promo Pack'],
  [/blister|checklane/i, 'Blister Pack'],
  [/booster pack|sleeved booster|\bpack\b/i, 'Booster Pack'],
  [/mini tin/i, 'Mini Tin'],
  [/\btin\b/i, 'Collector Tin'],
  [/ultra.?premium/i, 'Ultra-Premium Collection'],
  [/build (&|and) battle/i, 'Build & Battle Box'],
  [/battle deck|theme deck|starter (deck|set)|league battle deck|deck\b/i, 'Theme Deck'],
  [/collection|box\b|gift set/i, 'Premium Collection'],
];
const typeOf = (name) => { for (const [re, t] of TYPES) if (re.test(name)) return t; return 'Sealed Product'; };
// Not sealed product at all, even without a card number.
const SKIP = /code card|jumbo|oversized|\bsleeves?\b|deck box|playmat|card sleeves|storage/i;

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
  const items = [];
  let failed = 0;
  for (const [cat, lang] of CATEGORIES) {
    let groups = [];
    try { groups = (await get(`https://tcgcsv.com/tcgplayer/${cat}/groups`)).results || []; } catch (e) { failed++; continue; }
    for (const g of groups) {
      await sleep(120);
      let products;
      try { products = (await get(`https://tcgcsv.com/tcgplayer/${cat}/${g.groupId}/products`)).results || []; } catch (e) { failed++; continue; }
      const sealed = products.filter((p) => !ext(p, 'Number') && p.name && !SKIP.test(p.name));
      if (!sealed.length) continue;
      const price = new Map();
      await sleep(120);
      try {
        for (const r of (await get(`https://tcgcsv.com/tcgplayer/${cat}/${g.groupId}/prices`)).results || []) {
          const v = r.marketPrice != null ? r.marketPrice : r.midPrice;
          if (v == null) continue;
          if (!price.has(r.productId) || r.subTypeName === 'Normal') price.set(r.productId, Math.round(v * 100) / 100);
        }
      } catch (e) { failed++; }
      const ym = String(g.publishedOn || '').slice(0, 7);
      for (const p of sealed) {
        const name = String(p.name).replace(/\s+/g, ' ').trim().slice(0, 160);
        items.push([p.productId, name, String(g.name || '').slice(0, 100), typeOf(name), lang, price.get(p.productId) ?? null, ym]);
      }
    }
    console.log(`${lang}: ${groups.length} sets read, ${items.length} sealed products so far`);
  }
  if (items.length < 500) { console.log(`only ${items.length} products - keeping the previous file`); process.exitCode = 1; return; }
  items.sort((a, b) => String(b[6]).localeCompare(String(a[6])) || a[1].localeCompare(b[1]));
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'pokemon-sealed.json'), JSON.stringify({ built: new Date().toISOString(), currency: 'USD', count: items.length, items }));
  console.log(`pokemon-sealed.json: ${items.length} products (${failed} failed requests)`);
})().catch((e) => { console.error(e); process.exitCode = 1; });
