import type { FastifyStaticOptions } from "@fastify/static"
import Fastify, { FastifyInstance, FastifyRequest } from "fastify"
import fs from "node:fs/promises"
import path from "node:path"
import { Transform } from "node:stream"
import zlib from "node:zlib"

import { headHTMLOf, isTappedHttpError, routePathOf } from "../errors.js"
import { debugLog } from "../index.js"
import { buildAppGraph } from "../routing/appGraph.js"
import { renderPlaceholderData } from "../routing/head.js"
import { buildDevtoolsHtml, buildDevtoolsMissingHtml } from "./devtools.js"
import { buildErrorPageHtml, escapeHtml } from "./errorPage.js"
import { ServerConfig, SSROutcome, SSRRequestEvent, SSRTimings } from "./types.js"

// Runtime dynamic import that Vite's static analysis can't see. The production
// server module path is a fully-resolved file URL only known at runtime; a plain
// `import(path)` with an inline @vite-ignore loses the comment to the TS→JS
// transform and emits a "dynamic import cannot be analyzed" warning. Routing it
// through `new Function` hides the import() from Vite's import-analysis entirely.
const runtimeImport: (modulePath: string) => Promise<any> = new Function("modulePath", "return import(modulePath)") as any

/**
 * Safely serializes data to JSON for embedding in a script tag.
 * Escapes characters that could break out of the script context to prevent XSS.
 */
const safeJsonStringify = (data: unknown): string => {
  return JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026")
}

type ViteDevServer = any

export interface SetupServerOptions {
  config: ServerConfig
  __dirname: string
  serverModulePath?: string
  templatePath?: string
  /** Extra options merged over tapped's @fastify/static defaults (e.g. preCompressed, setHeaders). */
  staticOptions?: Partial<FastifyStaticOptions>
  /**
   * Runs against the fresh Fastify instance before tapped registers its dev middleware or static
   * handler, for hooks that must see every request first — edge-style redirects and rewrites, say.
   */
  beforeMiddleware?: (fastify: FastifyInstance) => Promise<void> | void
}

/** Sets up a Fastify server with Vite integration for SSR support */
export const setupServer = async (options: SetupServerOptions) => {
  const { config, __dirname, serverModulePath = "/src/tappedServerModule.tsx", templatePath = "./index.html" } = options
  const { isProduction, base } = config

  // In production the template is the vite-built copy (hashed asset references) in dist/client
  const templateHtml = isProduction ? await fs.readFile(path.resolve(__dirname, "./dist/client", templatePath), "utf-8") : ""

  const fastify = Fastify({})
  let vite: ViteDevServer | null = null

  // Fastify's logger is off, so an error it handles itself (a hook, a plugin) would otherwise 500 without a trace
  fastify.addHook("onError", async (request, _reply, error) => {
    console.error(`Unhandled error for ${request.method} ${request.url}:`, error)
  })

  await options.beforeMiddleware?.(fastify)

  if (!isProduction) {
    const { createServer } = await import("vite")
    vite = await createServer({ server: { middlewareMode: true }, appType: "custom", base })
    await fastify.register(import("@fastify/middie"))

    fastify.use((req, res, next) => {
      if (!req.url) return next()

      if (req.url.startsWith("/@") || req.url.startsWith("/__inspect") || req.url.includes(".")) {
        vite!.middlewares(req, res, next)
        return
      }
      next()
    })
  } else {
    // Brotli defaults to quality 11: ~1.8s of CPU for a 1.4MB chunk, which queues everything behind it
    // on the libuv pool. Quality 4 is ~10ms for a ~25% larger payload.
    await fastify.register(import("@fastify/compress"), { brotliOptions: { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } } })
    await fastify.register(import("@fastify/static"), {
      root: path.resolve(__dirname, "./dist/client"),
      prefix: base,
      wildcard: false,
      index: false,
      // Default on in prod: pairs with the tapped vite plugin's precompress output.
      // Safe even without precompressed siblings — @fastify/static falls back to the raw file.
      preCompressed: true,
      ...options.staticOptions,
    })
  }

  return { fastify, vite, templateHtml, serverModulePath, templatePath }
}

