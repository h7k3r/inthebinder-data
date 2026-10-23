#!/usr/bin/env node
// node tools/test_pokemon_match.js - checks the matching rules and price shapes offline.
const assert = require('assert');
const M = require('./pokemon_match');
const { cardmarketPrices, tcgplayerPrices } = require('./build_pokemon_prices');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };

t('numbers', () => {
  assert.strictEqual(M.normNum('001'), '1');
  assert.strictEqual(M.normNum('SV001'), 'SV1');
  assert.strictEqual(M.normNum('GG01'), 'GG1');
  assert.strictEqual(M.normNum('77a'), '77A');
  assert.strictEqual(M.normNum('136/189'), '136');
  assert.strictEqual(M.normNum('H30'), 'H30');
});

t('names', () => {
  assert(M.namesCompatible('Empoleon LV.X', 'Empoleon'));
  assert(M.namesCompatible('Zoroark-GX', 'Zoroark GX'));
  assert(M.namesCompatible('Imposter Professor Oak', 'Impostor Professor Oak'));
  assert(M.namesCompatible("Boss's Orders", "Boss's Orders (Giovanni)"));
  assert(M.namesCompatible('Pokémon Center Lady', 'Pokemon Center Lady'));
  assert(!M.namesCompatible('Blastoise', 'Reshiram'));
  assert(!M.namesCompatible('Pikachu', 'Raichu'));
});

t('set ids', () => {
  assert.deepStrictEqual(M.tcgdexIdGuesses('sv3pt5'), ['sv3pt5', 'sv03.5', 'sv3.5']);
  const m = M.matchTcgdexSets(
    [{ id: 'sv1', name: 'Scarlet & Violet', code: 'SVI' }, { id: 'swsh3', name: 'Darkness Ablaze' }, { id: 'me55c', name: '30th Celebration: Classic Collection' }, { id: 'zzz', name: 'Nope' }],
    [{ id: 'sv01', name: 'Scarlet & Violet', abbr: 'SVI' }, { id: 'swsh3', name: 'Darkness Ablaze' }, { id: '30th-c', name: '30th Classic Collection' }]
  );
  assert.deepStrictEqual(m, { sv1: 'sv01', swsh3: 'swsh3', me55c: '30th-c', zzz: null });
});

t('cards: number + name, name fallback, wrong name refused', () => {
  const cands = [{ id: 'cel25-2', localId: '2', name: 'Reshiram' }, { id: 'x-58', localId: '058', name: 'Pikachu' }];
  assert.strictEqual(M.matchCard({ number: '2', name: 'Blastoise' }, cands), null);
  assert.strictEqual(M.matchCard({ number: '58', name: 'Pikachu' }, cands).id, 'x-58');
  assert.strictEqual(M.matchCard({ number: '4', name: 'Reshiram' }, cands).id, 'cel25-2');
});

t('tcgcsv groups', () => {
  const groups = [
    { groupId: 1, name: 'SWSH03: Darkness Ablaze', abbreviation: 'SWSH03' },
    { groupId: 2, name: 'SM - Burning Shadows', abbreviation: 'SM03' },
    { groupId: 3, name: 'EX Unseen Forces', abbreviation: 'UF' },
    { groupId: 4, name: 'SWSH: Crown Zenith: Galarian Gallery', abbreviation: 'CRZ:GG' },
    { groupId: 5, name: 'SM Promos', abbreviation: 'SMP' },
    { groupId: 6, name: 'XY Promos', abbreviation: 'PR' },
    { groupId: 7, name: 'Black and White Promos', abbreviation: 'PR' },
  ];
  const m = M.matchTcgcsvGroups([
    { id: 'swsh3', name: 'Darkness Ablaze' }, { id: 'sm3', name: 'Burning Shadows' }, { id: 'ex10', name: 'Unseen Forces' },
    { id: 'swsh12pt5gg', name: 'Crown Zenith Galarian Gallery' }, { id: 'smp', name: 'SM Black Star Promos' },
    { id: 'basep', name: 'Wizards Black Star Promos', code: 'PR' },
  ], groups);
  assert.deepStrictEqual(m, { swsh3: 1, sm3: 2, ex10: 3, swsh12pt5gg: 4, smp: 5, basep: null });
});

t('tcgcsv products', () => {
  const p = { name: 'Charizard - 4/102 (Shadowless)', extendedData: [{ name: 'Number', value: '4/102' }] };
  assert.strictEqual(M.productNumber(p), '4/102');
  assert.strictEqual(M.productCardName(p), 'Charizard');
  assert.strictEqual(M.productNumber({ name: 'Booster Box', extendedData: [] }), null);
});

t('price shapes match what the app reads', () => {
  const cm = cardmarketPrices({ idProduct: 1, avg: 0.07, low: 0.02, trend: 0.05, avg1: 0.15, avg7: 0.06, avg30: 0.06, 'avg-holo': null, 'trend-holo': 0.25 });
  assert.deepStrictEqual(cm, { averageSellPrice: 0.07, lowPrice: 0.02, trendPrice: 0.05, avg1: 0.15, avg7: 0.06, avg30: 0.06, reverseHoloTrend: 0.25 });
  const tp = tcgplayerPrices([
    { subTypeName: 'Normal', lowPrice: 1, midPrice: 2, highPrice: 3, marketPrice: 1.5, directLowPrice: null },
    { subTypeName: 'Reverse Holofoil', lowPrice: 2, midPrice: null, highPrice: 9, marketPrice: 4 },
    { subTypeName: 'Weird', marketPrice: 1 },
  ]);
  assert.deepStrictEqual(tp, { normal: { low: 1, mid: 2, high: 3, market: 1.5 }, reverseHolofoil: { low: 2, high: 9, market: 4 } });
  assert.strictEqual(tcgplayerPrices([]), undefined);
});

console.log(`${n} groups of checks passed`);
