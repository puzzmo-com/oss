import { defineConfig } from "vite"
import { puzzmoSimulator, appBundlePlugin } from "@puzzmo/sdk/vite"

export default defineConfig({
  base: "./",
  plugins: [puzzmoSimulator({ fixturesGlob: "/fixtures/puzzles/**/*.json" }), appBundlePlugin()],
  build: {
    outDir: "dist",
    assetsDir: "assets",
  },
})
