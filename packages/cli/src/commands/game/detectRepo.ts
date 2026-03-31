import fs from "node:fs"
import path from "node:path"
import { execSync } from "node:child_process"

/** The type of repo we're in */
export type RepoType =
  /** Not in a git repo */
  | "none"
  /** A standalone single-game repo (has package.json, no workspaces, no games/ dir) */
  | "standalone"
  /** A multi-game repo with a shared root package.json (has games/ dir, no workspaces) */
  | "multi-game"
  /** A monorepo with workspace-managed packages */
  | "workspace-monorepo"

export type PackageManager = "npm" | "yarn" | "pnpm"

export type RepoContext = {
  inGitRepo: boolean
  repoRoot: string | null
  repoType: RepoType
  /** Top-level workspace folders derived from globs (e.g. ["apps", "packages", "games"]) */
  workspaceFolders: string[]
  /** Detected package manager based on lockfiles and packageManager field */
  packageManager: PackageManager
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

/** Detects package manager from lock files and the packageManager field */
const detectPackageManager = (repoRoot: string): PackageManager => {
  if (fs.existsSync(path.join(repoRoot, "yarn.lock"))) return "yarn"
  if (fs.existsSync(path.join(repoRoot, "pnpm-lock.yaml"))) return "pnpm"
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf-8"))
    if (typeof pkg.packageManager === "string") {
      if (pkg.packageManager.startsWith("yarn")) return "yarn"
      if (pkg.packageManager.startsWith("pnpm")) return "pnpm"
    }
  } catch {}
  return "npm"
}

/** Detects the repo type, root, workspace folders, and package manager */
export const detectRepoContext = (): RepoContext => {
  let repoRoot: string | null = null

  try {
    const result = execSync("git rev-parse --show-toplevel", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] })
    repoRoot = result.trim()
  } catch {
    return { inGitRepo: false, repoRoot: null, repoType: "none", workspaceFolders: [], packageManager: "npm" }
  }

  const pm = detectPackageManager(repoRoot)
  const globs = readPackageJsonWorkspaces(repoRoot) ?? readPnpmWorkspaces(repoRoot)

  if (globs) {
    const workspaceFolders = foldersFromGlobs(globs)
    // Also recognize a games/ directory even if not in workspace globs
    if (!workspaceFolders.includes("games") && fs.existsSync(path.join(repoRoot, "games"))) workspaceFolders.push("games")
    return { inGitRepo: true, repoRoot, repoType: "workspace-monorepo", workspaceFolders, packageManager: pm }
  }

  const hasGamesDir = fs.existsSync(path.join(repoRoot, "games"))
  if (hasGamesDir) return { inGitRepo: true, repoRoot, repoType: "multi-game", workspaceFolders: ["games"], packageManager: pm }

  return { inGitRepo: true, repoRoot, repoType: "standalone", workspaceFolders: [], packageManager: pm }
}
