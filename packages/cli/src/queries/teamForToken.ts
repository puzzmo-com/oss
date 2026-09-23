import { graphql, query } from "../util/belay.js"
import type { cliTeamForTokenQuery } from "./__generated__/cliTeamForTokenQuery.graphql.js"

const teamForTokenQuery = graphql`
  query cliTeamForTokenQuery($token: String!) {
    teamForToken(token: $token) {
      name
    }
  }
`

/** Looks up the display name of the team a token belongs to; throws if the server rejects the token. */
export const fetchTeamName = async (apiURL: string, token: string): Promise<string | null> => {
  const { data, errors } = await query<cliTeamForTokenQuery>(teamForTokenQuery, {
    variables: { token },
    url: `${apiURL}/graphql`,
  })

  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "))
  return data?.teamForToken?.name ?? null
}
