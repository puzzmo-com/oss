import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { findTokensForTeam, getTokens, resolveServerForTeam, sourceToURL } from "../util/config.js"
import { type DiscoveredGame, discoverGames } from "../util/discoverGames.js"
import { fetchTeamGameVersions, type GameVersions } from "../queries/gameRuntimes.js"

/** Which deployed build slot to diff against: the team's latest build, the staged next, or the previous one. */
export type ChangedAgainst = "latest" | "next" | "previous"

export type ChangedOptions = {
  json?: boolean
  list?: boolean
  matrix?: boolean
  ref?: string
  against?: ChangedAgainst
  includeUncommitted?: boolean
}

type GameStatus = "changed" | "unchanged" | "new" | "skipped"

type ChangedEntry = {
  slug: string
  displayName: string
  teamID: string
  dir: string
  baseSha: string | null
  ref: string
  status: GameStatus
  changedFiles: number
  /** Why the game was left out of the buildable set; only set when status is "skipped" */
  skipReason?: string
}

type EvalResult = { entry: ChangedEntry } | { error: string }

/** Reports which discovered games changed since their last deployed build, scoped per game folder. */
export const changed = async (dir: string, options: ChangedOptions = {}) => {
  const { json = false, list = false, matrix = false, against = "latest", includeUncommitted = false } = options

  if (getTokens().length === 0) {
    console.error("Not logged in. Run `puzzmo login <token>` or set PUZZMO_TOKEN.")
    process.exit(1)
  }

  const rootDir = path.resolve(dir)
  if (!fs.existsSync(rootDir)) {
    console.error(`Directory not found: ${dir}`)
    process.exit(1)
  }

  const repoRoot = getRepoRoot(rootDir)
  if (!repoRoot) {
    console.error(`Not a git repository: ${rootDir}`)
    process.exit(1)
  }

  const ref = options.ref || "HEAD"
  const refSha = revParseShort(ref, repoRoot)
  if (!refSha) {
    console.error(`Could not resolve git ref: ${ref}`)
    process.exit(1)
  }

  const { games, errors: discoveryErrors } = await discoverGames(rootDir, { requireDist: false, requireIcon: false })
  if (!games.length && !discoveryErrors.length) {
    console.error(`No puzzmo.json files found under ${rootDir}`)
    process.exit(1)
  }

  const hardErrors = discoveryErrors.map((err) => `${err.slug ?? path.relative(rootDir, err.puzzmoJsonPath)}: ${err.errors.join("; ")}`)

  const teamVersions = new Map<string, Promise<Map<string, GameVersions>>>()
  const results = await Promise.all(
    games.map((game) => evaluateGame(game, { repoRoot, ref, refSha, against, includeUncommitted, teamVersions })),
  )
  const report: ChangedEntry[] = []
  for (const result of results) {
    if ("entry" in result) report.push(result.entry)
    else hardErrors.push(result.error)
  }

  const buildable = report.filter(isBuildable)

  if (json) console.log(JSON.stringify(report, null, 2))
  else if (matrix) console.log(JSON.stringify({ include: buildable.map((entry) => ({ dir: entry.dir, slug: entry.slug })) }))
  else if (list) for (const entry of buildable) console.log(entry.dir)
  else if (report.length) printTable(report)
  else if (!hardErrors.length) console.log(`No puzzmo.json files found under ${rootDir}`)

  // Skips go to stderr so --list/--matrix stdout stays machine-readable, but never pass silently.
  const skipped = report.filter((entry) => entry.status === "skipped")
  if (skipped.length && !json) {
    console.error(`\n${skipped.length} game${skipped.length === 1 ? "" : "s"} skipped, they cannot be uploaded from here:`)
    for (const entry of skipped) console.error(`  ${entry.slug}: ${entry.skipReason}`)
  }

  if (hardErrors.length) {
    console.error(`\n${hardErrors.length} error${hardErrors.length === 1 ? "" : "s"}:`)
    for (const message of hardErrors) console.error(`  ${message}`)
    process.exit(1)
  }
}

type EvalContext = {
  repoRoot: string
  ref: string
  refSha: string
  against: ChangedAgainst
  includeUncommitted: boolean
  // Memoizes the per-team runtime fetch so games sharing a team only hit the API once.
  teamVersions: Map<string, Promise<Map<string, GameVersions>>>
}

/** Resolves one game's deployed SHA and diffs it against the ref. Returns either a report entry or a hard error. */
const evaluateGame = async (game: DiscoveredGame, ctx: EvalContext): Promise<EvalResult> => {
  const { slug, teamID } = game.puzzmoFile.game
  const dir = toPosix(path.relative(ctx.repoRoot, game.puzzmoJsonDir)) || "."

  // A game we have no token for can't be uploaded, so it is skipped rather than failing the run.
  const credential = await resolveServerForTeam(teamID)
  if (!credential) {
    const matches = findTokensForTeam(teamID)
    const message =
      matches.length === 0
        ? `no token for team ${teamID}`
        : `token for team ${teamID} is registered against ${matches.map((m) => m.source).join(", ")}, none of which are reachable`
    return { entry: makeEntry(game, dir, null, ctx.refSha, "skipped", 0, message) }
  }

  let versions: GameVersions | undefined
  try {
    versions = (await getTeamVersions(teamID, credential, ctx)).get(slug)
  } catch (e) {
    return { error: `${slug}: ${e instanceof Error ? e.message : String(e)}` }
  }

  const baseSha = pickBaseSha(versions ?? null, ctx.against)

  // Never deployed (or the chosen slot is empty) — nothing to diff against, so it's new and buildable.
  if (!baseSha) return { entry: makeEntry(game, dir, null, ctx.refSha, "new", 0) }

  // The deployed commit has to exist locally or we can't diff. A single-commit shallow checkout can't
  // possibly hold it, so fail loudly; with deeper history the miss is more likely a rebase/force-push,
  // so assume the game changed rather than blocking the run.
  if (!commitExists(baseSha, ctx.repoRoot)) {
    if (commitDepth(ctx.repoRoot) <= 1)
      return {
        error: `${slug}: deployed commit ${baseSha} not found locally. Fetch full git history (e.g. actions/checkout fetch-depth: 0).`,
      }
    return { entry: makeEntry(game, dir, baseSha, ctx.refSha, "changed", 0) }
  }

  const changedFiles = countChanges(baseSha, ctx.ref, game.puzzmoJsonDir, ctx.includeUncommitted)
  return { entry: makeEntry(game, dir, baseSha, ctx.refSha, changedFiles > 0 ? "changed" : "unchanged", changedFiles) }
}

