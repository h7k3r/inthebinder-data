#!/usr/bin/env node
/**
 * test_pokemon_images.js - checks tools/build_pokemon_images.js (the picture
 * table phones download). Runs in the Card data workflow before the table is
 * built.  node tools/test_pokemon_images.js
 */
const { buildTable } = require('./build_pokemon_images');
const { pictureKey } = require('./export_pokemon_catalog');

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
const T = 'https://assets.tcgdex.net/en/';

const catalogue = {
  cards: [
    ['me6-1', 'me6', '1', 'Heracross'],
    ['me6-2', 'me6', '2', 'Surskit'],
    ['me6-116', 'me6', '116', 'Altaria'],
    ['me6-140', 'me6', '140', 'Mega Rayquaza ex'],
    ['base1-4', 'base1', '4', 'Charizard'],
    ['base1-5', 'base1', '5', 'Clefairy'],
    ['cel25c-15_A2', 'cel25c', '15', 'Here Comes Team Rocket!', 'https://images.pokemontcg.io/cel25c/15_B.png'],
    ['cel25c-4_A', 'cel25c', '4', 'Charizard', 'https://images.pokemontcg.io/cel25c/4_A.png'],
    ['zz1-1', 'zz1', '1', 'Nobody'],
  ],
};
const map = {
  built: '2026-11-16T07:00:00Z',
  cards: {
    'me6-1': { img: `${T}me/me06/001` },
    'me6-2': { img: `${T}me/me06/002` },
    'me6-116': { img: `${T}me/me06/116` },
    // me6-140: TCGdex has no picture yet
    'base1-4': { img: `${T}base/base1/4` },
    'base1-5': { img: `${T}base/base1/5` },
    'cel25c-15_A2': { img: `${T}swsh/cel25/15A2` },
    'cel25c-4_A': { img: `${T}swsh/cel25/4A` },
    'zz1-1': { img: 'https://elsewhere.example/zz1/1' },
  },
};

const { sets, except, stats } = buildTable(map, catalogue);
ok(JSON.stringify(sets.me6) === JSON.stringify(['me/me06', 'pad3']), 'a new set gets its folder and numbering rule (Delta Reign: me/me06, 001)');
ok(JSON.stringify(sets.base1) === JSON.stringify(['base/base1', 'same']), 'old sets keep their plain numbers');
ok(except['me6-140'] === 0, 'a card TCGdex has no picture for is marked 0, so the app does not invent one');
ok(!('me6-1' in except) && !('me6-116' in except), 'cards that follow their set\'s rule need no line of their own');
ok(except['cel25c-15_B'] === 'swsh/cel25/15A2', 'an odd card is keyed the way the app reads its picture address');
ok(!sets.zz1, 'pictures that are not on TCGdex are never used');
ok(stats.ruled === 5 && stats.none === 2, `counts (${JSON.stringify(stats)})`);

ok(pictureKey('https://images.pokemontcg.io/sv3pt5/151_hires.png').id === 'sv3pt5-151', 'reads pokemontcg.io addresses like the app');
ok(pictureKey('https://images.scrydex.com/pokemon/me6-1/small').id === 'me6-1', 'reads scrydex addresses like the app');
ok(pictureKey('https://assets.tcgdex.net/en/me/me06/001/low.webp') === null, 'leaves other addresses alone');

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exitCode = fails ? 1 : 0;
