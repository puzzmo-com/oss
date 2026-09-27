import fs from "node:fs"
import path from "node:path"

import { addPuzzlesToPool, fetchGameSlugsForToken, type PuzzleFile, validatePoolPuzzles } from "../queries/puzzlePool.js"
import { getTokens, isServerReachable, sortByServerPriority, sourceToURL, tokenHelp, type TokenEntry } from "../util/config.js"

type PuzzlesUploadOptions = {
  game: string
  /** Validate every file without uploading any */
  dryRun?: boolean
}

// Matches the API's per-call cap
const maxBatchCount = 100
// The API's /graphql route takes 1MiB bodies, leave room for the query and JSON escaping
const maxBatchBytes = 900_000

/** CLI command: puzzmo puzzles upload <path> --game <slug> — adds puzzle files to the end of a game's puzzle pool */
export const puzzlesUpload = async (target: string, options: PuzzlesUploadOptions) => {
  const files = readPuzzleFiles(target)
  if (!files.length) {
    console.error(`No puzzle files found at ${target}`)
    process.exit(1)
  }

  const entry = await findTokenForGame(options.game)
  if (!entry) {
    console.error(`None of your saved tokens can manage a game with the slug "${options.game}".\n${tokenHelp}`)
    process.exit(1)
  }
  const apiURL = sourceToURL(entry.source)

  const oversized = files.filter((f) => payloadBytes(f) > maxBatchBytes)
  if (oversized.length) {
    for (const { filename } of oversized)
      console.error(`FAIL ${filename}\n     File is too large to upload (max ~${maxBatchBytes / 1000}KB)`)
    console.error(`\n${oversized.length} of ${files.length} puzzle files are too large, nothing was uploaded.`)
    process.exit(1)
  }
  const batches = toBatches(files)

  // Validate everything up front so a bad file doesn't leave half a batch in the pool
  const invalid: { filename: string; errors: readonly string[] }[] = []
  for (const batch of batches) {
    const results = await validatePoolPuzzles(apiURL, entry.token, options.game, batch)
    invalid.push(...results.filter((r) => !r.valid))
  }

  if (invalid.length) {
    for (const { filename, errors } of invalid) console.error(`FAIL ${filename}\n     ${errors.join("\n     ")}`)
    console.error(`\n${invalid.length} of ${files.length} puzzle files are invalid, nothing was uploaded.`)
    process.exit(1)
  }

  if (options.dryRun) {
    console.log(`All ${files.length} puzzle files are valid for ${options.game}. Nothing was uploaded (--dry-run).`)
    return
  }

  let uploaded = 0
  let poolCount = 0
  const failed: { filename: string; message: string }[] = []
  for (const batch of batches) {
    const result = await addPuzzlesToPool(apiURL, entry.token, options.game, batch)
    uploaded += result.uploadedFilenames.length
    poolCount = result.poolCount
    failed.push(...result.failed)
  }

  for (const { filename, message } of failed) console.error(`FAIL ${filename}: ${message}`)
  console.log(`Uploaded ${uploaded} puzzle${uploaded === 1 ? "" : "s"} to ${options.game}'s pool (${poolCount} waiting in the pool).`)
  if (failed.length) process.exit(1)
}

/** Reads a single file, or every non-hidden file directly inside a directory, sorted by name */
const readPuzzleFiles = (target: string): PuzzleFile[] => {
  const resolved = path.resolve(target)
  if (!fs.existsSync(resolved)) return []

  const paths = fs.statSync(resolved).isDirectory()
    ? fs
        .readdirSync(resolved, { withFileTypes: true })
        .filter((d) => d.isFile() && !d.name.startsWith("."))
        .map((d) => path.join(resolved, d.name))
    : [resolved]

  return paths
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)))
    .map((p) => ({ filename: path.basename(p), content: fs.readFileSync(p, "utf-8") }))
}

/** Finds the first saved token, in server priority order, whose team owns the game */
const findTokenForGame = async (gameSlug: string): Promise<TokenEntry | null> => {
  for (const entry of sortByServerPriority(getTokens())) {
    if (!(await isServerReachable(entry.source))) continue
    const slugs = await fetchGameSlugsForToken(sourceToURL(entry.source), entry.token).catch(() => null)
    if (slugs?.includes(gameSlug)) return entry
  }
  return null
}

/** Splits files into batches which stay under both the API's per-call count and its request size limit */
const toBatches = (files: PuzzleFile[]): PuzzleFile[][] => {
  const batches: PuzzleFile[][] = []
  let current: PuzzleFile[] = []
  let currentBytes = 0
  for (const file of files) {
    const bytes = payloadBytes(file)
    if (current.length && (current.length >= maxBatchCount || currentBytes + bytes > maxBatchBytes)) {
      batches.push(current)
      current = []
      currentBytes = 0
    }
    current.push(file)
    currentBytes += bytes
  }
  if (current.length) batches.push(current)
  return batches
}

const payloadBytes = (file: PuzzleFile) => Buffer.byteLength(JSON.stringify(file), "utf-8")
