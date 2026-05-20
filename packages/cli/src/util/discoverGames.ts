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
  /** Absolute path to the dist directory containing the build artifacts */
  distDir: string
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

/** Walks `rootDir` looking for puzzmo.json files, validates each, and resolves their dist directory */
export const discoverGames = async (rootDir: string): Promise<DiscoveryResult> => {
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

    if (!distDir) {
      fileErrors.push(`Could not find a dist/build folder for ${puzzmoFile.game.slug}. Set "output.dir" in puzzmo.json.`)
    } else if (!hasFiles(distDir)) {
      fileErrors.push(`Dist folder is empty: ${distDir}`)
    }

    if (fileErrors.length) {
      errors.push({ puzzmoJsonPath, slug: puzzmoFile.game.slug, errors: fileErrors })
      continue
    }

    games.push({ puzzmoJsonPath, puzzmoJsonDir, puzzmoFile, distDir: distDir as string })
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
