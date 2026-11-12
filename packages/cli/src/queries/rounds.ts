import { graphql, query } from "../util/belay.js"
import type { cliRoundFixturesQuery } from "./__generated__/cliRoundFixturesQuery.graphql.js"

const roundFixturesQuery = graphql`
  query cliRoundFixturesQuery($token: String!, $gameSlug: String!) {
    gameAchievementsDebug(token: $token, gameSlug: $gameSlug) {
      members {
        username
        rounds {
          at
          outcome
          verified
          hasLog
          fixture
        }
      }
    }
  }
`

export type TracedRound = { username: string; at: number; outcome: string; verified: boolean; hasLog: boolean; fixture: unknown }

/** Every round Puzzmo traced for the game's team (the last ten per member), each with its replay fixture when it kept the log */
export const fetchTracedRounds = async (apiURL: string, token: string, gameSlug: string): Promise<TracedRound[]> => {
  const { data, errors } = await query<cliRoundFixturesQuery>(roundFixturesQuery, {
    variables: { token, gameSlug },
    url: `${apiURL}/graphql`,
  })
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "))
  if (!data?.gameAchievementsDebug) throw new Error(`No game named "${gameSlug}" is accessible with that token.`)
  return data.gameAchievementsDebug.members.flatMap((member) => member.rounds.map((round) => ({ ...round, username: member.username })))
}
