#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { get } from "node:https"
// Forward all args to `puzzmo game create`
const args = process.argv.slice(2)

// Detect the package manager that invoked this script
const pm = detectPackageManager()

// Resolve the actual latest version from the registry to avoid npm cache staleness
const version = await fetchLatestVersion("@puzzmo/cli")
console.log(`Running @puzzmo/cli@${version}...`)

// Pass --pm so the CLI knows which package manager to use in generated files
const extraArgs = args.includes("--pm") ? [] : ["--pm", pm]

// Use npx with the exact version to avoid stale global installs
const result = spawnSync("npx", [`@puzzmo/cli@${version}`, "game", "create", ...args, ...extraArgs], {
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

/** Fetches the latest version from the npm registry, falls back to "latest" tag */
function fetchLatestVersion(pkg) {
  return new Promise((resolve) => {
    get(`https://registry.npmjs.org/${pkg}/latest`, (res) => {
      let data = ""
      res.on("data", (chunk) => (data += chunk))
      res.on("end", () => {
        try {
          resolve(JSON.parse(data).version)
        } catch {
          resolve("latest")
        }
      })
    }).on("error", () => resolve("latest"))
  })
}
