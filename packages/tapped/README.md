# @puzzmo/tapped

Tapped is a server-side rendering (SSR) framework for React applications built on Fastify, Vite, Relay, and Wouter. It provides a complete infrastructure for building type-safe, server-rendered React applications with GraphQL data fetching.

## Features

- **Fastify server setup** with Vite middleware for development and static file serving for production
- **React SSR streaming** with `renderToPipeableStream`
- **Wouter routing** with type-safe route matching and data preloading
- **Relay GraphQL** integration with server-side data hydration
- **React Helmet** for managing document head tags
- **Loader pattern** for route-based data preloading
- **Per-route render modes** — `"ssr"` (default) or `"spa"` (client shell, browser fetches data)
- **Server middleware** — koa-style chain with `redirect()` short-circuits, global and per-route
- **Per-route response headers** — Cache-Control/CSP from a `headers()` function on the route
- **Per-route document hooks** — `head()` for crawler metadata and `placeholder()` for a skeleton, on every render mode
- **Structured errors** — `TappedHttpError(status, message)` from loaders/middleware, sanitized in production
- **Request cancellation** — preload timeouts and client disconnects abort the upstream GraphQL fetch
- **Observability** — `Server-Timing` phase breakdown on every response, a dev-only `/_tapped` route-graph page, and a dev error overlay with open-in-editor stack frames
- **App configuration** for consistent server/client access to environment constants

## Installation

```bash
yarn add @puzzmo/tapped
```

## Usage

### Server Setup

Create a `server.mts` file:

```typescript
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { registerSSRHandler, setupServer, startServer } from "@puzzmo/tapped/server"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const config = {
  port: 8912,
  base: "/",
  isProduction: process.env.NODE_ENV === "production",
  isDev: !process.env.NODE_ENV,
  abortDelay: 10000,
  graphQLURL: "https://api.example.com/graphql",
  debugLog: (...args) => console.log(...args),
}

const { fastify, vite, templateHtml, serverModulePath } = await setupServer({
  config,
  __dirname,
})

registerSSRHandler({
  fastify,
  vite,
  templateHtml,
  serverModulePath,
  config,
  productionServerModulePath: pathToFileURL(path.resolve(__dirname, "./dist/server/tappedServerModule.mjs")).href,
})

startServer(fastify, config.port)
```

`registerSSRHandler` also takes:

- `cache` — an in-process cache of finished pages (`keyFor`, `ttlMs`, `maxEntries`), only for pages whose HTML is identical for every request it keys together
- `allReadyGraceMs` — how long to hold the stream after the shell is ready, waiting for every Suspense boundary. A boundary still pending when streaming starts is sent as its fallback and swapped in by script, so when loaders have already fetched everything a short wait writes the whole page in place. Defaults to `0`
- `onRequestComplete` — called once per request with its outcome and phase timings

### SSR Entry Point

Create a `tappedServerModule.ts` file that exports functions matching the expected interface:

```typescript
import { FastifyReply, FastifyRequest } from "fastify"
import { type RenderToPipeableStreamOptions } from "react-dom/server"
import { RecordSource } from "relay-runtime"

import { createWouterSSRContext, renderWouterReactApp } from "@puzzmo/tapped/src/server"

import { App } from "./app/App"
import { createWouterRoutes } from "./app/routes"
import { createEnvironment } from "./environment"
import { loadRootQuery } from "./queries/RootQuery"

// Create a single Relay environment that will be shared across all loaders
export const createTappedContext = async (graphqlUrl: string, req: FastifyRequest, res: FastifyReply) => {
  const recordSource = new RecordSource()
  const cookieHeader = req.headers.cookie
  const environment = createEnvironment(graphqlUrl, recordSource, cookieHeader)

  return createWouterSSRContext({
    graphqlUrl,
    request: req,
    reply: res,
    routes: createWouterRoutes(environment),
    rootBootstrappingLoader: loadRootQuery(environment), // Optional root data loader
    environment,
    recordSource,
  })
}

export const renderWouterApp = (context: any, options: RenderToPipeableStreamOptions) => {
  return renderWouterReactApp({
    context,
    App,
    options,
  })
}
```

