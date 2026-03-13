#!/usr/bin/env node

import { spawnSync } from "node:child_process"

// Forward all args to `puzzmo game create`
const args = process.argv.slice(2)

// Detect the package manager that invoked this script
const pm = detectPackageManager()

// Always ensure the latest puzzmo CLI is installed
console.log("Installing @puzzmo/cli@latest...")
spawnSync("npm", ["install", "-g", "@puzzmo/cli@latest"], { stdio: "inherit" })

// Pass --pm so the CLI knows which package manager to use in generated files
const extraArgs = args.includes("--pm") ? [] : ["--pm", pm]

const result = spawnSync("puzzmo", ["game", "create", ...args, ...extraArgs], {
  stdio: "inherit",
  env: process.env,
})

process.exit(result.status ?? 1)

function detectPackageManager() {
  const ua = process.env.npm_config_user_agent ?? ""
  if (ua.startsWith("yarn")) return "yarn"
  if (ua.startsWith("pnpm")) return "pnpm"
  return "npm"
}
