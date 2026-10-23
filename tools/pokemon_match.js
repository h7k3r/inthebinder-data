/**
 * pokemon_match.js - how the app's card ids line up with TCGdex (cards,
 * pictures, Cardmarket ids) and TCGplayer via tcgcsv.com (USD prices).
 * Pure functions only, so tools/test_pokemon_match.js can check them.
 */

/** Lower-case letters and digits only; '&' reads as 'and', accents dropped. */
function normName(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/pokemon/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/** '001' -> '1', 'SV001' -> 'SV1', 'GG01' -> 'GG1', '77a' -> '77A', 'H30' -> 'H30'. */
function normNum(n) {
  const x = String(n == null ? '' : n).trim().toUpperCase().split('/')[0].trim();
  const m = x.match(/^([A-Z]*)0*(\d+)([A-Z]*)$/);
  return m ? `${m[1]}${m[2]}${m[3]}` : x;
}

/**
 * Whether two card names are the same card, allowing the spelling habits of
 * the different databases: 'Empoleon LV.X' / 'Empoleon', 'Zoroark-GX' /
 * 'Zoroark GX', 'Imposter Professor Oak' / 'Impostor Professor Oak'.
 */
function namesCompatible(a, b) {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const strip = (s) => s.replace(/(lvx|gx|ex|v|vmax|vstar|star|delta)$/g, '');
  if (strip(x) === strip(y)) return true;
  if (x.length >= 5 && y.length >= 5 && (x.startsWith(y) || y.startsWith(x))) return true;
  return editDistance(x, y) <= Math.max(1, Math.floor(Math.min(x.length, y.length) / 8));
}

function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

/** Our set id -> the TCGdex set ids it is likely to be ('sv3pt5' -> 'sv03.5', 'sv3.5'). */
function tcgdexIdGuesses(id) {
  const out = [id];
  const m = String(id).match(/^(sv|swsh|sm|xy|bw|me)(\d+)(pt5)?$/);
  if (m) {
    const n = Number(m[2]);
    const half = m[3] ? '.5' : '';
    out.push(`${m[1]}${String(n).padStart(2, '0')}${half}`, `${m[1]}${n}${half}`);
  }
  return out;
}

/** Sets whose TCGdex home is not found by the rules (checked by hand, 23 Oct 2026). */
const TCGDEX_SET_OVERRIDES = {
  me55c: '30th-c',
  swsh45sv: 'swsh4.5',
  cel25c: 'cel25',
  swsh12pt5gg: 'swsh12.5',
  zsv10pt5: 'sv10.5b',
  rsv10pt5: 'sv10.5w',
};

/**
 * ourSets: [{ id, name, code }]; dxSets: [{ id, name, abbr }] ->
 * { ourId: tcgdexId | null }
 */
function matchTcgdexSets(ourSets, dxSets) {
  const byId = new Map(dxSets.map((s) => [s.id, s]));
  const byAbbr = new Map();
  const byName = new Map();
  for (const s of dxSets) {
    const a = s.abbr && String(s.abbr).toUpperCase();
    if (a) byAbbr.set(a, byAbbr.has(a) ? null : s.id);
    const n = normName(s.name);
    byName.set(n, byName.has(n) ? null : s.id);
  }
  const out = {};
  for (const s of ourSets) {
    let hit = TCGDEX_SET_OVERRIDES[s.id] && byId.has(TCGDEX_SET_OVERRIDES[s.id]) ? TCGDEX_SET_OVERRIDES[s.id] : null;
    if (!hit) hit = tcgdexIdGuesses(s.id).find((g) => byId.has(g)) || null;
    if (!hit && s.code) hit = byAbbr.get(String(s.code).toUpperCase()) || null;
    if (!hit) hit = byName.get(normName(s.name)) || null;
    out[s.id] = hit;
  }
  return out;
}

/**
 * One card -> its entry in a list of candidates [{ id, localId|number, name, ... }].
 * The number must match and the name must agree; failing that, a name that is
 * unique in the set (some sets are numbered differently in each database).
 */
function matchCard(card, candidates, numberOf = (c) => c.localId) {
  const num = normNum(card.number);
  const sameNum = candidates.filter((c) => normNum(numberOf(c)) === num);
  const named = sameNum.filter((c) => namesCompatible(card.name, c.name));
  if (named.length === 1) return named[0];
  if (named.length > 1) {
    const exact = named.filter((c) => normName(c.name) === normName(card.name));
    return exact.length >= 1 ? exact[0] : named[0];
  }
  const byName = candidates.filter((c) => normName(c.name) === normName(card.name));
  return byName.length === 1 ? byName[0] : null;
}

/**
 * The names a tcgcsv group could go by: 'SWSH03: Darkness Ablaze' ->
 * 'Darkness Ablaze', 'SM - Burning Shadows' -> 'Burning Shadows',
 * 'EX Unseen Forces' -> 'Unseen Forces'.
 */
function groupNames(name) {
  const n = String(name || '').trim();
  const a = n.replace(/^[A-Z0-9]{1,8}:\s*/, '');
  return [n, a, a.replace(/^(SM|XY)\s*-\s*/, ''), a.replace(/^EX\s+/, '')];
}
const groupBaseName = (name) => groupNames(name)[1];

/** Our sets whose tcgcsv group does not line up by name or code (checked by hand, 23 Oct 2026). */
const TCGCSV_GROUP_OVERRIDES = {
  basep: 'WoTC Promo',
  bp: 'Best of Promos',
  np: 'Nintendo Promos',
  tk1a: 'EX Trainer Kit 1: Latias & Latios',
  tk1b: 'EX Trainer Kit 1: Latias & Latios',
  tk2a: 'EX Trainer Kit 2: Plusle & Minun',
  tk2b: 'EX Trainer Kit 2: Plusle & Minun',
  dpp: 'Diamond and Pearl Promos',
  hsp: 'HGSS Promos',
  bwp: 'Black and White Promos',
  xyp: 'XY Promos',
  sm1: 'SM Base Set',
  smp: 'SM Promos',
  swsh1: 'SWSH01: Sword & Shield Base Set',
  swshp: 'SWSH: Sword & Shield Promo Cards',
  svp: 'SV: Scarlet & Violet Promo Cards',
  mep: 'ME: Mega Evolution Promo',
  mcd11: "McDonald's Promos 2011",
  mcd12: "McDonald's Promos 2012",
  mcd14: "McDonald's Promos 2014",
  mcd15: "McDonald's Promos 2015",
  mcd16: "McDonald's Promos 2016",
  mcd17: "McDonald's Promos 2017",
  mcd18: "McDonald's Promos 2018",
  mcd19: "McDonald's Promos 2019",
  mcd21: "McDonald's 25th Anniversary Promos",
  mcd22: "McDonald's Promos 2022",
  mcd23: "McDonald's Promos 2023",
  mcd24: "McDonald's Promos 2024",
};

/** ourSets: [{ id, name, code }]; groups: tcgcsv results -> { ourId: groupId | null } */
function matchTcgcsvGroups(ourSets, groups) {
  const byFull = new Map();
  const byBase = new Map();
  const byAbbr = new Map();
  const put = (m, k, v) => { if (!k) return; m.set(k, m.has(k) && m.get(k) !== v ? null : v); };
  for (const g of groups) {
    put(byFull, normName(g.name), g.groupId);
    for (const n of new Set(groupNames(g.name).slice(1).map(normName))) put(byBase, n, g.groupId);
    if (g.abbreviation) put(byAbbr, String(g.abbreviation).toUpperCase(), g.groupId);
  }
  const out = {};
  for (const s of ourSets) {
    const o = TCGCSV_GROUP_OVERRIDES[s.id];
    let hit = o ? (byFull.get(normName(o)) || null) : null;
    if (!hit) hit = byFull.get(normName(s.name)) || null;
    if (!hit) hit = byBase.get(normName(s.name)) || null;
    if (!hit) hit = byBase.get(normName(String(s.name).replace(/^(HS|SM|XY|SWSH|SV|ME)\s*[-—]\s*/i, ''))) || null;
    if (!hit && s.code) hit = byAbbr.get(String(s.code).toUpperCase()) || null;
    out[s.id] = hit;
  }
  return out;
}

/** tcgcsv product -> its collector number ('136/189' -> '136'), or null for sealed items. */
function productNumber(p) {
  const e = (p.extendedData || []).find((x) => x && x.name === 'Number');
  return e && e.value ? String(e.value) : null;
}

/** 'Charizard - 4/102 (Shadowless)' -> 'Charizard' */
function productCardName(p) {
  return String(p.name || '').replace(/\s*-\s*[A-Z]*\d+[A-Z]*\/\d+.*$/i, '').replace(/\s*\(.*\)\s*$/, '').trim();
}

/** tcgcsv subTypeName -> the pokemontcg.io price key the app reads. */
const TCGPLAYER_KEY = {
  'Normal': 'normal',
  'Holofoil': 'holofoil',
  'Reverse Holofoil': 'reverseHolofoil',
  '1st Edition Holofoil': '1stEditionHolofoil',
  '1st Edition Normal': '1stEditionNormal',
  'Unlimited Holofoil': 'unlimitedHolofoil',
  '1st Edition': '1stEditionNormal',
  'Unlimited': 'normal',
};

module.exports = {
  normName, normNum, namesCompatible, tcgdexIdGuesses, matchTcgdexSets, matchCard,
  groupBaseName, groupNames, matchTcgcsvGroups, productNumber, productCardName, TCGPLAYER_KEY,
  TCGDEX_SET_OVERRIDES, TCGCSV_GROUP_OVERRIDES,
};