**Important:** The function names must be `createTappedContext` and `renderWouterApp` as expected by the SSR handler, or it will throw,

### Route Definitions

Define routes with loaders. **Important:** Routes need to be created with an environment instance:

```typescript
import { lazy } from "react"
import { Environment } from "react-relay"

import { preload } from "@puzzmo/tapped/src/relay"
import { WouterRoute } from "@puzzmo/tapped/src/routing"

const HomePage = lazy(() => import("../pages/HomePage"))
const AboutPage = lazy(() => import("../pages/AboutPage"))

// Loader functions receive the environment
const loadHomePageQuery = (environment: Environment) => {
  return async ({ request, params }: LoaderArgs) => {
    return preload(environment, HomePageQuery, { id: params.id })
  }
}

export const createWouterRoutes = (environment: Environment): WouterRoute[] => [
  {
    path: "/",
    component: HomePage,
    loader: loadHomePageQuery(environment),
  },
  {
    path: "/about",
    component: AboutPage,
  },
]
```

**Key point:** All loaders must use the same Relay environment instance to ensure data loaded on the server is available during rendering.

### Render Modes

Each route declares how its initial document is produced via `render` (defaults to `"ssr"`):

```typescript
export const createWouterRoutes = (environment: Environment): WouterRoute[] => [
  { path: "/", component: HomePage, loader: loadHomePageQuery(environment) },
  // No server data loading: the client shell is served and the browser fetches.
  // Middleware still runs, so auth gating holds.
  { path: "/settings", component: SettingsPage, render: "spa" },
]
```

Separately from explicit `"spa"` routes, when a route's `preload` blows its timeout the server falls back to the
same client-shell response instead of 500ing. The response carries `x-ssr-fallback: spa` or `x-ssr-fallback: timeout`
so you can tell which happened from the Network panel.

### Middleware

Server-side middleware runs before loaders — globally (via `createWouterSSRContext({ middleware })`) and per-route
(via `route.middleware`). Each middleware can return a `Response` to short-circuit, mutate `args.context` to pass
data downstream, or call `next()` to continue:

```typescript
import { MiddlewareFn, redirect } from "@puzzmo/tapped/src/server"

const requireAuth: MiddlewareFn = async ({ request, context }, next) => {
  const session = await getSession(request)
  if (!session) return redirect("/login")
  context.session = session // available to later middleware + loaders via LoaderArgs.context
  return next()
}

const timing: MiddlewareFn = async ({ pathname }, next) => {
  const start = performance.now()
  try {
    return await next()
  } finally {
    console.log(`${pathname} took ${performance.now() - start}ms`)
  }
}
```

### Per-route Document Hooks

`head()` and `placeholder()` describe the document itself, and run on **every** render mode — including `"spa"`,
where no React is rendered on the server. That is the point: a client-rendered page is exactly the one that cannot
describe itself to a crawler, and the one whose root element would otherwise be empty.

```typescript
{
  path: "/p/:slug",
  component: PostPage,
  render: "spa",
  // Tag text and attribute values are escaped for you, so API-supplied strings are safe here
  head: async ({ params, request, signal }) => {
    const post = await fetchPost(params.slug, { signal })
    if (!post) return []
    return [
      { tag: "title", text: post.title },
      { tag: "meta", attrs: { property: "og:title", content: post.title } },
      { tag: "link", attrs: { rel: "canonical", href: `https://example.com/p/${post.slug}` } },
    ]
  },
  // Rendered into the app's root element on client-rendered responses; `data` is serialized to
  // `window.__PLACEHOLDER_DATA` so the same component can render it again while the app boots.
  placeholder: async ({ params }) => {
    const summary = await fetchSummary(params.slug)
    return summary && { html: renderToString(<PostSkeleton data={summary} />), data: summary }
  },
}
```

Both run after middleware and concurrently with the loaders, so an `"ssr"` route does not pay for them serially.
Both are treated as decoration: if one throws, the error is logged and the page is served without it.

### Per-route Response Headers

Routes can attach response headers (Cache-Control, CSP, etc.) that apply to streamed, shell, and short-circuit
responses alike:

```typescript
{
  path: "/pricing",
  component: PricingPage,
  headers: () => ({ "cache-control": "public, max-age=300" }),
}
```

### Structured Errors

Throw `TappedHttpError` from a loader or middleware for a proper status page. 4xx messages are shown to the client;
5xx messages are sanitized when `isProduction`:

```typescript
import { TappedHttpError } from "@puzzmo/tapped/src/server"

