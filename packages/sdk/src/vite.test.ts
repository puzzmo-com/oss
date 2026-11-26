import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import fs from "fs"
import { createServer as createHttpServer, type Server } from "http"
import type { AddressInfo } from "net"
import path from "path"
import os from "os"
import { createServer, type ViteDevServer } from "vite"

import {
  findPuzzmoJsonDirs,
  discoverGames,
  resolveGameFromReferer,
  generateSimulatorCode,
  pmmgBundlePlugin,
  appBundlePlugin,
  buildPmmgBundleSource,
} from "./vite"
import type { GameInfo } from "./vite"

/** Create a temp directory with a given file tree. Keys are relative paths, values are file contents. */
function createTempTree(tree: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "puzzmo-test-"))
  for (const [rel, content] of Object.entries(tree)) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content)
  }
  return root
}

function puzzmoJson(slug: string, displayName?: string) {
  return JSON.stringify({ game: { slug, displayName: displayName ?? slug, teamID: "test-team" } })
}

let tmpRoot: string

afterEach(() => {
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true })
})

// -------------------------------------------------------------------
// findPuzzmoJsonDirs
// -------------------------------------------------------------------
describe("findPuzzmoJsonDirs", () => {
  it("finds puzzmo.json one level deep", () => {
    tmpRoot = createTempTree({
      "game-a/puzzmo.json": puzzmoJson("game-a"),
      "game-b/puzzmo.json": puzzmoJson("game-b"),
    })
    const dirs = findPuzzmoJsonDirs(tmpRoot, 3)
    const names = dirs.map((d) => path.basename(d)).sort()
    expect(names).toEqual(["game-a", "game-b"])
  })

  it("finds puzzmo.json two levels deep", () => {
    tmpRoot = createTempTree({
      "games/hex-words/puzzmo.json": puzzmoJson("hex-words"),
      "games/ribbit/puzzmo.json": puzzmoJson("ribbit"),
    })
    const dirs = findPuzzmoJsonDirs(tmpRoot, 3)
    expect(dirs).toHaveLength(2)
    expect(dirs.map((d) => path.basename(d)).sort()).toEqual(["hex-words", "ribbit"])
  })

  it("respects maxDepth", () => {
    tmpRoot = createTempTree({
      "a/b/c/puzzmo.json": puzzmoJson("deep"),
    })
    expect(findPuzzmoJsonDirs(tmpRoot, 2)).toHaveLength(0)
    expect(findPuzzmoJsonDirs(tmpRoot, 3)).toHaveLength(1)
  })

  it("skips node_modules and dotfiles", () => {
    tmpRoot = createTempTree({
      "node_modules/pkg/puzzmo.json": puzzmoJson("pkg"),
      ".hidden/puzzmo.json": puzzmoJson("hidden"),
      "real-game/puzzmo.json": puzzmoJson("real"),
    })
    const dirs = findPuzzmoJsonDirs(tmpRoot, 3)
    expect(dirs.map((d) => path.basename(d))).toEqual(["real-game"])
  })

  it("returns empty for directory with no puzzmo.json", () => {
    tmpRoot = createTempTree({ "readme.md": "hello" })
    expect(findPuzzmoJsonDirs(tmpRoot, 3)).toEqual([])
  })
})