export interface SSRCacheOptions {
  /**
   * Returns a cache key for the request, or null to render uncached. Vary the key by anything that changes the HTML (path, theme cookie,
   * day).
   */
  keyFor: (req: FastifyRequest) => string | null
  /** How long a cached page stays valid. */
  ttlMs: number
  /** Cap on stored pages before the oldest entries are evicted. Defaults to 50. */
  maxEntries?: number
}

export interface RegisterSSRHandlerOptions {
  fastify: FastifyInstance
  vite: ViteDevServer | null
  templateHtml: string
  serverModulePath: string
  config: ServerConfig
  productionServerModulePath: string
  templatePath?: string
  /** In-process cache of fully-rendered pages, for routes whose HTML is identical across requests. */
  cache?: SSRCacheOptions
  /**
   * How long to hold the stream after the shell is ready, waiting for every Suspense boundary. A
   * boundary still pending when streaming starts is sent as its fallback and revealed by script, so
   * a page whose data was all preloaded loses nothing by waiting. Defaults to 0: stream at once.
   */
  allReadyGraceMs?: number
  /**
   * Called once per request with how the document was produced and what each phase cost. Tapped
   * measures these anyway for the Server-Timing header; this is the seam for recording them.
   * Never throws into the request — an observer that throws is logged and ignored.
   */
  onRequestComplete?: (event: SSRRequestEvent) => void
}

