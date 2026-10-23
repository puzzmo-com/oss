import type { Environment } from "react-relay"
import ReactRelay from "react-relay"
import { CacheConfig, GraphQLTaggedNode, OperationType } from "relay-runtime"

import { PreloadedData } from "./types.js"

const { fetchQuery, loadQuery, useLazyLoadQuery } = ReactRelay

/** Thrown by `preload` when the SSR data fetch exceeds its timeout, so callers can fall back to CSR rather than error the page. */
export class PreloadTimeoutError extends Error {
  /** Duck-type marker: instanceof fails across the vite-ssrLoadModule/node module boundary, so checks use this instead. */
  readonly isPreloadTimeoutError = true

  constructor(public readonly timeoutMs: number) {
    super(`preload: GraphQL fetch timed out after ${timeoutMs}ms`)
    this.name = "PreloadTimeoutError"
  }
}

/** True when the error is a PreloadTimeoutError, robust to the class identity crossing module-graph boundaries. */
export const isPreloadTimeoutError = (error: unknown): error is PreloadTimeoutError =>
  typeof error === "object" && error !== null && (error as { isPreloadTimeoutError?: boolean }).isPreloadTimeoutError === true

/**
 * Preloads a GraphQL query into the Relay environment for SSR. Times out after `timeoutMs` (default 5000) so a slow/hung GraphQL upstream
 * cannot stall SSR indefinitely; the SSR handler serves the client shell (CSR) instead. The timeout aborts the upstream fetch itself (via
 * the environment's cacheConfig metadata signal) rather than leaving it running. Pass `signal` (e.g. the request-close signal from
 * LoaderArgs) to also cancel the fetch when the client disconnects. On the client this is a no-op fetch: it returns
 * the loader metadata with a store-only query, since page components fetch their own data via useLazyLoadQuery.
 */
export const preload = async <TQuery extends OperationType>(
  environment: Environment,
  graphql: GraphQLTaggedNode,
  variables: TQuery["variables"] = {},
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<PreloadedData<TQuery>> => {
  // On the client, preload only supplies loader metadata (graphql + variables) to the SSR-data context;
  // page components fetch their own data via useLazyLoadQuery. Running the network fetch here just
  // duplicated that request and could blow the timeout, surfacing a spurious PreloadTimeoutError on
  // client-side navigation — so outside SSR we skip the fetch and return a store-only query reference.
  if (typeof window !== "undefined") {
    return {
      graphql,
      variables,
      query: loadQuery<TQuery>(environment, graphql, variables, { fetchPolicy: "store-only" }),
    }
  }

  const timeoutMs = options.timeoutMs ?? 5000

  const abortController = new AbortController()
  const signal = options.signal ? AbortSignal.any([options.signal, abortController.signal]) : abortController.signal

  const fetchPromise = fetchQuery<TQuery>(environment, graphql, variables, {
    fetchPolicy: "store-or-network",
    networkCacheConfig: { metadata: { signal } },
  }).toPromise()

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      abortController.abort()
      reject(new PreloadTimeoutError(timeoutMs))
    }, timeoutMs)
  })

  try {
    await Promise.race([fetchPromise, timeoutPromise])
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }

  return {
    graphql,
    variables,
    query: loadQuery<TQuery>(environment, graphql, variables, {
      fetchPolicy: "store-only",
    }),
  }
}

/**
 * Hook to fetch and return GraphQL query data with lazy loading support.
 * Uses preloaded data if available (SSR), otherwise fetches lazily (CSR).
 */
export const useGetMainPageQuery = <TQuery extends OperationType>(
  querySDL: GraphQLTaggedNode,
  vars?: TQuery["variables"],
  opts?: { networkCacheConfig?: CacheConfig },
) => {
  const variables = vars || ({} as TQuery["variables"])

  const result = useLazyLoadQuery<TQuery>(querySDL, variables, {
    fetchPolicy: "store-or-network",
    networkCacheConfig: opts?.networkCacheConfig,
  })

  return {
    variables,
    query: result,
  }
}
