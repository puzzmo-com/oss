import type { DeviceType, GameAnalyticsContext, LinkClickedInfo } from "./analytics"

/**
 * Game analytics event-firing logic for the SDK.
 *
 * This mirrors the runtime's tracker (and the canonical copy in @puzzmo-com/clickhouse/gameTracker
 * used server-side): which host messages map to which events, the engagement thresholds, the
 * payload shape, and the /events endpoint. It is kept here, dependency-free, so the published SDK
 * pulls in none of the clickhouse package's server deps (kysely / @clickhouse/client) and so the
 * public OSS mirror can build it without the private workspace packages present.
 */

export type GameAnalyticsEventType = "page_view" | "gameplay_active" | "active_30s" | "completed" | "link_click"

type GameAnalyticsState = {
  context: GameAnalyticsContext
  updateCount: number
  startTime: Date
  tracked: {
    pageView: boolean
    gameplayActive: boolean
    active30s: boolean
    completed: boolean
  }
}

type MessagesSent =
  | "READY_GAME_LOADED"
  | "UPLOAD_NEW_GAME_STATE"
  | "GAME_COMPLETED"
  | "SHOW_GAME_COMPLETE_SCREEN"
  | "UPDATE_GAME_STATE"
  | string

const sendGameAnalyticsEvent = async (
  context: GameAnalyticsContext,
  eventType: GameAnalyticsEventType,
  metadata?: Record<string, string | number | boolean>,
  elapsedTimeOnComplete?: number,
) => {
  try {
    const body = {
      ...context,
      eventType,
      elapsedTimeOnComplete,
      metadata,
    }

    const response = await fetch(`${context.apiRoot}events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      // Ensures the event still fires if the user navigates away (e.g. clicking a _blank link)
      keepalive: true,
    })

    if (!response.ok) {
      console.warn(`Analytics event failed: ${eventType} - ${response.status} ${response.statusText}`)
    }
  } catch (error) {
    console.warn(`Analytics event error: ${eventType}`, error)
  }
}

export const createGameAnalyticsTracker = (context: GameAnalyticsContext) => {
  const state: GameAnalyticsState = {
    context: { ...context, deviceType: context.deviceType ?? detectDeviceType() },
    updateCount: 0,
    startTime: new Date(),
    tracked: {
      pageView: false,
      gameplayActive: false,
      active30s: false,
      completed: false,
    },
  }

  const trackEvent = (type: MessagesSent, json?: any) => {
    const now = new Date()
    const timeDiff = now.getTime() - state.startTime.getTime()
    const seconds = timeDiff / 1000

    switch (type) {
      case "READY_GAME_LOADED": {
        if (!state.tracked.pageView) {
          sendGameAnalyticsEvent(state.context, "page_view")
          state.tracked.pageView = true
        }
        break
      }

      case "UPLOAD_NEW_GAME_STATE": {
        state.updateCount++

        // Fire gameplay_active early (after 2 state changes) to indicate user engagement
        if (state.updateCount > 2 && !state.tracked.gameplayActive) {
          sendGameAnalyticsEvent(state.context, "gameplay_active")
          state.tracked.gameplayActive = true
        }

        // Fire active_30s for sustained engagement
        if (seconds > 30) {
          if (!state.tracked.gameplayActive) {
            sendGameAnalyticsEvent(state.context, "gameplay_active")
            state.tracked.gameplayActive = true
          }
          if (!state.tracked.active30s) {
            sendGameAnalyticsEvent(state.context, "active_30s")
            state.tracked.active30s = true
          }
        }
        break
      }

      case "GAME_COMPLETED": {
        if (!state.tracked.completed && json?.input) {
          sendGameAnalyticsEvent(state.context, "completed", {}, json.input.elapsedTimeSecs)
          state.tracked.completed = true
        }
        break
      }
    }
  }

  const trackLinkClick = (info: LinkClickedInfo) => {
    sendGameAnalyticsEvent(state.context, "link_click", info)
  }

  return {
    trackEvent,
    trackLinkClick,
  }
}

/**
 * The kind of device the game runs on, judged by the whole device rather than the game's frame. A copy of
 * detectDeviceType in @puzzmo-com/clickhouse/deviceType, kept dependency-free for the published SDK.
 */
const detectDeviceType = (): DeviceType => {
  if (typeof navigator === "undefined" || typeof window === "undefined") return "unknown"
  const userAgent = navigator.userAgent

  // iPadOS Safari reports itself as a Mac, so only a touchscreen gives it away
  if (/iPad/.test(userAgent) || (/Macintosh/.test(userAgent) && navigator.maxTouchPoints > 1)) return "tablet"
  const mobileHint = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile
  if (/iPhone|iPod/.test(userAgent) || mobileHint) return "mobile"
  // Android phones carry "Mobile", Android tablets leave it out
  if (/Android/.test(userAgent)) return /Mobile/.test(userAgent) ? "mobile" : "tablet"
  if (/Mobile|Windows Phone/.test(userAgent)) return "mobile"

  // Anything else whose main input is touch, sized by the screen's short side
  if (window.matchMedia?.("(pointer: coarse)").matches) return Math.min(screen.width, screen.height) < 600 ? "mobile" : "tablet"
  return "desktop"
}
