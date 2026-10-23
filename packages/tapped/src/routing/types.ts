import React from "react"

import type { LoaderFn, Params } from "../relay/types.js"

export type { Params, LoaderArgs, PreloadedData, LoaderFn } from "../relay/types.js"

/**
 * How a route's initial document is produced:
 * - `"ssr"` (default) — loaders run on the server, the page streams as fully-rendered HTML with a seeded Relay store.
 * - `"spa"` — the server skips loaders and serves the client shell; the browser fetches data itself. Middleware still runs,
 * so auth gating holds. Use for pages that are personal/uncacheable or too heavy to be worth server rendering.
 */
export type RenderMode = "ssr" | "spa"

export interface MiddlewareArgs {
  /** The incoming request as a Web Request. */
  request: Request
  /** Dynamic URL params of the matched route (empty for global middleware run before matching). */
  params: Params
  pathname: string
  /** Per-request mutable bag for middleware to pass data downstream to other middleware and loaders. */
  context: Record<string, unknown>
}

/**
 * Server-side wrap-around function run before loaders. Return a Response (e.g. via `redirect()`) to short-circuit the
 * request, mutate `args.context` to pass data downstream, or call `next()` to continue — optionally wrapping it in
 * try/finally for logging and tracing.
 */
export type MiddlewareFn = (
  args: MiddlewareArgs,
  next: () => Promise<Response | undefined>,
) => Promise<Response | undefined> | Response | undefined

/** A tag tapped writes into the document head. Text and attribute values are escaped for you. */
export type HeadTag = { tag: "title"; text: string } | { tag: "meta" | "link"; attrs: Record<string, string> }

/** Markup for the app's root element while the client has not rendered yet, plus the data it was built from. */
export interface Placeholder {
  /** Pre-rendered HTML, e.g. a skeleton of the page. */
  html: string
  /** Serialized to `window.__PLACEHOLDER_DATA`, so the client can render the same markup before its own data lands. */
  data?: unknown
}

/**
 * What a route's `head()` and `placeholder()` are given. They run after middleware and alongside the
 * loaders, on every render mode — so a `render: "spa"` route can still describe itself to a crawler.
 */
export interface DocumentArgs {
  request: Request
  params: Params
  pathname: string
  /** Per-request mutable bag middleware may have written to before this ran. */
  context: Record<string, unknown>
  /** Aborts when the client disconnects; pass into any fetch these make. */
  signal?: AbortSignal
}

export interface WouterRoute {
  path: string
  component: React.ComponentType<any>
  loader?: LoaderFn
  children?: WouterRoute[]
  /** How the initial document is produced for this route. Defaults to "ssr". */
  render?: RenderMode
  /** Server middleware run (after any global middleware) before this route's loader. */
  middleware?: MiddlewareFn[]
  /** Extra response headers for this route (e.g. Cache-Control, CSP). Merged over defaults on every response shape. */
  headers?: (args: { request: Request; params: Params }) => Record<string, string>
  /**
   * Head tags for this route, resolved on the server on every render mode. Crawler metadata (OpenGraph,
   * oEmbed) belongs here rather than in the component: an SPA route renders no React on the server.
   */
  head?: (args: DocumentArgs) => HeadTag[] | Promise<HeadTag[]>
  /** Markup for the root element on `render: "spa"` responses — a skeleton in place of an empty shell. */
  placeholder?: (args: DocumentArgs) => Placeholder | null | Promise<Placeholder | null>
}

export interface RouteMatch {
  route: WouterRoute
  params: Record<string, string>
  pathname: string
}
