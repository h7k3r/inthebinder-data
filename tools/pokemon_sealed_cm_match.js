/**
 * pokemon_sealed_cm_match.js - which Cardmarket product is this TCGplayer
 * sealed product (28 Nov 2026)? Used by build_pokemon_sealed_cm.js and its test.
 *
 * Cardmarket's own catalogue (products_nonsingles_6.json) names a box
 * "Delta Reign Booster Box", "Delta Reign Booster Box (18 Boosters)",
 * "30th Celebration: Umbreon ex Ultra-Premium Collection". Ours (TCGplayer)
 * says "Delta Reign Booster Box", "Delta Reign Half Booster Box",
 * "30th Celebration Ultra-Premium Collection [Night]". A match needs the same
 * kind of box, the set's words, every telling word of our name and at most two
 * extra words on Cardmarket's side; a tie or a shop's own bundle is no match.
 */
function canon(s) {
  return ` ${String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, '').replace(/&/g, ' and ')
    .replace(/ultra[\s-]*premium/g, 'ultra premium')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\betbs?\b/g, 'elite trainer box')
    .replace(/\bupcs?\b/g, 'ultra premium collection')
    .replace(/\bcentre\b/g, 'center')
    .replace(/\bpc\b/g, 'pokemon center')
    .replace(/\b(\d+) boosters\b/g, '$1 packs')
    .replace(/\s+/g, ' ').trim()} `;
}
const has = (t, p) => t.includes(` ${p} `);
const KIND = [
  ['case', (t) => has(t, 'case')],
  ['half', (t) => has(t, 'half booster box') || (has(t, 'booster box') && has(t, '18 packs'))],
  ['pcetb', (t) => has(t, 'pokemon center') && has(t, 'elite trainer box')],
  ['etb', (t) => has(t, 'elite trainer box')],
  ['upc', (t) => has(t, 'ultra premium collection')],
  ['box', (t) => has(t, 'booster box') || has(t, 'booster display')],
  ['bundle', (t) => has(t, 'booster bundle')],
  ['blister', (t) => has(t, 'blister') || has(t, 'checklane')],
  ['minitin', (t) => has(t, 'mini tin')],
  ['tin', (t) => /\btins?\b/.test(t)],
  ['bb', (t) => has(t, 'build and battle')],
  ['deck', (t) => /\bdecks?\b/.test(t)],
  ['pack', (t) => /\b(booster|pack|sleeved booster)\b/.test(t) && !/\b(collection|box)\b/.test(t)],
];
const kindOf = (t) => (KIND.find(([, f]) => f(t)) || ['other'])[0];
const STOP = new Set(['pokemon', 'tcg', 'the', 'and', 'of', 'exclusive', 'english', 'ex', 'collection', 'box', 'booster', 'elite', 'trainer', 'center', 'ultra', 'premium', 'half', 'bundle', 'case', 'display', 'packs', 'pack', '18', '36', 'version', 'set', 'boosters']);
const words = (t) => t.trim().split(' ').filter((w) => w.length >= 2 && !STOP.has(w));
// Names the two catalogues write differently.
const ALIAS = { night: ['umbreon'], day: ['espeon'] };
const SHOP = /\b(costco|walmart|target|gamestop|sams club|bjs|best buy|meijer|kmart|big w|smyths|argos|toys r us|barnes)\b/;
const OTHER_LANG = /\b(jp|japanese|korean|chinese|thai|indonesian|german|french|italian|spanish|portuguese)\b/;

/** Cardmarket's non-singles, ready for matching (coins and card sets left out). */
function indexCm(products) {
  return (products || [])
    .filter((p) => p && p.name && !/coin|pcg set|lot/i.test(p.categoryName || ''))
    .map((p) => { const t = canon(p.name); return { id: p.idProduct, name: p.name, t, k: kindOf(t), w: new Set(words(t)) }; });
}

/** The Cardmarket product for one of ours, or null. */
function matchCm(idx, name, set) {
  const t = canon(name);
  if (SHOP.test(t) || OTHER_LANG.test(t)) return null;
  const k = kindOf(t);
  const mine = words(t);
  if (!mine.length) return null;
  const want = new Set(mine.flatMap((w) => [w, ...(ALIAS[w] || [])]));
  const setW = canon(String(set || '').replace(/^[^:]{1,12}:\s*/, '')).replace(/\bbase set\b/, '').trim();
  const realSet = setW && !/miscellaneous|promo|trainer kits|deck exclusives|black star/.test(setW);
  let best = null;
  for (const c of idx) {
    if (c.k !== k || OTHER_LANG.test(c.t) || SHOP.test(c.t)) continue;
    if (realSet && !c.t.includes(` ${setW} `)) continue;
    if ([...c.w].some((w) => /^\d+$/.test(w) && !mine.includes(w))) continue;
    const hit = mine.filter((w) => c.w.has(w) || (ALIAS[w] || []).some((a) => c.w.has(a))).length;
    if (hit < mine.length) continue;                       // every telling word of ours
    const extra = [...c.w].filter((w) => !want.has(w)).length;
    if (extra > 2) continue;
    if (!best || extra < best.extra) best = { c, extra, tie: false };
    else if (extra === best.extra) best.tie = true;
  }
  return best && !best.tie ? best.c : null;
}

module.exports = { canon, kindOf, indexCm, matchCm };
