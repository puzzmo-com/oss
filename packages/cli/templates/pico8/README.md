# __DISPLAY_NAME__

A Puzzmo game written as a PICO-8 cart. The whole game is in `cart/game.p8`, and `puzzmo.lua` connects it to Puzzmo
over PICO-8's GPIO bytes.

## Develop

You need [PICO-8](https://www.lexaloffle.com/pico-8.php) to make changes to the cart.

```
yarn install   # or npm/pnpm
yarn dev       # opens the Puzzmo simulator
```

Open `cart/game.p8` in PICO-8 and edit away. Each time you save, the dev server re-exports the cart and reloads the
page. It looks for `pico8` on your PATH, then in the usual install locations; set `PICO8=/path/to/pico8` if yours
lives somewhere else.

HTML exports need a label: run the cart in PICO-8, press CTRL-7, and save.

Commit `export/`. It's the exported cart, and it means building the game doesn't need PICO-8.

## How it fits together

- `cart/game.p8` is the game. It starts with `#include puzzmo.lua`, calls `pz_init()` in `_init` and `pz_update()`
  at the top of `_update60`, and gets the puzzle from `pz.puzzle`.
- `cart/puzzmo.lua` connects the cart to Puzzmo. The dev server keeps it up to date, so don't edit it. The comment
  at the top lists everything it gives you.
- `src/main.ts` hands the cart the puzzle and passes on what the cart saves. You shouldn't need to change it.
- `fixtures/puzzles/` holds the puzzles the simulator can load.

## Bringing over a cart you already have

Replace `cart/game.p8` with your cart (keep the name, or pass `cart` to `puzzmoPico8()` in `vite.config.ts`), then:

1. Add `#include puzzmo.lua` at the top of its code.
2. Call `pz_init()` in `_init`, and `pz_update()` first thing in `_update` or `_update60`.
3. Wait for `pz.ready` before starting, then build the level from `pz.puzzle`.
4. Only take input while `pz.started` is true and `pz.paused` is false.
5. Call `pz_save(str)` after each move, and read it back from `pz.progress` when the player returns.
6. Call `pz_complete(points, str)` when the puzzle is solved, and `pz_finished()` when your victory animation is done.

## Deployment

```
puzzmo login <your-token>   # token from workshop.puzzmo.com
yarn deploy                 # builds, then uploads to Puzzmo
yarn deploy:only            # uploads the current dist/
```
