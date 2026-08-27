import fs from "node:fs"
import path from "node:path"

import { type ParseError, parse as parseJsonc, printParseErrorCode } from "jsonc-parser"

import type { PuzzmoFile } from "./api.js"
import { validatePuzzmoJson } from "./validatePuzzmoFile.js"

/** Folder names that are skipped while walking the repo for puzzmo.json files */
const ignoredDirs = new Set(["node_modules", ".git", ".turbo", ".next", ".cache", "dist", "build", "built", "output"])

/** Folder names that are searched (in order) when resolving a game's dist directory */
const outputDirNames = ["dist", "build", "built", "output"]

/** A game discovered in the repo, with its parsed puzzmo.json and resolved dist directory */
export type DiscoveredGame = {
  /** Absolute path to the puzzmo.json file */
  puzzmoJsonPath: string
  /** Directory containing the puzzmo.json file */
  puzzmoJsonDir: string
  /** Validated puzzmo.json contents */
  puzzmoFile: PuzzmoFile
  /**
   * Absolute path to the dist directory containing the build artifacts (empty string when discovered with requireDist: false and none was
   * found)
   */
  distDir: string
  /** Absolute path to the icon SVG named by `game.iconPath`, or null when the file sets no icon */
  iconPath: string | null
}

/** A puzzmo.json that was found but could not be used (invalid JSON, schema errors, missing dist) */
export type DiscoveryError = {
  puzzmoJsonPath: string
  /** Slug pulled from the file when available, used for reporting */
  slug?: string
  errors: string[]
}

export type DiscoveryResult = {
  games: DiscoveredGame[]
  errors: DiscoveryError[]
}

/** Options for {@link discoverGames} */
export type DiscoverOptions = {
  /** Require each game to have a non-empty dist folder (default true). Set false for commands that run before a build. */
  requireDist?: boolean
  /** Require `game.iconPath` to point at a file (default true). Set false for commands that only read puzzmo.json metadata. */
  requireIcon?: boolean
}

/** Walks `rootDir` looking for puzzmo.json files, validates each, and resolves their dist directory */
export const discoverGames = async (rootDir: string, options: DiscoverOptions = {}): Promise<DiscoveryResult> => {
  const { requireDist = true, requireIcon = true } = options
  const root = path.resolve(rootDir)
  const puzzmoJsonPaths = findPuzzmoJsonFiles(root)

  const games: DiscoveredGame[] = []
  const errors: DiscoveryError[] = []

  for (const puzzmoJsonPath of puzzmoJsonPaths) {
    const fileErrors: string[] = []
    const parseErrors: ParseError[] = []
    const parsed: unknown = parseJsonc(fs.readFileSync(puzzmoJsonPath, "utf-8"), parseErrors, { allowTrailingComma: true })
    if (parseErrors.length) {
      const messages = parseErrors.map((err) => `${printParseErrorCode(err.error)} at offset ${err.offset}`)
      errors.push({ puzzmoJsonPath, errors: [`Invalid JSONC: ${messages.join("; ")}`] })
      continue
    }

    const validation = await validatePuzzmoJson(parsed)
    if (!validation.valid) {
      const slug = pullSlug(parsed)
      errors.push({ puzzmoJsonPath, slug, errors: validation.errors })
      continue
    }

    const puzzmoFile = validation.data
    const puzzmoJsonDir = path.dirname(puzzmoJsonPath)
    const distDir = resolveDistDir(puzzmoFile, puzzmoJsonDir, root)

    // The icon is checked here rather than at upload time so `validate` catches a stale path too.
    const iconPath = puzzmoFile.game.iconPath ? path.resolve(puzzmoJsonDir, puzzmoFile.game.iconPath) : null
    if (requireIcon && iconPath && !isFile(iconPath))
      fileErrors.push(`Icon file not found for ${puzzmoFile.game.slug}: "${puzzmoFile.game.iconPath}" (${iconPath}) does not exist.`)

    if (requireDist) {
      if (!distDir) {
        // output.dir set but missing usually means "not built yet", which the generic message hides.
        const configured = puzzmoFile.output?.dir
        fileErrors.push(
          configured
            ? `Build output folder not found for ${puzzmoFile.game.slug}: "${configured}" (${path.resolve(puzzmoJsonDir, configured)}) does not exist. Build the game first, or fix "output.dir" in puzzmo.json.`
            : `Could not find a dist/build folder for ${puzzmoFile.game.slug}. Set "output.dir" in puzzmo.json.`,
        )
      } else if (!hasFiles(distDir)) {
        fileErrors.push(`Dist folder is empty: ${distDir}`)
      }
    }

    if (fileErrors.length) {
      errors.push({ puzzmoJsonPath, slug: puzzmoFile.game.slug, errors: fileErrors })
      continue
    }

    games.push({ puzzmoJsonPath, puzzmoJsonDir, puzzmoFile, distDir: distDir ?? "", iconPath })
  }

  return { games, errors }
}

