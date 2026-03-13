import fs from "node:fs"
import path from "node:path"

import { detectAgent } from "../../wizard/agent-detect.js"
import { downloadPage } from "../../download/page-downloader.js"
import { runCommand, gitCommit } from "../../util/exec.js"
import { runSkillsPipelineTUI } from "../../skills/runner.js"
import { installSkills } from "../../skills/registry.js"
import { login } from "../login.js"

type CreateOptions = {
  name?: string
  url?: string
  agent?: string
  accessToken?: string
  pm?: string
}

/** Parses CLI args into CreateOptions */
const parseArgs = (args: string[]): CreateOptions => {
  const opts: CreateOptions = {}
  let i = 0

  while (i < args.length) {
    const arg = args[i]
    if (arg === "--name" && args[i + 1]) {
      opts.name = args[++i]
    } else if (arg === "--url" && args[i + 1]) {
      opts.url = args[++i]
    } else if (arg === "--agent" && args[i + 1]) {
      opts.agent = args[++i]
    } else if (arg === "--token" && args[i + 1]) {
      opts.accessToken = args[++i]
    } else if (arg === "--pm" && args[i + 1]) {
      opts.pm = args[++i]
    }
    i++
  }

  return opts
}

/** Interactive text prompt (simple readline-based fallback) */
const askText = async (message: string, defaultValue?: string): Promise<string> => {
  const { createInterface } = await import("node:readline")
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const prompt = defaultValue ? `${message} (${defaultValue}): ` : `${message}: `

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close()
      resolve(answer.trim() || defaultValue || "")
    })
  })
}

/** Interactive select prompt */
const askSelect = async (message: string, options: { value: string; label: string; disabled?: boolean }[]): Promise<string> => {
  console.log(`\n${message}`)
  const enabled = options.filter((o) => !o.disabled)
  options.forEach((opt) => {
    const prefix = opt.disabled ? "  " : `  ${enabled.indexOf(opt) + 1}.`
    const suffix = opt.disabled ? " (Coming soon)" : ""
    console.log(`${prefix} ${opt.label}${suffix}`)
  })

  const { createInterface } = await import("node:readline")
  const rl = createInterface({ input: process.stdin, output: process.stdout })

  return new Promise((resolve) => {
    rl.question(`\nChoice (1-${enabled.length}): `, (answer) => {
      rl.close()
      const idx = parseInt(answer.trim(), 10) - 1
      resolve(enabled[idx]?.value ?? enabled[0].value)
    })
  })
}

/** Converts a string to a URL-friendly slug */
const slugify = (str: string): string =>
  str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

/** Main game create wizard */
export const gameCreate = async (args: string[]) => {
  const opts = parseArgs(args)

  console.log("\n  Puzzmo Game Creator\n")

  // Step 1: Mode selection
  const mode = await askSelect("How would you like to create your game?", [
    { value: "import", label: "Import an HTML game from a web page" },
    { value: "new-repo", label: "Create game in a new repo", disabled: true },
    { value: "add-to-repo", label: "Add a game to this repo", disabled: true },
  ])

  if (mode !== "import") {
    console.log("This mode is not yet supported.")
    process.exit(0)
  }

  // Step 2: Source URL
  const url = opts.url || (await askText("Source URL to import"))
  if (!url) {
    console.error("Source URL is required for import mode")
    process.exit(1)
  }

  // Step 3: Download page to a temp dir, extract title
  const tmpDir = path.resolve(".puzzmo-import-tmp")
  console.log(`\nDownloading ${url}...`)
  const { title } = await downloadPage(url, tmpDir)
  console.log("Download complete.")

  // Step 4: Game name (default to HTML title if available)
  const defaultName = opts.name || title
  const name = await askText("Game name", defaultName)
  if (!name) {
    console.error("Game name is required")
    process.exit(1)
  }

  // Step 5: Move downloaded files to slugified directory
  const slug = slugify(name)
  const gameDir = path.resolve(slug)
  fs.renameSync(tmpDir, gameDir)

  // Step 5: Detect agents
  const agents = detectAgent()
  const agentChoices = [
    ...agents.map((a) => ({ value: a.binary, label: `${a.displayName} (${a.path})` })),
    { value: "none", label: "None - I'll run the skills manually" },
  ]

  // Step 6: Ask about agent
  let selectedAgent: string
  if (opts.agent) {
    selectedAgent = opts.agent
  } else if (agents.length > 0) {
    selectedAgent = await askSelect("Which LLM agent do you use?", agentChoices)
  } else {
    console.log("\nNo LLM agents detected (checked: claude, codex)")
    selectedAgent = "none"
  }

  // Step 7: Login if token provided
  if (opts.accessToken) {
    console.log("\nLogging in...")
    login(opts.accessToken)
  }

  // Step 8: Install skills into the game directory
  if (selectedAgent !== "none") {
    console.log("\nInstalling Puzzmo skills...")
    const count = installSkills(selectedAgent, gameDir, opts.pm)
    console.log(`Installed ${count} skill(s).`)
  }

  // Step 9: Initialize git
  if (!fs.existsSync(path.join(gameDir, ".git"))) {
    runCommand("git init", { cwd: gameDir })
    runCommand("git add -A", { cwd: gameDir })
    gitCommit("Initial game import", { cwd: gameDir })
  }

  // Step 10: Run skills pipeline
  if (selectedAgent !== "none") {
    console.log("\nStarting migration pipeline...\n")
    await runSkillsPipelineTUI(selectedAgent, gameDir)
  }

  // Done
  const pm = opts.pm || "npm"
  const runCmd = pm === "npm" ? "npx" : pm === "yarn" ? "yarn dlx" : "pnpm dlx"
  console.log(`\nDone! Your game is in ./${slug}/`)
  console.log(`\nNext steps:`)
  console.log(`  cd ${slug}`)
  console.log(`  ${runCmd} vite        # Start development server`)
  console.log(`  ${runCmd} vite build  # Build for production`)
  if (selectedAgent === "none") {
    console.log(`\nTo run migration skills manually, see packages/skills/ for SKILL.md files.`)
  }
}
