import { describe, expect, it, beforeEach } from "vitest"

// state.ts reaches for localStorage and window.location directly, so stub both before importing it.
class MemoryStorage {
  items = new Map<string, string>()
  /** Set to make every write throw, the way a full or private-mode store does. */
  readOnly = false

  getItem(key: string) {
    return this.items.has(key) ? this.items.get(key)! : null
  }
  setItem(key: string, value: string) {
    if (this.readOnly) throw new Error("QuotaExceededError")
    this.items.set(key, value)
  }
  removeItem(key: string) {
    this.items.delete(key)
  }
}

const storage = new MemoryStorage()
const location = { pathname: "/games/ribbit/" }
;(globalThis as any).localStorage = storage
;(globalThis as any).window = { location }

const { createInitialState, getSimulatorOverride, persistSimulatorOverride, clearSimulatorOverride, clearSimulatorOverrides } =
  await import("./state")

describe("simulator overrides", () => {
  beforeEach(() => {
    storage.items.clear()
    storage.readOnly = false
    location.pathname = "/games/ribbit/"
  })

  it("round-trips a value and reports absence as null", () => {
    expect(getSimulatorOverride("input")).toBe(null)
    expect(persistSimulatorOverride("input", "board-state")).toBe(true)
    expect(getSimulatorOverride("input")).toBe("board-state")

    clearSimulatorOverride("input")
    expect(getSimulatorOverride("input")).toBe(null)
  })

  it("distinguishes an applied empty string from no override", () => {
    persistSimulatorOverride("puzzle", "")
    expect(getSimulatorOverride("puzzle")).toBe("")
  })

  it("scopes overrides to the page, so one game's input does not leak into another", () => {
    persistSimulatorOverride("input", "ribbit-state")

    location.pathname = "/games/crossword/"
    expect(getSimulatorOverride("input")).toBe(null)

    location.pathname = "/games/ribbit/"
    expect(getSimulatorOverride("input")).toBe("ribbit-state")
  })

  it("treats /index.html and trailing slashes as the same page", () => {
    persistSimulatorOverride("input", "board-state")

    for (const pathname of ["/games/ribbit", "/games/ribbit//", "/games/ribbit/index.html"]) {
      location.pathname = pathname
      expect(getSimulatorOverride("input")).toBe("board-state")
    }
  })

  it("reports a failed write instead of throwing, so Apply can surface it", () => {
    storage.readOnly = true
    expect(persistSimulatorOverride("puzzle", "nope")).toBe(false)
  })

  it("clears both kinds together", () => {
    persistSimulatorOverride("puzzle", "p")
    persistSimulatorOverride("input", "i")

    clearSimulatorOverrides()

    expect(getSimulatorOverride("puzzle")).toBe(null)
    expect(getSimulatorOverride("input")).toBe(null)
  })
})

describe("createInitialState", () => {
  beforeEach(() => {
    storage.items.clear()
    storage.readOnly = false
    location.pathname = "/games/ribbit/"
  })

  it("starts empty when nothing has been applied", () => {
    const state = createInitialState({}, ["3x3"], ["ctrl", "data"])

    expect(state.puzzleData).toBe(null)
    expect(state.originalPuzzle).toBe("")
    expect(state.currentInputStr).toBe("")
    expect(state.appliedPuzzleOverride).toBe(null)
    expect(state.appliedInputOverride).toBe(null)
  })

  // The bug this guards: overrides have to be in state before the game sends READY, because
  // READY_DATA is the only time the game is handed its puzzle and board state.
  it("seeds applied overrides so they are in place before READY_DATA is built", () => {
    persistSimulatorOverride("puzzle", "custom-puzzle")
    persistSimulatorOverride("input", "custom-input")

    const state = createInitialState({}, ["3x3"], ["ctrl", "data"])

    expect(state.puzzleData).toBe("custom-puzzle")
    expect(state.originalPuzzle).toBe("custom-puzzle")
    expect(state.currentInputStr).toBe("custom-input")
    expect(state.appliedPuzzleOverride).toBe("custom-puzzle")
    expect(state.appliedInputOverride).toBe("custom-input")
  })

  it("seeds an input override on its own, leaving the puzzle to the fixtures", () => {
    persistSimulatorOverride("input", "custom-input")

    const state = createInitialState({}, ["3x3"], ["ctrl", "data"])

    expect(state.puzzleData).toBe(null)
    expect(state.appliedPuzzleOverride).toBe(null)
    expect(state.currentInputStr).toBe("custom-input")
  })
})
