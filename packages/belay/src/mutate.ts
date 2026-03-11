import type { GraphQLResponse, OperationType, RequestOptions } from "./types"

/**
 * Execute a GraphQL mutation using fetch with Relay-generated types.
 *
 * @example
 * ```ts
 * import { graphql, mutate } from '@puzzmo-com/belay'
 * import type { UpdateUserMutation } from '@relay/UpdateUserMutation.graphql'
 *
 * const updateUserMutation = graphql`
 *   mutation UpdateUserMutation($id: ID!, $input: UpdateUserInput!) {
 *     updateUser(id: $id, input: $input) { id name }
 *   }
 * `
 *
 * const { data, errors } = await mutate<UpdateUserMutation>(updateUserMutation, {
 *   variables: { id: '123', input: { name: 'New Name' } },
 *   url: 'https://api.puzzmo.com/graphql'
 * })
 * ```
 */
export const mutate = async <T extends OperationType>(
  mutationString: string,
  options: RequestOptions<T["variables"]>,
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
      query: mutationString,
      variables,
    }),
  })

  return response.json()
}
