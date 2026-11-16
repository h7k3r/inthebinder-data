# In the Binder - card data

Card catalogues and daily market prices for the games In the Binder supports
besides Pokémon: One Piece Card Game, Disney Lorcana, Dragon Ball Super Fusion
World, Magic: The Gathering and Yu-Gi-Oh!.

- `tools/build_games.js` builds them from [tcgcsv.com](https://tcgcsv.com), a
  daily public copy of TCGplayer's catalogue and prices.
- The **Card data** workflow runs every morning: it refreshes the prices and,
  on Mondays (or when run by hand with *full*), rebuilds the catalogues and
  publishes them as a release.
- The `data` branch always holds only the latest files (one commit, replaced
  each run), so this repository never grows:
  - `games.json` - every catalogue: counts, download URL, size, SHA-256
  - `<game>-prices.json` - `{ day, currency: "USD", prices: { "<productId>|<finish>": market } }`
  - `pokemon/<setId>.json` - Pokémon prices per set, built once a day by
    `tools/build_pokemon_prices.js` from Cardmarket's public price guide
    (EUR) and tcgcsv.com (TCGplayer USD), in the shape the app has always
    read. pokemontcg.io (deprecated, keys stop 1 March 2027) is only a
    fallback for a set nothing else priced.
  - `pokemon/_map.json` - every card in `pokemon-catalog.json` (the app's own
    English card list, from `tools/export_pokemon_catalog.js`) linked to its
    TCGdex card and picture, Cardmarket product id and TCGplayer product id
    (`tools/build_pokemon_map.js`, weekly; only new cards are looked up).
    TCGdex's card data is MIT licensed (Copyright (c) 2021 TCGdex).
  - `pokemon/images.json` - where each English card's picture lives on
    TCGdex (`tools/build_pokemon_images.js`, daily, from the map): a folder
    and numbering rule per set, plus the cards that differ. Phones use it in
    place of the copy the app shipped with, so a new set's pictures arrive
    with no app update.
  - `barcodes.json` - sealed-product barcodes from TCGplayer's catalogue
    (`tools/build_barcodes.js`, weekly), so the box scanner rarely needs
    Open Products Facts: `{ built, count, items: { "<digits, no leading zeros>": [name, game, set, productId] } }`

The In the Binder app downloads a game's catalogue the first time it is
opened and checks it against `games.json` (size and SHA-256).

## Safety nets (16 Nov 2026)

- **Weekly snapshot.** Because the `data` branch is replaced every run, the
  Card data workflow also saves what it published as a release asset once a
  week (`data-snapshot-YYYYMMDD`, `tools/data_snapshot.sh save`, the 8 newest
  kept). The price history, card map and Hot snapshot are built up over time
  and could not be rebuilt in full, so the next run's "Previous data" step puts
  them back from the newest snapshot if they are ever missing
  (`tools/data_snapshot.sh restore`). A snapshot is refused if it has under
  80% of the previous one's files. Checks: `bash tools/test_data_snapshot.sh`.
- **Set job heartbeat.** The new-sets job on xproto (`tools\update_sets.ps1` in
  binder-tcg) pushes `heartbeat.json` to the `heartbeat` branch after every
  run. The Set job heartbeat workflow checks it daily and opens an issue
  (GitHub emails the owner) when the job has not run, or has only failed, for
  48 hours (`tools/check_heartbeat.js`; checks: `node tools/test_heartbeat.js`).

Card names, numbers and prices belong to their publishers and TCGplayer.
In the Binder is an independent app, not affiliated with any of them.
