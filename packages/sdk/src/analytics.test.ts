import { describe, expect, it } from "vitest"

import { buildAnalyticsContext } from "./analytics"
import type { BootstrapGameData } from "./types"

const readyData = (overrides: Partial<BootstrapGameData> = {}) =>
  ({
    userState: { gameSettings: {}, id: "anon-state:userstate", ownerID: "anon-owner" },
    currentUser: null,
    game: { slug: "crossword" },
    session: { gameplay: { ownerID: "anon-owner" }, puzzle: { id: "p1:puzzle", team: { slug: "puzzmo" } } },
    hostContext: [{ type: "app", layout: "desktop", host: null }],
    ...overrides,
  }) as unknown as BootstrapGameData

describe("buildAnalyticsContext", () => {
  it("attributes plays on a puzzmo.com partner page to that partner", () => {
    const context = buildAnalyticsContext(readyData({ partnerSlug: "sfgate" }), "https://api.puzzmo.com/")
    expect(context?.partnerSlug).toBe("sfgate")
    expect(context?.runtimeType).toBe("puzzmo_com")
  })

  it("prefers the embed's partner over the top-level slug", () => {
    const hostContext = [{ type: "embed", embedID: "e1", partner: { slug: "bostonglobe" } }] as any
    const context = buildAnalyticsContext(readyData({ hostContext, partnerSlug: "sfgate" }), "https://api.puzzmo.com/")
    expect(context?.partnerSlug).toBe("bostonglobe")
    expect(context?.embedID).toBe("e1")
  })

  it("reports MSN Play as its own runtime, leaving the partner for the API to fill from the embed", () => {
    const hostContext = [{ type: "embed", noUI: true, embedID: "msn-play-ribbit-daily-cdn", host: "msn" }] as any
    const context = buildAnalyticsContext(readyData({ hostContext }), "https://api.puzzmo.com/")
    expect(context?.runtimeType).toBe("msn")
    expect(context?.embedID).toBe("msn-play-ribbit-daily-cdn")
    expect(context?.partnerSlug).toBeUndefined()
  })

  it("leaves the partner unset on plain puzzmo.com", () => {
    const context = buildAnalyticsContext(readyData(), "https://api.puzzmo.com/")
    expect(context?.partnerSlug).toBeUndefined()
    expect(context?.gameplayOwnerID).toBe("anon-owner")
  })
})
