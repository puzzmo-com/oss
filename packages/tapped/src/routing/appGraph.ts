import React from "react"

import { WouterRoute } from "./types.js"

export interface AppGraphRoute {
  path: string
  render: "ssr" | "spa"
  component: string
  hasLoader: boolean
  hasHeaders: boolean
  middlewareCount: number
  /** JSON-safe passthrough of any app-specific extra keys on the route (e.g. breadcrumb metadata). */
  meta: Record<string, unknown>
  children?: AppGraphRoute[]
}

/**
 * Serializes a route tree into JSON-safe metadata. Shared by the /_tapped devtools page and its JSON endpoint so the
 * two can never drift.
 */
export const buildAppGraph = (routes: WouterRoute[]): AppGraphRoute[] =>
  routes.map((route) => {
    const { path, component, loader, children, render, middleware, headers, ...rest } = route

    // Apps extend WouterRoute with their own metadata (breadcrumbs, auth flags); keep whatever is JSON-safe.
    const meta: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(rest)) {
      if (value === null || ["string", "number", "boolean"].includes(typeof value)) meta[key] = value
      else if (Array.isArray(value)) meta[key] = value.filter((entry) => ["string", "number", "boolean"].includes(typeof entry))
    }

    return {
      path,
      render: render ?? "ssr",
      component: componentName(component),
      hasLoader: !!loader,
      hasHeaders: !!headers,
      middlewareCount: middleware?.length ?? 0,
      meta,
      children: children ? buildAppGraph(children) : undefined,
    }
  })

/** Best-effort display name for a route component — React.lazy components are objects with no useful name. */
const componentName = (component: React.ComponentType<any>): string => {
  if (typeof component === "function") return (component as any).displayName || component.name || "anonymous"
  return "lazy"
}
