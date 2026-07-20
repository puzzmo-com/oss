import { resolve } from "path"
import { defineConfig } from "vite"

// Second build pass: a self-contained IIFE for script-tag/CDN use. Unlike the main
// lib build, lz-string is bundled so the file has no imports. Exposes window.PuzzmoSDK.
export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "src/global.ts"),
      name: "PuzzmoSDK",
      formats: ["iife"],
      fileName: () => "index.global.js",
    },
    emptyOutDir: false,
    sourcemap: true,
    target: "es2015",
  },
})
