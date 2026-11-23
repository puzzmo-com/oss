import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setTableBoardEnvironment, TableBoard, type TableBoardFrame, type TableBoardRenderer } from "./tableBoard"
import type { TableBoardScene, TableBoardUpdate, Theme } from "./types"

// Node has no canvas or animation frames, so the board draws on a stub and each test calls draw() at a time it picks
beforeEach(() => {
  vi.stubGlobal("document", { hidden: false })
  vi.stubGlobal("matchMedia", () => ({ matches: false }))
  vi.stubGlobal("requestAnimationFrame", () => 1)
  vi.stubGlobal("devicePixelRatio", 1)
})
afterEach(() => vi.unstubAllGlobals())

const stay = { duration: 300, keyframes: [{ offset: 0 }, { offset: 1 }] }

/** A pile of cards at one spot, the top one shown, the rest out of the scene, as Draw 2 covers them */
const pile = (top: number): TableBoardScene => ({
  width: 100,
  height: 100,
  transition: { duration: 300 },
  nodes: [{ key: `card:${top}`, sprite: "card", x: 10, y: 10, exit: stay }],
})

const setUp = (sceneFor: (input: string) => TableBoardScene = (input) => pile(Number(input))) => {
  const drawImages = { count: 0 }
  const ctx = new Proxy(
    { canvas: null as unknown },
    {
      get: (target, name) => {
        if (name in target) return target[name as "canvas"]
        return name === "drawImage" ? () => drawImages.count++ : () => {}
      },
    },
  )
  const canvas = { width: 0, height: 0, style: {}, getContext: () => ctx } as unknown as HTMLCanvasElement
  ctx.canvas = canvas
  const updates: TableBoardUpdate[] = []
  const renderer: TableBoardRenderer = {
    render: async (update) => {
      updates.push(update)
      return sceneFor(update.input)
    },
    sprite: () => ({ bitmap: {} as ImageBitmap, width: 10, height: 10, anchor: [5, 5] }),
  }
  const board = new TableBoard(canvas, renderer, "test", () => {})
  let frame: TableBoardFrame | undefined
  board.onDrawn = (drawn) => (frame = drawn)
  board.resize(100, 100)
  board.setTheme({ type: "light" } as Theme)
  return {
    board,
    updates,
    drawImages,
    /** The keys drawn at `now`, exits marked */
    drawnAt: (now: number) => {
      board.draw(now)
      return frame!.nodes.map((node) => (node.exiting ? `${node.key} (exiting)` : node.key))
    },
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("TableBoard", () => {
  it("lets a node that left go once its exit has played, rather than playing it again on the next update", async () => {
    const now = vi.spyOn(performance, "now")
    const { board, drawnAt } = setUp()

    now.mockReturnValue(1000)
    board.update({ puzzle: "p", input: "1" })
    await settle()
    expect(drawnAt(1000)).toEqual(["card:1"])

    // Covered: card 1 stays while card 2 lands on it
    now.mockReturnValue(2000)
    board.update({ puzzle: "p", input: "2" })
    await settle()
    expect(drawnAt(2100)).toEqual(["card:1 (exiting)", "card:2"])
    expect(drawnAt(2400)).toEqual(["card:2"])

    // A later move shows only what's in the scene, and what that move covered
    now.mockReturnValue(3000)
    board.update({ puzzle: "p", input: "3" })
    await settle()
    expect(drawnAt(3100)).toEqual(["card:2 (exiting)", "card:3"])
    board.dispose()
  })

  it("tells the bundle where the board is shown, and draws it again when that changes", async () => {
    const { board, updates } = setUp()
    board.update({ puzzle: "p", input: "1" })
    await settle()
    // Seated, on the theme's background
    expect(updates[0]).toMatchObject({ fidelity: "high", backgroundStyle: "light" })

    board.setLook({ fidelity: "low", backgroundStyle: "dark" })
    await settle()
    expect(updates).toHaveLength(2)
    expect(updates[1]).toMatchObject({ input: "1", fidelity: "low", backgroundStyle: "dark" })

    // The same look again changes nothing
    board.setLook({ fidelity: "low", backgroundStyle: "dark" })
    await settle()
    expect(updates).toHaveLength(2)
    board.dispose()
  })

  it("caps brightness however deeply it multiplies, since each extra unit is another draw", async () => {
    // Uncapped, three nested nodes at the most brightness each draws the sprite a thousand times
    const { board, drawImages, drawnAt } = setUp(() => ({
      width: 100,
      height: 100,
      nodes: [
        { key: "a", x: 0, y: 0, brightness: 10 },
        { key: "b", parent: "a", x: 0, y: 0, brightness: 10 },
        { key: "c", parent: "b", sprite: "card", x: 10, y: 10, brightness: 10 },
      ],
    }))
    board.update({ puzzle: "p", input: "1" })
    await settle()
    drawImages.count = 0
    drawnAt(1000)
    expect(drawImages.count).toBe(10)
    board.dispose()
  })

  it("draws in a worker: no document, a canvas with no element, and its size on the page sent through onFit", async () => {
    // As a worker has it: nothing of the page but what it was told
    vi.unstubAllGlobals()
    vi.stubGlobal("requestAnimationFrame", () => 1)
    setTableBoardEnvironment({ devicePixelRatio: 2, hidden: false, reducedMotion: false })
    const ctx = new Proxy({}, { get: () => () => {} })
    const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as OffscreenCanvas
    const renderer: TableBoardRenderer = {
      render: async () => ({ width: 100, height: 50, nodes: [{ key: "card", sprite: "card", x: 10, y: 10 }] }),
      sprite: () => ({ bitmap: {} as ImageBitmap, width: 10, height: 10, anchor: [5, 5] }),
    }
    const board = new TableBoard(canvas, renderer, "test", () => {})
    const fits: [number, number][] = []
    board.onFit = (cssWidth, cssHeight) => fits.push([cssWidth, cssHeight])
    board.resize(200, 400)
    board.setTheme({ type: "light" } as Theme)
    board.update({ puzzle: "p", input: "1" })
    await settle()
    board.draw(1000)

    expect([canvas.width, canvas.height]).toEqual([400, 200])
    // Told once, not on every frame
    expect(fits).toEqual([[200, 100]])
    board.dispose()
    setTableBoardEnvironment({ devicePixelRatio: undefined, hidden: undefined, reducedMotion: undefined })
  })
})
