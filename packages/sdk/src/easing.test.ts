import { describe, expect, it } from "vitest"

import { parseEasing } from "./easing"

describe("parseEasing", () => {
  it("parses keywords, cubic-bezier and linear() with and without stops", () => {
    expect(parseEasing("linear")(0.25)).toBe(0.25)
    expect(parseEasing("ease-out")(0.5)).toBeGreaterThan(0.5)
    expect(parseEasing("cubic-bezier(0.42, 0, 1, 1)")(0.5)).toBeLessThan(0.5)
    const overshoot = parseEasing("linear(0, 1.2, 1)")
    expect(overshoot(0.5)).toBeCloseTo(1.2, 5)
    expect(overshoot(1)).toBe(1)
    const positioned = parseEasing("linear(0, 0.5 25%, 1)")
    expect(positioned(0.25)).toBeCloseTo(0.5, 5)
    expect(positioned(0.625)).toBeCloseTo(0.75, 5)
  })

  it("falls back to linear for easings it does not understand, never NaN", () => {
    for (const easing of ["steps(4, end)", "cubic-bezier(0.1, oops, 1, 1)", "cubic-bezier(0.1, 0.2)", "linear(0, nope, 1)", ""])
      expect(parseEasing(easing)(0.25)).toBe(0.25)
  })
})
