import { describe, expect, it } from "vitest"

import { formatDuration, formatElapsed } from "./duration.js"

describe("formatDuration", () => {
  it("uses milliseconds under a second", () => {
    expect(formatDuration(0)).toBe("0ms")
    expect(formatDuration(283)).toBe("283ms")
    expect(formatDuration(999)).toBe("999ms")
  })

  it("uses one decimal of seconds under a minute", () => {
    expect(formatDuration(1000)).toBe("1.0s")
    expect(formatDuration(12_400)).toBe("12.4s")
  })

  it("uses zero-padded minutes and seconds above a minute", () => {
    expect(formatDuration(60_000)).toBe("1m00s")
    expect(formatDuration(362_000)).toBe("6m02s")
  })

  it("carries seconds that round up to a full minute", () => {
    expect(formatDuration(119_700)).toBe("2m00s")
  })
})

describe("formatElapsed", () => {
  it("drops sub-second precision so a live counter doesn't flicker", () => {
    expect(formatElapsed(9)).toBe("0s")
    expect(formatElapsed(999)).toBe("0s")
    expect(formatElapsed(12_400)).toBe("12s")
  })

  it("matches formatDuration above a minute", () => {
    expect(formatElapsed(65_400)).toBe("1m05s")
  })
})
