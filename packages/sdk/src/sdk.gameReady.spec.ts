import { describe, expect, it, vi } from "vitest"

// Minimal window stub so the SDK module can load in node and round-trip messages synchronously.
// Must be set up before the sdk module is imported, as it wires its listener at import time.
const listeners: ((event: { data: any }) => void)[] = []
const sentToHost: { type: string; json: any }[] = []

const windowStub: any = {
  addEventListener: (_type: string, fn: (event: { data: any }) => void) => listeners.push(fn),
  postMessage: (message: any) => {
    if (message?.private) sentToHost.push({ type: message.type, json: message.json })
    listeners.forEach((fn) => fn({ data: message }))
  },
}
windowStub.parent = windowStub
;(globalThis as any).window = windowStub

const { createPuzzmoSDK } = await import("./sdk")

const sendFromHost = (type: string, data: any) => windowStub.postMessage({ type, data })

const game = {
  id: "g-1:game",
  slug: "draw-2-solitaire",
  stableSlug: "draw-2-solitaire",
  displayName: "Draw 2 Solitaire",
  version: { flagsArr: [0], featuresArr: [0] },
}

describe("sdk.gameReady()", () => {
  it("hands over the puzzle when the host boots a session", async () => {
    const sdk = createPuzzmoSDK()
    const ready = sdk.gameReady()
    sendFromHost("READY_DATA", { game, session: { gameplay: { id: "gp-1", boardState: "b" }, puzzle: { puzzle: "p" } } })

    const result = await ready
    expect(result.mode).toBe("puzzle")
    expect(result.puzzleString).toBe("p")
    expect(result.inputString).toBe("b")
  })

  it("resolves in repeatable mode when the host boots the game for repeat play", async () => {
    const sdk = createPuzzmoSDK()
    const ready = sdk.gameReady()
    sendFromHost("READY_DATA", { game, repeatable: true, viewerStorage: { state: "s", stateVersion: 2 } })

    const result = await ready
    expect(result.mode).toBe("repeatable")
    expect(result.puzzleString).toBeNull()
    expect(result.inputString).toBeNull()
    expect(sdk.storage.get()).toEqual({ state: "s", stateVersion: 2 })
  })

  it("warns once that storage is not saved outside repeat play", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const sdk = createPuzzmoSDK()
    const ready = sdk.gameReady()
    sendFromHost("READY_DATA", { game, session: { gameplay: { id: "gp-3" }, puzzle: { puzzle: "p" } } })
    await ready

    sdk.storage.set("a")
    sdk.storage.set("b")
    expect(warn).toHaveBeenCalledTimes(1)
    expect(sdk.storage.get()).toEqual({ state: "b", stateVersion: 1 })
    warn.mockRestore()
  })

  it("stays in puzzle mode for a boot with no session that the host did not mark as repeat play", async () => {
    const sdk = createPuzzmoSDK()
    const ready = sdk.gameReady()
    sendFromHost("READY_DATA", { game })

    expect(await ready).toMatchObject({ mode: "puzzle", puzzleString: null, puzzleKey: null })
  })
})

