import { type FastifyReply, type FastifyRequest } from "fastify"
import { OperationType, RecordSource } from "relay-runtime"
import RelayModernEnvironment from "relay-runtime/lib/store/RelayModernEnvironment"

import { styleSheet } from "@stylexjs/stylex/lib/StyleXSheet"

import { PreloadedData } from "../relay/types.js"
import { MiddlewareFn, Placeholder, RouteMatch, WouterRoute } from "../routing/types.js"

/** Millisecond durations of the SSR phases, surfaced to the browser as a Server-Timing header. */
export interface SSRTimings {
  /** Time spent in the middleware chain. */
  mw?: number
  /** Time awaiting route/root loaders. */
  loader?: number
  /** Time spent rendering to the stream, once loading finished. */
  render?: number
}

/**
 * How a request's document was produced. The failure modes matter most: `timeout` and `error` both
 * answer 200 with a client shell, so without this they are indistinguishable from a healthy SPA route.
 */
export type SSROutcome = "ssr" | "spa" | "timeout" | "error" | "short-circuit" | "cache-hit" | "aborted"

/** What a finished request reports to `onRequestComplete`. */
export interface SSRRequestEvent {
  /** The matched route's path pattern (never the raw URL — that would be unbounded label cardinality). */
  routePath: string | null
  outcome: SSROutcome
  status: number
  timings: SSRTimings
  /** Wall-clock milliseconds for the whole handler. */
  duration: number
}

export interface WouterContext<TAppConfig = Record<string, unknown>> {
  environment: RelayModernEnvironment
  helmetContext: { helmet?: any }
  recordSource: RecordSource
  routeMatch: RouteMatch | null
  loaderData: PreloadedData<OperationType> | null
  pathname: string
  styleXSheet: typeof styleSheet
  appConfig?: TAppConfig
  /** Set when the server should skip SSR and serve the client shell: an explicit `render: "spa"` route, or a preload timeout. */
  csrFallback?: "spa" | "timeout"
  /** A middleware short-circuit (e.g. a redirect); the server translates it to the HTTP reply verbatim. */
  shortCircuitResponse?: Response
  /** Extra response headers from the matched route's `headers()`. */
  responseHeaders?: Record<string, string>
  /** Phase durations for the Server-Timing header. */
  timings?: SSRTimings
  /** The matched route's `head()` tags, already serialized — written into the head on every render mode. */
  headHTML?: string
  /** The matched route's `placeholder()`, for the root element of a client-rendered response. */
  placeholder?: Placeholder | null
}

export interface ServerConfig {
  port: number
  base: string
  isProduction: boolean
  isDev: boolean
  abortDelay?: number
  graphQLURL: string
}

export interface CreateContextOptions<TAppConfig = Record<string, unknown>> {
  /** Where should we be fetching data from? */
  graphqlURL: string
  /** The incoming request object */
  request: FastifyRequest
  /** The outgoing reply object for us to handle SSR on */
  reply: FastifyReply
  /** So that the SSR renderer can find the correct route */
  routes: WouterRoute[]
  /** Adds support for a root request for app bootrstrapping */
  rootBootstrappingLoader?: (args: {
    params: {}
    request: Request
    signal?: AbortSignal
    context?: Record<string, unknown>
  }) => Promise<any>
  /** Server middleware run on every request, before any route middleware and loaders. */
  middleware?: MiddlewareFn[]
  /** You pass in a relay environment which is used for data fetching */
  environment: RelayModernEnvironment
  /** You pass in a record source which is used and filled up during SSR */
  recordSource?: RecordSource
  /** App configuration to inject into window.__APP_CONFIG for client hydration */
  appConfig?: TAppConfig
}
