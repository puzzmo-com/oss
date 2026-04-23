import { defineConfig } from "vite"
import { resolve } from "path"

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, "src/index.ts"),
        "inputs/index": resolve(__dirname, "src/inputs/index.ts"),
        "simulator/index": resolve(__dirname, "src/simulator/index.ts"),
        "simulator/standalone": resolve(__dirname, "src/simulator/standalone.ts"),
        fonts: resolve(__dirname, "src/fonts.ts"),
        vite: resolve(__dirname, "src/vite.ts"),
      },
      formats: ["es", "cjs"],
      fileName: (format, entryName) => {
        const ext = format === "es" ? "js" : "cjs"
        return `${entryName}.${ext}`
      },
    },
    rolldownOptions: {
      external: ["vite", "lz-string"],
      output: {
        globals: {},
      },
    },
    sourcemap: true,
    target: "es2015",
  },
})