// -------------------------------------------------------------------
// discoverGames
// -------------------------------------------------------------------
describe("discoverGames", () => {
  it("discovers a single game at root", () => {
    tmpRoot = createTempTree({
      "puzzmo.json": puzzmoJson("my-game", "My Game"),
    })
    const games = discoverGames(tmpRoot)
    expect(games.size).toBe(1)
    const game = games.get("my-game")!
    expect(game.slug).toBe("my-game")
    expect(game.displayName).toBe("My Game")
    expect(game.dir).toBe(tmpRoot)
    expect(game.appBundlePath).toBeNull()
  })

  it("reads integrations", () => {
    const checklists = [{ stableID: "my-game:tutorial", type: "tutorial", items: [{ title: "Move", incrementExp: "moves" }] }]
    tmpRoot = createTempTree({
      "puzzmo.json": JSON.stringify({ game: { slug: "my-game", displayName: "My Game" }, integrations: { checklists } }),
    })
    expect(discoverGames(tmpRoot).get("my-game")!.integrations).toEqual({ checklists })
  })

  it("discovers multiple games in subdirectories", () => {
    tmpRoot = createTempTree({
      "games/alpha/puzzmo.json": puzzmoJson("alpha", "Alpha"),
      "games/beta/puzzmo.json": puzzmoJson("beta", "Beta"),
    })
    const games = discoverGames(tmpRoot)
    expect(games.size).toBe(2)
    expect(games.has("alpha")).toBe(true)
    expect(games.has("beta")).toBe(true)
  })

  it("detects app bundle when src/appBundle.js exists", () => {
    tmpRoot = createTempTree({
      "puzzmo.json": puzzmoJson("with-bundle"),
      "src/appBundle.js": "export function renderThumbnail() {}",
    })
    const games = discoverGames(tmpRoot)
    const game = games.get("with-bundle")!
    expect(game.appBundlePath).toBe("/src/appBundle.js")
  })

  it("sets appBundlePath relative to vite root in nested games", () => {
    tmpRoot = createTempTree({
      "games/foo/puzzmo.json": puzzmoJson("foo"),
      "games/foo/src/appBundle.js": "export function renderThumbnail() {}",
    })
    const games = discoverGames(tmpRoot)
    expect(games.get("foo")!.appBundlePath).toBe("/games/foo/src/appBundle.js")
  })

  it("detects app bundle when src/appBundle.ts exists", () => {
    tmpRoot = createTempTree({
      "puzzmo.json": puzzmoJson("with-ts-bundle"),
      "src/appBundle.ts": "export function renderThumbnail() { return '' }",
    })
    const games = discoverGames(tmpRoot)
    expect(games.get("with-ts-bundle")!.appBundlePath).toBe("/src/appBundle.ts")
  })

  it("detects app bundle when src/appBundle.tsx exists", () => {
    tmpRoot = createTempTree({
      "puzzmo.json": puzzmoJson("with-tsx-bundle"),
      "src/appBundle.tsx": "export function renderThumbnail() { return '' }",
    })
    const games = discoverGames(tmpRoot)
    expect(games.get("with-tsx-bundle")!.appBundlePath).toBe("/src/appBundle.tsx")
  })

  it("detects a pmmg bundle beside the app bundle", () => {
    tmpRoot = createTempTree({
      "games/foo/puzzmo.json": puzzmoJson("foo"),
      "games/foo/src/pmmgBundle.ts": "export default { table: { contract: 1, render() {} } }",
      "games/bar/puzzmo.json": puzzmoJson("bar"),
    })
    const games = discoverGames(tmpRoot)
    expect(games.get("foo")!.pmmgBundlePath).toBe("/games/foo/src/pmmgBundle.ts")
    expect(games.get("bar")!.pmmgBundlePath).toBeNull()
  })

  it("prefers .js over .ts when both exist", () => {
    tmpRoot = createTempTree({
      "puzzmo.json": puzzmoJson("dual"),
      "src/appBundle.js": "export function renderThumbnail() {}",
      "src/appBundle.ts": "export function renderThumbnail() { return '' }",
    })
    const games = discoverGames(tmpRoot)
    expect(games.get("dual")!.appBundlePath).toBe("/src/appBundle.js")
  })

  it("skips puzzmo.json without game.slug", () => {
    tmpRoot = createTempTree({
      "bad/puzzmo.json": JSON.stringify({ game: { displayName: "no slug" } }),
      "good/puzzmo.json": puzzmoJson("good"),
    })
    const games = discoverGames(tmpRoot)
    expect(games.size).toBe(1)
    expect(games.has("good")).toBe(true)
  })

  it("skips invalid JSON", () => {
    tmpRoot = createTempTree({
      "broken/puzzmo.json": "not json at all {{{",
      "ok/puzzmo.json": puzzmoJson("ok"),
    })
    const games = discoverGames(tmpRoot)
    expect(games.size).toBe(1)
    expect(games.has("ok")).toBe(true)
  })
})

