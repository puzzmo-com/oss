import { describe, expect, it } from "vitest"

import type { TableBoardDrawnNode } from "../tableBoard"
import { cornersOf, nodeAt } from "./pmmgOverlay"

const card = { width: 10, height: 20, anchor: [5, 10] as [number, number] }
const boxOf = (id: string) => (id === "card" ? card : undefined)

const node = (key: string, matrix: TableBoardDrawnNode["matrix"], extra: Partial<TableBoardDrawnNode> = {}): TableBoardDrawnNode => ({
  key,
  sprite: "card",
  matrix,
  alpha: 1,
  exiting: false,
  ...extra,
})

describe("cornersOf", () => {
  it("puts a sprite's box about its anchor, through the node's matrix", () => {
    expect(cornersOf([1, 0, 0, 1, 50, 50], card)).toEqual([
      [45, 40],
      [55, 40],
      [55, 60],
      [45, 60],
    ])
    // A quarter turn clockwise: the long side now runs across
    const turned = cornersOf([0, 1, -1, 0, 50, 50], card).map(([x, y]) => [Math.round(x), Math.round(y)])
    expect(turned).toEqual([
      [60, 45],
      [60, 55],
      [40, 55],
      [40, 45],
    ])
  })
})

describe("nodeAt", () => {
  it("finds the topmost node whose sprite is under the point", () => {
    const nodes = [node("under", [1, 0, 0, 1, 50, 50]), node("over", [1, 0, 0, 1, 52, 50])]
    expect(nodeAt(nodes, [51, 50], boxOf)?.key).toBe("over")
    expect(nodeAt(nodes, [46, 50], boxOf)?.key).toBe("under")
    expect(nodeAt(nodes, [80, 50], boxOf)).toBeNull()
  })

  it("follows a turned node, and skips hidden ones, ones with no sprite, and ones squashed flat", () => {
    expect(nodeAt([node("turned", [0, 1, -1, 0, 50, 50])], [59, 50], boxOf)?.key).toBe("turned")
    expect(nodeAt([node("hidden", [1, 0, 0, 1, 50, 50], { alpha: 0 })], [50, 50], boxOf)).toBeNull()
    expect(nodeAt([node("group", [1, 0, 0, 1, 50, 50], { sprite: undefined })], [50, 50], boxOf)).toBeNull()
    expect(nodeAt([node("flat", [0, 0, 0, 1, 50, 50])], [50, 50], boxOf)).toBeNull()
  })
})
