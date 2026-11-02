import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest"

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

// Each test gets a fresh SDK module: sdk.ts keeps one window-level hostAPI singleton, so without
// a reset every sendFromHost would also feed the SDK instances created by earlier tests.
let createPuzzmoSDK: typeof import("./sdk").createPuzzmoSDK
beforeEach(async () => {
  sentToHost.length = 0
  listeners.length = 0
  vi.resetModules()
  ;({ createPuzzmoSDK } = await import("./sdk"))
})

const sendFromHost = (type: string, data: any) => windowStub.postMessage({ type, data })

const game = {
  id: "g-1",
  slug: "anytime",
  stableSlug: "anytime",
  displayName: "Anytime",
  version: { id: "", label: null, featuresArr: [0], flagsArr: [0], runtime: { id: "", version: null } },
}
const withoutSession = {
  game,
  userState: { gameSettings: {}, id: "us", ownerID: "o" },
  currentUser: null,
  theme: null,
  hostContext: [],
  appRuntimeContract: "1.1",
}
const withSession = {
  ...withoutSession,
  session: { gameplay: { id: "gp-1", boardState: "saved", completed: false }, puzzle: { id: "pz-1", puzzle: "the-puzzle" } },
  appRuntimeContract: "1.0",
}

const sent = (type: string) => sentToHost.filter((m) => m.type === type).map((m) => m.json)
const lastSent = (type: string) => sent(type)[sent(type).length - 1]

describe("runtime contract declaration", () => {
  it("declares 1.1", async () => {
    const sdk = createPuzzmoSDK()
    const ready = sdk.gameReady()
    sendFromHost("READY_DATA", withSession)
    await ready
    sdk.gameLoaded()

    expect(lastSent("READY")).toEqual({ runtimeContract: "1.1" })
    expect(lastSent("READY_GAME_LOADED").gameRuntimeContract).toBe("1.1")
  })

  it("types puzzleString as nullable, so every game handles a missing puzzle", () => {
    const create = () => createPuzzmoSDK()
    type Result = Awaited<ReturnType<ReturnType<typeof create>["gameReady"]>>

    expectTypeOf<Result["puzzleString"]>().toEqualTypeOf<string | null>()
  })
})

describe("gameReady() without a session", () => {
  it("resolves with a null puzzle", async () => {
    const sdk = createPuzzmoSDK()
    const ready = sdk.gameReady()
    sendFromHost("READY_DATA", withoutSession)

    const result = await ready
    expect(result.puzzleString).toBeNull()
    expect(result.inputString).toBeNull()
    expect(result.completed).toBe(false)
    expect(result.readyData?.game.slug).toBe("anytime")
  })

  it("uses READY_DATA which arrived before gameReady() was called", async () => {
    const sdk = createPuzzmoSDK({ timeout: 50 })
    sendFromHost("READY_DATA", withoutSession)

    const result = await sdk.gameReady()
    expect(result.puzzleString).toBeNull()
  })

  it("returns the puzzle and saved state when the host sends a session", async () => {
    const sdk = createPuzzmoSDK()
    const ready = sdk.gameReady()
    sendFromHost("READY_DATA", withSession)

    const result = await ready
    expect(result.puzzleString).toBe("the-puzzle")
    expect(result.inputString).toBe("saved")
  })
})

describe("gameplay calls without a session", () => {
  const bootWithoutSession = async () => {
    const sdk = createPuzzmoSDK()
    const ready = sdk.gameReady()
    sendFromHost("READY_DATA", withoutSession)
    await ready
    return sdk
  }

  it("drops state saves and checkpoints with one warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const sdk = await bootWithoutSession()

    sdk.updateGameState("state")
    sdk.updateGameState("state")
    sdk.hitCheckpoint("half", { process: [] } as any)

    expect(sent("UPLOAD_NEW_GAME_STATE")).toHaveLength(0)
    expect(sent("HIT_CHECKPOINT")).toHaveLength(0)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it("reports a completion with no gameplay ID", async () => {
    const sdk = await bootWithoutSession()
    sdk.gameCompleted({ inputString: "done", pointsAwarded: 3 })

    const completed = lastSent("GAME_COMPLETED")
    expect(completed.id).toBeUndefined()
    expect(completed.input.boardState).toBe("done")
  })

  it("drops an id-less completion for a host which never negotiated 1.1", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const sdk = createPuzzmoSDK()
    const ready = sdk.gameReady()
    // A pre-1.1 host always sends a session; one without a gameplay is a host bug, and the old
    // SDK dropped the completion rather than sending a shape such hosts type as requiring an id
    sendFromHost("READY_DATA", { ...withoutSession, appRuntimeContract: undefined })
    await ready

    sdk.gameCompleted({ inputString: "done", pointsAwarded: 3 })
    expect(sent("GAME_COMPLETED")).toHaveLength(0)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it("warns when gameplay calls happen before READY_DATA arrives", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const sdk = createPuzzmoSDK()

    sdk.updateGameState("early")
    sdk.gameCompleted({ inputString: "early", pointsAwarded: 0 })

    expect(sent("UPLOAD_NEW_GAME_STATE")).toHaveLength(0)
    expect(sent("GAME_COMPLETED")).toHaveLength(0)
    expect(warn).toHaveBeenCalledTimes(1) // warnings are once-per-instance
    warn.mockRestore()
  })
})
