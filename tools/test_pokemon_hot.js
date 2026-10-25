#!/usr/bin/env node
// Checks for build_pokemon_hot.js's ranking (node tools/test_pokemon_hot.js).
const assert = require('assert');
const { rank } = require('./build_pokemon_hot');

// 1. Movers: price >= 5, prev >= 3, up >= 5 %, by % then price.
let r = rank([
  { key: 'a', price: 10, prev: 5 },     // +100 %
  { key: 'b', price: 12, prev: 10 },    // +20 %
  { key: 'c', price: 4, prev: 1 },      // too cheap
  { key: 'd', price: 6, prev: 2 },      // prev too low
  { key: 'e', price: 50, prev: 48 },    // +4.2 %, not enough
  { key: 'f', price: 24, prev: 20 },    // +20 %, dearer than b
  { key: 'g', price: 5, prev: 10 },     // -50 %
  { key: 'h', price: 30, prev: 40 },    // -25 %
  { key: 'i', price: 80, prev: 100 },   // -20 %
]);
assert.deepStrictEqual(r.movers.map((x) => x.key), ['a', 'f', 'b']);
assert.strictEqual(r.movers[0].change_pct, 100);
assert.deepStrictEqual(r.fallers.map((x) => x.key), ['g', 'h', 'i']);
assert.ok(!('delta' in r.movers[0]));

// 2. Fewer than 3 real movers: biggest absolute gainers instead.
r = rank([
  { key: 'a', price: 10, prev: 9.8 },
  { key: 'b', price: 3, prev: 1 },
  { key: 'c', price: 100, prev: 99 },
  { key: 'd', price: 2, prev: 2 },
]);
assert.deepStrictEqual(r.movers.map((x) => x.key), ['b', 'c', 'a']);

// 3. Limits and junk.
const many = Array.from({ length: 40 }, (_, i) => ({ key: 'k' + i, price: 10 + i, prev: (10 + i) * 0.8 }));
many.push({ key: 'zero', price: 0, prev: 5 }, { key: 'nan', price: NaN, prev: 5 }, { key: 'spike', price: 500, prev: 10 });
r = rank(many);
assert.strictEqual(r.movers.length, 12);
assert.strictEqual(r.movers[0].key, 'k39');
assert.ok(r.movers.every((m) => !['zero', 'nan', 'spike'].includes(m.key)));
// maxPrice / maxPct options.
r = rank([{ key: 'a', price: 2000, prev: 1500 }, { key: 'b', price: 60, prev: 40 }, { key: 'c', price: 30, prev: 25 }, { key: 'd', price: 9, prev: 8 }], { maxPrice: 1000, maxPct: 40 });
assert.deepStrictEqual(r.movers.map((x) => x.key), ['c', 'd']);

console.log('pokemon hot ranking: all checks passed');
