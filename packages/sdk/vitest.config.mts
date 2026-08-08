import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    // Quiet output: console only shown for failing tests, no redrawn task summary
    silent: "passed-only",
    reporters: [["default", { summary: false }]],
  },
})