const loadPostQuery = (environment: Environment) => async (args: LoaderArgs) => {
  const data = await preload(environment, PostQuery, { slug: args.params.slug }, { signal: args.signal })
  if (!data.query) throw new TappedHttpError(404, "Post not found")
  return data
}
```

Any other uncaught server error renders a dev-only error overlay (clickable stack frames that open in your editor
via Vite's `/__open-in-editor`) — production clients get a sanitized 500 and the details stay in the server logs.

### Request Cancellation

`preload`'s timeout (default 5000ms) aborts the upstream GraphQL fetch rather than abandoning it, via an
`AbortSignal` passed through Relay's `cacheConfig.metadata`. Loaders also receive `LoaderArgs.signal`, which fires
when the client disconnects — pass it into `preload` so abandoned requests cancel their upstream work:

```typescript
return preload<MyQueryType>(environment, Query, { slug }, { signal: args.signal })
```

If your app has its own `createEnvironment`/fetch function (rather than tapped's), read the signal out of
`cacheConfig.metadata.signal` and pass it to `fetch` — otherwise cancellation is a no-op.

### Observability

- Every SSR response carries a `Server-Timing` header (`mw;dur=… loader;dur=… render;dur=…`) visible in the browser
  devtools Network panel — in production too, since the cost is two subtractions.
- In dev, `/_tapped` serves a route-graph page (path, render mode, loader/middleware/headers wiring, plus any
  app-specific route metadata like breadcrumbs), and `/_tapped.json` serves the same data for tooling. Opt in by
  exporting `getRoutes` from your server module:

```typescript
// tappedServerModule.tsx — the throwaway environment is never fetched from (loaders don't run)
export const getRoutes = () => createWouterRoutes(createEnvironment("", new RecordSource()))
```

### Client-Side Hydration

In your client entry point:

```typescript
import ReactDOM from "react-dom/client"
import { RecordSource } from "relay-runtime"

const recordSource = new RecordSource(window.__RECORD_SOURCE)
const loaderData = window.__LOADER_DATA

ReactDOM.hydrateRoot(
  document.getElementById("root"),
  <App loaderData={loaderData} />
)
```

### App Configuration

Pass environment-specific configuration to `createWouterSSRContext()` and it will be injected into `window.__APP_CONFIG` for client hydration:

```typescript
// Define your config type
type AppConfig = {
  apiURL: string
  graphQLURL: string
}

const appConfig: AppConfig = {
  apiURL: process.env.API_URL || "http://localhost:8911",
  graphQLURL: process.env.GRAPHQL_URL || "http://localhost:8911/graphql",
}

// Pass to SSR context
export const createTappedContext = async (graphqlUrl: string, req: FastifyRequest, res: FastifyReply) => {
  return createWouterSSRContext<AppConfig>({
    // ... other options
    appConfig,
  })
}
```

On the client, read from `window.__APP_CONFIG` and pass to your App:

```typescript
const appConfig = (window as any).__APP_CONFIG
ReactDOM.hydrateRoot(
  document.getElementById("root"),
  <App loaderData={loaderData} appConfig={appConfig} />
)
```

### Using Loader Data in Components

With `useLazyLoadQuery` and shared environment:

```typescript
import { graphql } from "react-relay"
import { useGetMainPageQuery } from "./queries/utils"

const Query = graphql`
  query MyPageQuery {
    title
  }
`

// Helper hook that uses the query
export const useMyPageQuery = () => useGetMainPageQuery<MyPageQueryType>(Query)

