#!/usr/bin/env node
/**
 * build_pokemon_sealed_history.js - what every sealed Pokémon product (the
 * boxes in pokemon-sealed.json, English and Japanese) has been worth, week by
 * week since 8 Feb 2024, for the price chart on the app's box screen
 * (20 Nov 2026). Same source and step as build_pokemon_history.js.
 *
 *   node tools/build_pokemon_sealed_history.js --out out --backfill [--cache dir]
 *       reads tcgcsv's weekly archives (needs 7z), categories 3 and 85
 *   node tools/build_pokemon_sealed_history.js --out out
 *       the top-up: when the newest week is 7+ days old, adds today's prices
 *       from <out>/pokemon-sealed.json (built just before in the same run)
 *
 * Writes <out>/pokemon/sealed-history/<bucket>.json, bucket = productId % 64:
 *   { step: 7, days: ["YYYY-MM-DD", ...], items: { "<productId>": [price|null, ...] } }
 * USD, TCGplayer market (else mid), 2 decimals. Products never priced are left out.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const OUT = opt('--out', 'out');
const BACKFILL = args.includes('--backfill');
const CACHE = opt('--cache', path.join(os.tmpdir(), 'tcgcsv-archive'));
const FROM = opt('--from', '2024-02-08');
const STEP = 7;
const BUCKETS = 64;
const CATS = ['3', '85'];
const UA = { 'User-Agent': 'InTheBinder/1.18 (+https://inthebinder.com; support@inthebinder.com)' };
const DIR = path.join(OUT, 'pokemon', 'sealed-history');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ymd = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
function readJson(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; } }
const price = (r) => {
  const v = typeof r.marketPrice === 'number' ? r.marketPrice : typeof r.midPrice === 'number' ? r.midPrice : null;
  return v != null && Number.isFinite(v) && v > 0 && v < 1e6 ? Math.round(v * 100) / 100 : null;
};

function sealedIds() {
  const j = readJson(path.join(OUT, 'pokemon-sealed.json'), null);
  if (!j || !Array.isArray(j.items)) throw new Error('needs <out>/pokemon-sealed.json (build_pokemon_sealed.js)');
  return new Set(j.items.map((r) => r[0]));
}

function sevenZip() {
  for (const c of ['7z', '7za', 'C:\\Program Files\\7-Zip\\7z.exe']) {
    try { execFileSync(c, ['i'], { stdio: 'ignore' }); return c; } catch (e) { /* next */ }
  }
  throw new Error('7z not found (apt install p7zip-full, or 7-Zip on Windows)');
}

// tcgcsv answers 429 when archives are fetched too fast (seen 20 Nov 2026),
// so wait between downloads and back off for longer on a 429.
async function download(url, file) {
  for (let i = 1; i <= 6; i++) {
    try {
      const res = await fetch(url, { headers: UA });
      if (res.status === 404) return false;
      if (res.status === 429) {
        const wait = Number(res.headers.get('retry-after')) || 30 * i;
        console.log(`  rate limited, waiting ${wait}s`);
        await sleep(wait * 1000);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      await sleep(1500);
      return true;
    } catch (e) {
      if (i === 6) throw e;
      await sleep(3000 * i);
    }
  }
  return false;
}

/** All tables as one { days, items } (items: pid -> array aligned with days). */
function loadAll() {
  const t = { days: [], items: {} };
  if (!fs.existsSync(DIR)) return t;
  for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.json'))) {
    const j = readJson(path.join(DIR, f), null);
    if (!j || !Array.isArray(j.days)) continue;
    if (j.days.length > t.days.length) t.days = j.days;
    Object.assign(t.items, j.items || {});
  }
  return t;
}

function writeAll(t) {
  fs.mkdirSync(DIR, { recursive: true });
  const buckets = Array.from({ length: BUCKETS }, () => ({}));
  let n = 0;
  for (const [pid, arr] of Object.entries(t.items)) {
    while (arr.length < t.days.length) arr.push(null);
    if (!arr.some((x) => x != null)) continue;
    buckets[Number(pid) % BUCKETS][pid] = arr;
    n++;
  }
  buckets.forEach((items, b) => fs.writeFileSync(path.join(DIR, `${b}.json`), JSON.stringify({ step: STEP, days: t.days, items })));
  return n;
}

function addDay(t, day, prices) {
  t.days.push(day);
  const i = t.days.length - 1;
  for (const [pid, v] of prices) {
    if (!t.items[pid]) t.items[pid] = [];
    const arr = t.items[pid];
    while (arr.length < i) arr.push(null);
    arr.push(v);
  }
}

async function backfill() {
  const z = sevenZip();
  const ids = sealedIds();
  fs.mkdirSync(CACHE, { recursive: true });
  const t = { days: [], items: {} };
  const today = ymd(new Date());
  for (let day = FROM; day <= today; day = addDays(day, STEP)) {
    const file = path.join(CACHE, `prices-${day}.ppmd.7z`);
    let have = fs.existsSync(file) && fs.statSync(file).size > 0;
    if (!have) have = await download(`https://tcgcsv.com/archive/tcgplayer/prices-${day}.ppmd.7z`, file).catch(() => false);
    if (!have) { console.log(`${day}: no archive`); continue; }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tcgs-'));
    const prices = new Map();
    try {
      const inc = CATS.map((c) => `-ir!${day}${path.sep}${c}${path.sep}*`);
      execFileSync(z, ['x', file, `-o${tmp}`, ...inc, '-y'], { stdio: 'ignore' });
      for (const c of CATS) {
        const base = path.join(tmp, day, c);
        for (const g of fs.existsSync(base) ? fs.readdirSync(base) : []) {
          const j = readJson(path.join(base, g, 'prices'), null);
          for (const r of (j && j.results) || []) {
            if (!ids.has(r.productId) || prices.has(r.productId)) continue;
            const v = price(r);
            if (v != null) prices.set(r.productId, v);
          }
        }
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    addDay(t, day, prices);
    console.log(`${day}: ${prices.size} sealed prices`);
  }
  console.log(`Sealed history: ${writeAll(t)} products, ${t.days.length} weeks`);
}

function topUp() {
  const t = loadAll();
  if (!t.days.length) { console.log('No sealed history yet: run with --backfill once.'); return; }
  const today = ymd(new Date());
  const last = t.days[t.days.length - 1];
  if (addDays(last, STEP) > today) { console.log('Sealed history is up to date.'); return; }
  const j = readJson(path.join(OUT, 'pokemon-sealed.json'), null);
  const prices = new Map(((j && j.items) || []).filter((r) => typeof r[5] === 'number').map((r) => [r[0], r[5]]));
  if (prices.size < 500) { console.log(`Only ${prices.size} prices today: sealed history left as it was.`); return; }
  addDay(t, today, prices);
  console.log(`Sealed history: ${writeAll(t)} products, newest week ${today}`);
}

(async () => { if (BACKFILL) await backfill(); else topUp(); })().catch((e) => { console.error(e); process.exitCode = 1; });
