# **DISPLAY_NAME**

A Minesweeper-style Puzzmo game scaffold.

## Develop

```
yarn install   # or npm/pnpm
yarn dev       # opens the Puzzmo simulator
yarn build
```

Edit puzzles in `fixtures/puzzles/`. Game logic is in `src/main.ts`.

## Deployment

```
puzzmo login <your-token>   # token from dev.puzzmo.com
yarn deploy                 # builds, then uploads to Puzzmo
yarn deploy:only            # uploads the current dist/
```
