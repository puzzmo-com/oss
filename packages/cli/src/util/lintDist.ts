import fs from "node:fs"
import path from "node:path"

/**
 * Sentinel the SDK stamps onto the simulator's root element, kept in sync with
 * packages/sdk/src/simulator/marker.ts. Minifiers rewrite identifiers but not string contents, so a
 * bundled simulator always carries this literal into dist.
 */
export const simulatorBuildMarker = "puzzmo-simulator-dev-only-do-not-ship"

/** Why a shipped simulator breaks a game, appended to every simulator error so the fix is obvious */
const simulatorConsequence =
  "The simulator is a dev-only host: production embeds do not pass ?developer=true, so it boots a second host over your game (duplicate READY_DATA, duplicate keyboards, a stray collab room)."

/** Extensions worth scanning. .map files are skipped — they embed simulator source text and match even when nothing shipped. */
const scannedExtensions = new Set([".js", ".mjs", ".cjs", ".html", ".css"])

/** Cap on how many offending files are named in a message, so a chunked build does not print a wall of paths */
const maxReportedFiles = 5

/**
 * Fatal checks on a game's build output. Unlike {@link lintPuzzmoFile} these are errors, not
 * warnings — each one means the build is broken in production rather than merely questionable.
 */
export const lintDist = (distDir: string): string[] => {
  if (!distDir || !fs.existsSync(distDir)) return []

  const errors: string[] = []
  const bundled = filesContaining(distDir, simulatorBuildMarker)
  if (bundled.length) {
    errors.push(
      `The Puzzmo simulator is bundled into this build (${formatFileList(distDir, bundled)}). ${simulatorConsequence} Remove the "@puzzmo/sdk/simulator" import from your game source — the puzzmoSimulator() Vite plugin already injects it in dev only, so nothing needs to import it directly.`,
    )
  }

  errors.push(...lintIndexHTML(distDir))
  return errors
}

/** Catches the two ways index.html can pull in a simulator the bundle scan cannot see */
const lintIndexHTML = (distDir: string): string[] => {
  const indexPath = path.join(distDir, "index.html")
  if (!fs.existsSync(indexPath)) return []

  const errors: string[] = []
  const html = fs.readFileSync(indexPath, "utf-8")

  // The standalone build loads from a CDN, so the marker never lands in dist — match the tag itself.
  const standaloneSrcs = scriptSrcsIn(html).filter((src) => /simulator\/standalone(\.[a-z]+)?$/i.test(src))
  if (standaloneSrcs.length || html.includes("SIMULATOR_CONFIG")) {
    const detail = standaloneSrcs.length ? ` (${standaloneSrcs.join(", ")})` : " (window.SIMULATOR_CONFIG is set)"
    errors.push(
      `index.html loads the standalone Puzzmo simulator${detail}. ${simulatorConsequence} Drop the script tag and any window.SIMULATOR_CONFIG assignment from the HTML you ship, or move them into a dev-only HTML entry point.`,
    )
  }

  if (scriptSrcsIn(html).some((src) => src.includes("@puzzmo-simulator-init"))) {
    errors.push(
      `index.html references @puzzmo-simulator-init.js, which only the dev server serves — this looks like saved dev-server HTML rather than build output. Run your bundler's build and upload its dist folder.`,
    )
  }

  return errors
}

/** Returns every scannable file under `dir` whose contents include `needle` */
const filesContaining = (dir: string, needle: string): string[] => {
  const matches: string[] = []
  for (const file of walkFiles(dir)) {
    if (!scannedExtensions.has(path.extname(file).toLowerCase())) continue
    let contents: string
    try {
      contents = fs.readFileSync(file, "utf-8")
    } catch {
      continue
    }
    if (contents.includes(needle)) matches.push(file)
  }
  return matches.sort()
}

/** Recursively lists files under `dir`, ignoring anything unreadable */
const walkFiles = (dir: string): string[] => {
  const files: string[] = []
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return files
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...walkFiles(full))
    else if (entry.isFile()) files.push(full)
  }
  return files
}

/** Pulls the src of every script tag in an HTML string */
const scriptSrcsIn = (html: string): string[] => {
  const srcs: string[] = []
  const scriptRe = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi
  let match: RegExpExecArray | null
  while ((match = scriptRe.exec(html)) !== null) srcs.push(match[1])
  return srcs
}

/** Renders offending paths relative to dist, truncating past {@link maxReportedFiles} */
const formatFileList = (distDir: string, files: string[]): string => {
  const shown = files.slice(0, maxReportedFiles).map((file) => path.relative(distDir, file) || path.basename(file))
  const extra = files.length - shown.length
  return extra > 0 ? `${shown.join(", ")}, +${extra} more` : shown.join(", ")
}
