import { graphql, query } from "../util/belay.js"
import type { cliAddPuzzlesToPoolMutation } from "./__generated__/cliAddPuzzlesToPoolMutation.graphql.js"
import type { cliGamesForAccessTokenQuery } from "./__generated__/cliGamesForAccessTokenQuery.graphql.js"
import type { cliValidatePoolPuzzlesQuery } from "./__generated__/cliValidatePoolPuzzlesQuery.graphql.js"

const gamesForAccessTokenQuery = graphql`
  query cliGamesForAccessTokenQuery($token: String!) {
    gamesForAccessToken(token: $token) {
      slug
    }
  }
`

const validatePoolPuzzlesQuery = graphql`
  query cliValidatePoolPuzzlesQuery($token: String!, $gameSlug: String!, $puzzles: [McpPuzzleFileInput!]!) {
    validatePoolPuzzles(token: $token, gameSlug: $gameSlug, puzzles: $puzzles) {
      filename
      valid
      errors
    }
  }
`

const addPuzzlesToPoolMutation = graphql`
  mutation cliAddPuzzlesToPoolMutation($token: String!, $gameSlug: String!, $puzzles: [McpPuzzleFileInput!]!) {
    addPuzzlesToPool(token: $token, gameSlug: $gameSlug, puzzles: $puzzles) {
      uploadedFilenames
      failed {
        filename
        message
      }
      poolCount
    }
  }
`

export type PuzzleFile = { filename: string; content: string }

/** The slugs of the games a token can manage, or null when the server rejects the token. */
export const fetchGameSlugsForToken = async (apiURL: string, token: string): Promise<string[] | null> => {
  const { data } = await query<cliGamesForAccessTokenQuery>(gamesForAccessTokenQuery, { variables: { token }, url: `${apiURL}/graphql` })
  return data?.gamesForAccessToken?.map((g) => g.slug) ?? null
}

/** Checks puzzle files against the game's pool rules without uploading them. */
export const validatePoolPuzzles = async (apiURL: string, token: string, gameSlug: string, puzzles: PuzzleFile[]) => {
  const { data, errors } = await query<cliValidatePoolPuzzlesQuery>(validatePoolPuzzlesQuery, {
    variables: { token, gameSlug, puzzles },
    url: `${apiURL}/graphql`,
  })
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "))
  if (!data?.validatePoolPuzzles) throw new Error(`No game named "${gameSlug}" is accessible with that token.`)
  return data.validatePoolPuzzles
}

/** Adds puzzle files to the end of the game's pool; invalid files come back in `failed`. */
export const addPuzzlesToPool = async (apiURL: string, token: string, gameSlug: string, puzzles: PuzzleFile[]) => {
  const { data, errors } = await query<cliAddPuzzlesToPoolMutation>(addPuzzlesToPoolMutation, {
    variables: { token, gameSlug, puzzles },
    url: `${apiURL}/graphql`,
  })
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "))
  if (!data?.addPuzzlesToPool) throw new Error(`No game named "${gameSlug}" is accessible with that token.`)
  return data.addPuzzlesToPool
}
