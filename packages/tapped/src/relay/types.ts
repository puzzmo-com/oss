import { PreloadedQuery } from "react-relay"
import { GraphQLTaggedNode, OperationType } from "relay-runtime"

export type Params = Record<string, string | undefined>

export interface LoaderArgs {
  params: Params
  request: Request
  /** Aborts when the client disconnects; pass into `preload` (or your own fetches) to cancel abandoned work. */
  signal?: AbortSignal
  /** Per-request mutable bag middleware may have written to (e.g. a session) before loaders ran. */
  context?: Record<string, unknown>
}

export interface PreloadedData<TQuery extends OperationType> {
  graphql: GraphQLTaggedNode
  variables: TQuery["variables"]
  query: PreloadedQuery<TQuery>
}

export type LoaderFn = (args: LoaderArgs) => Promise<PreloadedData<OperationType>>
