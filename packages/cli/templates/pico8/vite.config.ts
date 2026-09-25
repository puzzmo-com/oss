import { defineConfig } from "vite"
import { puzzmoSimulator, puzzmoPico8 } from "@puzzmo/sdk/vite"

export default defineConfig({
  base: "./",
  plugins: [
    // Builds the page from PICO-8's export of cart/game.p8, and re-exports it when you save in PICO-8
    puzzmoPico8(),
    puzzmoSimulator({ fixturesGlob: "/fixtures/puzzles/**/*.txt" }),
  ],
})