// -------------------------------------------------------------------
// resolveGameFromReferer
// -------------------------------------------------------------------
describe("resolveGameFromReferer", () => {
  let games: Map<string, GameInfo>

  beforeEach(() => {
    tmpRoot = createTempTree({
      "games/alpha/puzzmo.json": puzzmoJson("alpha"),
      "games/beta/puzzmo.json": puzzmoJson("beta"),
    })
    games = discoverGames(tmpRoot)
  })

  it("matches referer to the correct game", () => {
    const game = resolveGameFromReferer("http://localhost:3000/games/alpha/index.html", games, tmpRoot)
    expect(game?.slug).toBe("alpha")
  })

  it("matches referer to a different game", () => {
    const game = resolveGameFromReferer("http://localhost:3000/games/beta/", games, tmpRoot)
    expect(game?.slug).toBe("beta")
  })

  it("returns undefined for unrecognized referer with multiple games", () => {
    const game = resolveGameFromReferer("http://localhost:3000/other/page", games, tmpRoot)
    expect(game).toBeUndefined()
  })

  it("falls back to single game when only one exists", () => {
    const singleGame = new Map<string, GameInfo>()
    singleGame.set("only", { dir: path.join(tmpRoot, "games/alpha"), slug: "only", displayName: "Only", appBundlePath: null })
    const game = resolveGameFromReferer("http://localhost:3000/unknown", singleGame, tmpRoot)
    expect(game?.slug).toBe("only")
  })

  it("returns undefined for no referer with multiple games", () => {
    expect(resolveGameFromReferer(undefined, games, tmpRoot)).toBeUndefined()
  })

  it("handles malformed referer gracefully", () => {
    expect(resolveGameFromReferer("not a url", games, tmpRoot)).toBeUndefined()
  })
})

// -------------------------------------------------------------------
// generateSimulatorCode
// -------------------------------------------------------------------
describe("generateSimulatorCode", () => {
  it("generates default code with no game", () => {
    const code = generateSimulatorCode({}, undefined)
    expect(code).toContain('import { createSimulator } from "@puzzmo/sdk/simulator"')
    expect(code).toContain("import.meta.glob")
    expect(code).toContain("/fixtures/puzzles/**/*.{json,toml}")
    // fixtures load as raw strings so any text format reaches the game verbatim
    expect(code).toContain('query: "?raw"')
    expect(code).toContain('import: "default"')
    expect(code).toContain("createSimulator({ fixtures })")
    expect(code).not.toContain("slug")
    expect(code).not.toContain("appBundle")
  })

  it("includes slug when game is provided", () => {
    const game: GameInfo = { dir: "/tmp/foo", slug: "my-game", displayName: "My Game", appBundlePath: null }
    const code = generateSimulatorCode({}, game)
    expect(code).toContain('slug: "my-game"')
  })

  it("includes integrations when the game has them", () => {
    const integrations = { checklists: [{ stableID: "my-game:tutorial", type: "tutorial", items: [] }] }
    const game: GameInfo = { dir: "/tmp/foo", slug: "my-game", displayName: "My Game", appBundlePath: null, integrations }
    const code = generateSimulatorCode({}, game)
    expect(code).toContain(`integrations: ${JSON.stringify(integrations)}`)
  })

  it("includes app bundle import when game has one", () => {
    const game: GameInfo = { dir: "/tmp/foo", slug: "my-game", displayName: "My Game", appBundlePath: "/games/foo/src/appBundle.js" }
    const code = generateSimulatorCode({}, game)
    expect(code).toContain('import("/games/foo/src/appBundle.js")')
    expect(code).toContain("globalThis.renderThumbnail = m.renderThumbnail")
    expect(code).toContain("globalThis.getShareString = m.getShareString")
  })

  it("hands the simulator a loader for the pmmg bundle when the game has one, so it gets a Pmmg tab", () => {
    const game: GameInfo = {
      dir: "/tmp/foo",
      slug: "my-game",
      displayName: "My Game",
      appBundlePath: null,
      pmmgBundlePath: "/games/foo/src/pmmgBundle.ts",
    }
    expect(generateSimulatorCode({}, game)).toContain('pmmgBundle: () => import("/games/foo/src/pmmgBundle.ts")')
    expect(generateSimulatorCode({}, { ...game, pmmgBundlePath: null })).not.toContain("pmmgBundle")
  })

  it("disables fixtures when fixturesGlob is false", () => {
    const code = generateSimulatorCode({ fixturesGlob: false }, undefined)
    expect(code).not.toContain("import.meta.glob")
    expect(code).not.toContain("fixtures")
  })

  it("imports and calls plugin view factories", () => {
    const code = generateSimulatorCode(
      { viewFactories: [{ module: "@puzzmo-com/shared/sdkPlugins", export: "createCollabSimulatorView" }] },
      undefined,
    )
    expect(code).toContain('import { createCollabSimulatorView } from "@puzzmo-com/shared/sdkPlugins"')
    expect(code).toContain("views: [createCollabSimulatorView()]")
    expect(code).not.toContain("viewFactories")
  })

  it("uses custom fixturesGlob", () => {
    const code = generateSimulatorCode({ fixturesGlob: "/data/**/*.json" }, undefined)
    expect(code).toContain("/data/**/*.json")
  })

  it("passes autoStart and collapsed options", () => {
    const code = generateSimulatorCode({ autoStart: false, collapsed: false }, undefined)
    expect(code).toContain("autoStart: false")
    expect(code).toContain("collapsed: false")
  })
})

