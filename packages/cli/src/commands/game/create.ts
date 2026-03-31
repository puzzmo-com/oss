import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import * as p from "@clack/prompts"

import { detectAgent } from "../../wizard/agent-detect.js"
import { downloadPage } from "../../download/page-downloader.js"
import { runCommand, gitCommit } from "../../util/exec.js"
import { runSkillsPipelineTUI } from "../../skills/runner.js"
import { login } from "../login.js"
import { getToken } from "../../util/config.js"
import { detectRepoContext } from "./detectRepo.js"

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

/** Converts a string to a URL-friendly slug (matches packages/shared/slugify.ts) */
const slugify = (text: string) =>
  text
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]+/g, "")
    .replace(/--+/g, "-")

/** Writes .mcp.json with dev server config */
const writeMcpConfig = (dir: string) => {
  const token = getToken()
  const mcpConfig = {
    mcpServers: {
      "dev.puzzmo.com": {
        type: "http",
        // url: "https://dev.puzzmo.com/api/mcp",
        url: "https://dev-dj9e.onrender.com/api/mcp",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      },
    },
  }
  fs.writeFileSync(path.join(dir, ".mcp.json"), JSON.stringify(mcpConfig, null, 2) + "\n")
}

/** Sets up a standalone new repo for the game */
const setupNewRepo = (gameDir: string) => {
  fs.writeFileSync(path.join(gameDir, ".gitignore"), ["node_modules", "dist", ".DS_Store", ".yarn", ".pnp.*", ".puzzmo", ""].join("\n"))
  writeMcpConfig(gameDir)

  if (!fs.existsSync(path.join(gameDir, ".git"))) {
    runCommand("git init", { cwd: gameDir })
    runCommand("git add -A", { cwd: gameDir })
    gitCommit("Initial game import", { cwd: gameDir })
  }
}

/** Sets up the game inside an existing monorepo */
const setupMonorepoGame = (tmpDir: string, slug: string, repoRoot: string, parentFolder: string): string => {
  const parentDir = path.join(repoRoot, parentFolder)
  if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true })

  const gameDir = path.join(parentDir, slug)
  if (fs.existsSync(gameDir)) fs.rmSync(gameDir, { recursive: true })
  fs.renameSync(tmpDir, gameDir)

  // Write .mcp.json at repo root if not already present
  const mcpPath = path.join(repoRoot, ".mcp.json")
  if (!fs.existsSync(mcpPath)) writeMcpConfig(repoRoot)

  runCommand("git add -A", { cwd: repoRoot })
  gitCommit(`New game: ${slug}`, { cwd: repoRoot })

  return gameDir
}

/** Main game create wizard */
export const gameCreate = async (args: string[]) => {
  const opts = parseArgs(args)

  const require = createRequire(import.meta.url)
  const { version } = require("../../../package.json")
  p.intro(`Puzzmo Game Creator v${version}`)

  // Step 1: Detect repo context and choose mode
  const repo = detectRepoContext()
  const isMonorepo = repo.inGitRepo && repo.hasWorkspaces && repo.workspaceFolders.length > 0

  const modeOptions = [
    { value: "new-repo" as const, label: "Create game in a new repo" },
    { value: "add-to-repo" as const, label: "Add a game to this repo" },
  ]
  if (isMonorepo) modeOptions.reverse()

  const mode = await p.select({
    message: "How would you like to create your game?",
    options: modeOptions,
  })

  if (p.isCancel(mode)) process.exit(0)

  // Step 2: Source URL
  let url = opts.url
  if (!url) {
    url = (await p.text({ message: "Source URL to import", validate: (v) => (!v ? "URL is required" : undefined) })) as string
    if (p.isCancel(url)) process.exit(0)
  }

  // Step 3: Download page to a temp dir, extract title
  const tmpDir = path.resolve(".puzzmo-import-tmp")
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true })
  const s = p.spinner()
  s.start(`Downloading ${url}`)
  const { title } = await downloadPage(url, tmpDir)
  s.stop("Download complete.")

  // Step 4: Game name
  const defaultName = opts.name || title
  const name = (await p.text({
    message: "Game name",
    initialValue: defaultName,
    validate: (v) => (!v ? "Game name is required" : undefined),
  })) as string
  if (p.isCancel(name)) process.exit(0)

  const slug = slugify(name)

  // Step 5: Login if token provided
  if (opts.accessToken) {
    p.log.step("Logging in...")
    login(opts.accessToken)
  }

  // Step 6: Diamond — set up repo or monorepo subdir
  let gameDir: string

  if (mode === "new-repo") {
    gameDir = path.resolve(slug)
    if (fs.existsSync(gameDir)) fs.rmSync(gameDir, { recursive: true })
    fs.renameSync(tmpDir, gameDir)
    setupNewRepo(gameDir)
  } else {
    if (!repo.repoRoot) {
      p.log.error("Could not detect repository root. Are you inside a git repo?")
      process.exit(1)
    }

    // Determine which workspace folder to place the game in
    let parentFolder: string
    const hasGames = repo.workspaceFolders.includes("games")

    if (hasGames) {
      parentFolder = "games"
    } else if (repo.workspaceFolders.length === 0) {
      parentFolder = "games"
    } else if (repo.workspaceFolders.length === 1) {
      parentFolder = repo.workspaceFolders[0]
    } else {
      parentFolder = (await p.select({
        message: "Which folder should the game be added to?",
        options: repo.workspaceFolders.map((f) => ({ value: f, label: f })),
      })) as string
      if (p.isCancel(parentFolder)) process.exit(0)
    }

    gameDir = setupMonorepoGame(tmpDir, slug, repo.repoRoot, parentFolder)
  }

  // Step 7: Detect agent and run skills pipeline
  const agents = detectAgent()
  const agentChoices = [
    ...agents.map((a) => ({ value: a.binary, label: `${a.displayName} (${a.path})` })),
    { value: "none", label: "None - I'll run the skills manually" },
  ]

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

  if (selectedAgent !== "none") {
    p.log.step("Running Puzzmo skills pipeline...")
    await runSkillsPipelineTUI(selectedAgent, gameDir)
  }

  // Done
  const pm = opts.pm || "npm"
  const runCmd = pm === "npm" ? "npx" : pm === "yarn" ? "yarn dlx" : "pnpm dlx"
  const relativePath = path.relative(process.cwd(), gameDir)

  p.note(
    [`cd ${relativePath}`, `${runCmd} vite        # Start development server`, `${runCmd} vite build  # Build for production`].join("\n"),
    "Next steps",
  )

  p.outro(`Done! Your game is in ./${relativePath}/`)
}
