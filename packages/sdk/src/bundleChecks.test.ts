import { describe, expect, it } from "vitest"

import { checkBundle, pageBundleLimits, type BundleFacts } from "./bundleChecks"

const limits = pageBundleLimits("test pages")
const entryID = "/game/src/appBundle.ts"

/** Facts for a bundle with an entry that imports each extra module directly */
const facts = (code: string, modules: Record<string, { size: number; code: string | null }>): BundleFacts => ({
  fileName: "dist/app-bundle.js",
  code,
  modules: { [entryID]: { size: 100, code: "" }, ...modules },
  chains: new Map([[entryID, [entryID]], ...Object.keys(modules).map((moduleID): [string, string[]] => [moduleID, [entryID, moduleID]])]),
  root: "/game",
})

describe("checkBundle", () => {
  it("fails past the size limit, naming the largest modules and how the entry reaches them", () => {
    const words = "/game/node_modules/words/index.js"
    const { errors } = checkBundle(facts("x".repeat(600 * 1024), { [words]: { size: 590 * 1024, code: "" } }), limits)

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain("dist/app-bundle.js is 600KB, over the 500KB limit for a bundle loaded on test pages")
    expect(errors[0]).toContain("590KB  words/index.js")
    expect(errors[0]).toContain("src/appBundle.ts > words/index.js")
  })

  it("warns between the warning and failing limits", () => {
    const { errors, warnings } = checkBundle(facts("x".repeat(300 * 1024), {}), limits)
    expect(errors).toEqual([])
    expect(warnings[0]).toContain("over the 200KB limit")
  })

  it("fails on a banned package, scoped or not, with its import chain", () => {
    const { errors } = checkBundle(
      facts("", {
        "/game/node_modules/react/cjs/react.production.js": { size: 10, code: "" },
        "/game/node_modules/react/index.js": { size: 10, code: "" },
        "/game/node_modules/@reduxjs/toolkit/dist/index.mjs": { size: 10, code: "" },
      }),
      limits,
    )

    expect(errors).toHaveLength(2)
    expect(errors[0]).toContain("react can't be in dist/app-bundle.js")
    expect(errors[0]).toContain("src/appBundle.ts > react/cjs/react.production.js")
    expect(errors[1]).toContain("@reduxjs/toolkit can't be in dist/app-bundle.js")
  })

  it("passes a bundle with no limits whatever its size or packages", () => {
    const bundle = facts("x".repeat(600 * 1024), { "/game/node_modules/react/index.js": { size: 10, code: "" } })
    expect(checkBundle(bundle, {})).toEqual({ errors: [], warnings: [] })
  })

  it("warns on Node globals, by the module they come from", () => {
    const postcss = "/game/node_modules/postcss/lib/postcss.js"
    const code = "if (process.env.LANG && process.env.LANG.startsWith('cn')) a()\nconst b = Buffer.from(c)\nconst d = require('fs')"
    const { warnings } = checkBundle(facts(code, { [postcss]: { size: 10, code } }), {})

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("process.env.LANG (x2) in postcss/lib/postcss.js\n    src/appBundle.ts > postcss/lib/postcss.js")
    expect(warnings[0]).toContain("Buffer.from in postcss/lib/postcss.js")
    expect(warnings[0]).toContain("require( in postcss/lib/postcss.js")
  })

  it("skips guarded globals, other objects' properties, bundler helpers and lookalike names", () => {
    const code = [
      'var freeGlobal = typeof global == "object" && global && global.Object === Object && global',
      'typeof process == "object" && typeof process.emit == "function" ? process.emit("x") : console.error()',
      "const env = options.process.env",
      'const fs = __require("fs")',
      "const processedForPatches = 1",
    ].join("\n")
    expect(checkBundle(facts(code, { "/game/node_modules/lib/index.js": { size: 10, code } }), {}).warnings).toEqual([])
  })

  it("skips globals that dead-code removal dropped from the final code", () => {
    const moduleCode = 'if ("production" !== "production") console.log(process.version)'
    const bundle = facts("", { "/game/node_modules/lib/index.js": { size: 10, code: moduleCode } })
    expect(checkBundle(bundle, {}).warnings).toEqual([])
  })
})
