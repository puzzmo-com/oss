import type { Plugin } from "vite"
import { build } from "vite"
import path from "path"

export type PuzzmoSimulatorPluginOptions = {
  /** Whether to auto-start the game after READY (default: true) */
  autoStart?: boolean
  /** Initial collapsed state (default: true) */
  collapsed?: boolean
  /** Game slug for API features (e.g. "crossword", "my-game") */
  slug?: string
  /** Glob pattern for fixture files, passed to import.meta.glob (e.g. "./fixtures/puzzles/**\/*.json") */
  fixturesGlob?: string
}

const SIMULATOR_URL = "/@puzzmo-simulator-init.js"
const VIRTUAL_ID = "virtual:puzzmo-simulator"
const RESOLVED_VIRTUAL_ID = "\0" + VIRTUAL_ID

/** Vite plugin that injects the Puzzmo simulator in dev mode and handles OAuth callbacks. */
export function puzzmoSimulator(options: PuzzmoSimulatorPluginOptions = {}): Plugin {
  function generateCode(): string {
    const { fixturesGlob, ...config } = options

    const lines = [`import { createSimulator } from "@puzzmo/sdk/simulator"`]

    if (fixturesGlob) {
      lines.push(`const fixtures = import.meta.glob(${JSON.stringify(fixturesGlob)}, { eager: true })`)
    }

    const configEntries = Object.entries(config).filter(([, v]) => v !== undefined)
    const configParts = configEntries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    if (fixturesGlob) configParts.push("fixtures")

    lines.push(`createSimulator({ ${configParts.join(", ")} })`)

    return lines.join("\n")
  }

  return {
    name: "puzzmo-simulator",
    apply: "serve",

    // Virtual module used internally for code generation and transformation.
    // Uses \0 prefix so Vite's HTML processor won't try to inline it.
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_VIRTUAL_ID
    },

    load(id) {
      if (id === RESOLVED_VIRTUAL_ID) return generateCode()
    },

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

      // Serve the simulator init module. Registered before Vite's internal
      // middleware so the SPA fallback doesn't intercept it.
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.split("?")[0] !== SIMULATOR_URL) return next()

        const result = await server.transformRequest(VIRTUAL_ID)
        if (!result) return next()
        res.setHeader("Content-Type", "application/javascript")
        res.end(result.code)
      })
    },

    // Inject a script tag whose src the browser will fetch.
    // The URL is NOT resolvable via resolveId (intentionally), so Vite's
    // HTML processor won't inline it. The middleware above serves it instead.
    transformIndexHtml() {
      return [
        {
          tag: "script",
          attrs: { type: "module", src: SIMULATOR_URL },
          injectTo: "head",
        },
      ]
    },
  }
}

type BundlePluginOptions = {
  /** Entry file for the bundle */
  entry: string
  /** Output file name */
  outputFile: string
}

function createBundlePlugin(pluginName: string, defaults: BundlePluginOptions) {
  return (options: Partial<BundlePluginOptions> = {}): Plugin => {
    const { entry, outputFile } = { ...defaults, ...options }
    return {
      name: pluginName,
      apply: "build",
      async closeBundle() {
        try {
          await build({
            configFile: false,
            logLevel: "warn",
            build: {
              lib: {
                entry: path.isAbsolute(entry) ? entry : path.resolve(process.cwd(), entry),
                formats: ["es"],
                fileName: () => outputFile,
              },
              outDir: "dist",
              emptyOutDir: false,
            },
          })
        } catch (error) {
          console.error(`[${pluginName}] build failed:`, error)
          throw error
        }
      },
    }
  }
}

export type AppBundlePluginOptions = Partial<BundlePluginOptions>

/**
 * Vite plugin that produces dist/app-bundle.js after the main build for app-level integrations.
 *
 * The bundle exports `renderThumbnail(puzzleStr, inputStr?, config?)` — a pure
 * SVG-string renderer used by the Puzzmo platform for puzzle previews.
 */
export const appBundlePlugin = createBundlePlugin("app-bundle", { entry: "src/appBundle.js", outputFile: "app-bundle.js" })

export type EditorBundlePluginOptions = Partial<BundlePluginOptions>

/** Vite plugin that produces dist/editor-bundle.js after the main build for editor-level integrations. */
export const editorBundlePlugin = createBundlePlugin("editor-bundle", { entry: "src/editorBundle.js", outputFile: "editor-bundle.js" })
