/**
 * A structured HTTP error for loaders and middleware to throw. The SSR handler honors the status code, keeps 4xx
 * messages client-visible, and sanitizes 5xx messages when running in production.
 *
 * ```ts
 * if (!post) throw new TappedHttpError(404, "Post not found")
 * ```
 */
export class TappedHttpError extends Error {
  /** Duck-type marker: instanceof fails across the vite-ssrLoadModule/node module boundary, so checks use this instead. */
  readonly isTappedHttpError = true

  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = "TappedHttpError"
  }
}

/** True when the error is a TappedHttpError, robust to the class identity crossing the vite/node module boundary. */
export const isTappedHttpError = (error: unknown): error is TappedHttpError =>
  typeof error === "object" && error !== null && (error as { isTappedHttpError?: boolean }).isTappedHttpError === true

/**
 * Records which route a failure happened on, so a request that dies before its context exists can
 * still be attributed to a page. Loaders run during context creation, so a failing loader takes the
 * matched route down with it — and "which page stopped server-rendering" is the whole question.
 *
 * A plain property rather than a symbol: like isTappedHttpError, this has to survive the error
 * crossing the vite-ssrLoadModule/node module boundary.
 */
export const attachRoutePath = <E>(error: E, routePath: string | undefined | null): E => {
  if (routePath && typeof error === "object" && error !== null) (error as { tappedRoutePath?: string }).tappedRoutePath = routePath
  return error
}

/** The route path attached by attachRoutePath, if the error carries one. */
export const routePathOf = (error: unknown): string | null =>
  (typeof error === "object" && error !== null && (error as { tappedRoutePath?: string }).tappedRoutePath) || null

/**
 * Keeps a route's head tags with a failure that happens before its context exists. They come from
 * their own lookup, so a broken loader should not also cost the shell its crawler metadata.
 */
export const attachHeadHTML = <E>(error: E, headHTML: string): E => {
  if (headHTML && typeof error === "object" && error !== null) (error as { tappedHeadHTML?: string }).tappedHeadHTML = headHTML
  return error
}

/** The head HTML attached by attachHeadHTML, if the error carries any. */
export const headHTMLOf = (error: unknown): string =>
  (typeof error === "object" && error !== null && (error as { tappedHeadHTML?: string }).tappedHeadHTML) || ""
