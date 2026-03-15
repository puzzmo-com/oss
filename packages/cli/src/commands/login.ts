import * as p from "@clack/prompts"

import { writeConfig, readConfig } from "../util/config.js"

/** Saves a CLI token to ~/.puzzmo/config.json */
export const login = (token: string) => {
  if (!token.startsWith("pzt-")) {
    p.log.error("Invalid CLI token. Generate one from dev.puzzmo.com.")
    process.exit(1)
  }

  const config = readConfig()
  config.token = token
  writeConfig(config)

  p.log.success("Logged in successfully. Token saved to ~/.puzzmo/config.json")
}