const MyPage = () => {
  const { query } = useMyPageQuery()
  return <div>{query.title}</div>
}
```

**How it works:** When data is preloaded during SSR using the same environment instance, `useLazyLoadQuery` with `fetchPolicy: "store-or-network"` will read from the cache without suspending. On client-side navigation, it will fetch as needed.

## API Reference

### Server (`@puzzmo/tapped/src/server`)

- `setupServer(options)` - Sets up Fastify server with Vite middleware
  - `staticOptions` (optional) - Extra @fastify/static options merged over tapped's defaults (e.g. `preCompressed`, `setHeaders`) for consumers that want custom cache or compression behavior
- `registerSSRHandler(options)` - Registers the catch-all SSR route handler
  - `productionServerModulePath` - Absolute file URL to built server module
  - Expects your server module to export `createTappedContext` and `renderWouterApp` functions
- `startServer(fastify, port, { name?, details? })` - Starts the Fastify server and prints a ready banner: its address, then any `[label, value]` rows in `details`
- `createWouterSSRContext(options)` - Creates SSR context with route matching, middleware, and data loading
  - `environment` - Relay environment instance (shared across loaders)
  - `recordSource` - RecordSource for data serialization
  - `rootBootstrappingLoader` (optional) - Loader for app-wide data
  - `middleware` (optional) - Global middleware chain run on every request before route middleware and loaders
  - `appConfig` (optional) - Configuration object injected into `window.__APP_CONFIG`
- `renderWouterReactApp(options)` - Renders React app to a pipeable stream
- `TappedHttpError(status, message)` / `isTappedHttpError(error)` - Structured HTTP errors from loaders/middleware
- `redirect(location, status?)` - Builds a redirect `Response` for middleware to return (defaults to 302)

### Routing (`@puzzmo/tapped/src/routing`)

- `matchRoute(pathname, routes)` - Matches a pathname against route definitions
- `loadRouteData(match, request, signal?, context?)` - Executes the loader for a matched route
- `createRouteElements(routes)` - Generates Wouter Route components
- `runMiddleware(middleware, args)` - Runs a middleware chain, returning the short-circuiting `Response` if any
- `buildAppGraph(routes)` - Serializes a route tree into the JSON-safe metadata behind `/_tapped`

- `renderHeadTags(tags)` - Serializes `HeadTag[]` to HTML, escaping text and attribute values
- `renderPlaceholderData(placeholder)` - The inline script seeding `window.__PLACEHOLDER_DATA`

`WouterRoute` fields: `path`, `component`, `loader?`, `children?`, `render?` (`"ssr"` | `"spa"`), `middleware?`,
`headers?`, `head?`, `placeholder?`.

### Relay (`@puzzmo/tapped/src/relay`)

- `preload(environment, query, variables, options?)` - Preloads GraphQL data during SSR
  - Returns `PreloadedData<TQuery>` with `query`, `variables`, and `graphql` fields
  - Data is loaded into the environment's store for reuse during rendering
  - `options.timeoutMs` (default 5000) - on timeout the upstream fetch is aborted, a `PreloadTimeoutError` is
    thrown, and the SSR handler serves the client shell instead of a 500
  - `options.signal` - additional AbortSignal (e.g. `LoaderArgs.signal`) that also cancels the fetch
- `useGetMainPageQuery(query, variables)` - Hook using `useLazyLoadQuery` with `store-or-network` policy
  - Reads from cache if data exists (SSR), otherwise fetches (CSR)
- `PreloadTimeoutError` / `isPreloadTimeoutError(error)` - The timeout error and its boundary-safe check

### Client (`@puzzmo/tapped/src/client`)

- `WouterLoaderProvider` - Context provider for loader data
- `useSSRData<TQuery>()` - Hook to access typed SSR loader data from context or `window.__LOADER_DATA`

### Vite plugin (`@puzzmo/tapped/vite`)

`tapped(options)` — bundles the Vite config a Tapped SSR app needs.

```ts
import { tapped } from "@puzzmo/tapped/vite"

