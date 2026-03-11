import { defineConfig } from "vite"
import { resolve } from "path"

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, "src/index.ts"),
        "simulator/index": resolve(__dirname, "src/simulator/index.ts"),
        "simulator/standalone": resolve(__dirname, "src/simulator/standalone.ts"),
        vite: resolve(__dirname, "src/vite.ts"),
      },
      formats: ["es", "cjs"],
      fileName: (format, entryName) => {
        const ext = format === "es" ? "js" : "cjs"
        return `${entryName}.${ext}`
      },
    },
    rollupOptions: {
      external: ["vite"],
      output: {
        globals: {},
      },
    },
    sourcemap: true,
    target: "es2015",
  },
})
