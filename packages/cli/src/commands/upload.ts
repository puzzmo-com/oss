import { execSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import * as p from "@clack/prompts"

import { GameNotFoundError, uploadFiles } from "../util/api.js"
import {
  defaultSource,
  findTokensForTeam,
  getTokens,
  normalizeSource,
  resolveServerForTeam,
  sourceToURL,
  type TokenEntry,
} from "../util/config.js"
import { createUserGame } from "../util/createGame.js"
import { discoverGames, type DiscoveredGame } from "../util/discoverGames.js"

type UploadOptions = {
  verbose?: boolean
}

type GameSuccess = {
  ok: true
  slug: string
  source: string
  fileCount: number
  totalBytes: number
  versionID: string
  assetsBase: string
  integrationsChanged: boolean
  gameURL: string | null
  versionsURL: string | null
}

type GameFailure = {
  ok: false
  slug: string
  error: string
}

type GameResult = GameSuccess | GameFailure

/** Uploads game build artifacts to Puzzmo by discovering puzzmo.json files in `dir` */
export const upload = async (dir: string, options: UploadOptions = {}) => {
  const { verbose = false } = options

  if (getTokens().length === 0) {
    console.error("Not logged in. Run `puzzmo login <token>` or set PUZZMO_TOKEN.")
    process.exit(1)
  }

  const rootDir = path.resolve(dir)
  if (!fs.existsSync(rootDir)) {
    console.error(`Directory not found: ${dir}`)
    process.exit(1)
  }

  const { games, errors: discoveryErrors } = await discoverGames(rootDir)

  if (!games.length && !discoveryErrors.length) {
    console.error(`No puzzmo.json files found under ${rootDir}`)
    process.exit(1)
  }

  const multi = games.length + discoveryErrors.length > 1

  if (multi) {
    console.log(`Found ${plural(games.length, "game")} under ${rootDir}`)
    for (const game of games) {
      console.log(`  - ${game.puzzmoFile.game.slug} (${path.relative(rootDir, game.distDir) || "."})`)
    }
    if (discoveryErrors.length) {
      console.log(`\n${plural(discoveryErrors.length, "puzzmo.json file")} could not be loaded:`)
      for (const err of discoveryErrors) {
        console.log(`  - ${err.slug ?? path.relative(rootDir, err.puzzmoJsonPath)}`)
        for (const e of err.errors) console.log(`      ${e}`)
      }
    }
  }

  const sha = getGitSHA(rootDir) || hashGames(games)
  const description = getGitMessage(rootDir)
  const repoURL = getGitRepoURL(rootDir)
  if (description && multi) console.log(`\nMessage: ${description}`)

  const results: GameResult[] = []
  for (const err of discoveryErrors) {
    results.push({ ok: false, slug: err.slug ?? path.relative(rootDir, err.puzzmoJsonPath), error: err.errors.join("; ") })
  }

  for (let i = 0; i < games.length; i++) {
    const game = games[i]
    const slug = game.puzzmoFile.game.slug
    const prefix = multi ? `[${i + 1}/${games.length}] ` : ""
    const distLabel = path.relative(rootDir, game.distDir) || "."

    const teamID = game.puzzmoFile.game.teamID
    const credential = await resolveServerForTeam(teamID)
    if (!credential) {
      const matches = findTokensForTeam(teamID)
      const message =
        matches.length === 0
          ? `No saved token for team ${teamID}. Run \`puzzmo login <token>\` (use \`--source\` if the token is for a non-default server).`
          : `Token for team ${teamID} is registered against ${matches.map((m) => m.source).join(", ")} but none of those servers are reachable.`
      console.error(`\n${prefix}Uploading ${slug} from ${distLabel}\n  ${message}`)
      results.push({ ok: false, slug, error: message })
      continue
    }

    const apiURL = sourceToURL(credential.source)
    console.log(`\n${prefix}Uploading ${slug} from ${distLabel}`)
    if (!isDefaultServer(credential.source)) console.log(`  Server: ${credential.source}`)
    if (description && !multi) console.log(`  Message: ${description}`)

    try {
      let result: GameSuccess
      try {
        result = await uploadOneGame(game, { credential, apiURL, sha, description, repoURL, verbose })
      } catch (e) {
        if (!(e instanceof GameNotFoundError)) throw e
        const created = await maybeCreateMissingGame(e, game, { apiURL, teamAccessToken: credential.token })
        if (!created) throw e
        result = await uploadOneGame(game, { credential, apiURL, sha, description, repoURL, verbose })
      }
      results.push(result)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      console.error(`  Failed: ${message}`)
      results.push({ ok: false, slug, error: message })
    }
  }

  printSummary(results, multi)

  const anyFailed = results.some((r) => !r.ok)
  if (anyFailed) process.exit(1)
}

type UploadOneOptions = {
  credential: TokenEntry
  apiURL: string
  sha: string
  description: string | null
  repoURL: string | null
  verbose: boolean
}

/** Uploads a single discovered game; throws on failure */
const uploadOneGame = async (game: DiscoveredGame, opts: UploadOneOptions): Promise<GameSuccess> => {
  const { credential, apiURL, sha, description, repoURL, verbose } = opts
  const { puzzmoFile, distDir } = game
  const gameSlug = puzzmoFile.game.slug

  const files = collectFiles(distDir)
  if (!files.length) throw new Error(`Dist folder is empty: ${distDir}`)

  let totalBytes = 0
  for (const file of files) totalBytes += fs.statSync(file).size
  console.log(`  ${plural(files.length, "file")}, ${formatBytes(totalBytes)} (sha ${sha.slice(0, 8)})`)

  const result = await uploadFiles(
    apiURL,
    credential.token,
    gameSlug,
    sha,
    files,
    distDir,
    puzzmoFile,
    (batch, totalBatches, uploaded) => {
      console.log(`    Batch ${batch}/${totalBatches} done (${plural(uploaded, "file")} uploaded)`)
    },
    { verbose, description, repoURL },
  )

  if (result.integrationsChanged && result.versionsURL) {
    console.log(`  Uploaded. Integrations changed — a new version has been staged for your team:`)
    console.log(`    ${result.versionsURL}`)
  } else if (result.gameURL) {
    console.log(`  Uploaded — live now for your team at:`)
    console.log(`    ${result.gameURL}`)
  } else {
    console.log(`  Uploaded.`)
  }
  return {
    ok: true,
    slug: gameSlug,
    source: credential.source,
    fileCount: files.length,
    totalBytes,
    versionID: result.versionID,
    assetsBase: result.assetsBase,
    integrationsChanged: result.integrationsChanged,
    gameURL: result.gameURL,
    versionsURL: result.versionsURL,
  }
}

/** Prints the closing summary: failure count for all-fail, otherwise the puzzmonaut delivering the success line. */
const printSummary = (results: GameResult[], multi: boolean) => {
  const successes = results.filter((r): r is GameSuccess => r.ok)
  const failures = results.filter((r): r is GameFailure => !r.ok)

  if (successes.length === 0) {
    if (multi) console.log(`\n${plural(failures.length, "game")} failed.`)
    return
  }

  const lines: string[] = []
  if (multi && failures.length === 0) lines.push(`${plural(successes.length, "game")} uploaded!`)
  else if (multi) lines.push(`${successes.length} of ${results.length} uploaded, ${failures.length} failed.`)
  else lines.push("Uploaded!")

  console.log("")
  console.log(puzzmonautSays(lines))
}

const plural = (n: number, singular: string, pluralForm?: string): string => `${n} ${n === 1 ? singular : (pluralForm ?? `${singular}s`)}`

const isDefaultServer = (source: string): boolean => normalizeSource(source) === normalizeSource(defaultSource)

const yellow = (s: string): string => (process.stdout.isTTY ? `\x1b[33m${s}\x1b[0m` : s)
const blackOnYellow = (s: string): string => (process.stdout.isTTY ? `\x1b[30;43m${s}\x1b[0m` : s)

const puzzmonautLines = [
  ` ${yellow("▟████▙")}`,
  ` ${yellow("██")}${blackOnYellow("▝ ▘ ")} ${yellow("██")}`,
  `${yellow(" ██")}${blackOnYellow(" ▄▖")}${yellow("██")}`,
  ` ${yellow("▝▀▀▀▀▘")}`,
]

const visualWidth = (s: string): number => s.replace(/\u001b\[[0-9;]*m/g, "").length

/** Renders the puzzmonaut with message lines vertically centered to its right. */
const puzzmonautSays = (messages: string[]): string => {
  const iconWidth = Math.max(...puzzmonautLines.map(visualWidth))
  const startRow = Math.max(0, Math.floor((puzzmonautLines.length - messages.length) / 2))
  return puzzmonautLines
    .map((line, i) => {
      const pad = " ".repeat(iconWidth - visualWidth(line))
      const msg = messages[i - startRow] ?? ""
      return `${line}${pad}  ${msg}`.trimEnd()
    })
    .join("\n")
}

/** Collects all files in a directory recursively */
const collectFiles = (dir: string): string[] => {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...collectFiles(full))
    else files.push(full)
  }
  return files
}

