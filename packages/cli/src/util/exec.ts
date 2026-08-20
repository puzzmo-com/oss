import { execSync, spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

type ExecOptions = { cwd?: string }

export type PackageManagerName = "npm" | "yarn" | "pnpm"

/** Runs a shell command, printing output */
export const runCommand = (cmd: string, opts: ExecOptions = {}) => {
  execSync(cmd, {
    cwd: opts.cwd,
    stdio: "inherit",
    encoding: "utf-8",
  })
}

/** Runs a command and returns stdout */
export const runCommandOutput = (cmd: string, opts: ExecOptions = {}): string => {
  return execSync(cmd, {
    cwd: opts.cwd,
    encoding: "utf-8",
  }).trim()
}

/** Creates a git commit */
export const gitCommit = (message: string, opts: ExecOptions = {}) => {
  execSync(`git commit -m "${message}"`, {
    cwd: opts.cwd,
    stdio: "inherit",
  })
}

/** True if a `git` executable is available on PATH */
export const isGitInstalled = (): boolean => {
  try {
    execSync("git --version", { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

/** Runs a command without blocking the event loop, capturing stdout and stderr together */
export const runCapture = (cmd: string, opts: ExecOptions = {}): Promise<{ success: boolean; output: string }> =>
  new Promise((resolve) => {
    const child = spawn(cmd, { cwd: opts.cwd, shell: true })
    let output = ""
    child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString("utf-8")))
    child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString("utf-8")))
    child.on("error", (e) => resolve({ success: false, output: output + e.message }))
    child.on("close", (code) => resolve({ success: code === 0, output }))
  })

/** Runs the project's build and returns success/failure */
export const verifyBuild = async (cwd: string, buildCmd: string): Promise<{ success: boolean; error?: string }> => {
  const { success, output } = await runCapture(buildCmd, { cwd })
  return success ? { success: true } : { success: false, error: output }
}

/**
 * The command that builds a game directory. Prefers the project's own `build` script so
 * monorepo/PnP setups resolve the way they normally do, and only falls back to invoking
 * vite directly for games that share a parent package.json.
 */
export const resolveBuildCommand = (gameDir: string, pm: PackageManagerName): string => {
  if (hasBuildScript(gameDir)) return pm === "yarn" ? "yarn build" : `${pm} run build`
  if (pm === "yarn") return "yarn vite build"
  if (pm === "pnpm") return "pnpm exec vite build"
  return "npx vite build"
}

/** True when the directory has its own package.json declaring a build script */
const hasBuildScript = (dir: string): boolean => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf-8"))
    return Boolean(pkg.scripts?.build)
  } catch {
    return false
  }
}
