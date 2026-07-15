import type { Plugin, ResolvedConfig } from "vite"
import { build } from "vite"
import path from "path"
import fs from "fs"
import type { HostContext } from "./types"
import type { HostContextPreset } from "./simulator/types"

export type PuzzmoSimulatorPluginOptions = {
  /** Whether to auto-start the game after READY (default: true) */
  autoStart?: boolean
  /** Initial collapsed state (default: true) */
  collapsed?: boolean
  /**
   * Glob pattern for fixture files, passed to import.meta.glob which is relative to the closest puzzmo.json. Defaults
   * to `"/fixtures/puzzles/**\/*.{json,toml}"`. Fixtures are loaded as raw strings (any text format works — JSON,
   * TOML, or a custom format) and delivered to the game verbatim, so the game parses them itself. Pass false to disable.
   */
  fixturesGlob?: string | false
  /**
   * The `hostContext` array the simulator sends in READY_DATA, so host-context-dependent features
   * (embed settings, sandbox mode, mobile layout, …) can be exercised locally. Must be
   * JSON-serializable. Defaults to a single desktop "app" context; the simulator's Host tab can
   * override it at runtime (persisted per-browser, applied on restart).
   *
   * @internal
   */
  hostContext?: HostContext[]
  /**
   * Extra named `hostContext` presets for the simulator's Host tab, alongside the generic
   * built-ins — how a game ships its own scenarios (e.g. crossword's partner-embed toolbar
   * settings). Must be JSON-serializable.
   *
   * @internal
   */
  hostContextPresets?: HostContextPreset[]
}

const simulatorURL = "/@puzzmo-simulator-init.js"
const virtualID = "virtual:puzzmo-simulator"

/** @internal */
export type GameInfo = {
  /** Directory containing the puzzmo.json */
  dir: string
  slug: string
  displayName: string
  /** Vite-root-relative path to app bundle entry, if it exists */
  appBundlePath: string | null
}

/**
 * Discover all games from puzzmo.json files under a root directory.
 *
 * @internal
 */
export function discoverGames(viteRoot: string): Map<string, GameInfo> {
  const games = new Map<string, GameInfo>()
  const candidates = findPuzzmoJsonDirs(viteRoot, 3)
  if (fs.existsSync(path.join(viteRoot, "puzzmo.json"))) {
    candidates.unshift(viteRoot)
  }
  for (const dir of candidates) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, "puzzmo.json"), "utf-8"))
      if (!data?.game?.slug) continue
      const bundleEntry = resolveBundleEntry(dir, "src/appBundle")
      let appBundle: string | null = null
      if (bundleEntry) {
        const relative = path.relative(viteRoot, bundleEntry)
        appBundle = "/" + relative.split(path.sep).join("/")
      }
      games.set(data.game.slug, { dir, slug: data.game.slug, displayName: data.game.displayName, appBundlePath: appBundle })
    } catch {
      // skip invalid files
    }
  }
  return games
}

/**
 * Resolve which game a request belongs to using the referer URL.
 *
 * @internal
 */
export function resolveGameFromReferer(referer: string | undefined, games: Map<string, GameInfo>, viteRoot: string): GameInfo | undefined {
  if (referer) {
    try {
      const refPath = new URL(referer).pathname
      for (const g of games.values()) {
        const relDir = "/" + path.relative(viteRoot, g.dir).split(path.sep).join("/")
        if (refPath.startsWith(relDir + "/") || refPath === relDir) return g
      }
    } catch {
      // ignore malformed referer
    }
  }
  if (games.size === 1) return games.values().next().value
  return undefined
}

/**
 * Generate the virtual module code for the simulator.
 *
 * @internal
 */
export function generateSimulatorCode(options: PuzzmoSimulatorPluginOptions, game: GameInfo | undefined): string {
  const { fixturesGlob: fixturesOpt, ...config } = options
  const fixturesGlob = fixturesOpt === false ? null : (fixturesOpt ?? "/fixtures/puzzles/**/*.{json,toml}")

  const lines = [`import { createSimulator } from "@puzzmo/sdk/simulator"`]

  // Load fixtures as raw strings so any text format reaches the game verbatim; the game does its own parsing.
  if (fixturesGlob) {
    lines.push(`const fixtures = import.meta.glob(${JSON.stringify(fixturesGlob)}, { query: "?raw", import: "default", eager: true })`)
  }

  if (game?.appBundlePath) {
    lines.push(`import(${JSON.stringify(game.appBundlePath)}).then(m => {`)
    lines.push(`  if (m.renderThumbnail) globalThis.renderThumbnail = m.renderThumbnail`)
    lines.push(`  if (m.getShareString) globalThis.getShareString = m.getShareString`)
    lines.push(`}).catch(() => {})`)
  }

  const simConfig = { ...config, ...(game?.slug ? { slug: game.slug } : {}) }
  const configEntries = Object.entries(simConfig).filter(([, v]) => v !== undefined)
  const configParts = configEntries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
  if (fixturesGlob) configParts.push("fixtures")

  lines.push(`createSimulator({ ${configParts.join(", ")} })`)

  return lines.join("\n")
}

