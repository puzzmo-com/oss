import { Redirect } from "wouter"

import { redirect } from "./middleware.js"
import { WouterRoute } from "./types.js"

/**
 * A route that sends `path` to `to`. On the server it short-circuits with an HTTP redirect *before any render*,
 * so curl, crawlers and link unfurlers follow it to the destination's real SSR HTML instead of the empty
 * client-side-redirect shell. On the client (SPA navigation) the component issues the equivalent wouter
 * redirect, since middleware only runs on the server. Defaults to 307 (temporary, method-preserving).
 */
export const redirectRoute = (path: string, to: string, status: 301 | 302 | 303 | 307 | 308 = 307): WouterRoute => ({
  path,
  component: () => <Redirect to={to} replace />,
  middleware: [() => redirect(to, status)],
})