// -------------------------------------------------------------------
// Bundle builds
// -------------------------------------------------------------------

describe("bundle builds", () => {
  // Stands in for immer/reselect, which check NODE_ENV at load and would throw where there's no `process`
  const nodeEnvEntry = "export const mode = process.env.NODE_ENV === 'production' ? 'prod' : 'dev'"

  it("bakes NODE_ENV into the app bundle, as thumbnails run it where there is no process", async () => {
    tmpRoot = createTempTree({ "src/appBundle.ts": nodeEnvEntry })
    const outDir = path.join(tmpRoot, "dist")
    const plugin = appBundlePlugin({ entry: path.join(tmpRoot, "src/appBundle.ts"), outDir })
    await (plugin.closeBundle as () => Promise<void>)()

    const code = fs.readFileSync(path.join(outDir, "app-bundle.js"), "utf8")
    expect(code).not.toContain("process.env")
  })

  it("bakes NODE_ENV into the pmmg bundle", async () => {
    tmpRoot = createTempTree({ "src/pmmgBundle.ts": nodeEnvEntry })
    const code = await buildPmmgBundleSource(path.join(tmpRoot, "src/pmmgBundle.ts"))
    expect(code).not.toContain("process.env")
  })

  it("fails the app bundle's build when React ends up in it, saying which import brought it", async () => {
    tmpRoot = createTempTree({
      "node_modules/react/package.json": JSON.stringify({ name: "react", type: "module", main: "index.js" }),
      "node_modules/react/index.js": "export const createElement = () => 1",
      "src/thumb.ts": 'import { createElement } from "react"\nexport const draw = () => createElement()',
      "src/appBundle.ts": 'export { draw as renderThumbnail } from "./thumb"',
    })
    const plugin = appBundlePlugin({ entry: path.join(tmpRoot, "src/appBundle.ts"), outDir: path.join(tmpRoot, "dist") })
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {})

    const error = await (plugin.closeBundle as () => Promise<void>)().catch((e: Error) => e)
    quiet.mockRestore()

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(/^\[app-bundle\] react can't be in .*app-bundle\.js[\s\S]*thumb\.ts > react\/index\.js/)
    // Printed alone, not inside rolldown's stack
    expect((error as Error).stack).toBe((error as Error).message)
  })
})

// -------------------------------------------------------------------
// pmmgBundlePlugin
// -------------------------------------------------------------------

describe("pmmgBundlePlugin in dev", () => {
  let server: ViteDevServer | undefined
  let http: Server | undefined
  afterEach(async () => {
    http?.close()
    await server?.close()
  })

  it("serves one built file to the sandbox's opaque origin, and none of the dev server's modules", async () => {
    tmpRoot = createTempTree({
      "src/pmmgBundle.ts": 'import { size } from "./board"\nexport default { table: { contract: 1, render: () => ({ width: size }) } }',
      "src/board.ts": "export const size: number = 412",
    })
    server = await createServer({
      configFile: false,
      root: tmpRoot,
      logLevel: "silent",
      plugins: pmmgBundlePlugin(),
      server: { middlewareMode: true, ws: false },
    })
    http = createHttpServer(server.middlewares).listen(0)
    await new Promise((resolve) => http!.once("listening", resolve))
    const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`

    const bundle = await fetch(`${base}/pmmg-bundle.js`, { headers: { origin: "null" } })
    expect(bundle.status).toBe(200)
    expect(bundle.headers.get("access-control-allow-origin")).toBe("*")
    const code = await bundle.text()
    expect(code).toContain("412")
    expect(code).not.toMatch(/^import /m)

    const source = await fetch(`${base}/src/board.ts`, { headers: { origin: "null" } })
    expect(source.headers.get("access-control-allow-origin")).toBeNull()
  })
})
