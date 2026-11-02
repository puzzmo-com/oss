import { describe, expect, it } from "vitest"

import { normalizeReadyData } from "./bootstrapPayload"

const legacy = {
  userState: { gameSettings: {}, id: "us", ownerID: "o" },
  startOrFindGameplay: {
    gamePlayed: {
      id: "gp-1",
      boardState: "b",
      puzzle: {
        id: "pz-1",
        puzzle: "p",
        viewerMetadata: { streak: 3 },
        game: { slug: "typeshift", displayName: "Typeshift", flagsArr: 512, assetsSha: "abc", assetsBaseURL: "https://cdn/x" },
      },
    },
  },
}

describe("normalizeReadyData", () => {
  it("builds game and session from the legacy nesting, and drops it", () => {
    const data: any = normalizeReadyData(legacy)

    expect(data.startOrFindGameplay).toBeUndefined()
    expect(data.session.gameplay).toEqual({ id: "gp-1", boardState: "b" })
    expect(data.session.puzzle).toEqual({ id: "pz-1", puzzle: "p" })
    expect(data.viewerMetadata).toEqual({ streak: 3 })
    expect(data.game).toMatchObject({ slug: "typeshift", stableSlug: "typeshift", displayName: "Typeshift" })
    expect(data.game.version.runtime.version).toEqual({ id: "", assetsSha: "abc", assetsBaseURL: "https://cdn/x" })
  })

  it("normalises a bare flags number into an array", () => {
    expect(normalizeReadyData(legacy).game.version.flagsArr).toEqual([512])
  })

  it("prefers a top-level viewerMetadata over the legacy one", () => {
    const data = normalizeReadyData({ ...legacy, viewerMetadata: { streak: 9 } })
    expect(data.viewerMetadata).toEqual({ streak: 9 })
  })

  it("leaves session absent when the legacy payload has no gameplay", () => {
    const data = normalizeReadyData({ userState: legacy.userState, startOrFindGameplay: {} })
    expect(data.session).toBeUndefined()
    expect(data.game.slug).toBe("")
  })

  it("passes through a payload which already has game, stripping the legacy nesting", () => {
    const game = { id: "g", slug: "s" }
    const data: any = normalizeReadyData({ ...legacy, game })
    expect(data.game).toBe(game)
    expect(data.startOrFindGameplay).toBeUndefined()
  })
})
