import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const configDir = path.join(os.homedir(), ".puzzmo")
const configPath = path.join(configDir, "config.json")

export const defaultSource = "https://api.puzzmo.com"

export type TokenEntry = {
  /** Server identifier (e.g. "api.puzzmo.com" or "localhost:8911") */
  source: string
  /** The pzt- prefixed JWT issued by that server */
  token: string
}

type Config = { tokens: TokenEntry[] }

/** Reads ~/.puzzmo/config.json. Returns an empty token list if the file doesn't exist. */
export const readConfig = (): Config => {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8")) as Partial<Config>
    return { tokens: parsed.tokens ?? [] }
  } catch {
    return { tokens: [] }
  }
}

const writeConfig = (config: Config) => {
  fs.mkdirSync(configDir, { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n")
}

/** Saves a token for `source`, replacing any existing entry for that same source */
export const addToken = (source: string, token: string) => {
  const normalized = normalizeSource(source)
  const { tokens } = readConfig()
  const remaining = tokens.filter((t) => normalizeSource(t.source) !== normalized)
  remaining.push({ source: normalized, token })
  writeConfig({ tokens: remaining })
}

/** Removes any saved token for `source`. Returns true if something was removed. */
export const removeToken = (source: string): boolean => {
  const normalized = normalizeSource(source)
  const { tokens } = readConfig()
  const remaining = tokens.filter((t) => normalizeSource(t.source) !== normalized)
  if (remaining.length === tokens.length) return false
  writeConfig({ tokens: remaining })
  return true
}

/**
 * Returns saved tokens. Env vars override the config file entirely: `PUZZMO_TOKEN`, plus any
 * `PUZZMO_TOKEN_<NAME>` so one environment can hold tokens for several teams.
 */
export const getTokens = (): TokenEntry[] => {
  const envTokens = readEnvTokens()
  return envTokens.length ? envTokens : readConfig().tokens
}

const envTokenPrefix = "PUZZMO_TOKEN_"

/**
 * Reads tokens out of the environment: `PUZZMO_TOKEN` first, then every `PUZZMO_TOKEN_<NAME>`.
 * `<NAME>` is only a label — a token's team comes from its JWT — but it does pick that token's
 * server via `PUZZMO_API_URL_<NAME>`, falling back to `PUZZMO_API_URL` then the default.
 */
const readEnvTokens = (): TokenEntry[] => {
  const fallbackSource = process.env.PUZZMO_API_URL ?? defaultSource
  const entries: TokenEntry[] = []

  const add = (token: string | undefined, source: string) => {
    const trimmed = token?.trim()
    if (!trimmed) return
    entries.push({ source: normalizeSource(source), token: trimmed })
  }

  add(process.env.PUZZMO_TOKEN, fallbackSource)
  // Sorted so the token order is stable regardless of how the environment was assembled.
  for (const name of Object.keys(process.env).sort()) {
    if (!name.startsWith(envTokenPrefix)) continue
    const suffix = name.slice(envTokenPrefix.length)
    if (!suffix) continue
    add(process.env[name], process.env[`PUZZMO_API_URL_${suffix}`] ?? fallbackSource)
  }

  return dedupeTokens(entries)
}

/** Drops repeats of the same token against the same server, keeping the first occurrence */
const dedupeTokens = (tokens: TokenEntry[]): TokenEntry[] => {
  const seen = new Set<string>()
  return tokens.filter((entry) => {
    const key = `${entry.source} ${entry.token}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Best-guess token for clients that don't care which server it points at (e.g. .mcp.json scaffolding) */
export const getDefaultToken = (): string | undefined => getTokens()[0]?.token

type TokenPayload = { teamID?: string; createdByID?: string; iat?: number }

/** Decodes a `pzt-<jwt>` token (without verifying) and returns its payload, or null on failure */
export const decodeTokenPayload = (token: string): TokenPayload | null => {
  try {
    const stripped = token.startsWith("pzt-") ? token.slice(4) : token
    const parts = stripped.split(".")
    if (parts.length < 2) return null
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/")
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4)
    return JSON.parse(Buffer.from(padded, "base64").toString("utf-8")) as TokenPayload
  } catch {
    return null
  }
}

/** Strips protocol and trailing slashes so two spellings of the same server compare equal */
export const normalizeSource = (source: string): string =>
  source
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")

/** Re-attaches a protocol to a normalized source. Localhost defaults to http, everything else to https. */
export const sourceToURL = (source: string): string => {
  const trimmed = source.trim().replace(/\/+$/, "")
  if (/^https?:\/\//.test(trimmed)) return trimmed
  const normalized = normalizeSource(trimmed)
  if (isLocalhost(normalized)) return `http://${normalized}`
  return `https://${normalized}`
}

const isLocalhost = (source: string): boolean => {
  const n = normalizeSource(source)
  return n.startsWith("localhost") || n.startsWith("127.0.0.1") || n.startsWith("0.0.0.0")
}

const isPuzzmoCom = (source: string): boolean => /(^|\.)puzzmo\.com(:|\/|$)/.test(normalizeSource(source))

/** Sorts saved tokens by upload preference: localhost > *.puzzmo.com > anything else */
export const sortByServerPriority = (tokens: TokenEntry[]): TokenEntry[] => {
  const priority = (t: TokenEntry) => (isLocalhost(t.source) ? 0 : isPuzzmoCom(t.source) ? 1 : 2)
  return [...tokens].sort((a, b) => priority(a) - priority(b))
}

/** Returns saved tokens whose JWT teamID matches the given teamID */
export const findTokensForTeam = (teamID: string): TokenEntry[] => getTokens().filter((t) => decodeTokenPayload(t.token)?.teamID === teamID)

/** True if a quick fetch to `${source}/graphql` returns any HTTP response within `timeoutMs` */
export const isServerReachable = async (source: string, timeoutMs = 1500): Promise<boolean> => {
  const url = `${sourceToURL(source)}/graphql`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    await fetch(url, { method: "GET", signal: controller.signal })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Picks the (source, token) pair to use for `teamID`. Prefers localhost when reachable,
 * then *.puzzmo.com, then any other matching source. Returns null if no token matches.
 */
export const resolveServerForTeam = async (teamID: string): Promise<TokenEntry | null> => {
  const matches = sortByServerPriority(findTokensForTeam(teamID))
  if (matches.length === 0) return null
  for (const candidate of matches) {
    if (isLocalhost(candidate.source) && !(await isServerReachable(candidate.source))) continue
    return candidate
  }
  return null
}
