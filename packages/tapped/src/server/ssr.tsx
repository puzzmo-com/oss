import { FastifyRequest } from "fastify"
import React, { Suspense } from "react"
import { type RenderToPipeableStreamOptions, renderToPipeableStream } from "react-dom/server"
import { RecordSource } from "relay-runtime"

import { styleSheet } from "@stylexjs/stylex/lib/StyleXSheet"

import { attachHeadHTML, attachRoutePath } from "../errors.js"
import { debugLog } from "../index.js"
import { createEnvironment } from "../relay/environment.js"
import { isPreloadTimeoutError } from "../relay/loader.js"
import { runMiddleware } from "../routing/middleware.js"
import { loadRouteData, matchRoute } from "../routing/routes.js"
import { renderHeadTags } from "../routing/head.js"
import { HeadTag } from "../routing/types.js"
import { CreateContextOptions, SSRTimings, WouterContext } from "./types.js"

const createFetchRequest = (req: FastifyRequest, signal: AbortSignal) => {
  const origin = `${req.protocol}://${req.headers.host}`
  const url = new URL(req.url, origin)
  debugLog("SSR: Fetching URL", url.href)

  const headers = new Headers()
  for (const [key, values] of Object.entries(req.headers)) {
    if (values) {
      if (Array.isArray(values)) {
        for (const value of values) {
          headers.append(key, value)
        }
      } else if (typeof values === "string") {
        headers.set(key, values)
      }
    }
  }
  headers.set("authorization", `Bearer ~`)
  headers.set("auth-provider", "custom")

  const init = {
    method: req.method,
    headers,
    signal,
    body: req.method !== "GET" && req.method !== "HEAD" ? (req.body as BodyInit) : undefined,
  }

  debugLog("SSR: Fetch request", req.method, url.href)
  return new Request(url.href, init)
}

/**
 * Creates a Wouter routing context for server-side rendering with Relay environment and route matching.
 * Runs global + route middleware first (which may short-circuit with a Response), then route/root loaders —
 * unless the route opts into `render: "spa"`, in which case loaders are skipped and the client shell is served.
 */
