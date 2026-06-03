// "belay lite" — a local copy of the parts of @puzzmo-com/belay the CLI needs.
// The CLI is published to npm and ships unbundled, so it can't depend on the private,
// source-only belay package; this vendors the tiny query/graphql helpers instead.
// The `graphql` tag lets the Relay compiler validate these queries and generate types
// (see the "cli" project in relay.config.json). Keep this in sync with packages/belay.

/** Standard GraphQL error shape */
export type GraphQLError = {
  message: string
  locations?: Array<{ line: number; column: number }>
  path?: Array<string | number>
  extensions?: Record<string, unknown>
}

/** GraphQL response shape */
export type GraphQLResponse<TData> = {
  data?: TData
  errors?: GraphQLError[]
}

/** Operation type with variables and response — matches Relay's generated operation types */
export type OperationType = {
  variables: Record<string, unknown>
  response: unknown
}

/** Request options for the query function */
export type RequestOptions<TVariables> = {
  variables: TVariables
  url: string
  headers?: HeadersInit
  signal?: AbortSignal
}

/**
 * A graphql tagged template literal that returns the query string. This lets the Relay
 * compiler pick up and validate the operation (and generate its types) without bundling relay-runtime.
 */
export const graphql = (strings: TemplateStringsArray): string => strings[0]!

/** Execute a GraphQL query via fetch, typed with a Relay-generated operation type. */
export const query = async <T extends OperationType>(
  queryString: string,
  options: RequestOptions<T["variables"]>,
): Promise<GraphQLResponse<T["response"]>> => {
  const { variables, url, headers, signal } = options

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    signal,
    body: JSON.stringify({ query: queryString, variables }),
  })

  return response.json() as Promise<GraphQLResponse<T["response"]>>
}
