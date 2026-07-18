import { defineConfig } from "vitest/config"

// Only run TypeScript sources; the build compiles into lib/ and we must not
// re-run the compiled .test.js copies (they can't resolve the __fixtures__ files).
export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
})
