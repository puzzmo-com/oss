import type { Plugin, ResolvedConfig } from "vite"
import { execFileSync } from "child_process"
import path from "path"
import fs from "fs"
import { puzzmoLua } from "./lua"

export type PuzzmoPico8PluginOptions = {
  /** The cart, relative to the page. Defaults to the only `.p8` file in `cart/`. */
  cart?: string
  /** Where PICO-8's HTML export lives, relative to the page. Defaults to `export`. Commit it, so builds don't need PICO-8. */
  exportDir?: string
  /**
   * The PICO-8 binary used to re-export the cart when it changes. Defaults to `$PICO8`, then `pico8` on your PATH,
   * then where PICO-8's installers put it. When it can't be found the committed export is used as-is. Pass false to
   * never export.
   */
  pico8?: string | false
  /** Keep `puzzmo.lua` next to the cart up to date. Defaults to true. */
  writeLua?: boolean
}

/** @internal */
export type Pico8Game = {
  /** The directory holding the page */
  dir: string
  cart: string
  /** The cart's name, which PICO-8 also uses for its export */
  name: string
  exportHTML: string
  exportJS: string
}

/** @internal Finds the PICO-8 game served by the page in `dir`, if there is one. */
export function findPico8Game(dir: string, options: PuzzmoPico8PluginOptions = {}): Pico8Game | null {
  let cart: string | undefined
  if (options.cart) cart = path.resolve(dir, options.cart)
  else {
    const cartDir = path.join(dir, "cart")
    const carts = fs.existsSync(cartDir) ? fs.readdirSync(cartDir).filter((f) => f.endsWith(".p8")) : []
    if (carts.length > 1) throw new Error(`[puzzmo-pico8] found ${carts.length} carts in ${cartDir}, pick one with the \`cart\` option`)
    if (carts.length === 1) cart = path.join(cartDir, carts[0])
  }
  if (!cart || !fs.existsSync(cart)) return null
  const name = path.basename(cart, ".p8")
  const exportDir = path.resolve(dir, options.exportDir ?? "export")
  return { dir, cart, name, exportHTML: path.join(exportDir, `${name}.html`), exportJS: path.join(exportDir, `${name}.js`) }
}

/**
 * @internal
 * Turns PICO-8's exported page into a Puzzmo game's page. PICO-8's shell is a thousand lines of globals and handlers
 * its runtime expects to find, and it changes between versions, so rather than keep a copy we adjust theirs.
 */
export function patchPico8Export(html: string, name: string, scripts: string[]): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

  // PICO-8 loads its runtime from a script element it builds itself. Point it at the copy we serve next to the page,
  // relative because Puzzmo serves games from a subfolder.
  const runtime = new RegExp(`((?:\\.src\\s*=\\s*|\\ssrc=)["'])[^"']*${escaped}\\.js(["'])`)
  if (!runtime.test(html)) throw new Error(`[puzzmo-pico8] couldn't find where PICO-8's page loads ${name}.js`)
  html = html.replace(runtime, `$1./${name}.js$2`)

  // Boot straight away. Otherwise the cart waits for a click on PICO-8's play button and the host never hears that
  // the game loaded. (Browsers which need a tap before audio can start, like iOS Safari, still show the button.)
  html = html.replace(/var\s+p8_autoplay\s*=\s*false/, "var p8_autoplay = true")

  // The GPIO array, for shells old enough not to declare it themselves.
  if (!/var\s+pico8_gpio\s*=/.test(html)) html = html.replace(/<head>/i, "<head>\n<script>var pico8_gpio = new Array(128)</script>")

  // Things a browser shrugs off and Vite doesn't: an HTML comment wrapped around the stylesheet, a stray
  // `-repeat center;` in it, and an `&nbsp` without its semicolon.
  html = html.replace(
    /(<style[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (_, open: string, css: string, close: string) =>
      open + css.replace(/<!--|-->/g, "").replace(/^[ \t]*-repeat[^;\n]*;[ \t]*$/gm, "") + close,
  )
  html = html.replace(/&nbsp(?!;)/g, "&nbsp;")

  const bodyEnd = html.lastIndexOf("</body>")
  if (bodyEnd === -1) throw new Error("[puzzmo-pico8] that doesn't look like a PICO-8 export, it has no </body>")
  return html.slice(0, bodyEnd) + scripts.join("\n") + "\n" + html.slice(bodyEnd)
}

/** Where PICO-8's own installers put it, for people who never added it to their PATH. */
const usualPico8Locations = [
  "/Applications/PICO-8.app/Contents/MacOS/pico8",
  "C:\\Program Files (x86)\\PICO-8\\pico8.exe",
  "C:\\Program Files\\PICO-8\\pico8.exe",
]

/** Finds an executable on the PATH without running it: `pico8` with no export arguments opens the whole app. */
const findExecutable = (bin: string): string | null => {
  if (bin.includes("/") || bin.includes("\\")) return fs.existsSync(bin) ? bin : null
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    for (const ext of process.platform === "win32" ? [".exe", ".cmd", ""] : [""]) {
      const candidate = path.join(dir, bin + ext)
      if (fs.existsSync(candidate)) return candidate
    }
  }
  if (bin === "pico8") return usualPico8Locations.find((p) => fs.existsSync(p)) ?? null
  return null
}

const mtime = (file: string) => (fs.existsSync(file) ? fs.statSync(file).mtimeMs : 0)

/**
 * Vite plugin for games written as PICO-8 carts. Your `index.html` only needs your own script tag, the plugin swaps
 * in PICO-8's exported page around it, serves the PICO-8 runtime next to it, and copies it into the build.
 *
 * When PICO-8 is installed it also re-exports the cart whenever it (or a `.lua` file next to it) changes, and reloads
 * the page, so saving in PICO-8 is enough to see the change in the simulator.
 */
