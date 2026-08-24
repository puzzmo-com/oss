import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { lintDist, simulatorBuildMarker } from "./lintDist.js"

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

/** Writes `files` (dist-relative path to contents) into a throwaway dist folder and returns its path */
const makeDist = (files: Record<string, string>): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "puzzmo-lint-dist-"))
  tempDirs.push(dir)
  for (const [relative, contents] of Object.entries(files)) {
    const full = path.join(dir, relative)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, contents)
  }
  return dir
}

describe(lintDist.name, () => {
  it("passes a build with no simulator in it", () => {
    const dist = makeDist({
      "index.html": `<script type="module" src="./assets/main.js"></script>`,
      "assets/main.js": `console.log("hello")`,
    })
    expect(lintDist(dist)).toEqual([])
  })

  it("flags the build marker in a bundled chunk", () => {
    const dist = makeDist({
      "index.html": `<script type="module" src="./assets/main.js"></script>`,
      "assets/main.js": `var e=document.createElement("div");e.id="simulator";e.dataset.puzzmoBuild="${simulatorBuildMarker}"`,
    })
    const errors = lintDist(dist)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain("bundled into this build (assets/main.js)")
  })

  it("names only the first few offenders when the simulator lands in many chunks", () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < 8; i++) files[`assets/chunk-${i}.js`] = `"${simulatorBuildMarker}"`
    const errors = lintDist(makeDist(files))
    expect(errors[0]).toContain("+3 more")
  })

  it("ignores sourcemaps, which embed simulator source even when nothing shipped", () => {
    const dist = makeDist({ "assets/main.js.map": `{"sourcesContent":["${simulatorBuildMarker}"]}` })
    expect(lintDist(dist)).toEqual([])
  })

  it("flags a standalone simulator script tag loaded from a CDN", () => {
    const dist = makeDist({
      "index.html": `<script src="https://cdn.jsdelivr.net/npm/@puzzmo/sdk/dist/simulator/standalone.js"></script>`,
    })
    const errors = lintDist(dist)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain("standalone.js")
  })

  it("flags a SIMULATOR_CONFIG assignment with no script tag to match", () => {
    const dist = makeDist({ "index.html": `<script>window.SIMULATOR_CONFIG = { slug: "my-game" }</script>` })
    expect(lintDist(dist)[0]).toContain("window.SIMULATOR_CONFIG is set")
  })

  it("flags saved dev-server HTML", () => {
    const dist = makeDist({ "index.html": `<script type="module" src="/@puzzmo-simulator-init.js"></script>` })
    expect(lintDist(dist)[0]).toContain("only the dev server serves")
  })

  it("returns nothing for a dist folder that does not exist", () => {
    expect(lintDist(path.join(os.tmpdir(), "puzzmo-lint-dist-missing"))).toEqual([])
    expect(lintDist("")).toEqual([])
  })
})