plugins: [
  tapped({
    precompress: true,
    fingerprintTargets: ["monacoeditorwork/editor.worker.bundle.js", "stylex.css"],
  }),
  // ...
]
```

What it does:

- Marks `@puzzmo/tapped/src/server` (and node builtins / fsevents) as external so the SSR module isn't bundled into the client.
- Splits `/pages/...Page.{ts,tsx}` and `/queries/...Query.{ts,tsx}` into their own chunks. Disable with `pageChunking: false`.
- When `precompress: true`, emits `.br` (brotli q11) and `.gz` (level 9) siblings for compressible client assets above 1 KB after the client build.
- When `fingerprintTargets` is set, hashes each target, relocates it under `assets/external/`, and patches the URL in `index.html`. Intended for plugin outputs that escape Vite's normal fingerprinting pipeline (e.g. `stylex.css` from `@stylexswc/unplugin`, the monaco worker bundle).

The raw `fingerprintStaticAssets` and `precompressDir` helpers are also re-exported from `@puzzmo/tapped/vite` if you need to invoke them from a standalone script.

#### Pairing precompress with the server

Tapped's fastify server defaults `preCompressed: true` in production (override via `staticOptions.preCompressed: false` if you ever need the raw files only). The remaining job is the cache-control policy:

```ts
const { fastify, vite, templateHtml, serverModulePath } = await setupServer({
  config: { ... },
  __dirname,
  staticOptions: {
    setHeaders(res, filePath) {
      // Strip any .br/.gz suffix so the cache decision uses the underlying file type.
      const basePath = filePath.replace(/\.(br|gz)$/, "")
      if (basePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "public, no-cache")
      } else if (basePath.includes("/assets/")) {
        // Vite fingerprints everything under /assets/; fingerprintTargets lands here too.
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable")
      } else {
        res.setHeader("Cache-Control", "public, max-age=3600")
      }
    },
  },
})
```

Skip `precompress` when:

- The server doesn't serve `.br`/`.gz` siblings directly (e.g. uses `@fastify/compress` on the fly, or no fastify at all). The siblings become dead weight on disk.
- A CDN (CloudFront, Cloudflare) or edge host (Vercel, Netlify) sits in front and compresses at the edge — the origin copies are unused.
- You care about build wall-clock time more than serve-time CPU. Brotli q11 is the slowest tier; this runs at the end of every client build.

## Architecture Notes

### Shared Relay Environment Pattern

**Critical:** All data loaders must use the same Relay environment instance for SSR to work correctly:

1. Create environment once in your `createTappedContext` function
2. Pass that environment to `createWouterRoutes()` and any root loaders
3. Pass the environment to `createWouterSSRContext()` via the options
4. During SSR, all loaders will populate the same store
5. When React renders, `useLazyLoadQuery` reads from that populated store without suspending

```typescript
// ✅ Correct - Single environment
const environment = createEnvironment(url, recordSource, cookie)
const routes = createWouterRoutes(environment)
const rootLoader = loadRootQuery(environment)
return createWouterSSRContext({ ..., environment, routes, rootBootstrappingLoader: rootLoader })

// ❌ Wrong - Multiple environments
const routes = createWouterRoutes(createEnvironment(...)) // Different env!
const rootLoader = loadRootQuery(createEnvironment(...))  // Different env!
return createWouterSSRContext({ ... }) // Creates another env!
```

### Forwarding request headers

`createEnvironment` from `@puzzmo/tapped/src/relay` forwards the visitor's `cookie` and `authorization` to the GraphQL
upstream and nothing else. Anything more is named one header at a time in `forwarded`, so the full request header set
never reaches the API by accident:

```typescript
const environment = createEnvironment(graphqlUrl, recordSource, {
  cookie: req.headers.cookie,
  authorization: req.headers.authorization,
  forwarded: { "x-forwarded-for": req.headers["x-forwarded-for"] as string | undefined },
})
```

Unset values are skipped, and a `forwarded` entry cannot replace a header tapped sets itself.

## License

MIT