/** Vite plugin that injects the Puzzmo simulator in dev mode and handles OAuth callbacks. */
export function puzzmoSimulator(options: PuzzmoSimulatorPluginOptions = {}): Plugin {
  let games = new Map<string, GameInfo>()
  let viteRoot: string

  return {
    name: "puzzmo-simulator",
    apply: "serve",

    configResolved(config: ResolvedConfig) {
      viteRoot = config.root
      games = discoverGames(viteRoot)

      if (games.size === 0) {
        config.logger.info(`\x1b[33m\x1b[1m  PUZZMO \x1b[22m\x1b[39m\x1b[2m no puzzmo.json files found\x1b[22m`)
      } else {
        const names = [...games.values()].map((g) => `\x1b[36m${g.slug}\x1b[39m`)
        const label = games.size === 1 ? "game" : "games"
        config.logger.info(`\x1b[33m\x1b[1m  PUZZMO \x1b[22m\x1b[39m found ${games.size} ${label}: ${names.join("\x1b[2m, \x1b[22m")}`)
      }
    },

    resolveId(id) {
      if (id === virtualID || id.startsWith(virtualID + "?")) return "\0" + id
    },

    load(id) {
      if (!id.startsWith("\0" + virtualID)) return
      const params = new URLSearchParams(id.split("?")[1] || "")
      const gameSlug = params.get("game")
      const game = gameSlug ? games.get(gameSlug) : games.size === 1 ? games.values().next().value : undefined
      return generateSimulatorCode(options, game)
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

      // Serve the simulator init module, resolving the game from the referer
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.split("?")[0] !== simulatorURL) return next()

        const game = resolveGameFromReferer(req.headers.referer, games, viteRoot)
        const moduleID = virtualID + (game ? `?game=${game.slug}` : "")
        const result = await server.transformRequest(moduleID)
        if (!result) return next()
        res.setHeader("Content-Type", "application/javascript")
        res.end(result.code)
      })
    },

    transformIndexHtml() {
      return [
        {
          tag: "script",
          attrs: { type: "module", src: simulatorURL },
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
        // If the caller overrode `entry`, honor it as-is. Otherwise try `.js` first, then `.ts`.
        const resolvedEntry = options.entry
          ? path.isAbsolute(entry)
            ? entry
            : path.resolve(process.cwd(), entry)
          : (resolveBundleEntry(process.cwd(), stripBundleExt(entry)) ?? path.resolve(process.cwd(), entry))
        try {
          await build({
            configFile: false,
            logLevel: "warn",
            build: {
              lib: {
                entry: resolvedEntry,
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

/** Strip the trailing extension from a default entry path so we can probe siblings. */
const stripBundleExt = (p: string) => p.replace(/\.[jt]sx?$/i, "")

/** Returns the absolute path to the first matching extension under `dir`, or null. */
const resolveBundleEntry = (dir: string, baseRelative: string): string | null => {
  for (const ext of [".js", ".ts"]) {
    const candidate = path.join(dir, baseRelative + ext)
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

export type AppBundlePluginOptions = {
  /** Entry file for the app bundle (default: `src/appBundle.js`) */
  entry?: string
  /** Output file name (default: `app-bundle.js`) */
  outputFile?: string
}

/**
 * Vite plugin that produces dist/app-bundle.js after the main build for app-level integrations.
 *
 * The bundle exports `renderThumbnail(puzzleStr, inputStr?, config?)` — a pure renderer
 * returning the SVG and its dimensions (`{ svg, width, height }`), used by the Puzzmo
 * platform for puzzle previews.
 */
export const appBundlePlugin = createBundlePlugin("app-bundle", { entry: "src/appBundle.js", outputFile: "app-bundle.js" })

export type EditorBundlePluginOptions = {
  /** Entry file for the editor bundle (default: `src/editorBundle.js`) */
  entry?: string
  /** Output file name (default: `editor-bundle.js`) */
  outputFile?: string
}

/** Vite plugin that produces dist/editor-bundle.js after the main build for editor-level integrations. */
export const editorBundlePlugin = createBundlePlugin("editor-bundle", { entry: "src/editorBundle.js", outputFile: "editor-bundle.js" })

/**
 * Recursively find directories containing puzzmo.json, up to `maxDepth` levels deep.
 *
 * @internal
 */
export const findPuzzmoJsonDirs = (root: string, maxDepth: number, depth = 0): string[] => {
  if (depth >= maxDepth) return []
  const results: string[] = []
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return results
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") continue
    const dir = path.join(root, entry.name)
    if (fs.existsSync(path.join(dir, "puzzmo.json"))) {
      results.push(dir)
    }
    results.push(...findPuzzmoJsonDirs(dir, maxDepth, depth + 1))
  }
  return results
}
