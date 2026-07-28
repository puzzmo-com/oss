import { execSync } from "node:child_process"

type ExecOptions = { cwd?: string }

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

/** Runs vite build and returns success/failure */
export const verifyBuild = (cwd: string): { success: boolean; error?: string } => {
  try {
    execSync("npx vite build", { cwd, encoding: "utf-8", stdio: "pipe" })
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.stderr || e.stdout || e.message }
  }
}
