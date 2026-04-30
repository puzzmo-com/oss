import fs from "node:fs"
import path from "node:path"
import os from "node:os"

/** Metadata about a known AI coding agent CLI */
export type AgentCLIDefinition = {
  /** Display name of the agent */
  displayName: string
  /** CLI binary name(s) to search for */
  binaries: string[]
  /** Npm package name, if installed via npm */
  npmPackage?: string
  /** Additional well-known install paths to check beyond PATH */
  knownPaths?: string[]
}

/** A detected agent CLI on the system */
export type DetectedAgentCLI = {
  /** Identifier key from the registry */
  id: string
  /** Display name of the agent */
  displayName: string
  /** The binary name that was found */
  binary: string
  /** Full resolved path to the binary */
  path: string
  /** Last modified time of the binary (ms since epoch) */
  mtime: number
}

const home = os.homedir()

/** Registry of known AI coding agent CLIs */
export const agentRegistry: Record<string, AgentCLIDefinition> = {
  claude: {
    displayName: "Claude Code",
    binaries: ["claude"],
    npmPackage: "@anthropic-ai/claude-code",
    knownPaths: [path.join(home, ".claude", "bin"), path.join(home, ".local", "bin")],
  },
  codex: {
    displayName: "Codex CLI",
    binaries: ["codex"],
    npmPackage: "@openai/codex",
  },
  copilot: {
    displayName: "GitHub Copilot CLI",
    binaries: ["copilot"],
    npmPackage: "@github/copilot",
  },
  gemini: {
    displayName: "Gemini CLI",
    binaries: ["gemini"],
    npmPackage: "@google/gemini-cli",
  },
  aider: {
    displayName: "Aider",
    binaries: ["aider"],
  },
  cline: {
    displayName: "Cline",
    binaries: ["cline"],
    npmPackage: "cline",
  },
  amp: {
    displayName: "Amp",
    binaries: ["amp"],
    npmPackage: "@sourcegraph/amp",
  },
  augment: {
    displayName: "Augment CLI",
    binaries: ["auggie"],
    npmPackage: "@augmentcode/auggie",
  },
  opencode: {
    displayName: "OpenCode",
    binaries: ["opencode"],
    npmPackage: "opencode-ai",
  },
  goose: {
    displayName: "Goose",
    binaries: ["goose"],
  },
  kiro: {
    displayName: "Kiro CLI",
    binaries: ["kiro-cli"],
  },
  cursor: {
    displayName: "Cursor",
    binaries: ["cursor"],
    knownPaths:
      process.platform === "win32" ? [path.join(process.env.LOCALAPPDATA ?? "", "Programs", "cursor", "resources", "app", "bin")] : [],
  },
}

const isWindows = process.platform === "win32"

/** File extensions to check on Windows */
const winExts = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD;.PS1").toLowerCase().split(";")

/** Returns the directories in the system PATH */
const getPathDirs = (): string[] => {
  const envPath = process.env.PATH ?? ""
  return envPath.split(isWindows ? ";" : ":").filter(Boolean)
}

/** Checks if a file exists and is executable */
const isExecutable = (filePath: string): boolean => {
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) return false
    if (isWindows) return true
    // Check Unix execute bits (owner, group, or other)
    return (stat.mode & 0o111) !== 0
  } catch {
    return false
  }
}

/** Finds a binary in a list of directories, returns full path or null */
const findBinary = (binary: string, dirs: string[]): { path: string; mtime: number } | null => {
  for (const dir of dirs) {
    if (isWindows) {
      // On Windows, check with each PATHEXT extension
      for (const ext of winExts) {
        const fullPath = path.join(dir, binary + ext)
        if (isExecutable(fullPath)) {
          const stat = fs.statSync(fullPath)
          return { path: fullPath, mtime: stat.mtimeMs }
        }
      }
      // Also check without extension (e.g. .cmd scripts sometimes)
      const noExtPath = path.join(dir, binary)
      if (isExecutable(noExtPath)) {
        const stat = fs.statSync(noExtPath)
        return { path: noExtPath, mtime: stat.mtimeMs }
      }
    } else {
      const fullPath = path.join(dir, binary)
      if (isExecutable(fullPath)) {
        const stat = fs.statSync(fullPath)
        return { path: fullPath, mtime: stat.mtimeMs }
      }
    }
  }
  return null
}

/** Detects all installed AI coding agent CLIs on the system */
export const detectAgentCLIs = (): DetectedAgentCLI[] => {
  const pathDirs = getPathDirs()
  const detected: DetectedAgentCLI[] = []

  for (const [id, def] of Object.entries(agentRegistry)) {
    // Combine PATH dirs with any known install paths for this agent
    const searchDirs = def.knownPaths ? [...pathDirs, ...def.knownPaths] : pathDirs

    for (const binary of def.binaries) {
      const result = findBinary(binary, searchDirs)
      if (result) {
        detected.push({
          id,
          displayName: def.displayName,
          binary,
          path: result.path,
          mtime: result.mtime,
        })
        break // Found this agent, move to next
      }
    }
  }

  // Sort by most recently modified binary first
  detected.sort((a, b) => b.mtime - a.mtime)
  return detected
}

/** Detects a specific agent by ID */
export const detectAgentCLI = (id: string): DetectedAgentCLI | null => {
  const def = agentRegistry[id]
  if (!def) return null

  const pathDirs = getPathDirs()
  const searchDirs = def.knownPaths ? [...pathDirs, ...def.knownPaths] : pathDirs

  for (const binary of def.binaries) {
    const result = findBinary(binary, searchDirs)
    if (result) {
      return { id, displayName: def.displayName, binary, path: result.path, mtime: result.mtime }
    }
  }
  return null
}
