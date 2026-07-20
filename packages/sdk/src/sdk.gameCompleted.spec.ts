import { describe, expect, it, beforeEach } from "vitest"

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

const bootWithGameplay = () => {
  const sdk = createPuzzmoSDK()
  sendFromHost("READY_DATA", { startOrFindGameplay: { gamePlayed: { id: "gp-1", boardState: "", puzzle: { puzzle: "p" } } } })
  sendFromHost("START_GAME", {})
  return sdk
}

const lastMessage = (type: string) => {
  const matches = sentToHost.filter((m) => m.type === type)
  return matches[matches.length - 1]?.json
}

describe("sdk.gameCompleted() inputString/boardState alias", () => {
  beforeEach(() => {
    sentToHost.length = 0
  })

  it("maps inputString onto the wire boardState field", () => {
    const sdk = bootWithGameplay()
    sdk.gameCompleted({ inputString: "v1:42", pointsAwarded: 42 })

    const input = lastMessage("GAME_COMPLETED").input
    expect(input.boardState).toBe("v1:42")
    expect(input.inputString).toBeUndefined()
  })

  it("still accepts the untyped boardState spelling at runtime", () => {
    const sdk = bootWithGameplay()
    sdk.gameCompleted({ boardState: "v1:7", pointsAwarded: 7 } as any)

    expect(lastMessage("GAME_COMPLETED").input.boardState).toBe("v1:7")
  })
})
