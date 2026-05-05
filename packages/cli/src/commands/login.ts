import * as p from "@clack/prompts"

import { defaultSource, addToken, decodeTokenPayload, normalizeSource } from "../util/config.js"

/** Saves a CLI token to ~/.puzzmo/config.json under the given source server */
export const login = (token: string, source: string = defaultSource) => {
  if (!token.startsWith("pzt-")) {
    p.log.error("Invalid CLI token. Generate one from dev.puzzmo.com.")
    process.exit(1)
  }

  const payload = decodeTokenPayload(token)
  if (!payload?.teamID) {
    p.log.error("Could not decode the team from this token. Make sure you're using a token from dev.puzzmo.com.")
    process.exit(1)
  }

  const normalized = normalizeSource(source)
  addToken(normalized, token)
  p.log.success(`Logged in to ${normalized} for team ${payload.teamID}. Token saved to ~/.puzzmo/config.json`)
}
