import { describe, expect, it, beforeEach } from "vitest"

import { defaultKeyboardConfig, keyStylesFromRules } from "./keyboard"

// Same window stub as the other SDK specs: the module wires its listener at import time, so this
// has to exist before the import below.
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

describe("keyStylesFromRules", () => {
  it("expands a rule across every key it names", () => {
    expect(keyStylesFromRules([{ keys: ["a", "b"], text: { opacity: "0.4" } }])).toEqual({
      a: { text: { opacity: "0.4" } },
      b: { text: { opacity: "0.4" } },
    })
  })

  it("merges overlapping rules property by property, with the later rule winning", () => {
    const styles = keyStylesFromRules([
      { keys: ["a", "b"], text: { opacity: "0.4", color: "#111" }, background: { backgroundColor: "#eee" } },
      { keys: ["b"], text: { opacity: "1" } },
    ])

    expect(styles).toEqual({
      a: { text: { opacity: "0.4", color: "#111" }, background: { backgroundColor: "#eee" } },
      b: { text: { opacity: "1", color: "#111" }, background: { backgroundColor: "#eee" } },
    })
  })

  it("leaves out the group a rule didn't set", () => {
    const styles = keyStylesFromRules([{ keys: ["a"], text: { opacity: "0.4" } }])
    expect(styles.a.background).toBeUndefined()
  })

  it("returns an empty map for no rules", () => {
    expect(keyStylesFromRules([])).toEqual({})
  })
})

describe("sdk.keyboard.show", () => {
  beforeEach(() => {
    sentToHost.length = 0
  })

  it("carries per-key styles in the config, the same way it carries disabled keys", () => {
    const sdk = createPuzzmoSDK()
    const individualKeyStyles = keyStylesFromRules([{ keys: ["a"], text: { opacity: "0.4" } }])
    sdk.keyboard.show({ ...defaultKeyboardConfig, disabled: ["a"], individualKeyStyles })

    const sent = sentToHost.filter((m) => m.type === "KEYBOARD_UPDATE_CONFIG")
    expect(sent).toHaveLength(1)
    expect(sent[0].json.individualKeyStyles).toEqual(individualKeyStyles)
    expect(sent[0].json.disabled).toEqual(["a"])
  })

  it("drops the styling along with everything else on hide", () => {
    const sdk = createPuzzmoSDK()
    sdk.keyboard.show({ ...defaultKeyboardConfig, individualKeyStyles: { a: { text: { opacity: "0.4" } } } })
    sdk.keyboard.hide()

    const sent = sentToHost.filter((m) => m.type === "KEYBOARD_UPDATE_CONFIG")
    expect(sent[sent.length - 1].json.individualKeyStyles).toBeUndefined()
  })
})
