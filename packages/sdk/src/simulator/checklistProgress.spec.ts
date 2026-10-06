import { describe, it, expect } from "vitest"

import { advanceChecklist, evaluateItem, sanitizeDeeds, scopeFromDeeds } from "./checklistProgress"

describe("scopeFromDeeds", () => {
  it("camelizes ids and skips undefined values", () => {
    const scope = scopeFromDeeds([
      { id: "flush-count", value: 2 },
      { id: "missing", value: undefined },
    ])
    expect(scope).toEqual({ flushCount: 2 })
  })

  it("ignores name, which puzzmo.com strips before the API sees it", () => {
    const { deeds } = sanitizeDeeds([{ id: "x", name: "named-deed", value: 1 }], "checkpoint")
    expect(scopeFromDeeds(deeds)).toEqual({ x: 1 })
  })
})

describe("sanitizeDeeds", () => {
  it("drops deeds without a string id and warns", () => {
    const result = sanitizeDeeds([null, { value: 1 }, { id: "ok", value: 1 }], "checkpoint")
    expect(result.deeds).toEqual([{ id: "ok", value: 1 }])
    expect(result.warnings).toHaveLength(2)
  })

  it("warns when deeds is not an array", () => {
    expect(sanitizeDeeds({ id: "x" }, "checkpoint")).toEqual({ deeds: [], warnings: [expect.stringContaining("not an array")] })
    expect(sanitizeDeeds(undefined, "completion")).toEqual({ deeds: [], warnings: [] })
  })

  it("keeps checkpoint values untouched", () => {
    expect(sanitizeDeeds([{ id: "moves", value: 2.9 }], "checkpoint").deeds).toEqual([{ id: "moves", value: 2.9 }])
  })

  it("floors numbers and drops null values on completion", () => {
    const { deeds } = sanitizeDeeds(
      [
        { id: "moves", value: 2.9 },
        { id: "gone", value: null },
        { id: "won", value: true },
      ],
      "completion",
    )
    expect(deeds).toEqual([
      { id: "moves", value: 2 },
      { id: "won", value: true },
    ])
  })

  it("keeps only the first persisted deeds for external games on completion", () => {
    const input = ["a", "b", "c", "d"].map((id) => ({ id, value: 1, persist: true }))
    const result = sanitizeDeeds([...input, { id: "temp", value: 1 }], "completion")
    expect(result.deeds.map((deed) => deed.id)).toEqual(["a", "b", "c", "temp"])
    expect(result.warnings).toEqual([expect.stringContaining("dropped: d")])
  })
})

describe("evaluateItem", () => {
  it("treats a boolean result as 1 or 0", () => {
    expect(evaluateItem({ incrementExp: "won" }, { won: true }).complete).toBe(true)
    expect(evaluateItem({ incrementExp: "won" }, { won: false }).complete).toBe(false)
  })

  it("compares the floored value against targetCount", () => {
    expect(evaluateItem({ incrementExp: "moves", targetCount: 3 }, { moves: 2.9 })).toEqual({ complete: false, value: 2 })
    expect(evaluateItem({ incrementExp: "moves", targetCount: 3 }, { moves: 3 })).toEqual({ complete: true, value: 3 })
  })

  it("gates on filterExp", () => {
    expect(evaluateItem({ incrementExp: "moves", filterExp: "hard" }, { moves: 5, hard: false }).complete).toBe(false)
    expect(evaluateItem({ incrementExp: "moves", filterExp: "hard" }, { moves: 5, hard: true }).complete).toBe(true)
  })

  it("reads unknown identifiers as undefined rather than erroring", () => {
    expect(evaluateItem({ incrementExp: "notSent" }, {})).toEqual({ complete: false, value: 0 })
  })

  it("reports expressions that return the wrong type", () => {
    const result = evaluateItem({ incrementExp: "'nope'" }, {})
    expect(result.complete).toBe(false)
    expect(result.error).toContain("incrementExp must return")
  })

  it("ignores deeds named after reserved words instead of failing every item", () => {
    expect(evaluateItem({ incrementExp: "moves" }, { moves: 1, class: 1, eval: 1 })).toEqual({ complete: true, value: 1 })
  })

  it("cannot reach JS globals, matching the API's angular-expressions sandbox", () => {
    expect(evaluateItem({ incrementExp: "Math.max(moves, 5)" }, { moves: 1 })).toEqual({ complete: false, value: 0 })
  })

  it("never completes an item without incrementExp", () => {
    expect(evaluateItem({ title: "Read this" }, { anything: 1 }).complete).toBe(false)
  })
})

describe("advanceChecklist", () => {
  const items = [
    { title: "a", incrementExp: "a", liveUpdate: true },
    { title: "b", incrementExp: "b" },
    { title: "c", incrementExp: "c", liveUpdate: true },
  ]

  it("stops at items without liveUpdate in checkpoint mode", () => {
    expect(advanceChecklist({ items, index: 0, scope: { a: 1, b: 1, c: 1 }, mode: "checkpoint" }).index).toBe(1)
  })

  it("walks through every satisfied item on completion", () => {
    expect(advanceChecklist({ items, index: 0, scope: { a: 1, b: 1, c: 1 }, mode: "completion" }).index).toBe(3)
  })

  it("stops at the first unsatisfied item and reports its value", () => {
    const result = advanceChecklist({ items, index: 0, scope: { a: 1, b: 0 }, mode: "completion" })
    expect(result.index).toBe(1)
    expect(result.head).toEqual({ complete: false, value: 0 })
  })

  it("handles an empty checklist", () => {
    expect(advanceChecklist({ items: [], index: 0, scope: {}, mode: "completion" })).toEqual({ index: 0, head: undefined })
  })

  it("clamps an out-of-range index", () => {
    expect(advanceChecklist({ items, index: 10, scope: {}, mode: "completion" }).index).toBe(3)
  })
})
