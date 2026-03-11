import type { Plugin } from "vite"

export type PuzzmoSimulatorPluginOptions = {
  /** Path to the puzzle JSON file (default: "./sample-puzzle.json") */
  puzzlePath?: string
  /** Whether to auto-start the game after READY (default: true) */
  autoStart?: boolean
  /** Initial collapsed state (default: true) */
  collapsed?: boolean
  /** Game slug for API features (e.g. "crossword", "my-game") */
  slug?: string
  /** Glob pattern for fixture files, passed to import.meta.glob (e.g. "./fixtures/puzzles/**\/*.json") */
  fixturesGlob?: string
}

/** Vite plugin that injects the Puzzmo simulator in dev mode and handles OAuth callbacks. */
export function puzzmoSimulator(options: PuzzmoSimulatorPluginOptions = {}): Plugin {
  return {
    name: "puzzmo-simulator",
    apply: "serve",

    configureServer(server) {
      server.middlewares.use("/oauth/callback", (_req, res) => {
        res.setHeader("Content-Type", "text/html")
        res.end(`<!DOCTYPE html>
<html><head><title>Puzzmo OAuth</title></head>
<body><script>
var params = new URLSearchParams(window.location.search);
var returnUrl = sessionStorage.getItem("oauth_return_url") || "/";
var url = new URL(returnUrl);
params.forEach(function(v, k) { url.searchParams.set(k, v); });
window.location.href = url.toString();
</script></body></html>`)
      })
    },

    transformIndexHtml() {
      const { fixturesGlob, ...config } = options

      const lines = [
        `import { createSimulator } from "@puzzmo/sdk/simulator"`,
      ]

      if (fixturesGlob) {
        lines.push(`const fixtures = import.meta.glob(${JSON.stringify(fixturesGlob)}, { eager: true })`)
      }

      const configEntries = Object.entries(config).filter(([, v]) => v !== undefined)
      const configParts = configEntries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
      if (fixturesGlob) configParts.push("fixtures")

      lines.push(`createSimulator({ ${configParts.join(", ")} })`)

      return [
        {
          tag: "script",
          attrs: { type: "module" },
          children: lines.join("\n"),
          injectTo: "head",
        },
      ]
    },
  }
}
