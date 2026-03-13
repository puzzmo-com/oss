#!/usr/bin/env node

import { execSync, spawnSync } from "node:child_process"

// Forward all args to `puzzmo game create`
const args = process.argv.slice(2)

// Detect the package manager that invoked this script
const pm = detectPackageManager()

// Check if puzzmo CLI is available
try {
  execSync("puzzmo --help", { stdio: "ignore" })
} catch {
  console.log("Installing @puzzmo/cli...")
  spawnSync("npm", ["install", "-g", "@puzzmo/cli"], { stdio: "inherit" })
}

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