/** Tries to get the shortest unique git SHA, returns null if not in a git repo */
const getGitSHA = (cwd: string): string | null => {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf-8", cwd }).trim()
  } catch {
    return null
  }
}

/** Gets the subject line of the latest commit, or null if not in a git repo */
const getGitMessage = (cwd: string): string | null => {
  try {
    return execSync("git log -1 --pretty=%s", { encoding: "utf-8", cwd }).trim() || null
  } catch {
    return null
  }
}

/** Gets the origin remote URL normalized to https, or null if unavailable */
const getGitRepoURL = (cwd: string): string | null => {
  try {
    const raw = execSync("git config --get remote.origin.url", { encoding: "utf-8", cwd }).trim()
    return raw ? normalizeRepoURL(raw) : null
  } catch {
    return null
  }
}

/** Converts SSH-style git URLs to https; strips trailing .git */
const normalizeRepoURL = (url: string): string => {
  let normalized = url
  // git@host:owner/repo(.git) -> https://host/owner/repo
  const sshMatch = normalized.match(/^git@([^:]+):(.+)$/)
  if (sshMatch) normalized = `https://${sshMatch[1]}/${sshMatch[2]}`
  // ssh://git@host/owner/repo(.git) -> https://host/owner/repo
  else if (normalized.startsWith("ssh://")) normalized = normalized.replace(/^ssh:\/\/(?:[^@]+@)?/, "https://")
  // git://host/owner/repo(.git) -> https://host/owner/repo
  else if (normalized.startsWith("git://")) normalized = normalized.replace(/^git:\/\//, "https://")
  return normalized.replace(/\.git$/, "")
}

/** Hashes the dist contents of every game to produce a deterministic SHA across all uploads */
const hashGames = (games: DiscoveredGame[]): string => {
  const hash = crypto.createHash("sha256")
  for (const game of games) {
    for (const file of collectFiles(game.distDir).sort()) {
      hash.update(file)
      hash.update(fs.readFileSync(file))
    }
  }
  return hash.digest("hex").slice(0, 12)
}

/**
 * When a game can't be uploaded because it doesn't exist on the user's account,
 * offer to create it interactively. Returns true if the game was created and the
 * caller can retry the upload. Returns false otherwise (non-interactive shell or
 * user declined).
 */
const maybeCreateMissingGame = async (
  err: GameNotFoundError,
  game: DiscoveredGame,
  opts: { apiURL: string; teamAccessToken: string },
): Promise<boolean> => {
  const slug = err.slug
  const displayName = game.puzzmoFile.game.displayName

  if (!process.stdin.isTTY) {
    console.error(`  Game "${slug}" not found on your account. Re-run interactively to create it.`)
    return false
  }

  const consent = await p.confirm({
    message: `Game "${slug}" doesn't exist on your account. Create it now (displayName: "${displayName}")?`,
    initialValue: true,
  })
  if (p.isCancel(consent) || !consent) return false

  try {
    const created = await createUserGame({ apiURL: opts.apiURL, displayName, teamAccessToken: opts.teamAccessToken })
    console.log(`  Created game ${created.slug}`)
    if (created.slug !== slug) {
      console.warn(`  Server picked slug "${created.slug}" but your puzzmo.json uses "${slug}". Update puzzmo.json before re-uploading.`)
      return false
    }
    return true
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error(`  Could not create game: ${message}`)
    return false
  }
}

/** Formats a byte count as a human-readable string */
const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
