import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { adoptPico8Cart } from "./create.js"

const cart = (lua: string) => `pico-8 cartridge // http://www.pico-8.com\nversion 41\n__lua__\n${lua}\n__gfx__\n0000\n`

const adopt = (contents: string) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pico8-cart-"))
  fs.writeFileSync(path.join(dir, "in.p8"), contents)
  const result = adoptPico8Cart(path.join(dir, "in.p8"), path.join(dir, "out.p8"))
  return { ...result, out: fs.readFileSync(path.join(dir, "out.p8"), "utf-8") }
}

describe("adoptPico8Cart", () => {
  it("adds the bridge's #include at the top of the cart's code", () => {
    const { addedInclude, out } = adopt(cart("function _init() end"))
    expect(addedInclude).toBe(true)
    expect(out).toContain("__lua__\n#include puzzmo.lua\nfunction _init() end")
    expect(out).toContain("__gfx__\n0000")
  })

  it("leaves a cart which already includes it alone", () => {
    const original = cart("#include puzzmo.lua\nfunction _init() end")
    expect(adopt(original)).toEqual({ addedInclude: false, out: original })
  })

  it("refuses something which isn't a cart", () => {
    expect(() => adopt("hello")).toThrow(/doesn't look like a PICO-8 cart/)
  })
})
