import { describe, expect, it, beforeEach } from "vitest"

import type { GameSettingsUIComponents } from "./types"

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

// userState.gameSettings is keyed by game slug, matching what real hosts send
const readyDataWithSettings = (settingsForGame: any) => ({
  userState: { gameSettings: { typeshift: settingsForGame }, id: "u", ownerID: "o" },
  startOrFindGameplay: { gamePlayed: { id: "gp", puzzle: { puzzle: "puzzle-str", game: { slug: "typeshift" } } } },
})

// The settings UI Typeshift ships in production, so the fixture reads like real usage
const components: GameSettingsUIComponents[] = [
  {
    id: "typeshift-safe-mode",
    subtitle: "Require double tapping to submit a word?",
    title: "Confirm word submission",
    type: "boolean",
    defaultValue: false,
    name: "confirmSubmit",
  },
  {
    id: "typeshift-highlight-core-words",
    subtitle: "Highlight letters found in core words?",
    title: "Highlight core words",
    type: "boolean",
    defaultValue: false,
    name: "highlightCoreWords",
  },
  {
    id: "typeshift-skip-single-letter-columns",
    subtitle: "Skip over columns with only one letter while typing?",
    title: "Skip single letter columns",
    type: "boolean",
    defaultValue: true,
    name: "skipSingleLetterColumns",
  },
]