describe("a repeatable game with a puzzle pool", () => {
  const lastSent = (type: string) => sentToHost.filter((m) => m.type === type).slice(-1)[0]?.json

  it("gets its first puzzle and its key from the boot", async () => {
    const sdk = createPuzzmoSDK()
    const ready = sdk.gameReady()
    sendFromHost("READY_DATA", { game, repeatable: true, repeatablePuzzle: { key: "v2/3/17", puzzle: "deal" } })

    const result = await ready
    expect(result).toMatchObject({ mode: "repeatable", puzzleString: "deal", puzzleKey: "v2/3/17" })
  })

  it("asks the host for another and resolves with its answer", async () => {
    const sdk = createPuzzmoSDK()
    const next = sdk.requestPuzzle({ buckets: ["3"], exclude: ["v2/3/17"] })

    const request = lastSent("REQUEST_PUZZLE")
    expect(request).toMatchObject({ buckets: ["3"], exclude: ["v2/3/17"] })
    sendFromHost("PUZZLE_DATA", { nonce: "someone-else", puzzle: { key: "v2/3/1", puzzle: "wrong" } })
    sendFromHost("PUZZLE_DATA", { nonce: request.nonce, puzzle: { key: "v2/3/18", puzzle: "next deal" } })

    expect(await next).toEqual({ puzzleKey: "v2/3/18", puzzleString: "next deal" })
  })

  it("rejects when the host says there is no puzzle, or never answers", async () => {
    const sdk = createPuzzmoSDK()
    const refused = sdk.requestPuzzle()
    sendFromHost("PUZZLE_DATA", { nonce: lastSent("REQUEST_PUZZLE").nonce, error: "This game has no puzzle pool", failed: true })
    await expect(refused).rejects.toThrow("no puzzle pool")

    vi.useFakeTimers()
    const unanswered = sdk.requestPuzzle()
    vi.advanceTimersByTime(10_000)
    await expect(unanswered).rejects.toThrow("Timeout")
    vi.useRealTimers()
  })

  it("reports a run against the puzzle it was played on", () => {
    const sdk = createPuzzmoSDK()
    sdk.completeRepeatableRun({ elapsedTimeSecs: 30, puzzleKey: "v2/3/18" })
    expect(lastSent("COMPLETE_REPEATABLE_RUN").input).toMatchObject({ elapsedTimeSecs: 30, puzzleKey: "v2/3/18" })

    sdk.completeRepeatableRun({ elapsedTimeSecs: 30 })
    expect(lastSent("COMPLETE_REPEATABLE_RUN").input).not.toHaveProperty("puzzleKey")
  })

  it("logs a round's events with where each batch starts, counting afresh from each start", () => {
    const sdk = createPuzzmoSDK()
    sdk.rounds.start({ reason: "new", puzzleKey: "v2/3/18" })
    expect(lastSent("START_REPEATABLE_ROUND")).toEqual({ reason: "new", puzzleKey: "v2/3/18" })

    sdk.rounds.log([0, "d"], [120, "m", 3, 4])
    sdk.rounds.log([300, "u"])
    expect(lastSent("APPEND_REPEATABLE_ROUND_LOG")).toEqual({ from: 2, events: [[300, "u"]] })

    sdk.rounds.start({ reason: "reset" })
    expect(lastSent("START_REPEATABLE_ROUND")).toEqual({ reason: "reset" })
    sdk.rounds.log([10, "d"])
    expect(lastSent("APPEND_REPEATABLE_ROUND_LOG")).toEqual({ from: 0, events: [[10, "d"]] })
  })

  it("resumes a round with its saved log, and carries on logging from where it ends", () => {
    const sdk = createPuzzmoSDK()
    sdk.rounds.resume({
      puzzleKey: "v2/3/18",
      events: [
        [0, "d"],
        [120, "m", 3, 4],
      ],
    })
    expect(lastSent("RESUME_REPEATABLE_ROUND")).toEqual({
      puzzleKey: "v2/3/18",
      events: [
        [0, "d"],
        [120, "m", 3, 4],
      ],
    })

    sdk.rounds.log([300, "u"])
    expect(lastSent("APPEND_REPEATABLE_ROUND_LOG")).toEqual({ from: 2, events: [[300, "u"]] })
  })

  it("hands the game the achievements a round unlocked", () => {
    const sdk = createPuzzmoSDK()
    const heard: unknown[] = []
    sdk.on("achievementsUnlocked", (data) => heard.push(data))
    const achievements = [
      { stableID: "no-regrets", name: "No Regrets", description: "", icon: "", tier: "Fancy", isSiteAchievement: false },
    ]
    sendFromHost("ACHIEVEMENTS_UNLOCKED", { achievements })
    expect(heard).toEqual([{ achievements }])
  })

  it("refuses state the host would refuse, without keeping it", () => {
    const sdk = createPuzzmoSDK()
    expect(() => sdk.storage.set("x".repeat(64 * 1024 + 1))).toThrow(/byte cap/)
    expect(() => sdk.storage.set("x", 0)).toThrow(/stateVersion/)
    expect(sdk.storage.get()).toBeNull()
  })

  it("sends the run's own time as its only time deed", () => {
    const sdk = createPuzzmoSDK()
    sdk.completeRepeatableRun({ elapsedTimeSecs: 30 }, {
      deeds: [
        { id: "time", value: 93 },
        { id: "moves", value: 4 },
      ],
    } as any)
    expect(lastSent("COMPLETE_REPEATABLE_RUN").input.deedValues).toEqual([
      { id: "moves", value: 4 },
      { id: "time", value: 30 },
    ])
  })

  it("times each run from where the last one ended when the game passes no time", () => {
    vi.useFakeTimers()
    const sdk = createPuzzmoSDK()
    sendFromHost("START_GAME", {})

    vi.advanceTimersByTime(40_000)
    sdk.completeRepeatableRun()
    expect(lastSent("COMPLETE_REPEATABLE_RUN").input.elapsedTimeSecs).toBe(40)

    vi.advanceTimersByTime(25_000)
    sdk.completeRepeatableRun()
    expect(lastSent("COMPLETE_REPEATABLE_RUN").input.elapsedTimeSecs).toBe(25)
    vi.useRealTimers()
  })
})
