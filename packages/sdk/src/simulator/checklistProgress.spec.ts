import { describe, it, expect } from "vitest"

import { advanceChecklist, evaluateItem, scopeFromDeeds } from "./checklistProgress"

describe("scopeFromDeeds", () => {
  it("camelizes ids, prefers name, and skips undefined values", () => {
    const scope = scopeFromDeeds([
      { id: "flush-count", value: 2 },
      { id: "x", name: "named-deed", value: true },
      { id: "missing", value: undefined },
    ])
    expect(scope).toEqual({ flushCount: 2, namedDeed: true })
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