describe("sdk.settings", () => {
  beforeEach(() => {
    sentToHost.length = 0
  })

  it("seeds settings from READY_DATA and merges component defaults underneath on initialize", () => {
    const sdk = createPuzzmoSDK()
    sendFromHost("READY_DATA", readyDataWithSettings({ confirmSubmit: true }))

    expect(sdk.settings.get()).toEqual({ confirmSubmit: true })

    const resolved = sdk.settings.initialize(components)
    expect(resolved).toEqual({ confirmSubmit: true, highlightCoreWords: false, skipSingleLetterColumns: true })

    const sent = sentToHost.find((m) => m.type === "INITIALIZE_SETTINGS")
    expect(sent?.json).toEqual({ components, settings: resolved })
  })

  it("parses settings stored as a JSON string (older records)", () => {
    const sdk = createPuzzmoSDK()
    sendFromHost("READY_DATA", readyDataWithSettings(JSON.stringify({ confirmSubmit: true })))

    expect(sdk.settings.get()).toEqual({ confirmSubmit: true })
  })

  it("falls back to component defaults when the user has no saved settings for this game", () => {
    const sdk = createPuzzmoSDK()
    sendFromHost("READY_DATA", {
      userState: { gameSettings: { "other-game": { confirmSubmit: true } }, id: "u", ownerID: "o" },
      startOrFindGameplay: { gamePlayed: { id: "gp", puzzle: { puzzle: "puzzle-str", game: { slug: "typeshift" } } } },
    })

    expect(sdk.settings.get()).toEqual({})
    expect(sdk.settings.initialize(components)).toEqual({ confirmSubmit: false, highlightCoreWords: false, skipSingleLetterColumns: true })
  })

  it("applies SETTINGS_UPDATE from the host and emits the full settings object", () => {
    const sdk = createPuzzmoSDK()
    sendFromHost("READY_DATA", readyDataWithSettings({}))
    sdk.settings.initialize(components)

    let emitted: any
    sdk.on("settingsUpdate", (data) => (emitted = data))
    sendFromHost("SETTINGS_UPDATE", { skipSingleLetterColumns: false })

    expect(emitted).toEqual({ confirmSubmit: false, highlightCoreWords: false, skipSingleLetterColumns: false })
    expect(sdk.settings.get()).toEqual(emitted)
  })

  it("update() merges changes and persists the full object to the host", () => {
    const sdk = createPuzzmoSDK()
    sendFromHost("READY_DATA", readyDataWithSettings({ confirmSubmit: true }))
    sdk.settings.initialize(components)

    const updated = sdk.settings.update({ highlightCoreWords: true })
    expect(updated).toEqual({ confirmSubmit: true, highlightCoreWords: true, skipSingleLetterColumns: true })

    const sent = sentToHost.find((m) => m.type === "UPDATE_SETTINGS_FROM_EMBED")
    expect(sent?.json).toEqual({ settings: updated })
    expect(sdk.settings.get()).toEqual(updated)
  })

  describe("in an embed with settingsUIOverrides", () => {
    const embedReadyData = (settingsForGame: any, settingsUIOverrides: any[]) => ({
      ...readyDataWithSettings(settingsForGame),
      hostContext: [{ type: "embed", typeshift: { settingsUIOverrides } }],
    })

    it("uses an override's defaultValue until the player saves their own", () => {
      const override = { id: "typeshift-highlight-core-words", defaultValue: true }

      const fresh = createPuzzmoSDK()
      sendFromHost("READY_DATA", embedReadyData({}, [override]))
      expect(fresh.settings.initialize(components)).toMatchObject({ highlightCoreWords: true })
      expect(fresh.settings.components().find((c) => c.id === override.id)).toMatchObject({
        defaultValue: true,
        title: "Highlight core words",
      })

      const returning = createPuzzmoSDK()
      sendFromHost("READY_DATA", embedReadyData({ highlightCoreWords: false }, [override]))
      expect(returning.settings.initialize(components)).toMatchObject({ highlightCoreWords: false })
    })

    it("hides an omitted setting and locks it over the player's saved value", () => {
      const sdk = createPuzzmoSDK()
      sendFromHost("READY_DATA", embedReadyData({ confirmSubmit: false }, [{ id: "typeshift-safe-mode", defaultValue: true, omit: true }]))

      expect(sdk.settings.initialize(components)).toMatchObject({ confirmSubmit: true })
      expect(sdk.settings.components().map((c) => Boolean(c.hidden))).toEqual([true, false, false])
      expect(sentToHost.find((m) => m.type === "INITIALIZE_SETTINGS")?.json.components).toEqual(sdk.settings.components())

      let emitted: any
      sdk.on("settingsUpdate", (data) => (emitted = data))
      sendFromHost("SETTINGS_UPDATE", { confirmSubmit: false, highlightCoreWords: true })
      expect(emitted).toMatchObject({ confirmSubmit: true, highlightCoreWords: true })
    })

    it("locks an omitted setting to the game's default when the override gives none", () => {
      const sdk = createPuzzmoSDK()
      sendFromHost(
        "READY_DATA",
        embedReadyData({ skipSingleLetterColumns: false }, [{ id: "typeshift-skip-single-letter-columns", omit: true }]),
      )

      expect(sdk.settings.initialize(components)).toMatchObject({ skipSingleLetterColumns: true })
    })

    it("keeps locked values out of what update() saves", () => {
      const sdk = createPuzzmoSDK()
      sendFromHost("READY_DATA", embedReadyData({ confirmSubmit: false }, [{ id: "typeshift-safe-mode", defaultValue: true, omit: true }]))
      sdk.settings.initialize(components)

      const updated = sdk.settings.update({ confirmSubmit: true, highlightCoreWords: true })
      expect(updated).toEqual({ confirmSubmit: true, highlightCoreWords: true, skipSingleLetterColumns: true })

      const sent = sentToHost.find((m) => m.type === "UPDATE_SETTINGS_FROM_EMBED")
      expect(sent?.json.settings).toEqual({ confirmSubmit: false, highlightCoreWords: true, skipSingleLetterColumns: true })
    })

    it("overrides and omits components inside split groups", () => {
      const sdk = createPuzzmoSDK()
      sendFromHost("READY_DATA", embedReadyData({ size: 1 }, [{ id: "d", defaultValue: 2, omit: true }]))

      const split: GameSettingsUIComponents = {
        id: "c",
        type: "split",
        content: [{ id: "d", type: "number", name: "size", defaultValue: 3, values: [1, 2, 3], title: "Size" }],
      }
      expect(sdk.settings.initialize([split])).toEqual({ size: 2 })
      expect(sdk.settings.components()).toEqual([{ ...split, content: [{ ...split.content[0], defaultValue: 2, hidden: true }] }])
    })

    it("ignores overrides for another game and outside an embed", () => {
      const sdk = createPuzzmoSDK()
      sendFromHost("READY_DATA", {
        ...readyDataWithSettings({}),
        hostContext: [{ type: "embed", sudoku: { settingsUIOverrides: [{ id: "typeshift-safe-mode", defaultValue: true, omit: true }] } }],
      })

      expect(sdk.settings.initialize(components)).toMatchObject({ confirmSubmit: false })
      expect(sdk.settings.components()).toBe(components)
    })
  })

  it("skips display-only components and recurses into split groups when merging defaults", () => {
    const sdk = createPuzzmoSDK()
    sendFromHost("READY_DATA", readyDataWithSettings({}))

    const resolved = sdk.settings.initialize([
      { id: "t", type: "title", value: "Options" },
      {
        id: "c",
        type: "split",
        content: [{ id: "d", type: "number", name: "size", defaultValue: 3, values: [1, 2, 3], title: "Size" }],
      },
    ])
    expect(resolved).toEqual({ size: 3 })
  })
})
