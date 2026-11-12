import { defineConfig } from "vite"
import { resolve } from "path"

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: resolve(import.meta.dirname, "src/index.ts"),
        contracts: resolve(import.meta.dirname, "src/contracts.ts"),
        bundles: resolve(import.meta.dirname, "src/bundles.ts"),
        "inputs/index": resolve(import.meta.dirname, "src/inputs/index.ts"),
        "simulator/index": resolve(import.meta.dirname, "src/simulator/index.ts"),
        "simulator/standalone": resolve(import.meta.dirname, "src/simulator/standalone.ts"),
        fonts: resolve(import.meta.dirname, "src/fonts.ts"),
        svgJSX: resolve(import.meta.dirname, "src/svgJSX.ts"),
        "pico8/index": resolve(import.meta.dirname, "src/pico8/index.ts"),
        vite: resolve(import.meta.dirname, "src/vite.ts"),
        thumbnailMotion: resolve(import.meta.dirname, "src/thumbnailMotion.ts"),
      },
      formats: ["es", "cjs"],
      fileName: (format, entryName) => {
        const ext = format === "es" ? "js" : "cjs"
        return `${entryName}.${ext}`
      },
    },
    rolldownOptions: {
      external: ["vite", "lz-string", "path", "fs", "child_process"],
      output: {
        globals: {},
      },
    },
    sourcemap: true,
    target: "es2015",
  },
})
