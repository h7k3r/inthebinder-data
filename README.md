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

The In the Binder app downloads a game's catalogue the first time it is
opened and checks it against `games.json` (size and SHA-256).

Card names, numbers and prices belong to their publishers and TCGplayer.
In the Binder is an independent app, not affiliated with any of them.
