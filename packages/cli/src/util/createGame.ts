const createUserGameMutation = `
  mutation cliCreateUserGameMutation($teamAccessToken: String!, $input: CreateUserGameInput!) {
    createUserGame(teamAccessToken: $teamAccessToken, input: $input) {
      game { id slug displayName }
      newAccessToken
    }
  }
`

type GraphQLError = { message: string }

type CreateUserGameResponse = {
  data?: {
    createUserGame: {
      game: { id: string; slug: string; displayName: string }
      newAccessToken: string | null
    } | null
  }
  errors?: GraphQLError[]
}

export type CreateUserGameOptions = {
  /** Base URL of the API server to call (e.g. "https://api.puzzmo.com") */
  apiURL: string
  /** A teamAccessToken (the same token saved by `puzzmo login`). The mutation uses it to identify the team. */
  teamAccessToken: string
  displayName: string
}

export type CreatedGame = { id: string; slug: string; displayName: string; newAccessToken: string | null }

/** Calls the createUserGame mutation using a teamAccessToken for auth. */
export const createUserGame = async (options: CreateUserGameOptions): Promise<CreatedGame> => {
  const url = `${options.apiURL}/graphql`

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: createUserGameMutation,
      variables: {
        teamAccessToken: options.teamAccessToken,
        input: { displayName: options.displayName },
      },
    }),
  })

  if (!response.ok) throw new Error(`createUserGame request failed: ${response.status} ${response.statusText}`)

  const result = (await response.json()) as CreateUserGameResponse

  if (result.errors?.length) {
    const message = result.errors.map((e) => e.message).join("; ")
    throw new Error(`createUserGame failed: ${message}`)
  }
  if (!result.data?.createUserGame) throw new Error("createUserGame returned no data")

  const { game, newAccessToken } = result.data.createUserGame
  return { id: game.id, slug: game.slug, displayName: game.displayName, newAccessToken }
}
