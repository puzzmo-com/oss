import { writeConfig, readConfig } from "../util/config.js"

/** Saves a CLI token to ~/.puzzmo/config.json */
export const login = (token: string) => {
  if (!token.startsWith("pzt-")) {
    console.error("Invalid CLI token. Generate one from studio.puzzmo.com.")
    process.exit(1)
  }

  const config = readConfig()
  config.token = token
  writeConfig(config)

  console.log("Logged in successfully. Token saved to ~/.puzzmo/config.json")
}
