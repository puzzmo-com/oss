import { describe, expect, it, beforeEach } from "vitest"

import type { SDKPlugin } from "./plugins"

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

// A tiny plugin that exercises every part of the context: send, on, timer, bootstrap.
const probePlugin: SDKPlugin<"probe", { fire: (msg: string) => void; received: string[]; bootstrapID: () => string | null }> = {
  name: "probe",
  setup: (ctx) => {
    const received: string[] = []
    ctx.on("START_GAME", () => received.push("start"))
    return {
      fire: (msg) => ctx.send("PROBE_MESSAGE", msg),
      received,
      bootstrapID: () => ctx.bootstrap()?.startOrFindGameplay?.gamePlayed?.id ?? null,
    }
  },
}

describe("sdk plugins", () => {
  beforeEach(() => {
    sentToHost.length = 0
  })

  it("exposes each plugin's API under sdk.plugins[name]", () => {
    const sdk = createPuzzmoSDK({ plugins: [probePlugin] })
    expect(typeof sdk.plugins.probe.fire).toBe("function")
  })

  it("lets a plugin send arbitrary host messages through the shared transport", () => {
    const sdk = createPuzzmoSDK({ plugins: [probePlugin] })
    sdk.plugins.probe.fire("hello")

    const sent = sentToHost.find((m) => m.type === "PROBE_MESSAGE")
    expect(sent?.json).toBe("hello")
  })

  it("lets a plugin subscribe to host messages and read the bootstrap payload", () => {
    const sdk = createPuzzmoSDK({ plugins: [probePlugin] })
    sendFromHost("READY_DATA", { startOrFindGameplay: { gamePlayed: { id: "gp-1", puzzle: { puzzle: "p" } } } })
    sendFromHost("START_GAME", {})

    expect(sdk.plugins.probe.received).toEqual(["start"])
    expect(sdk.plugins.probe.bootstrapID()).toBe("gp-1")
  })

  it("defaults to an empty plugins map when none are passed", () => {
    const sdk = createPuzzmoSDK()
    expect(sdk.plugins).toEqual({})
  })
})
