import fs from "node:fs"
import path from "node:path"
import { execSync } from "node:child_process"

export type RepoContext = {
  inGitRepo: boolean
  repoRoot: string | null
  hasWorkspaces: boolean
  /** Top-level workspace folders derived from globs (e.g. ["apps", "packages", "games"]) */
  workspaceFolders: string[]
}

/** Extracts top-level folder names from workspace glob patterns like "apps/*" or "packages/**" */
const foldersFromGlobs = (globs: string[]): string[] => {
  const folders = new Set<string>()
  for (const glob of globs) {
    const topLevel = glob.split("/")[0]
    if (topLevel && !topLevel.includes("*")) folders.add(topLevel)
  }
  return [...folders]
}

/** Reads workspace globs from package.json (npm/yarn) */
const readPackageJsonWorkspaces = (repoRoot: string): string[] | null => {
  try {
    const pkgPath = path.join(repoRoot, "package.json")
    if (!fs.existsSync(pkgPath)) return null
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"))
    const ws = pkg.workspaces
    if (Array.isArray(ws)) return ws
    if (typeof ws === "object" && ws !== null) return ws.packages ?? []
  } catch {
    // invalid JSON
  }
  return null
}

/** Reads workspace globs from pnpm-workspace.yaml */
const readPnpmWorkspaces = (repoRoot: string): string[] | null => {
  try {
    const yamlPath = path.join(repoRoot, "pnpm-workspace.yaml")
    if (!fs.existsSync(yamlPath)) return null
    const content = fs.readFileSync(yamlPath, "utf-8")
    // Simple YAML parsing for the packages array — avoids a yaml dependency
    const packages: string[] = []
    let inPackages = false
    for (const line of content.split("\n")) {
      if (/^packages\s*:/.test(line)) {
        inPackages = true
        continue
      }
      if (inPackages) {
        const match = line.match(/^\s+-\s+['"]?([^'"#]+)['"]?/)
        if (match) packages.push(match[1].trim())
        else if (/^\S/.test(line)) break
      }
    }
    return packages.length > 0 ? packages : null
  } catch {
    // missing or unreadable
  }
  return null
}

/** Detects whether we're inside a git repo and if it's a monorepo with workspace folders */
export const detectRepoContext = (): RepoContext => {
  let repoRoot: string | null = null

  try {
    const result = execSync("git rev-parse --show-toplevel", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] })
    repoRoot = result.trim()
  } catch {
    return { inGitRepo: false, repoRoot: null, hasWorkspaces: false, workspaceFolders: [] }
  }

  const globs = readPackageJsonWorkspaces(repoRoot) ?? readPnpmWorkspaces(repoRoot)
  const hasWorkspaces = globs !== null
  const workspaceFolders = globs ? foldersFromGlobs(globs) : []

  // Also recognize a games/ directory even without formal workspaces config
  if (!workspaceFolders.includes("games") && fs.existsSync(path.join(repoRoot, "games"))) workspaceFolders.push("games")

  return { inGitRepo: true, repoRoot, hasWorkspaces: hasWorkspaces || workspaceFolders.length > 0, workspaceFolders }
}
