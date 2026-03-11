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

/** Operation type with variables and response - matches Relay's generated types */
export type OperationType = {
  variables: Record<string, unknown>
  response: unknown
}

/** Request options for query/mutate functions */
export type RequestOptions<TVariables> = {
  variables: TVariables
  url: string
  headers?: HeadersInit
  credentials?: RequestCredentials
  signal?: AbortSignal
}