export function puzzmoPico8(options: PuzzmoPico8PluginOptions = {}): Plugin {
  let config: ResolvedConfig
  const games = new Map<string, Pico8Game>()
  const binary = options.pico8 === false ? null : (options.pico8 ?? process.env.PICO8 ?? "pico8")

  const log = (message: string) => config.logger.info(`\x1b[33m\x1b[1m  PICO-8 \x1b[22m\x1b[39m${message}`)

  const writeLua = (game: Pico8Game) => {
    if (options.writeLua === false) return
    const file = path.join(path.dirname(game.cart), "puzzmo.lua")
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === puzzmoLua) return
    fs.writeFileSync(file, puzzmoLua)
    log(`wrote ${path.relative(config.root, file)}`)
  }

  /** Re-exports the cart when it's newer than the export and PICO-8 is around to do it. */
  const exportIfStale = (game: Pico8Game) => {
    const cartDir = path.dirname(game.cart)
    const newest = Math.max(
      ...fs
        .readdirSync(cartDir)
        .filter((f) => /\.(p8|lua)$/.test(f))
        .map((f) => mtime(path.join(cartDir, f))),
    )
    if (fs.existsSync(game.exportJS) && mtime(game.exportJS) >= newest) return

    const pico8 = binary ? findExecutable(binary) : null
    if (!pico8) {
      if (fs.existsSync(game.exportHTML)) {
        config.logger.warn(
          `[puzzmo-pico8] ${path.relative(config.root, game.cart)} is newer than its export, and PICO-8 isn't around to re-export it. Using the old export.`,
        )
        return
      }
      throw new Error(
        `[puzzmo-pico8] there's no export of ${path.relative(config.root, game.cart)} yet, and PICO-8 isn't on your PATH to make one.\n` +
          `Export it inside PICO-8 with EXPORT ${game.name}.html into ${path.relative(config.root, path.dirname(game.exportHTML))}/, or set PICO8=/path/to/pico8.`,
      )
    }

    fs.mkdirSync(path.dirname(game.exportHTML), { recursive: true })
    const before = mtime(game.exportJS)
    let output = ""
    try {
      output = execFileSync(pico8, [game.cart, "-export", game.exportHTML], {
        encoding: "utf8",
        timeout: 60_000,
        stdio: ["ignore", "pipe", "pipe"],
      })
    } catch (error) {
      output = String((error as { stdout?: string }).stdout ?? error)
    }
    if (mtime(game.exportJS) === before) {
      const hint = /label/i.test(output) ? "\nHTML exports need a label: run the cart in PICO-8, press CTRL-7, and save." : ""
      throw new Error(`[puzzmo-pico8] PICO-8 didn't export ${path.relative(config.root, game.cart)}:\n${output.trim()}${hint}`)
    }
    log(`exported ${path.relative(config.root, game.cart)}`)
  }

  const gameForPage = (htmlFile: string) => {
    const dir = path.dirname(htmlFile)
    if (!games.has(dir)) {
      const game = findPico8Game(dir, options)
      if (!game) return null
      games.set(dir, game)
    }
    return games.get(dir)!
  }

  return {
    name: "puzzmo-pico8",

    config() {
      // The export is rewritten on every save, and Vite reloads the page for any .html it sees change. The plugin
      // reloads once the export is done, so Vite reloading too would boot the cart twice.
      const exportDir = options.exportDir ?? "export"
      const isExport = (file: string) =>
        /\.(html|js)$/.test(file) &&
        path.basename(path.dirname(file)) === path.basename(exportDir) &&
        fs.existsSync(path.join(path.dirname(path.dirname(file)), "cart"))
      return { server: { watch: { ignored: [isExport] } } }
    },

    configResolved(resolved) {
      config = resolved
    },

    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        const game = gameForPage(ctx.filename)
        if (!game) return
        writeLua(game)
        exportIfStale(game)
        // Keep the page's own module scripts: that's the game code.
        const scripts = html.match(/<script\b[^>]*type=["']module["'][^>]*>[\s\S]*?<\/script>/gi) ?? []
        return patchPico8Export(fs.readFileSync(game.exportHTML, "utf8"), game.name, scripts)
      },
    },

    configureServer(devServer) {
      // Serve the runtime next to the page, untouched by Vite's transforms: it is a megabyte of emscripten output
      // which only works exactly as PICO-8 wrote it.
      devServer.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url ?? "").split("?")[0])
        if (!url.endsWith(".js")) return next()
        const game = [...games.values()].find(
          (g) =>
            url ===
            "/" +
              path
                .relative(config.root, path.join(g.dir, `${g.name}.js`))
                .split(path.sep)
                .join("/"),
        )
        if (!game || !fs.existsSync(game.exportJS)) return next()
        res.setHeader("Content-Type", "text/javascript")
        res.end(fs.readFileSync(game.exportJS))
      })

      // Saving the cart in PICO-8 re-exports it and reloads the page.
      devServer.watcher.on("change", (file) => {
        const game = [...games.values()].find((g) => path.dirname(file) === path.dirname(g.cart) && /\.(p8|lua)$/.test(file))
        if (!game || path.basename(file) === "puzzmo.lua") return
        try {
          exportIfStale(game)
          devServer.ws.send({ type: "full-reload" })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          config.logger.error(message)
          devServer.ws.send({ type: "error", err: { message, stack: "" } })
        }
      })
    },

    generateBundle() {
      for (const game of games.values()) {
        const fileName = path
          .relative(config.root, path.join(game.dir, `${game.name}.js`))
          .split(path.sep)
          .join("/")
        this.emitFile({ type: "asset", fileName, source: fs.readFileSync(game.exportJS) })
      }
    },
  }
}
