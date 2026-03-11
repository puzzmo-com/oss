import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const configDir = path.join(os.homedir(), ".puzzmo")
const configPath = path.join(configDir, "config.json")

type Config = {
  token?: string
  apiURL?: string
}

/** Reads the CLI config from ~/.puzzmo/config.json */
export const readConfig = (): Config => {
  try {
    const raw = fs.readFileSync(configPath, "utf-8")
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

/** Writes the CLI config to ~/.puzzmo/config.json */
export const writeConfig = (config: Config) => {
  fs.mkdirSync(configDir, { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n")
}

/** Returns the auth token from config or PUZZMO_TOKEN env var */
export const getToken = (): string | undefined => {
  return process.env.PUZZMO_TOKEN || readConfig().token
}

/** Returns the API base URL */
export const getAPIURL = (): string => {
  return process.env.PUZZMO_API_URL || readConfig().apiURL || "https://api.puzzmo.com"
}
