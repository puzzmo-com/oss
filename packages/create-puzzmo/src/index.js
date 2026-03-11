#!/usr/bin/env node

import { execSync, spawnSync } from "node:child_process"

// Forward all args to `puzzmo game create`
const args = process.argv.slice(2)

// Check if puzzmo CLI is available
try {
  execSync("puzzmo --help", { stdio: "ignore" })
} catch {
  console.log("Installing @puzzmo/cli...")
  const pm = detectPackageManager()
  spawnSync(pm === "yarn" ? "yarn" : pm, ["add", "-g", "@puzzmo/cli"], { stdio: "inherit" })
}

const result = spawnSync("puzzmo", ["game", "create", ...args], {
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
