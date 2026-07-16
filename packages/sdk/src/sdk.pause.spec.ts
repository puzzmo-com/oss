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

describe("sdk.timer.pause() / sdk.timer.resume()", () => {
  beforeEach(() => {
    sentToHost.length = 0
  })

  it("stops and restarts the SDK-owned timer", () => {
    const sdk = createPuzzmoSDK()
    sendFromHost("START_GAME", {})

    expect(sdk.timer.isPaused()).toBe(false)

    sdk.timer.pause()
    expect(sdk.timer.isPaused()).toBe(true)

    sdk.timer.resume()
    expect(sdk.timer.isPaused()).toBe(false)
  })

  it("emits pause/resume events, the same as a host-sent PAUSE_GAME/RESUME_GAME", () => {
    const sdk = createPuzzmoSDK()
    sendFromHost("START_GAME", {})

    const events: string[] = []
    sdk.on("pause", () => events.push("pause"))
    sdk.on("resume", () => events.push("resume"))

    sdk.timer.pause()
    sdk.timer.resume()

    expect(events).toEqual(["pause", "resume"])
  })

  it("host-sent PAUSE_GAME/RESUME_GAME still drive the same timer as before", () => {
    const sdk = createPuzzmoSDK()
    sendFromHost("START_GAME", {})

    sendFromHost("PAUSE_GAME", {})
    expect(sdk.timer.isPaused()).toBe(true)

    sendFromHost("RESUME_GAME", {})
    expect(sdk.timer.isPaused()).toBe(false)
  })
})
