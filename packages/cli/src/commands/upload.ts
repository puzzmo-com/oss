import { type ExecSyncOptionsWithStringEncoding, execSync } from "node:child_process"
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
import { lintDist } from "../util/lintDist.js"
import { lintPuzzmoFile } from "../util/lintPuzzmoFile.js"
import { mascotSmall, pickMascot } from "../util/mascot.js"
import { slugify } from "../util/slugify.js"

type UploadOptions = {
  verbose?: boolean
  /** Create games that don't exist yet without prompting (for CI). */
  createMissing?: boolean
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
  const autoCreate = options.createMissing ?? false

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
  }

  // Always report unloadable files: with a single game they are the only output before exit 1.
  if (discoveryErrors.length) {
    console.error(`${multi ? "\n" : ""}${plural(discoveryErrors.length, "puzzmo.json file")} could not be loaded:`)
    for (const err of discoveryErrors) {
      console.error(`  - ${path.relative(rootDir, err.puzzmoJsonPath)}${err.slug ? ` (${err.slug})` : ""}`)
      for (const e of err.errors) console.error(`      ${e}`)
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
        const created = await maybeCreateMissingGame(e, game, { apiURL, teamAccessToken: credential.token, autoCreate })
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
  if (!fs.existsSync(path.join(distDir, "index.html")))
    throw new Error(
      `No index.html at the root of ${distDir} — the game is served from index.html, so it can't go live without it. Check your build output.`,
    )

  // These break the game once it is live, so stop before any bytes go up rather than warning after.
  const distErrors = lintDist(distDir)
  if (distErrors.length) throw new Error(distErrors.join("\n  "))

  let totalBytes = 0
  for (const file of files) totalBytes += fs.statSync(file).size
  console.log(`  ${plural(files.length, "file")}, ${formatBytes(totalBytes)} (sha ${sha.slice(0, 8)})`)

  warnAboutAbsoluteScriptURLs(distDir)
  for (const warning of lintPuzzmoFile(puzzmoFile)) console.log(yellow(`  Warning: ${warning}`))

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
    if (failures.length) console.error(`\n${plural(failures.length, "game")} failed.`)
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

/** Renders the puzzmonaut with message lines vertically centered to its right, or bare text in a log. */
const puzzmonautSays = (messages: string[]): string => {
  const mascot = pickMascot(mascotSmall)
  if (!mascot) return messages.join("\n")
  const startRow = Math.max(0, Math.floor((mascot.height - messages.length) / 2))
  // Every art row is exactly mascot.width columns, so the text aligns without padding.
  return mascot.lines.map((line, i) => `${line}  ${messages[i - startRow] ?? ""}`.trimEnd()).join("\n")
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
    return execSync("git rev-parse --short HEAD", gitExecOptions(cwd)).trim()
  } catch {
    return null
  }
}

/** Gets the subject line of the latest commit, or null if not in a git repo */
const getGitMessage = (cwd: string): string | null => {
  try {
    return execSync("git log -1 --pretty=%s", gitExecOptions(cwd)).trim() || null
  } catch {
    return null
  }
}

/** Gets the origin remote URL normalized to https, or null if unavailable */
const getGitRepoURL = (cwd: string): string | null => {
  try {
    const raw = execSync("git config --get remote.origin.url", gitExecOptions(cwd)).trim()
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
 * create it. With `autoCreate` (CI: --create-missing) it
 * creates without prompting; otherwise it asks for confirmation in an interactive
 * shell. Returns true if the game was created and the caller can retry the upload.
 * Returns false otherwise (non-interactive without autoCreate, or user declined).
 */
const maybeCreateMissingGame = async (
  err: GameNotFoundError,
  game: DiscoveredGame,
  opts: { apiURL: string; teamAccessToken: string; autoCreate: boolean },
): Promise<boolean> => {
  const slug = err.slug
  const { displayName, oneliner, description, highlightColor } = game.puzzmoFile.game

  // Creation derives the slug from displayName server-side; if it wouldn't match the
  // puzzmo.json slug, creating would mint an orphan game under the wrong slug and the
  // retried upload would still 404. Refuse up front so nothing is created.
  const expectedSlug = slugify(displayName)
  if (expectedSlug !== slug) {
    console.error(
      `  Game "${slug}" not found, and cannot be auto-created: displayName "${displayName}" slugifies to "${expectedSlug}", not "${slug}". ` +
        `Set puzzmo.json game.slug to "${expectedSlug}" (or adjust game.displayName), or create the game manually.`,
    )
    return false
  }

  if (opts.autoCreate) {
    console.log(`  Game "${slug}" not found — creating it (displayName: "${displayName}")...`)
  } else if (!process.stdin.isTTY) {
    console.error(`  Game "${slug}" not found on your account. Re-run interactively, or pass --create-missing to create it automatically.`)
    return false
  } else {
    const consent = await p.confirm({
      message: `Game "${slug}" doesn't exist on your account. Create it now (displayName: "${displayName}")?`,
      initialValue: true,
    })
    if (p.isCancel(consent) || !consent) return false
  }

  try {
    const created = await createUserGame({
      apiURL: opts.apiURL,
      displayName,
      oneliner,
      description,
      highlightColor,
      teamAccessToken: opts.teamAccessToken,
    })
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

/**
 * Warns when dist/index.html loads its JS via absolute URLs. Games are served from a per-version subpath
 * (e.g. puzzmo-game-assets.com/assets/<hash>/...), so a "/assets/foo.js" src resolves to the host root and 404s.
 * The fix is a relative base — e.g. `base: "./"` in vite.config.ts — so srcs become "./assets/foo.js".
 */
const warnAboutAbsoluteScriptURLs = (distDir: string): void => {
  const indexPath = path.join(distDir, "index.html")
  if (!fs.existsSync(indexPath)) return

  const html = fs.readFileSync(indexPath, "utf-8")
  const offenders: string[] = []
  const scriptRe = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi
  let match: RegExpExecArray | null
  while ((match = scriptRe.exec(html)) !== null) {
    if (isAbsoluteAssetURL(match[1])) offenders.push(match[1])
  }
  if (!offenders.length) return

  console.log(yellow(`  Warning: index.html loads JS via absolute URLs, which will break as game is served from a subpath:`))
  for (const url of offenders) console.log(yellow(`      ${url}`))
  console.log(
    yellow(`    Use relative paths instead — set \`base: "./"\` in your vite.config.ts (or your bundler's equivalent) and rebuild.`),
  )
}

/** True for URLs that resolve outside the game's own folder: site-root ("/x"), protocol-relative ("//x"), or fully-qualified ("https://x"). */
const isAbsoluteAssetURL = (url: string): boolean => url.startsWith("/") || /^[a-z][a-z0-9+.-]*:\/\//i.test(url)

/** Git lookups are best-effort, so their stderr is dropped rather than leaked into the upload output */
const gitExecOptions = (cwd: string): ExecSyncOptionsWithStringEncoding => ({ encoding: "utf-8", cwd, stdio: ["ignore", "pipe", "ignore"] })

/** Formats a byte count as a human-readable string */
const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
