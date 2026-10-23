import { MiddlewareArgs, MiddlewareFn } from "./types.js"

/** Creates a redirect Response for middleware to return, short-circuiting SSR. */
export const redirect = (location: string, status: 301 | 302 | 303 | 307 | 308 = 302): Response =>
  new Response(null, { status, headers: { location } })

/**
 * Runs a middleware chain koa-style: each middleware may return a Response to short-circuit, mutate `args.context`,
 * or call `next()` to continue. Returns the short-circuiting Response, if any.
 */
export const runMiddleware = async (middleware: MiddlewareFn[], args: MiddlewareArgs): Promise<Response | undefined> => {
  let lastCalled = -1

  const dispatch = async (index: number): Promise<Response | undefined> => {
    if (index <= lastCalled) throw new Error("tapped middleware called next() multiple times")
    lastCalled = index

    const fn = middleware[index]
    if (!fn) return undefined
    return await fn(args, () => dispatch(index + 1))
  }

  return dispatch(0)
}
