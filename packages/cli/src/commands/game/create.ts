import fs from "node:fs"
import path from "node:path"
import * as p from "@clack/prompts"

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

/** Converts a string to a URL-friendly slug */
const slugify = (str: string): string =>
  str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

/** Main game create wizard */
export const gameCreate = async (args: string[]) => {
  const opts = parseArgs(args)

  p.intro("Puzzmo Game Creator")

  // Step 1: Mode selection
  const mode = await p.select({
    message: "How would you like to create your game?",
    options: [
      { value: "import", label: "Import an HTML game from a web page" },
      { value: "new-repo", label: "Create game in a new repo", hint: "coming soon" },
      { value: "add-to-repo", label: "Add a game to this repo", hint: "coming soon" },
    ],
  })

  if (p.isCancel(mode)) process.exit(0)

  if (mode !== "import") {
    p.log.warn("This mode is not yet supported.")
    process.exit(0)
  }

  // Step 2: Source URL
  let url = opts.url
  if (!url) {
    url = (await p.text({ message: "Source URL to import", validate: (v) => (!v ? "URL is required" : undefined) })) as string
    if (p.isCancel(url)) process.exit(0)
  }

  // Step 3: Download page to a temp dir, extract title
  const tmpDir = path.resolve(".puzzmo-import-tmp")
  const s = p.spinner()
  s.start(`Downloading ${url}`)
  const { title } = await downloadPage(url, tmpDir)
  s.stop("Download complete.")

  // Step 4: Game name (default to HTML title if available)
  const defaultName = opts.name || title
  const name = (await p.text({
    message: "Game name",
    initialValue: defaultName,
    validate: (v) => (!v ? "Game name is required" : undefined),
  })) as string
  if (p.isCancel(name)) process.exit(0)

  // Step 5: Move downloaded files to slugified directory
  const slug = slugify(name)
  const gameDir = path.resolve(slug)
  fs.renameSync(tmpDir, gameDir)

  // Step 6: Detect agents
  const agents = detectAgent()
  const agentChoices = [
    ...agents.map((a) => ({ value: a.binary, label: `${a.displayName} (${a.path})` })),
    { value: "none", label: "None - I'll run the skills manually" },
  ]

  // Step 7: Ask about agent
  let selectedAgent: string
  if (opts.agent) {
    selectedAgent = opts.agent
  } else if (agents.length > 0) {
    selectedAgent = (await p.select({ message: "Which LLM agent do you use?", options: agentChoices })) as string
    if (p.isCancel(selectedAgent)) process.exit(0)
  } else {
    p.log.info("No LLM agents detected (checked: claude, codex)")
    selectedAgent = "none"
  }

  // Step 8: Login if token provided
  if (opts.accessToken) {
    p.log.step("Logging in...")
    login(opts.accessToken)
  }

  // Step 9: Install skills into the game directory
  if (selectedAgent !== "none") {
    p.log.step("Installing Puzzmo skills...")
    const count = installSkills(selectedAgent, gameDir, opts.pm)
    p.log.success(`Installed ${count} skill(s).`)
  }

  // Step 10: Initialize git
  if (!fs.existsSync(path.join(gameDir, ".git"))) {
    runCommand("git init", { cwd: gameDir })
    runCommand("git add -A", { cwd: gameDir })
    gitCommit("Initial game import", { cwd: gameDir })
  }

  // Step 11: Run skills pipeline
  if (selectedAgent !== "none") {
    p.log.step("Starting migration pipeline...")
    await runSkillsPipelineTUI(selectedAgent, gameDir)
  }

  // Done
  const pm = opts.pm || "npm"
  const runCmd = pm === "npm" ? "npx" : pm === "yarn" ? "yarn dlx" : "pnpm dlx"

  p.note(
    [`cd ${slug}`, `${runCmd} vite        # Start development server`, `${runCmd} vite build  # Build for production`].join("\n"),
    "Next steps",
  )

  if (selectedAgent === "none") {
    p.log.info("To run migration skills manually, see packages/skills/ for SKILL.md files.")
  }

  p.outro(`Done! Your game is in ./${slug}/`)
}
