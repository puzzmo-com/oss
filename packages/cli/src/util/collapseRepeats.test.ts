import { describe, expect, it } from "vitest"

import { collapseRepeats, foldTailRepeat, type RepeatableLine } from "./collapseRepeats.js"

/** Feeds lines in one at a time the way the pane does, then flattens for comparison. */
const appendAll = (texts: string[]): string[] => {
  const lines: RepeatableLine[] = []
  for (const text of texts) {
    lines.push({ text, reps: 1 })
    foldTailRepeat(lines)
  }
  return lines.map((l) => (l.reps > 1 ? `${l.text} (x ${l.reps})` : l.text))
}

describe("foldTailRepeat", () => {
  it("folds identical lines as they arrive", () => {
    expect(appendAll(["a", "a", "a", "b"])).toEqual(["a (x 3)", "b"])
  })

  it("folds a repeating call/result pair, which is what retried edits look like", () => {
    const stream = ["Edit main.ts", "  ✓ updated", "Edit main.ts", "  ✓ updated", "Edit main.ts", "  ✓ updated", "Done"]
    expect(appendAll(stream)).toEqual(["Edit main.ts (x 3)", "  ✓ updated", "Done"])
  })

  it("leaves non-adjacent repeats alone", () => {
    expect(appendAll(["a", "b", "a"])).toEqual(["a", "b", "a"])
  })

  it("keeps a half-finished repeat visible until it completes", () => {
    expect(appendAll(["Edit x", "  ✓ ok", "Edit x"])).toEqual(["Edit x", "  ✓ ok", "Edit x"])
    expect(appendAll(["Edit x", "  ✓ ok", "Edit x", "  ✓ ok"])).toEqual(["Edit x (x 2)", "  ✓ ok"])
  })

  it("never buries an existing count inside a folded block", () => {
    // The second "a (x 2)" cannot merge into the first without losing a tally.
    expect(appendAll(["a", "a", "b", "a", "a", "b"])).toEqual(["a (x 2)", "b", "a (x 2)", "b"])
  })

  it("reports whether it folded", () => {
    const lines: RepeatableLine[] = [{ text: "a", reps: 1 }]
    expect(foldTailRepeat(lines)).toBe(false)
    lines.push({ text: "a", reps: 1 })
    expect(foldTailRepeat(lines)).toBe(true)
    expect(lines).toEqual([{ text: "a", reps: 2 }])
  })
})

describe("collapseRepeats", () => {
  it("leaves lines with no repeats alone", () => {
    expect(collapseRepeats(["a", "b", "c"])).toEqual(["a", "b", "c"])
  })

  it("folds consecutive identical lines", () => {
    expect(collapseRepeats(["a", "a", "a", "b"])).toEqual(["a (x 3)", "b"])
  })

  it("folds a repeating call/result pair, which is what retried edits look like", () => {
    const lines = ["Edit main.ts", "  ✓ updated", "Edit main.ts", "  ✓ updated", "Edit main.ts", "  ✓ updated", "Done"]
    expect(collapseRepeats(lines)).toEqual(["Edit main.ts (x 3)", "  ✓ updated", "Done"])
  })

  it("does not fold repeats that are not adjacent", () => {
    expect(collapseRepeats(["a", "b", "a"])).toEqual(["a", "b", "a"])
  })

  it("keeps a trailing partial block rather than swallowing it", () => {
    expect(collapseRepeats(["a", "b", "a", "b", "a"])).toEqual(["a (x 2)", "b", "a"])
  })

  it("prefers the block length that folds the most lines", () => {
    // Folding the pair covers six lines; folding just the leading "a" would cover two.
    expect(collapseRepeats(["a", "a", "b", "a", "a", "b", "a", "a", "b"])).toEqual(["a", "a", "b"].map((l, i) => (i === 0 ? "a (x 3)" : l)))
  })

  it("handles an empty input", () => {
    expect(collapseRepeats([])).toEqual([])
  })
})