/** Recursively finds puzzmo.json files under `dir`, skipping output / vendored folders. Tracks realpaths to avoid symlink cycles. */
const findPuzzmoJsonFiles = (dir: string): string[] => {
  const found: string[] = []
  const visited = new Set<string>()
  const stack = [dir]
  while (stack.length) {
    const current = stack.pop() as string
    const realCurrent = safeRealpath(current)
    if (!realCurrent || visited.has(realCurrent)) continue
    visited.add(realCurrent)

    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(realCurrent, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(realCurrent, entry.name)
      const kind = resolveEntryKind(entry, full)
      if (kind === "directory") {
        if (ignoredDirs.has(entry.name)) continue
        if (entry.name.startsWith(".")) continue
        stack.push(full)
      } else if (kind === "file" && entry.name === "puzzmo.json") {
        found.push(full)
      }
    }
  }
  return found.sort()
}

/** Resolves the dist directory for a discovered game, returning null if none can be found */
const resolveDistDir = (puzzmoFile: PuzzmoFile, puzzmoJsonDir: string, repoRoot: string): string | null => {
  if (puzzmoFile.output?.dir) {
    const resolved = path.resolve(puzzmoJsonDir, puzzmoFile.output.dir)
    return fs.existsSync(resolved) ? resolved : null
  }

  const slug = puzzmoFile.game.slug
  const candidateDirs = walkUp(puzzmoJsonDir, repoRoot)
  for (const baseDir of candidateDirs) {
    for (const name of outputDirNames) {
      const withSlug = path.join(baseDir, name, slug)
      if (fs.existsSync(withSlug) && fs.statSync(withSlug).isDirectory()) return withSlug
      const plain = path.join(baseDir, name)
      if (fs.existsSync(plain) && fs.statSync(plain).isDirectory()) return plain
    }
  }
  return null
}

/** Returns the directories from `start` walking up to (and including) `stop` */
const walkUp = (start: string, stop: string): string[] => {
  const dirs: string[] = []
  let current = start
  while (true) {
    dirs.push(current)
    if (current === stop) break
    const parent = path.dirname(current)
    if (parent === current) break
    if (!current.startsWith(stop)) break
    current = parent
  }
  return dirs
}

/** Returns true if the path exists and is a file (following symlinks) */
const isFile = (p: string): boolean => {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

/** Returns true if the directory contains at least one file (recursively). Follows symlinks safely via a visited realpath set. */
const hasFiles = (dir: string, visited: Set<string> = new Set()): boolean => {
  const realDir = safeRealpath(dir)
  if (!realDir || visited.has(realDir)) return false
  visited.add(realDir)

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(realDir, { withFileTypes: true })
  } catch {
    return false
  }
  for (const entry of entries) {
    const full = path.join(realDir, entry.name)
    const kind = resolveEntryKind(entry, full)
    if (kind === "file") return true
    if (kind === "directory" && hasFiles(full, visited)) return true
  }
  return false
}

/** Resolves the underlying type of a directory entry, following symlinks one level. Returns null for dangling links or other types. */
const resolveEntryKind = (entry: fs.Dirent, fullPath: string): "file" | "directory" | null => {
  if (entry.isFile()) return "file"
  if (entry.isDirectory()) return "directory"
  if (!entry.isSymbolicLink()) return null
  try {
    const stat = fs.statSync(fullPath)
    if (stat.isFile()) return "file"
    if (stat.isDirectory()) return "directory"
  } catch {
    // dangling symlink
  }
  return null
}

/** Resolves a path to its real location; returns null if the path can't be resolved (broken link, missing dir, etc.) */
const safeRealpath = (p: string): string | null => {
  try {
    return fs.realpathSync(p)
  } catch {
    return null
  }
}

/** Best-effort extraction of the slug from a malformed puzzmo.json for error reporting */
const pullSlug = (parsed: unknown): string | undefined => {
  if (!parsed || typeof parsed !== "object") return undefined
  const game = (parsed as { game?: unknown }).game
  if (!game || typeof game !== "object") return undefined
  const slug = (game as { slug?: unknown }).slug
  return typeof slug === "string" ? slug : undefined
}
