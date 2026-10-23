import { Environment, FetchFunction, Network, Observable, RecordSource, Store } from "relay-runtime"

export type SSRRequestHeaders = {
  cookie?: string
  authorization?: string
  /** Extra headers the consumer names one by one, e.g. a proxy's geolocation header. Unset values are skipped */
  forwarded?: Record<string, string | undefined>
}

const createFetchFunction =
  (url: string, requestHeaders?: SSRRequestHeaders): FetchFunction =>
  (params, variables, cacheConfig) => {
    const headers: [string, string][] = [
      ["content-type", "application/json"],
      ["auth-provider", "custom"],
    ]

    // Forward the authorization header from the incoming request, or use placeholder
    const authHeader = requestHeaders?.authorization || "Bearer ~"
    headers.push(["authorization", authHeader])

    // Forward cookie header for session-based auth
    if (requestHeaders?.cookie) headers.push(["cookie", requestHeaders.cookie])

    // Never let a forwarded header override one set above, fetch would join the two values
    for (const [name, value] of Object.entries(requestHeaders?.forwarded ?? {})) {
      const key = name.toLowerCase()
      if (value && !headers.some(([existing]) => existing === key)) headers.push([key, value])
    }

    // Per-call cancellation: preload passes an AbortSignal through Relay's cacheConfig metadata so a
    // timeout or client disconnect cancels the upstream request rather than just abandoning the promise.
    const signal = cacheConfig?.metadata?.signal as AbortSignal | undefined

    // Append the operation name so requests are identifiable in API logs and traces
    const fetchURL = params.name ? `${url}?${params.name}` : url
    const response = fetch(fetchURL, {
      method: "POST",
      headers,
      credentials: "include",
      signal,
      body: JSON.stringify({
        query: params.text,
        variables,
      }),
    })

    return Observable.from(response.then((data) => data.json()))
  }

/** Creates a Relay environment with network layer and store for GraphQL queries */
export const createEnvironment = (url: string, records: RecordSource, requestHeaders?: SSRRequestHeaders) => {
  const network = Network.create(createFetchFunction(url, requestHeaders))
  const store = new Store(records)
  return new Environment({ store, network })
}