/** Registers the SSR route handler for server-side rendering of React components */
export const registerSSRHandler = (options: RegisterSSRHandlerOptions) => {
  const {
    fastify,
    vite,
    templateHtml,
    serverModulePath,
    config,
    productionServerModulePath,
    cache,
    allReadyGraceMs = 0,
    templatePath = "./index.html",
    onRequestComplete,
  } = options
  const { isProduction, base, graphQLURL, abortDelay = 10000, isDev } = config

  // routePath is kept with the page so a hit is reported against the route that rendered it
  const ssrCache = new Map<string, { html: string; expires: number; routePath?: string }>()

  // Dev-only devtools: /_tapped renders the resolved route graph, /_tapped.json serves it for tooling.
  // Requires the app's server module to export getRoutes(); production never registers these routes.
  if (!isProduction && vite) {
    const devtoolsHandler = async (reply: any, asJson: boolean) => {
      const serverModule = await vite.ssrLoadModule(serverModulePath)
      if (typeof serverModule.getRoutes !== "function") {
        if (asJson) return reply.code(404).send({ error: "server module does not export getRoutes" })
        return reply.code(200).header("Content-Type", "text/html").send(buildDevtoolsMissingHtml())
      }
      const graph = buildAppGraph(await serverModule.getRoutes())
      if (asJson) return reply.code(200).send({ routes: graph })
      return reply.code(200).header("Content-Type", "text/html").send(buildDevtoolsHtml(graph))
    }
    fastify.get("/_tapped", async (_request, reply) => devtoolsHandler(reply, false))
    fastify.get("/_tapped.json", async (_request, reply) => devtoolsHandler(reply, true))
  }

  fastify.get("*", async (request, reply) => {
    debugLog("Route handler called for:", request.url)
    const url = request.url.replace(base, "")

    const requestStart = performance.now()
    let reported = false
    // Reported exactly once per request, from whichever path actually answers it. Some of those
    // paths hijack the reply and stream, so this cannot live in a Fastify onResponse hook and
    // still know which one ran.
    const report = (outcome: SSROutcome, status: number, context?: { timings?: SSRTimings; routeMatch?: any }, error?: unknown) => {
      if (reported || !onRequestComplete) return
      reported = true
      try {
        onRequestComplete({
          routePath: context?.routeMatch?.route?.path ?? routePathOf(error),
          outcome,
          status,
          timings: context?.timings ?? {},
          duration: performance.now() - requestStart,
        })
      } catch (error) {
        console.error("tapped onRequestComplete observer threw:", error)
      }
    }

    const cacheKey = cache?.keyFor(request) ?? null
    if (cacheKey) {
      const hit = ssrCache.get(cacheKey)
      if (hit && hit.expires > Date.now()) {
        report("cache-hit", 200, { routeMatch: { route: { path: hit.routePath } } })
        return applyDocumentCacheHeaders(reply).code(200).header("Content-Type", "text/html").header("x-ssr-cache", "hit").send(hit.html)
      }
      if (hit) ssrCache.delete(cacheKey)
    }

    let template: string | undefined
    let serverModule: any
    // Held outside the try so the failure paths can still label themselves with the matched route
    let context: any

    // SSR is an enhancement layer: when rendering or data loading fails, serve the template
    // as a plain SPA shell (no SSR markup, no record source) so the client renders from scratch
    const sendSPAFallback = (error: any, tpl: string | undefined) => {
      console.error("SSR failed, serving SPA shell fallback:", error)
      if (reply.sent || !tpl) return false
      // A render error has a context; a loader error carries the head tags itself
      const headHTML = context?.headHTML || headHTMLOf(error)
      // Only a render error has the app config; a loader error leaves the client to its build defaults
      const appConfig = context?.appConfig ? `<script>window.__APP_CONFIG = ${safeJsonStringify(context.appConfig)}</script>` : ""
      const shell = tpl.replace("<!--app-head-->", () => appConfig + headHTML).replace("<!--app-html-->", "")
      report("error", 200, context, error)
      applyDocumentCacheHeaders(reply).code(200).header("Content-Type", "text/html").header("x-ssr-fallback", "error").send(shell)
      return true
    }

    try {
      let loadedTemplate: string
      if (!isProduction && vite) {
        const raw = await fs.readFile(templatePath, "utf-8")
        loadedTemplate = await vite.transformIndexHtml(request.url, raw)
        serverModule = await vite.ssrLoadModule(serverModulePath)
      } else {
        loadedTemplate = templateHtml
        serverModule = await runtimeImport(productionServerModulePath)
      }
      template = loadedTemplate

      const { createTappedContext, renderWouterApp } = serverModule
      if (!createTappedContext || !renderWouterApp) {
        throw new Error("Bridging server module does not export renderWouter or createWouterContext")
      }

      const [htmlStart, restHtml] = loadedTemplate.split(`<!--app-head-->`)
      const [bodyStart, htmlEnd] = restHtml.split(`<!--app-html-->`)

      context = await createTappedContext(graphQLURL, request, reply)
      debugLog("Context created, rendering app for URL:", url)

      // Middleware short-circuited (e.g. a redirect): translate the Web Response to the Fastify reply verbatim.
      if (context.shortCircuitResponse) {
        const response: Response = context.shortCircuitResponse
        debugLog("Middleware short-circuit for URL:", url, "status:", response.status)
        report("short-circuit", response.status, context)
        reply.code(response.status)
        response.headers.forEach((value, key) => reply.header(key, value))
        applyTimingAndRouteHeaders(reply, context)
        return reply.send(await response.text())
      }

      // The route is render: "spa", or preloading the SSR data timed out: skip server rendering and send the
      // client shell so the app fetches the data itself (CSR). We still inject __APP_CONFIG since the client
      // requires it to boot.
      if (context.csrFallback) {
        debugLog(`Serving client shell (${context.csrFallback}) for URL:`, url)
        // The route's head() and placeholder() still apply: a client-rendered page is exactly the one
        // that cannot describe itself to a crawler, and an empty root is what the placeholder is for.
        const head =
          `<script>window.__APP_CONFIG = ${safeJsonStringify(context.appConfig || {})}</script>` +
          renderPlaceholderData(context.placeholder) +
          (context.headHTML ?? ``)
        // Replacer functions, not strings: a title or username containing $' or $& would otherwise
        // expand into surrounding template text and corrupt the document
        const shell = template.replace(`<!--app-head-->`, () => head).replace(`<!--app-html-->`, () => context.placeholder?.html ?? ``)
        report(context.csrFallback, 200, context)
        applyTimingAndRouteHeaders(reply, context)
        return reply.code(200).header("Content-Type", "text/html").header("x-ssr-fallback", context.csrFallback).send(shell)
      }

      let didError = false
      const renderStart = performance.now()

      // A boundary still pending when the stream starts goes out as its fallback, to be swapped in by
      // script later. Waiting (up to allReadyGraceMs) for everything lets it be written in place instead.
      let shellReady = false
      let allReady = false
      let streaming = false
      let graceTimer: ReturnType<typeof setTimeout> | undefined

      const startStreaming = () => {
        if (streaming || reply.raw.destroyed) return
        streaming = true
        debugLog("starting to stream")
        reply.hijack()
        const response = reply.raw

        // Shell errors never get here (onShellError answers them). A boundary that errored is client
        // rendered by React on hydration, so the page is still a 200; didError only keeps it out of the cache.
        response.statusCode = 200
        response.setHeader("Content-Type", "text/html")
        for (const [key, value] of Object.entries(documentCacheHeaders)) response.setHeader(key, value)

        context.timings = { ...context.timings, render: performance.now() - renderStart }
        const timing = serverTimingValue(context.timings, context.timings.render)
        if (timing) response.setHeader("Server-Timing", timing)
        if (context.responseHeaders) {
          for (const [key, value] of Object.entries(context.responseHeaders)) response.setHeader(key, value as string)
        }

        // Mirror every chunk we stream into a buffer so the finished page can
        // be stored in the SSR cache (only when this request is cacheable).
        const captured: Buffer[] | null = cacheKey ? [] : null
        const writeOut = (data: string | Buffer) => {
          response.write(data)
          captured?.push(Buffer.from(data))
        }

        writeOut(htmlStart)

        if (context.headHTML) writeOut(context.headHTML)

        const { helmet } = context.helmetContext
        if (helmet) {
          writeOut(helmet.title.toString())
          writeOut(helmet.priority.toString())
          writeOut(helmet.meta.toString())
          writeOut(helmet.link.toString())
          writeOut(helmet.script.toString())
        }

        const { styleXSheet } = context
        const css = styleXSheet.getCSS()
        if (css && isDev) {
          writeOut(`<style data-stylex="true">${css}</style>`)
        } else {
          writeOut(`<!-- No StyleX CSS to inject in non-dev env -->`)
        }

        writeOut(bodyStart)

        debugLog("About to serialize record source and loader data...")
        const { environment, loaderData } = context

        const recordSource = environment.getStore().getSource()
        const recordData = recordSource.toJSON()
        debugLog("Record source keys:", Object.keys(recordData).slice(0, 20) + "...")
        debugLog("Record source sample:", JSON.stringify(recordData).substring(0, 200) + "...")
        debugLog("Loader data:", JSON.stringify(loaderData).substring(0, 200) + "...")

        const transformStream = new Transform({
          transform(chunk, encoding, callback) {
            response.write(chunk, encoding)
            captured?.push(Buffer.from(chunk))
            callback()
          },
          final(callback) {
            writeOut(`<script>window.__RECORD_SOURCE = ${safeJsonStringify(recordData)}</script>`)

            const serializableLoaderData = loaderData
              ? {
                  graphql: loaderData.graphql,
                  variables: loaderData.variables,
                }
              : null

            writeOut(`<script>window.__LOADER_DATA = ${safeJsonStringify(serializableLoaderData)}</script>`)

            writeOut(`<script>window.__APP_CONFIG = ${safeJsonStringify(context.appConfig || {})}</script>`)

            // Dev-only: re-emit the full StyleX sheet. Lazy route/mdx modules register their rules
            // after the shell's <style data-stylex> block has flushed, and a cold dev server's
            // aggregated stylex.css misses them too, leaving late rules absent until an HMR update.
            if (isDev) {
              const lateCSS = context.styleXSheet.getCSS()
              if (lateCSS) writeOut(`<style data-stylex="late">${lateCSS}</style>`)
            }

            captured?.push(Buffer.from(htmlEnd))
            response.end(htmlEnd)
            report(didError ? "error" : "ssr", response.statusCode, context)

            if (cache && cacheKey && captured && !didError && response.statusCode === 200) {
              const routePath = context.routeMatch?.route?.path
              ssrCache.set(cacheKey, { html: Buffer.concat(captured).toString("utf8"), expires: Date.now() + cache.ttlMs, routePath })
              const maxEntries = cache.maxEntries ?? 50
              while (ssrCache.size > maxEntries) {
                const oldest = ssrCache.keys().next().value
                if (oldest === undefined) break
                ssrCache.delete(oldest)
              }
            }

            callback()
          },
        })

        pipe(transformStream)
      }

      // The grace timer calls this from a bare setTimeout, where a throw would be uncaught and kill the process.
      const startStreamingSafely = () => {
        try {
          startStreaming()
        } catch (error) {
          console.error("SSR stream setup failed:", error)
          abort()
          const response = reply.raw
          if (!response.headersSent) {
            response.statusCode = 500
            response.setHeader("Content-Type", "text/html")
            response.end("<h1>Something went wrong</h1>")
          } else {
            response.destroy(error as Error)
          }
          report("error", 500, context, error)
        }
      }

      const { pipe, abort } = renderWouterApp(context, {
        // React flushes the shell once buffered output passes progressiveChunkSize (~12.8KB
        // default) and defers any unfinished Suspense boundary as a JS-revealed (`$RC`) chunk.
        // Our inline theme-CSS <style> alone is ~10KB, so every real page tips over and renders
        // as `Loading…` without JS. A huge chunk size keeps the whole tree in the shell so the
        // content is written inline (no-JS / crawler friendly).
        progressiveChunkSize: Number.MAX_SAFE_INTEGER,
        onShellError(error: any) {
          debugLog("onShellError called")
          if (!sendSPAFallback(error, loadedTemplate) && !reply.sent) {
            reply.code(500)
            reply.header("Content-Type", "text/html")
            // Error details stay server-side in production; the console.error in onError has the full story.
            reply.send(isProduction ? "<h1>Something went wrong</h1>" : "<h1>Something went wrong: " + escapeHtml(error.message) + "</h1>")
          }
        },
        onShellReady() {
          shellReady = true
          if (allReady || !allReadyGraceMs) startStreamingSafely()
          else graceTimer = setTimeout(startStreamingSafely, allReadyGraceMs)
        },
        onAllReady() {
          debugLog("onAllReady called - all content ready")
          allReady = true
          clearTimeout(graceTimer)
          if (shellReady) startStreamingSafely()
        },
        onError(error: any) {
          didError = true
          console.error("Render error:", error)
        },
      })

      const abortTimer = setTimeout(() => {
        abort()
      }, abortDelay)

      // Clear the abort timer when the response finishes or the client disconnects,
      // otherwise every request leaks a 10s timer until it fires.
      reply.raw.once("close", () => {
        clearTimeout(abortTimer)
        clearTimeout(graceTimer)
        // A stream the client walked away from never reaches response.end, so this is the only
        // place it gets counted. Reporting is idempotent, so a completed response no-ops here.
        report("aborted", reply.raw.statusCode, context)
      })

      // The reply is answered later from onShellReady/onShellError. Resolving with undefined instead
      // makes Fastify send an empty 200 right away, and the SPA fallback then has nothing to write to.
      return reply
    } catch (e: any) {
      console.error("Route handler error:", e)
      vite?.ssrFixStacktrace(e)
      console.error(e.stack)
      if (reply.sent) return

      // Structured errors from loaders/middleware: honor the status, keep 4xx messages, sanitize 5xx in production.
      if (isTappedHttpError(e)) {
        const message = e.status < 500 || !isProduction ? e.message : "Something went wrong"
        report("error", e.status, context, e)
        return reply
          .code(e.status)
          .header("Content-Type", "text/html")
          .send(`<h1>${e.status}</h1><p>${escapeHtml(message)}</p>`)
      }

      // Unexpected errors degrade to the client-rendered shell rather than an error page.
      if (sendSPAFallback(e, template)) return

      report("error", 500, context, e)

      if (isProduction) {
        // Never leak stack traces to production clients — the console.error above has the full story.
        return applyDocumentCacheHeaders(reply).code(500).header("Content-Type", "text/html").send("<h1>Something went wrong</h1>")
      }

      return reply
        .code(500)
        .header("Content-Type", "text/html")
        .send(buildErrorPageHtml(e, { pathname: url }))
    }
  })
}

