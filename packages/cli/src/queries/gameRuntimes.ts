import { graphql, query } from "../util/belay.js"
import type { cliGameRuntimesQuery } from "./__generated__/cliGameRuntimesQuery.graphql.js"

const gameRuntimesQuery = graphql`
  query cliGameRuntimesQuery($token: String!) {
    teamForToken(token: $token) {
      slug
      games(first: 500) {
        edges {
          node {
            slug
            runtime {
              currentVersion {
                assetsSha
              }
              nextVersion {
                assetsSha
              }
              previousVersion {
                assetsSha
              }
            }
          }
        }
      }
    }
  }
`

/** The deployed runtime build SHAs for a game, read from its runtime's current/next/previous version slots. */
export type GameVersions = {
  /** SHA of the live/current runtime build */
  current: string | null
  /** SHA of the staged "next" runtime build, if one exists */
  next: string | null
  /** SHA of the previous runtime build, if one exists */
  previous: string | null
}

/**
 * Fetches the runtime build SHAs for every game in the token's team, keyed by game slug. The token is sent both as
 * the `teamForToken` argument and as the Bearer header — the latter is what unlocks the team-gated `runtime` field.
 */
export const fetchTeamGameVersions = async (apiURL: string, token: string): Promise<Map<string, GameVersions>> => {
  const { data, errors } = await query<cliGameRuntimesQuery>(gameRuntimesQuery, {
    variables: { token },
    url: `${apiURL}/graphql`,
    headers: { Authorization: `Bearer ${token}` },
  })

  if (errors?.length) throw new Error(`teamForToken failed: ${errors.map((e) => e.message).join("; ")}`)

  const versions = new Map<string, GameVersions>()
  for (const edge of data?.teamForToken?.games?.edges ?? []) {
    const game = edge?.node
    if (!game) continue
    versions.set(game.slug, {
      current: game.runtime?.currentVersion?.assetsSha || null,
      next: game.runtime?.nextVersion?.assetsSha || null,
      previous: game.runtime?.previousVersion?.assetsSha || null,
    })
  }
  return versions
}
