import type { GraphQLResponse, OperationType, RequestOptions } from "./types"

/**
 * Execute a GraphQL query using fetch with Relay-generated types.
 *
 * @example
 * ```ts
 * import { graphql, query } from '@puzzmo-com/belay'
 * import type { LoginFormQuery } from '@relay/LoginFormQuery.graphql'
 *
 * const loginQuery = graphql`
 *   query LoginFormQuery($jwt: String!) {
 *     login(jwt: $jwt) { id }
 *   }
 * `
 *
 * const { data, errors } = await query<LoginFormQuery>(loginQuery, {
 *   variables: { jwt: 'xxx' },
 *   url: 'https://api.puzzmo.com/graphql'
 * })
 * ```
 */
export const query = async <T extends OperationType>(
  queryString: string,
  options: RequestOptions<T["variables"]>
): Promise<GraphQLResponse<T["response"]>> => {
  const { variables, url, headers, credentials, signal } = options

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    credentials,
    signal,
    body: JSON.stringify({
      query: queryString,
      variables,
    }),
  })

  return response.json()
}
