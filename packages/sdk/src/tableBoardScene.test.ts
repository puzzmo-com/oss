import { describe, expect, it } from "vitest"

import { spritesIn, validateScene } from "./tableBoardScene"

const card = { key: "card:1", sprite: "face:1", x: 10, y: 20 }

describe("validateScene", () => {
  it("keeps what it knows and drops the rest", () => {
    const scene = validateScene({ width: 100, height: 200, nodes: [{ ...card, extra: "<script>" }], script: "x" })
    expect(scene).toEqual({ width: 100, height: 200, nodes: [card] })
  })

  it("clamps opacity and timings into range", () => {
    const scene = validateScene({
      width: 1,
      height: 1,
      nodes: [{ ...card, opacity: 4, transition: { duration: 1e9, delay: -5 } }],
    })
    expect(scene.nodes[0]).toMatchObject({ opacity: 1, transition: { duration: 10_000, delay: 0 } })
  })

  it("refuses numbers that aren't finite", () => {
    expect(() => validateScene({ width: 1, height: 1, nodes: [{ ...card, x: NaN }] })).toThrow("Node 0's x must be a finite number")
    expect(() => validateScene({ width: Infinity, height: 1, nodes: [] })).toThrow("width")
  })

  it("refuses nodes nested past the depth limit", () => {
    const chain = (depth: number) =>
      Array.from({ length: depth }, (_, index) => ({ key: `n${index}`, x: 0, y: 0, ...(index ? { parent: `n${index - 1}` } : {}) }))
    expect(validateScene({ width: 1, height: 1, nodes: chain(16) }).nodes).toHaveLength(16)
    expect(() => validateScene({ width: 1, height: 1, nodes: chain(17) })).toThrow('Node "n16" is nested over 16 nodes deep')
  })

  it("refuses a key used twice, and a parent that comes after its child", () => {
    expect(() => validateScene({ width: 1, height: 1, nodes: [card, card] })).toThrow("used twice")
    expect(() =>
      validateScene({
        width: 1,
        height: 1,
        nodes: [
          { ...card, parent: "piece" },
          { key: "piece", x: 0, y: 0 },
        ],
      }),
    ).toThrow("must come before it")
  })

  it("refuses keyframes out of order and effects for nodes that aren't there", () => {
    const keyframes = [{ offset: 0.5 }, { offset: 0.2 }]
    expect(() => validateScene({ width: 1, height: 1, nodes: [{ ...card, enter: { duration: 100, keyframes } }] })).toThrow("in order")
    expect(() =>
      validateScene({ width: 1, height: 1, nodes: [card], effects: [{ key: "nope", duration: 100, keyframes: [{ offset: 0 }] }] }),
    ).toThrow("isn't in the scene")
  })

  it("keeps a known blend and refuses an unknown one", () => {
    const scene = validateScene({ width: 1, height: 1, nodes: [{ ...card, blend: "hard-light" }] })
    expect(scene.nodes[0].blend).toBe("hard-light")
    expect(() => validateScene({ width: 1, height: 1, nodes: [{ ...card, blend: "plus-darker" }] })).toThrow("blend must be one of")
  })

  it("refuses an isolated node's child listed after something outside it", () => {
    const group = { key: "pieces", x: 0, y: 0, isolate: true }
    const inside = { ...card, parent: "pieces" }
    const outside = { key: "frame", x: 0, y: 0 }
    expect(validateScene({ width: 1, height: 1, nodes: [group, inside, outside] }).nodes[0].isolate).toBe(true)
    expect(() => validateScene({ width: 1, height: 1, nodes: [group, outside, inside] })).toThrow(
      "must come straight after its other children",
    )
  })

  it("caps how many nodes a scene can hold", () => {
    const nodes = Array.from({ length: 5001 }, (_, i) => ({ key: `n${i}`, x: 0, y: 0 }))
    expect(() => validateScene({ width: 1, height: 1, nodes })).toThrow("at most 5000")
  })
})

describe("spritesIn", () => {
  it("finds sprites in nodes, enter and exit keyframes and effects", () => {
    const scene = validateScene({
      width: 1,
      height: 1,
      nodes: [{ ...card, exit: { duration: 100, keyframes: [{ offset: 1, sprite: "gone" }] } }],
      effects: [{ key: "card:1", duration: 200, keyframes: [{ offset: 0.5, sprite: "back" }] }],
    })
    expect([...spritesIn(scene)].sort()).toEqual(["back", "face:1", "gone"])
  })
})