export const createWouterSSRContext = async <TAppConfig = Record<string, unknown>,>(
  options: CreateContextOptions<TAppConfig>,
): Promise<WouterContext<TAppConfig>> => {
  const { graphqlURL: graphqlUrl, request: req, reply: res, routes, rootBootstrappingLoader, middleware, appConfig } = options

  let recordSource = options.recordSource
  let environment = options.environment

  if (!environment || !recordSource) {
    recordSource = new RecordSource()
    const requestHeaders = {
      cookie: req.headers.cookie,
      authorization: req.headers.authorization,
    }
    debugLog("SSR: Forwarding request headers for auth:", {
      cookie: !!requestHeaders.cookie,
      authorization: !!requestHeaders.authorization,
    })
    environment = createEnvironment(graphqlUrl, recordSource, requestHeaders)
  }

  const url = new URL(req.url, `${req.protocol}://${req.headers.host}`)
  const pathname = url.pathname

  const routeMatch = matchRoute(pathname, routes)

  // One abort signal per request: fires when the client disconnects, and is threaded into the loader
  // fetch Request + LoaderArgs so abandoned work is actually cancelled.
  const abortController = new AbortController()
  res.raw.on("close", () => abortController.abort())
  const signal = abortController.signal

  const fetchRequest = createFetchRequest(req, signal)

  const timings: SSRTimings = {}
  const baseContext = {
    environment,
    helmetContext: {},
    recordSource,
    routeMatch,
    pathname,
    styleXSheet: styleSheet,
    appConfig,
    timings,
  }

  // Per-request mutable bag middleware writes to and loaders can read from.
  const middlewareContext: Record<string, unknown> = {}

  const chain = [...(middleware ?? []), ...(routeMatch?.route.middleware ?? [])]
  if (chain.length > 0) {
    const mwStart = performance.now()
    const shortCircuit = await runMiddleware(chain, {
      request: fetchRequest,
      params: routeMatch?.params ?? {},
      pathname,
      context: middlewareContext,
    })
    timings.mw = performance.now() - mwStart

    if (shortCircuit) {
      debugLog("SSR: Middleware short-circuited with status", shortCircuit.status)
      return { ...baseContext, loaderData: null, shortCircuitResponse: shortCircuit }
    }
  }

  const responseHeaders = routeMatch?.route.headers?.({ request: fetchRequest, params: routeMatch.params })

  // Started before the loaders so the two overlap: head tags usually mean another round trip, and
  // making SSR routes pay for it serially would be a straight latency regression.
  const documentArgs = { request: fetchRequest, params: routeMatch?.params ?? {}, pathname, context: middlewareContext, signal }
  const headTags = optional(() => routeMatch?.route.head?.(documentArgs), "head", [] as HeadTag[])

  // SPA routes skip server data loading entirely — middleware has run, so auth gating still holds.
  if (routeMatch?.route.render === "spa") {
    debugLog("SSR: Route is render: spa, serving client shell for", pathname)
    const placeholder = await optional(() => routeMatch.route.placeholder?.(documentArgs), "placeholder", null)
    return { ...baseContext, loaderData: null, responseHeaders, csrFallback: "spa", headHTML: renderHeadTags(await headTags), placeholder }
  }

  // The root loader runs first so route loaders can read what it fetched out of the
  // Relay store (e.g. viewer/session data that route queries take as variables)
  let loaderData = null
  let csrFallback: "timeout" | undefined
  const loaderStart = performance.now()
  try {
    if (rootBootstrappingLoader) await rootBootstrappingLoader({ params: {}, request: fetchRequest, signal, context: middlewareContext })
    if (routeMatch && routeMatch.route.loader) loaderData = await loadRouteData(routeMatch, fetchRequest, signal, middlewareContext)

    debugLog("SSR: Loaded layout and route data for", pathname)
    debugLog("SSR: Route:", routeMatch?.route?.path)
    debugLog("SSR: Loader data:", loaderData)
  } catch (error) {
    // A slow upstream that blows the preload timeout is not fatal: fall back to CSR so the client can fetch the data,
    // rather than 500ing the page. Any other loader failure is a real error and still surfaces.
    if (isPreloadTimeoutError(error)) {
      console.warn("SSR: Preload timed out, serving client shell (CSR) for", pathname)
      csrFallback = "timeout"
    } else {
      console.error("SSR: Failed to load data", error)
      // The context this would have become never gets returned, so the route rides on the error
      throw attachHeadHTML(attachRoutePath(error, routeMatch?.route.path), renderHeadTags(await headTags))
    }
  } finally {
    timings.loader = performance.now() - loaderStart
  }

  return { ...baseContext, loaderData, responseHeaders, csrFallback, headHTML: renderHeadTags(await headTags) }
}

/**
 * Awaits an optional document hook, degrading to `fallback` if it throws. Head tags and placeholders
 * are decoration: a failed lookup must cost the page its metadata, never the page itself.
 */
const optional = async <T,>(run: () => T | Promise<T> | undefined, name: string, fallback: T): Promise<T> => {
  try {
    return (await run()) ?? fallback
  } catch (error) {
    console.error(`SSR: route ${name}() failed, continuing without it`, error)
    return fallback
  }
}

type RenderWouterOptions<TAppConfig = Record<string, unknown>> = {
  context: WouterContext<TAppConfig>
  App: React.ComponentType<any>
  appProps?: Record<string, any>
  fallback?: React.ReactNode
  options: RenderToPipeableStreamOptions
}

/** Renders a Wouter application to a pipeable stream for server-side rendering */
export const renderWouterReactApp = <TAppConfig = Record<string, unknown>,>(renderOptions: RenderWouterOptions<TAppConfig>) => {
  const { context, App, appProps = {}, fallback = <div>Loading...</div>, options } = renderOptions
  const { environment, recordSource, helmetContext, pathname, loaderData, styleXSheet, appConfig } = context

  styleXSheet.inject()

  return renderToPipeableStream(
    <React.StrictMode>
      <Suspense fallback={fallback}>
        <App
          environment={environment}
          recordSource={recordSource}
          helmetContext={helmetContext}
          ssrPath={pathname}
          loaderData={loaderData}
          appConfig={appConfig}
          {...appProps}
        />
      </Suspense>
    </React.StrictMode>,
    options,
  )
}
