#!/usr/bin/env node
// node tools/test_pokemon_sealed_cm.js - TCGplayer sealed names to Cardmarket products (28 Nov 2026).
const { indexCm, matchCm } = require('./pokemon_sealed_cm_match');

const cm = indexCm([
  { idProduct: 1, name: 'Delta Reign Booster Box', categoryName: 'Pokémon Display' },
  { idProduct: 2, name: 'Delta Reign Booster Box (18 Boosters)', categoryName: 'Pokémon Display' },
  { idProduct: 3, name: 'Delta Reign 6 Booster Box Case', categoryName: 'Pokémon Display' },
  { idProduct: 4, name: 'Delta Reign Elite Trainer Box', categoryName: 'Pokémon Elite Trainer Boxes' },
  { idProduct: 5, name: 'Delta Reign Pokémon Center Elite Trainer Box', categoryName: 'Pokémon Elite Trainer Boxes' },
  { idProduct: 6, name: '30th Celebration: Umbreon ex Ultra-Premium Collection', categoryName: 'Pokémon Box Set' },
  { idProduct: 7, name: '30th Celebration: Espeon ex Ultra-Premium Collection', categoryName: 'Pokémon Box Set' },
  { idProduct: 8, name: '30th Celebration Booster Bundle', categoryName: 'Pokémon Display' },
  { idProduct: 9, name: 'Scarlet & Violet Booster Box', categoryName: 'Pokémon Display' },
  { idProduct: 10, name: 'Scarlet & Violet 151 Booster Box', categoryName: 'Pokémon Display' },
  { idProduct: 11, name: 'Temporal Forces Walking Wake Pokémon Center Elite Trainer Box', categoryName: 'Pokémon Elite Trainer Boxes' },
  { idProduct: 12, name: 'Temporal Forces Iron Leaves Pokémon Center Elite Trainer Box', categoryName: 'Pokémon Elite Trainer Boxes' },
  { idProduct: 13, name: '30th Celebration JP Booster Box', categoryName: 'Pokémon Display' },
  { idProduct: 14, name: 'Delta Reign: Mega Rayquaza Coin', categoryName: 'Pokémon Coins' },
]);
const cases = [
  ['Delta Reign Booster Box', 'ME06: Delta Reign', 1],
  ['Delta Reign Half Booster Box', 'ME06: Delta Reign', 2],
  ['Delta Reign Booster Box Case', 'ME06: Delta Reign', 3],
  ['Delta Reign Elite Trainer Box', 'ME06: Delta Reign', 4],
  ['Delta Reign Pokemon Center Elite Trainer Box (Exclusive)', 'ME06: Delta Reign', 5],
  ['30th Celebration Ultra-Premium Collection [Night]', 'ME: 30th Celebration', 6],
  ['30th Celebration Ultra-Premium Collection [Day]', 'ME: 30th Celebration', 7],
  ['30th Celebration Booster Bundle', 'ME: 30th Celebration', 8],
  ['Costco Pokemon 30th Celebration 2-Pack Trainer Box and Booster Bundle', 'ME: 30th Celebration', null],
  ['Scarlet & Violet Booster Box', 'SV01: Scarlet & Violet Base Set', 9],
  ['Scarlet & Violet 151 Booster Box', 'SV: Scarlet & Violet 151', 10],
  ['Temporal Forces Pokemon Center Elite Trainer Box (Exclusive) [Walking Wake]', 'SV05: Temporal Forces', 11],
  ['Temporal Forces Pokemon Center Elite Trainer Box (Exclusive) [Iron Leaves]', 'SV05: Temporal Forces', 12],
  ['Temporal Forces Pokemon Center Elite Trainer Box (Exclusive)', 'SV05: Temporal Forces', null],
  ['Twilight Masquerade Booster Box', 'SV06: Twilight Masquerade', null],
];
let fail = 0;
for (const [name, set, want] of cases) {
  const got = matchCm(cm, name, set);
  const id = got ? got.id : null;
  if (id !== want) { fail++; console.log('FAIL', name, 'got', id, got && got.name, 'want', want); }
}
console.log(`${cases.length - fail}/${cases.length} sealed Cardmarket matches`);
if (fail) process.exit(1);
