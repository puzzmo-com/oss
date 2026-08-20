import fs from "node:fs"
import path from "node:path"

const ignoredDirs = new Set(["node_modules", "dist", ".git", ".puzzmo", ".yarn", ".DS_Store"])
const maxDepth = 3
const maxEntriesPerDir = 12
const maxLines = 90

/**
 * A short description of what's already on disk, handed to the agent with every step.
 * Without it each step opens by globbing and reading its way back to the same picture,
 * which is several tool round trips before any work starts.
 */
export const describeProject = (gameDir: string): string => {
  const sections = [`Project layout (${path.basename(gameDir)}/):`, ...treeLines(gameDir, "", 0, { count: 0 })]

  const puzzmoJSON = readIfPresent(path.join(gameDir, "puzzmo.json"))
  if (puzzmoJSON) sections.push("", "puzzmo.json:", puzzmoJSON.trim())

  const scripts = readScripts(path.join(gameDir, "package.json"))
  if (scripts) sections.push("", `package.json scripts: ${scripts}`)

  return sections.join("\n")
}

/** Renders an indented tree, skipping build output and collapsing large directories */
const treeLines = (dir: string, prefix: string, depth: number, budget: { count: number }): string[] => {
  if (depth > maxDepth || budget.count >= maxLines) return []

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const visible = entries.filter((e) => !ignoredDirs.has(e.name)).sort((a, b) => a.name.localeCompare(b.name))
  const shown = visible.slice(0, maxEntriesPerDir)
  const lines: string[] = []

  for (const entry of shown) {
    if (budget.count >= maxLines) break
    budget.count++
    if (entry.isDirectory()) {
      lines.push(`${prefix}  ${entry.name}/`)
      lines.push(...treeLines(path.join(dir, entry.name), `${prefix}  `, depth + 1, budget))
    } else {
      lines.push(`${prefix}  ${entry.name}`)
    }
  }

  if (visible.length > shown.length) lines.push(`${prefix}  ... ${visible.length - shown.length} more`)
  return lines
}

/** Reads a file, returning undefined when it's missing or unreadable */
const readIfPresent = (file: string): string | undefined => {
  try {
    return fs.readFileSync(file, "utf-8")
  } catch {
    return undefined
  }
}

/** Comma-separated script names from a package.json, or undefined when there isn't one */
const readScripts = (pkgPath: string): string | undefined => {
  const raw = readIfPresent(pkgPath)
  if (!raw) return undefined
  try {
    const names = Object.keys(JSON.parse(raw).scripts ?? {})
    return names.length > 0 ? names.join(", ") : undefined
  } catch {
    return undefined
  }
}
