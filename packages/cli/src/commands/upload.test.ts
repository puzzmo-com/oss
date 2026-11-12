import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { uploadFiles } from "../util/api.js"
import { upload } from "./upload.js"

// The real validator fetches the schema over the network; these tests are about which files go up.
vi.mock("../util/validatePuzzmoFile.js", () => ({ validatePuzzmoJson: async (data: unknown) => ({ valid: true, data }) }))

vi.mock("../util/config.js", async (importOriginal) => {
  const credential = { source: "https://api.puzzmo.com", token: "pzt-test" }
  return { ...(await importOriginal<object>()), getTokens: () => [credential], resolveServerForTeam: async () => credential }
})

vi.mock("../util/api.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  uploadFiles: vi.fn(async () => ({
    assetsBase: "https://assets.example/abc/",
    versionID: "version-1",
    integrationsChanged: false,
    iconChanged: false,
    helpChanged: false,
    gameURL: null,
    versionsURL: null,
    serverBundle: null,
    serverBundleWarnings: [],
  })),
}))

class ExitError extends Error {
  constructor(public readonly code: number | undefined) {
    super(`process.exit(${code})`)
  }
}

const tempDirs: string[] = []
let errorOutput: string[] = []

beforeEach(() => {
  errorOutput = []
  vi.mocked(uploadFiles).mockClear()
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new ExitError(typeof code === "number" ? code : undefined)
  })
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void errorOutput.push(args.join(" ")))
  vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe(upload.name, () => {
  it("uploads the file named by output.serverBundle, not the shared dist-server beside dist", async () => {
    const repo = makeRepo({
      ...multiGameBuild("solitaire", { serverBundle: "../../dist-server/solitaire/server-bundle.js" }),
      ...multiGameBuild("klondike", { serverBundle: "../../dist-server/klondike/server-bundle.js" }),
      "dist-server/solitaire/server-bundle.js": "solitaire bundle",
      "dist-server/klondike/server-bundle.js": "klondike bundle",
      // A stray build in the old shared spot must be ignored once each game names its own
      "dist/dist-server/server-bundle.js": "stray bundle",
    })

    await upload(repo)

    expect(sentServerBundles()).toEqual({ klondike: "klondike bundle", solitaire: "solitaire bundle" })
  })

  it("fails a game whose output.serverBundle doesn't exist, and still uploads the others", async () => {
    const repo = makeRepo({
      ...multiGameBuild("solitaire", { serverBundle: "../../dist-server/solitaire/server-bundle.js" }),
      ...multiGameBuild("klondike", { serverBundle: "../../dist-server/klondike/server-bundle.js" }),
      "dist-server/klondike/server-bundle.js": "klondike bundle",
    })

    await expect(upload(repo)).rejects.toThrow(new ExitError(1))

    expect(sentServerBundles()).toEqual({ klondike: "klondike bundle" })
    const message = errorOutput.find((line) => line.includes("Server bundle not found"))
    expect(message).toContain(`for solitaire: "../../dist-server/solitaire/server-bundle.js"`)
    expect(message).toContain(`Build the game first, or fix "output.serverBundle" in puzzmo.json.`)
  })

  it("falls back to dist-server/server-bundle.js beside dist when output.serverBundle isn't set", async () => {
    const repo = makeRepo({
      "puzzmo.json": puzzmoJSON("solitaire", { dir: "dist" }),
      "dist/index.html": "<html></html>",
      "dist-server/server-bundle.js": "default bundle",
    })

    await upload(repo)

    expect(sentServerBundles()).toEqual({ solitaire: "default bundle" })
  })

  it("sends no server bundle when there's none beside dist", async () => {
    const repo = makeRepo({ ...multiGameBuild("solitaire"), ...multiGameBuild("klondike") })

    await upload(repo)

    expect(sentServerBundles()).toEqual({ klondike: null, solitaire: null })
  })

  it("refuses the whole run before uploading anything when games would share one server bundle", async () => {
    const repo = makeRepo({
      ...multiGameBuild("solitaire"),
      ...multiGameBuild("klondike"),
      ...multiGameBuild("spider", { serverBundle: "../../dist-server/spider/server-bundle.js" }),
      "dist/dist-server/server-bundle.js": "whichever game built last",
      "dist-server/spider/server-bundle.js": "spider bundle",
    })

    await expect(upload(repo)).rejects.toThrow(new ExitError(1))

    expect(uploadFiles).not.toHaveBeenCalled()
    const output = errorOutput.join("\n")
    expect(output).toContain("Refusing to upload: more than one game would send the same server bundle.")
    expect(output).toContain(`${path.join("dist", "dist-server", "server-bundle.js")} would be sent for klondike, solitaire`)
    expect(output).not.toContain("spider")
    expect(output).toContain(`Set "output.serverBundle"`)
  })

  it("refuses when an explicit output.serverBundle points at another game's default bundle", async () => {
    const repo = makeRepo({
      ...multiGameBuild("solitaire"),
      ...multiGameBuild("klondike", { serverBundle: "../../dist/dist-server/server-bundle.js" }),
      "dist/dist-server/server-bundle.js": "solitaire bundle",
    })

    await expect(upload(repo)).rejects.toThrow(new ExitError(1))

    expect(uploadFiles).not.toHaveBeenCalled()
    expect(errorOutput.join("\n")).toContain("would be sent for klondike, solitaire")
  })
})

/** Writes `files` (repo-relative path to contents) into a throwaway repo and returns its path */
const makeRepo = (files: Record<string, string>): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "puzzmo-upload-"))
  tempDirs.push(dir)
  for (const [relative, contents] of Object.entries(files)) {
    const full = path.join(dir, relative)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, contents)
  }
  return dir
}

/** A game laid out like a repo that builds many games from one root: games/<slug>/puzzmo.json building into dist/<slug> */
const multiGameBuild = (slug: string, output: { serverBundle?: string } = {}): Record<string, string> => ({
  [`games/${slug}/puzzmo.json`]: puzzmoJSON(slug, { dir: `../../dist/${slug}`, ...output }),
  [`dist/${slug}/index.html`]: "<html></html>",
})

const puzzmoJSON = (slug: string, output: { dir: string; serverBundle?: string }): string =>
  JSON.stringify({ game: { displayName: slug, slug, teamID: "team-1" }, output })

/** The server bundle contents each uploaded game sent, keyed by slug */
const sentServerBundles = (): Record<string, string | null | undefined> =>
  Object.fromEntries(vi.mocked(uploadFiles).mock.calls.map((call) => [call[2], call[8]?.serverBundle]))
