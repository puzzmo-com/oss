import * as p from "@clack/prompts"

import { fetchTeamName } from "../queries/teamForToken.js"
import { defaultSource, addToken, decodeTokenPayload, normalizeSource, sourceToURL, tokenHelp } from "../util/config.js"

/** Saves a CLI token to ~/.puzzmo/config.json under the given source server, along with its team's name */
export const login = async (token: string, source: string = defaultSource) => {
  if (!token.startsWith("pzt-")) {
    p.log.error(`Invalid CLI token — they start with "pzt-".\n${tokenHelp}`)
    process.exit(1)
  }

  const payload = decodeTokenPayload(token)
  if (!payload?.teamID) {
    p.log.error(`Could not decode the team from this token, so it is not a Workshop access token.\n${tokenHelp}`)
    process.exit(1)
  }

  const normalized = normalizeSource(source)
  // Only a nicety for later messages, so the token is still saved when the server can't be asked
  let teamName: string | null = null
  try {
    teamName = await fetchTeamName(sourceToURL(normalized), token)
  } catch (e) {
    p.log.warn(`Could not look up the team name on ${normalized}: ${e instanceof Error ? e.message : String(e)}`)
  }

  addToken(normalized, token, teamName ?? undefined)
  const team = teamName ? `${teamName} (${payload.teamID})` : payload.teamID
  p.log.success(`Logged in to ${normalized} for team ${team}. Token saved to ~/.puzzmo/config.json`)
}
