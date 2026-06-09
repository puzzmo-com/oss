import { createGameAnalyticsTracker } from "@puzzmo-com/clickhouse/gameTracker"

import type { BootstrapGameData } from "./types"

/**
 * Game analytics for the SDK.
 *
 * The event-firing logic — which host messages map to which ClickHouse events, the
 * engagement thresholds, the payload, and the /events endpoint — lives in
 *
 * @puzzmo-com/clickhouse/gameTracker and is shared with the runtime. That module is
 * pure (its only imports are `import type`), so bundling it into the published SDK
 * pulls in none of the clickhouse package's server deps (kysely / @clickhouse/client);
 * they tree-shake out entirely.
 *
 * This file only adds the SDK-specific glue: deciding whether analytics should run,
 * building the context from bootstrap data, and watching for link clicks. Events are
 * never sent from localhost (dev + the SDK simulator).
 */

export type LinkClickedInfo = {
  href: string
  text: string
  target: string
}

type UserType = "anon" | "user" | "paid"
type RuntimeType = "puzzmo_com" | "iframe" | "simple_embed" | "app_embed" | "ios_native"

/** Everything the events endpoint needs to attribute an event, mirrors the runtime's context. */
export type GameAnalyticsContext = {
  gameSlug: string
  puzzleID: string
  gameplayOwnerID: string
  apiRoot: string
  userType: UserType
  runtimeType: RuntimeType
  userID?: string
  teamSlug?: string
  partnerSlug?: string
  dailyDateKey?: string
  embedID?: string
}

export type GameAnalyticsTracker = {
  /** Map an outgoing host message to its analytics event(s), if any. */
  trackEvent: (type: string, json?: any) => void
  /** Report an anchor click inside the game. */
  trackLinkClick: (info: LinkClickedInfo) => void
}

/**
 * Build the analytics tracker for a game, or null when analytics shouldn't run
 * (no browser, running on localhost, or missing bootstrap data).
 */
export const createGameAnalytics = (readyData: BootstrapGameData | null): GameAnalyticsTracker | null => {
  const endpoint = resolveAnalyticsEndpoint()
  if (!endpoint.enabled) return null

  const context = buildAnalyticsContext(readyData, endpoint.apiRoot)
  if (!context) return null

  return createGameAnalyticsTracker(context)
}

/** Delegates document clicks to report anchor navigations. Returns a cleanup function. */
export const setupLinkTracking = (onLinkClicked: (info: LinkClickedInfo) => void): (() => void) => {
  if (typeof document === "undefined") return () => {}

  const handler = (event: MouseEvent) => {
    const node = event.target
    if (!(node instanceof Element)) return
    const anchor = node.closest("a[href]")
    if (!(anchor instanceof HTMLAnchorElement)) return

    onLinkClicked({
      href: anchor.href,
      text: anchor.textContent?.trim() ?? "",
      target: anchor.target,
    })
  }

  document.addEventListener("click", handler)
  return () => document.removeEventListener("click", handler)
}

/** Picks the events endpoint, and disables analytics entirely on localhost (dev + simulator). */
const resolveAnalyticsEndpoint = (): { apiRoot: string; enabled: boolean } => {
  if (typeof window === "undefined" || !window.location) return { apiRoot: "", enabled: false }

  const hostname = window.location.hostname
  const isLocalhost =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "[::1]" ||
    hostname.endsWith(".localhost")

  if (isLocalhost) return { apiRoot: "", enabled: false }

  const isStaging = hostname.includes("staging")
  return { apiRoot: isStaging ? "https://api-staging.puzzmo.com/" : "https://api.puzzmo.com/", enabled: true }
}

/** Derive the analytics context from the host's bootstrap data, or null if a game isn't present. */
const buildAnalyticsContext = (readyData: BootstrapGameData | null, apiRoot: string): GameAnalyticsContext | null => {
  const gameplay = readyData?.startOrFindGameplay?.gamePlayed
  if (!gameplay) return null

  const puzzle: any = gameplay.puzzle
  const hostContext: any[] = (readyData?.hostContext as any[]) ?? []

  return {
    gameSlug: puzzle.game?.slug ?? "unknown",
    puzzleID: puzzle.id,
    gameplayOwnerID: gameplay.ownerID || readyData?.userState?.id || "unknown",
    apiRoot,
    userType: mapUserType(readyData?.currentUser?.type),
    runtimeType: getRuntimeType(hostContext),
    userID: readyData?.currentUser?.id,
    teamSlug: puzzle.team?.slug || undefined,
    partnerSlug: hostContext.find((hc) => hc?.type === "embed")?.partner?.slug || undefined,
    dailyDateKey: puzzle.mostRecentDaily?.daily?.dateKey,
    embedID: hostContext.find((hc) => hc?.type === "embed")?.embedID || undefined,
  }
}

/** Map the user's subscription tier to the analytics user bucket. */
const mapUserType = (type: string | null | undefined): UserType => {
  if (!type || type === "Unverified") return "anon"
  if (type === "Paid") return "paid"
  return "user"
}

/** Derive the runtime bucket from host context, mirroring the runtime's getRuntimeType. */
const getRuntimeType = (hostContext: any[]): RuntimeType => {
  if (hostContext.find((hc) => hc?.type === "embed")) return "iframe"

  const app = hostContext.find((hc) => hc?.type === "app")
  if (app?.host === "__embed") return "simple_embed"
  if (app?.host === "app-embed") return "app_embed"
  if (app?.host === "ios-app") return "ios_native"

  return "puzzmo_com"
}
