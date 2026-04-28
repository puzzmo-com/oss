import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "fs"
import path from "path"
import os from "os"

import { findPuzzmoJsonDirs, discoverGames, resolveGameFromReferer, generateSimulatorCode } from "./vite"
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
    expect(code).toContain("/fixtures/puzzles/**/*.json")
    expect(code).toContain("createSimulator({ fixtures })")
    expect(code).not.toContain("slug")
    expect(code).not.toContain("appBundle")
  })

  it("includes slug when game is provided", () => {
    const game: GameInfo = { dir: "/tmp/foo", slug: "my-game", displayName: "My Game", appBundlePath: null }
    const code = generateSimulatorCode({}, game)
    expect(code).toContain('slug: "my-game"')
  })

  it("includes app bundle import when game has one", () => {
    const game: GameInfo = { dir: "/tmp/foo", slug: "my-game", displayName: "My Game", appBundlePath: "/games/foo/src/appBundle.js" }
    const code = generateSimulatorCode({}, game)
    expect(code).toContain('import("/games/foo/src/appBundle.js")')
    expect(code).toContain("globalThis.renderThumbnail = m.renderThumbnail")
  })

  it("disables fixtures when fixturesGlob is false", () => {
    const code = generateSimulatorCode({ fixturesGlob: false }, undefined)
    expect(code).not.toContain("import.meta.glob")
    expect(code).not.toContain("fixtures")
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