/** Builds a Server-Timing header value from the SSR phase timings, or null when nothing was measured. */
const serverTimingValue = (timings: SSRTimings | undefined, renderMs?: number): string | null => {
  const parts: string[] = []
  if (timings?.mw !== undefined) parts.push(`mw;dur=${timings.mw.toFixed(1)}`)
  if (timings?.loader !== undefined) parts.push(`loader;dur=${timings.loader.toFixed(1)}`)
  if (renderMs !== undefined) parts.push(`render;dur=${renderMs.toFixed(1)}`)
  return parts.length > 0 ? parts.join(", ") : null
}

/**
 * An SSR document carries whatever the signed-in viewer can see, the serialized Relay store
 * included, so it must never settle in a shared cache. A route whose HTML is identical for
 * everyone can opt out through its own headers(), which are applied after these.
 */
const documentCacheHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" }

/** Sets the no-shared-cache defaults on a non-streamed reply, before any route headers. */
const applyDocumentCacheHeaders = (reply: any) => {
  for (const [key, value] of Object.entries(documentCacheHeaders)) reply.header(key, value)
  return reply
}

/** Applies Server-Timing + the matched route's headers() to a non-streamed reply (shell, short-circuit). */
const applyTimingAndRouteHeaders = (reply: any, context: { timings?: SSRTimings; responseHeaders?: Record<string, string> }) => {
  applyDocumentCacheHeaders(reply)
  const timing = serverTimingValue(context.timings)
  if (timing) reply.header("Server-Timing", timing)
  if (context.responseHeaders) {
    for (const [key, value] of Object.entries(context.responseHeaders)) reply.header(key, value)
  }
}

export interface StartServerOptions {
  /** Names the server in the ready banner, e.g. "MY APP" */
  name?: string
  /** Label and value rows printed under the server's address, e.g. ["GraphQL", url] */
  details?: [label: string, value: string][]
}

/** Starts the Fastify server, and prints a ready banner with its address once it is listening */
export const startServer = (fastify: FastifyInstance, port: number, options: StartServerOptions = {}) => {
  fastify.listen({ port, host: "0.0.0.0" }, (err, address) => {
    if (err) throw err

    const rows: [string, string][] = [["Local", address.replace("0.0.0.0", "localhost")], ...(options.details ?? [])]
    const labelWidth = Math.max(...rows.map(([label]) => label.length)) + 2

    console.log(`\n  ${options.name ?? "TAPPED SERVER"}  ready\n`)
    for (const [label, value] of rows) console.log(`  ➜  ${`${label}:`.padEnd(labelWidth)}${value}`)
    console.log("")
  })
}
