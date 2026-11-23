import { describe, expect, it, vi } from "vitest"

import type { TableBoardCapability, TableBoardSprites, TableBoardUpdate } from "../types"
import { createPmmgRenderer, type Rasterise } from "./pmmgRenderer"

// No Image here to decode SVG, so each SVG sprite becomes a stand-in bitmap
const rasterise: Rasterise = async (svgs) =>
  svgs.map(({ id }) => ({ id, bitmap: { close: vi.fn(), width: 10, height: 10 } as unknown as ImageBitmap }))

const update = (input: string, pixelsPerUnit = 2): TableBoardUpdate => ({
  board: "simulator",
  puzzle: "puzzle",
  input,
  skipped: 0,
  theme: {} as TableBoardUpdate["theme"],
  fidelity: "high",
  backgroundStyle: "dark",
  pixelsPerUnit,
})

/** A table that draws one card per letter of its input, each its own SVG sprite */
const cards = (extra?: (sprites: TableBoardSprites, input: string) => void): TableBoardCapability => ({
  contract: 1,
  render(next, sprites) {
    extra?.(sprites, next.input)
    const nodes = [...next.input].map((letter, i) => {
      sprites.svg(`card:${letter}`, { width: 10, height: 14 }, `<text>${letter}</text>`)
      return { key: `card:${i}`, sprite: `card:${letter}`, x: i * 12, y: 0 }
    })
    return { width: 100, height: 20, nodes }
  },
})

describe("createPmmgRenderer", () => {
  it("makes each sprite once per resolution and keeps it with what made it", async () => {
    const table = cards()
    const render = vi.spyOn(table, "render")
    const renderer = createPmmgRenderer(table, { rasterise })

    const scene = await renderer.render(update("ab"))
    expect(scene.nodes.map((node) => node.sprite)).toEqual(["card:a", "card:b"])
    expect(renderer.latest?.made).toEqual(["card:a", "card:b"])

    await renderer.render(update("abc"))
    expect(renderer.latest?.made).toEqual(["card:c"])
    expect(renderer.spritesAt(2).map((sprite) => sprite.id)).toEqual(["card:a", "card:b", "card:c"])
    expect(renderer.sprite("card:a", 2)).toMatchObject({
      kind: "svg",
      svg: "<text>a</text>",
      width: 10,
      height: 14,
      anchor: [5, 7],
      render: 1,
    })

    // A new resolution starts from nothing
    await renderer.render(update("a", 3))
    expect(renderer.latest?.made).toEqual(["card:a"])
    expect(renderer.resolutions()).toEqual([2, 3])
    expect(render).toHaveBeenCalledTimes(3)
  })

  it("refuses a scene Puzzmo would, and says which part failed", async () => {
    const renderer = createPmmgRenderer({
      contract: 1,
      render: () => ({ width: 1, height: 1, nodes: [{ key: "a", x: Number.NaN, y: 0 }] }),
    })
    await expect(renderer.render(update(""))).rejects.toThrow("Node 0's x must be a finite number")
    expect(renderer.latest?.error).toMatchObject({ phase: "scene" })
    // Kept as returned, so the Scene tab can show what was refused
    expect(renderer.latest?.raw).toMatchObject({ width: 1 })
  })

  it("refuses a scene naming a sprite it never made", async () => {
    const renderer = createPmmgRenderer({
      contract: 1,
      render: () => ({ width: 1, height: 1, nodes: [{ key: "a", sprite: "ghost", x: 0, y: 0 }] }),
    })
    await expect(renderer.render(update(""))).rejects.toThrow("never made: ghost")
  })

  it("refuses a render that returns a Promise, which the sandbox never waits for", async () => {
    const renderer = createPmmgRenderer({ contract: 1, render: (async () => ({ width: 1, height: 1, nodes: [] })) as never })
    await expect(renderer.render(update(""))).rejects.toThrow("returned a Promise")
    expect(renderer.latest?.error?.phase).toBe("render")
  })

  it("refuses a scene that couldn't leave the sandbox", async () => {
    const renderer = createPmmgRenderer({ contract: 1, render: () => ({ width: 1, height: 1, nodes: [], onTap: () => {} }) as never })
    await expect(renderer.render(update(""))).rejects.toThrow("can't leave the sandbox")
  })

  it("warns when an ID is made again as a different picture", async () => {
    const table = cards((sprites, input) => sprites.svg("badge", { width: 4, height: 4 }, `<circle r="${input.length}"/>`))
    const renderer = createPmmgRenderer(table, { rasterise })
    await renderer.render(update("a"))
    await renderer.render(update("ab"))
    expect(renderer.warnings).toEqual([
      `"badge" was made again with different SVG. Puzzmo keeps the first, so put what differs into the ID`,
    ])
    expect(renderer.sprite("badge", 2)?.svg).toBe(`<circle r="1"/>`)
  })

  it("makes every sprite again after a failed render, as the sandbox does", async () => {
    let fail = false
    const table = cards(() => {
      if (fail) throw new Error("boom")
    })
    const renderer = createPmmgRenderer(table, { rasterise })
    await renderer.render(update("ab"))
    fail = true
    await expect(renderer.render(update("ab"))).rejects.toThrow("boom")
    fail = false
    await renderer.render(update("ab"))
    expect(renderer.latest?.made).toEqual(["card:a", "card:b"])
  })

  it("forgets everything when cleared", async () => {
    const renderer = createPmmgRenderer(cards(), { rasterise })
    await renderer.render(update("a"))
    const bitmap = renderer.sprite("card:a", 2)!.bitmap
    renderer.clear()
    expect(bitmap.close).toHaveBeenCalled()
    expect(renderer.spritesAt(2)).toEqual([])
    await renderer.render(update("a"))
    expect(renderer.latest?.made).toEqual(["card:a"])
  })
})
