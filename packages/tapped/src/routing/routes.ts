import { parse } from "regexparam"

import { RouteMatch, WouterRoute } from "./types.js"

/** Matches a pathname against a list of routes and returns the matched route with parameters */
export const matchRoute = (pathname: string, routes: WouterRoute[]): RouteMatch | null => {
  for (const route of routes) {
    const { pattern, keys } = parse(route.path)
    const match = pathname.match(pattern)

    if (match) {
      const params: Record<string, string> = {}
      keys.forEach((key, index) => {
        params[key] = match[index + 1]
      })

      if (route.children) {
        const childMatch = matchRoute(pathname, route.children)
        if (childMatch) {
          return childMatch
        }
      }

      return { route, params, pathname }
    }
  }

  return null
}

/** Loads data for a matched route using its loader function */
export const loadRouteData = async (
  match: RouteMatch,
  request: Request,
  signal?: AbortSignal,
  context?: Record<string, unknown>,
): Promise<any> => {
  if (!match.route.loader) return null

  try {
    return await match.route.loader({ request, params: match.params, signal, context })
  } catch (error) {
    console.error("Route loader error:", error)
    throw error
  }
}
