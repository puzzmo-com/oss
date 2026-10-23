# Tapped (@puzzmo/tapped)

Tapped is a server-side rendering framework for React + Relay applications, built on Fastify, Vite, and Wouter. It is a **standalone library with multiple consuming apps** — treat it like an open-source project, not part of any one app's codebase. Code, comments, and APIs must make sense without knowing anything about a specific consumer: no references to a consumer's screens, queries, domain models, or URL structure. The [README.md](README.md) is the public-facing documentation; keep it updated when APIs change.

## How it works

Tapped's job is: render a Wouter-routed React app on the server with its Relay data already in the store, stream the HTML, and hand the client everything it needs to hydrate without refetching.

The life of a request:

1. **Server setup** (`src/server/createServer.ts`) — `setupServer` builds a Fastify instance, giving consumers a `beforeMiddleware` hook to register their own hooks against it first (edge-style redirects and rewrites need to see a request before the dev server or static handler claims it). In dev, Vite runs in middleware mode and serves assets/HMR; in production, `@fastify/static` serves the built client (with optional precompressed `.br`/`.gz` siblings) and the HTML template is read from `dist/client/<templatePath>`.
2. **The catch-all handler** (`registerSSRHandler`) — every GET that isn't a static asset hits this. It loads the consumer's _server module_ (via `vite.ssrLoadModule` in dev, a built `.mjs` import in production), which must export `createTappedContext` and `renderWouterApp`.
3. **Context creation** (`src/server/ssr.tsx`) — `createWouterSSRContext` matches the URL against the consumer's route config, then runs data loaders against a single per-request Relay environment: the optional `rootBootstrappingLoader` first, then the matched route's `loader`. They are sequential on purpose — route loaders may read what the root loader put in the store.
4. **Streaming render** (`renderWouterReactApp`) — `renderToPipeableStream` renders the consumer's App. The HTML template is split on the `<!--app-head-->` and `<!--app-html-->` markers; the route's `head()` tags, helmet head tags and (in dev) StyleX CSS are written into the head, then the app HTML streams in.
5. **Hydration payload** — after the app HTML, the full Relay record source, the loader metadata, and the optional app config are serialized into `window.__RECORD_SOURCE`, `window.__LOADER_DATA`, and `window.__APP_CONFIG` (XSS-escaped). The client builds a `RecordSource` from that, so `useLazyLoadQuery` with `store-or-network` renders without a network round trip.
6. **Failure path** — if a loader or the shell render throws, the handler serves the template as a plain SPA shell (markers stripped, no record source) with a `200` and an `x-ssr-fallback: error` header. SSR is an enhancement layer: a broken page must degrade to client rendering, never to an error page.

## Layout

- `src/server/` — Fastify setup, the SSR handler, context creation, streaming render, `ServerConfig`/`WouterContext` types
- `src/routing/` — route config types, `matchRoute` (regexparam), `loadRouteData`, `createRouteElements` for the client-side `<Switch>`, `renderHeadTags`/`renderPlaceholderData` for the document hooks
- `src/relay/` — `createEnvironment` (server-side fetch with forwarded credentials), `preload` (SSR data loading with timeout), `useGetMainPageQuery` (store-or-network read hook)
- `src/client/` — loader-data context provider and `useSSRData` (context on the server, `window.__LOADER_DATA` on the client)
- `src/vite/` — the `tapped()` Vite plugin: SSR-module externals, page/query chunk splitting, opt-in precompression and post-build fingerprinting

The package is source-distributed: consumers import TypeScript directly through the `exports` map (`@puzzmo/tapped/src/server`, etc.). There is no build step; `yarn workspace @puzzmo/tapped type-check` is the verification.

## Invariants

These are the rules that make the system work — breaking any of them produces subtle hydration or cross-request bugs, not loud failures:

- **One Relay environment per request, shared by every loader.** Store-fulfilled hydration only works if the root loader, route loaders, and the rendered app all read/write the same store. Never create a second environment mid-request.
- **Loader variables must exactly match what components request at render.** A variable mismatch means a different query identity, so the client refetches and the SSR data is wasted. When a loader and a component disagree, the component is the source of truth.
- **Root loader before route loaders.** Route loaders are allowed to depend on store data the root loader fetched. Don't parallelize them.
- **No per-request state at module scope.** The server module is loaded once and reused across requests (both `ssrLoadModule` and the production import are cached), so module-level mutable state leaks between requests. This applies to tapped itself and is worth flagging when seen in consumer code.
- **Header forwarding is an allowlist.** `createEnvironment` forwards `cookie`, `authorization`, and whatever the consumer names one by one in `SSRRequestHeaders.forwarded` to the GraphQL upstream. Don't widen this to forward arbitrary request headers, and don't let `forwarded` override the headers tapped sets itself.
- **The serialized record source is the whole store.** Everything a loader fetches ends up in the page HTML. That makes authed SSR pages personalized and uncacheable — which is why the SSR page cache (`SSRCacheOptions`) must only be enabled for routes whose HTML is identical across requests.
- **Everything rendered must be SSR-safe.** No `document`/`window`/`localStorage` access during render; browser APIs belong in effects and event handlers. The SPA fallback catches violations, but each one costs the page its SSR.
- **Document hooks run on every render mode, and never fail the page.** `head()` and `placeholder()` exist so a `render: "spa"` route can still describe itself to a crawler and fill its root element — skipping them for SPA routes would remove their entire reason to exist. Both are decoration: a throw is logged and the page is served without it.
- **`progressiveChunkSize` is `MAX_SAFE_INTEGER` deliberately.** React otherwise flushes the shell early and reveals Suspense content via JS (`$RC` chunks), which breaks no-JS rendering and crawlers. Don't "fix" it back to the default.
- **The template contract is the two markers.** Consumer templates must contain `<!--app-head-->` and `<!--app-html-->`. The production template is the Vite-built copy (hashed asset references), so the SSR template must be one of the client build's HTML inputs.

## Making changes

- Multiple apps in this monorepo consume tapped. A breaking change to the server-module contract, route config shape, or hydration globals must update every consumer in the same PR — find them with `grep -rl "@puzzmo/tapped" apps/*/src apps/*/server.mts`.
- Generic root-repo conventions (ID suffix naming, one-line JSDocs, no single-statement braces, helpers at the bottom of the file) apply here too.
- New options should be optional with defaults preserving current behavior — consumers shouldn't need changes to upgrade.
- Debug output goes through `debugLog` in `src/index.ts` (toggled by a constant, silent by default), not bare `console.log`. Operational errors that operators need to see use `console.error`.
