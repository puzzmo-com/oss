import { afterEach, describe, expect, it, vi } from "vitest"

import { createGameAnalyticsTracker } from "./gameTracker"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("createGameAnalyticsTracker", () => {
  it("sends the device type with each event, spotting an iPad behind iPadOS Safari's Mac user agent", async () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15", maxTouchPoints: 5 })
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) })
    vi.stubGlobal("screen", { width: 1024, height: 1366 })
    const fetchMock = vi.fn(async (_url: string, _init: { body: string }) => ({ ok: true }))
    vi.stubGlobal("fetch", fetchMock)

    const tracker = createGameAnalyticsTracker({
      gameSlug: "typeshift",
      puzzleID: "p1:puzzle",
      gameplayOwnerID: "owner",
      apiRoot: "https://api.test/",
      userType: "anon",
      runtimeType: "iframe",
    })
    tracker.trackEvent("READY_GAME_LOADED")

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ eventType: "page_view", deviceType: "tablet" })
  })
})