const makeEntry = (
  game: DiscoveredGame,
  dir: string,
  baseSha: string | null,
  ref: string,
  status: GameStatus,
  changedFiles: number,
  skipReason?: string,
): ChangedEntry => ({
  slug: game.puzzmoFile.game.slug,
  displayName: game.puzzmoFile.game.displayName,
  teamID: game.puzzmoFile.game.teamID,
  dir,
  baseSha,
  ref,
  status,
  changedFiles,
  ...(skipReason ? { skipReason } : {}),
})

/** Fetches a team's per-game runtime SHAs once, memoizing the in-flight promise so concurrent games share the call. */
const getTeamVersions = (
  teamID: string,
  credential: { source: string; token: string },
  ctx: EvalContext,
): Promise<Map<string, GameVersions>> => {
  let pending = ctx.teamVersions.get(teamID)
  if (!pending) {
    pending = fetchTeamGameVersions(sourceToURL(credential.source), credential.token)
    ctx.teamVersions.set(teamID, pending)
  }
  return pending
}

/** Picks the baseline SHA for the chosen slot. `latest` is the most recent build the team has — the staged next, else the live current. */
const pickBaseSha = (versions: GameVersions | null, against: ChangedAgainst): string | null => {
  if (!versions) return null
  if (against === "next") return versions.next
  if (against === "previous") return versions.previous
  return versions.next ?? versions.current
}

/** Counts files differing under `dir` between `base` and `ref`, optionally folding in uncommitted working-tree changes. */
const countChanges = (base: string, ref: string, dir: string, includeUncommitted: boolean): number => {
  const files = new Set(gitLines(["diff", "--name-only", `${base}..${ref}`, "--", "."], dir))
  if (includeUncommitted) {
    for (const file of gitLines(["diff", "--name-only", "--", "."], dir)) files.add(file) // unstaged
    for (const file of gitLines(["diff", "--name-only", "--cached", "--", "."], dir)) files.add(file) // staged
    for (const file of gitLines(["ls-files", "--others", "--exclude-standard", "--", "."], dir)) files.add(file) // untracked
  }
  return files.size
}

/** Prints the human-readable summary table. */
const printTable = (report: ChangedEntry[]) => {
  const headers = ["GAME", "STATUS", "BASE", "FILES"]
  const rows = report.map((entry) => [entry.slug, entry.status, entry.baseSha ?? "—", String(entry.changedFiles)])
  const widths = headers.map((header, i) => Math.max(header.length, ...rows.map((row) => row[i].length)))
  const format = (cols: string[]) => cols.map((col, i) => col.padEnd(widths[i])).join("  ")

  console.log(format(headers))
  for (const row of rows) console.log(format(row))

  const changedCount = report.filter(isBuildable).length
  console.log(`\n${changedCount} of ${report.length} game${report.length === 1 ? "" : "s"} changed.`)
}

/** Games worth building: changed or never deployed. Unchanged and skipped ones are left out. */
const isBuildable = (entry: ChangedEntry): boolean => entry.status === "changed" || entry.status === "new"

const getRepoRoot = (cwd: string): string | null => tryGit(["rev-parse", "--show-toplevel"], cwd)

const revParseShort = (ref: string, cwd: string): string | null => tryGit(["rev-parse", "--short", ref], cwd)

/** True if `sha` resolves to a commit object in the repo at `cwd`. */
const commitExists = (sha: string, cwd: string): boolean => {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", `${sha}^{commit}`], { cwd, stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

/** Number of commits reachable from HEAD; 1 signals a shallow single-commit checkout. Defaults to 1 on failure. */
const commitDepth = (cwd: string): number => {
  const out = tryGit(["rev-list", "--count", "HEAD"], cwd)
  const count = out ? Number.parseInt(out, 10) : NaN
  return Number.isFinite(count) ? count : 1
}

/** Runs a git command and returns its trimmed stdout, or null if it failed (git's own stderr is suppressed). */
const tryGit = (args: string[], cwd: string): string | null => {
  try {
    return execFileSync("git", args, { encoding: "utf-8", cwd, stdio: ["ignore", "pipe", "ignore"] }).trim()
  } catch {
    return null
  }
}

/** Runs a git command that emits one file path per line and returns the non-empty lines, or [] if it failed. */
const gitLines = (args: string[], cwd: string): string[] => {
  const out = tryGit(args, cwd)
  if (out === null) return []
  return out.split("\n").filter(Boolean)
}

const toPosix = (p: string): string => p.split(path.sep).join("/")
