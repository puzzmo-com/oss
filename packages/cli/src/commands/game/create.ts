import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import * as p from "@clack/prompts"

import { agentNames } from "../../agents/index.js"
import { detectAgent } from "../../wizard/agent-detect.js"
import { downloadPage } from "../../download/page-downloader.js"
import { runCommand, gitCommit } from "../../util/exec.js"
import { runSkillsPipelineTUI, runAgentWithBuildLoop } from "../../skills/runner.js"
import { login } from "../login.js"
import { getDefaultToken } from "../../util/config.js"
import { detectRepoContext, type RepoType } from "./detectRepo.js"

export type Strategy = "import" | "blank" | "prompt"

export type CreateOptions = {
  name?: string
  url?: string
  agent?: string
  accessToken?: string
  pm?: string
  strategy?: Strategy
  prompt?: string
}

/** Converts a string to a URL-friendly slug (matches packages/shared/slugify.ts) */
const slugify = (text: string) =>
  text
    .toString()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]+/g, "")
    .replace(/--+/g, "-")

/** Writes .mcp.json with dev server config */
const writeMcpConfig = (dir: string) => {
  const token = getDefaultToken()
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

/** Places a game inside an existing repo's parent folder (games/, packages/, etc.) */
const setupRepoGame = (tmpDir: string, slug: string, repoRoot: string, parentFolder: string): string => {
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

/** Files/dirs that stay at the repo root during a standalone→multi-game conversion */
const rootKeepList = new Set([
  ".git",
  ".gitignore",
  ".mcp.json",
  "node_modules",
  "dist",
  ".puzzmo",
  ".DS_Store",
  "package.json",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  ".yarnrc.yml",
  ".yarn",
  ".pnp.cjs",
  ".pnp.loader.mjs",
  "tsconfig.json",
  "vite.config.ts",
  "vite.config.js",
  ".prettierrc",
  ".prettierrc.json",
  "prettier.config.js",
  ".eslintrc",
  ".eslintrc.json",
  "eslint.config.js",
])

/** Converts a standalone single-game repo into a multi-game repo by moving existing files into games/<name>/ */
const convertToMultiGame = (repoRoot: string): string => {
  // Derive existing game name from package.json or directory name
  let existingName: string | undefined
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf-8"))
    if (pkg.name) existingName = slugify(pkg.name)
  } catch {}
  if (!existingName) existingName = path.basename(repoRoot)

  const gamesDir = path.join(repoRoot, "games")
  const existingGameDir = path.join(gamesDir, existingName)
  fs.mkdirSync(existingGameDir, { recursive: true })

  // Move all non-root files into games/<existing>/
  for (const entry of fs.readdirSync(repoRoot)) {
    if (rootKeepList.has(entry) || entry === "games") continue
    fs.renameSync(path.join(repoRoot, entry), path.join(existingGameDir, entry))
  }

  runCommand("git add -A", { cwd: repoRoot })
  gitCommit(`Restructure: move existing game to games/${existingName}`, { cwd: repoRoot })

  return existingName
}

/** Resolves the bundled template directory by name. Templates ship at packages/cli/templates/<name>/ */
const resolveTemplateDir = (name: string): string => {
  const here = fileURLToPath(import.meta.url)
  // here = .../packages/cli/lib/commands/game/create.js → ../../../templates/<name>
  return path.resolve(here, "..", "..", "..", "..", "templates", name)
}

/** File extensions where we apply template variable substitution */
const textExtension = new Set([".md", ".json", ".html", ".css", ".ts", ".tsx", ".js", ".jsx", ".mjs"])

/** Recursively copies a template directory, substituting placeholders in text files. */
const copyTemplate = (sourceDir: string, targetDir: string, replacements: Record<string, string>) => {
  fs.mkdirSync(targetDir, { recursive: true })
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const src = path.join(sourceDir, entry.name)
    const dst = path.join(targetDir, entry.name)
    if (entry.isDirectory()) {
      copyTemplate(src, dst, replacements)
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name)
      if (textExtension.has(ext) || entry.name === ".gitignore") {
        let content = fs.readFileSync(src, "utf-8")
        for (const [key, value] of Object.entries(replacements)) content = content.replaceAll(key, value)
        fs.writeFileSync(dst, content)
      } else {
        fs.copyFileSync(src, dst)
      }
    }
  }
}

/** Picks an agent interactively, returning the agent id or "none" */
const pickAgent = async (preselected?: string): Promise<string> => {
  const supported = new Set(agentNames())
  const agents = detectAgent().filter((a) => supported.has(a.id))
  if (preselected) return preselected
  if (agents.length === 0) {
    p.log.info(`No supported LLM agents detected (checked: ${agentNames().join(", ")})`)
    return "none"
  }
  const choices = [
    ...agents.map((a) => ({ value: a.id, label: `${a.displayName} (${a.path})` })),
    { value: "none", label: "None - I'll run the steps manually" },
  ]
  const result = (await p.select({ message: "Which LLM agent do you use?", options: choices })) as string
  if (p.isCancel(result)) process.exit(0)
  return result
}

/** Composes the prompt sent to the agent for the "from prompt" strategy */
const buildPromptStrategyMessage = (userPrompt: string, displayName: string): string =>
  [
    `You are scaffolding a Puzzmo game called "${displayName}" in the current directory.`,
    `The starter is a working Vite + Puzzmo SDK Minesweeper. Replace the gameplay with the game described below.`,
    ``,
    `Game description:`,
    userPrompt,
    ``,
    `Constraints:`,
    `- Keep puzzmo.json valid (do not remove the slug or displayName fields).`,
    `- Use the Puzzmo SDK lifecycle: gameReady → gameLoaded → on("start"|"retry") → updateGameState → gameCompleted.`,
    `- Replace fixtures in fixtures/puzzles/ with puzzles for the new game.`,
    `- Keep the build green (\`npx vite build\` should succeed).`,
  ].join("\n")

/** Main game create wizard */
export const gameCreate = async (opts: CreateOptions) => {
  const require = createRequire(import.meta.url)
  const { version } = require("../../../package.json")
  p.intro(`Puzzmo Game Creator v${version}`)

  // Step 1: Pick strategy
  let strategy: Strategy
  if (opts.strategy) {
    strategy = opts.strategy
  } else {
    const choice = await p.select({
      message: "How would you like to create your game?",
      options: [
        { value: "blank" as const, label: "Blank game (Minesweeper template)" },
        { value: "import" as const, label: "Import from an existing URL (uses an LLM to migrate)" },
        { value: "prompt" as const, label: "From a prompt (Builds on template + LLM customizations)" },
      ],
    })
    if (p.isCancel(choice)) process.exit(0)
    strategy = choice as Strategy
  }

  // Step 2: Detect repo and pick placement
  const repo = detectRepoContext()
  const canAddToRepo = repo.repoType === "multi-game" || repo.repoType === "workspace-monorepo" || repo.repoType === "standalone"

  const placementOptions = [
    { value: "new-repo" as const, label: "Create game in a new repo" },
    ...(canAddToRepo ? [{ value: "add-to-repo" as const, label: "Add a game to this repo" }] : []),
  ]
  if (canAddToRepo && repo.repoType !== "none") placementOptions.reverse()

  let mode: "new-repo" | "add-to-repo"
  if (placementOptions.length === 1) {
    mode = placementOptions[0].value
  } else {
    const selected = await p.select({ message: "Where should the game live?", options: placementOptions })
    if (p.isCancel(selected)) process.exit(0)
    mode = selected as "new-repo" | "add-to-repo"
  }

  // Step 3: Acquire source content into tmpDir
  const tmpDir = path.resolve(".puzzmo-import-tmp")
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true })

  let importedTitle: string | undefined
  let userPrompt: string | undefined

  if (strategy === "import") {
    let url = opts.url
    if (!url) {
      url = (await p.text({ message: "Source URL to import", validate: (v) => (!v ? "URL is required" : undefined) })) as string
      if (p.isCancel(url)) process.exit(0)
    }
    const s = p.spinner()
    s.start(`Downloading ${url}`)
    const { title } = await downloadPage(url, tmpDir)
    s.stop("Download complete.")
    importedTitle = title
  } else if (strategy === "prompt") {
    userPrompt = opts.prompt
    if (!userPrompt) {
      userPrompt = (await p.text({
        message: "Describe the game you want to build",
        placeholder: "A word search where letters appear in waves...",
        validate: (v) => (!v ? "Prompt is required" : undefined),
      })) as string
      if (p.isCancel(userPrompt)) process.exit(0)
    }
  }

  // Step 4: Game name
  let name: string
  if (opts.name) {
    name = opts.name
  } else {
    const result = (await p.text({
      message: "Game name",
      initialValue: importedTitle || "My Game",
      validate: (v) => (!v ? "Game name is required" : undefined),
    })) as string
    if (p.isCancel(result)) process.exit(0)
    name = result
  }

  const slug = slugify(name)

  // Materialize template content for blank/prompt strategies (after we know the slug/name)
  if (strategy !== "import") {
    const templateDir = resolveTemplateDir("minesweeper")
    if (!fs.existsSync(templateDir)) {
      p.log.error(`Bundled template not found at ${templateDir}`)
      process.exit(1)
    }
    copyTemplate(templateDir, tmpDir, { __SLUG__: slug, __DISPLAY_NAME__: name })
  }

  // Step 5: Login if token provided
  if (opts.accessToken) {
    p.log.step("Logging in...")
    login(opts.accessToken)
  }

  // Step 6: Place files
  let gameDir: string
  let repoType: RepoType = repo.repoType

  if (mode === "new-repo") {
    gameDir = path.resolve(slug)
    if (fs.existsSync(gameDir)) fs.rmSync(gameDir, { recursive: true })
    fs.renameSync(tmpDir, gameDir)
    setupNewRepo(gameDir)
    repoType = "standalone"
  } else {
    if (!repo.repoRoot) {
      p.log.error("Could not detect repository root. Are you inside a git repo?")
      process.exit(1)
    }

    if (repo.repoType === "standalone") {
      const existingGame = convertToMultiGame(repo.repoRoot)
      p.log.step(`Moved existing game to games/${existingGame}/`)
      repoType = "multi-game"
    }

    let parentFolder: string
    if (repoType === "multi-game") {
      parentFolder = "games"
    } else {
      const hasGames = repo.workspaceFolders.includes("games")
      if (hasGames) {
        parentFolder = "games"
      } else if (repo.workspaceFolders.length === 1) {
        parentFolder = repo.workspaceFolders[0]
      } else if (repo.workspaceFolders.length === 0) {
        parentFolder = "games"
      } else {
        parentFolder = (await p.select({
          message: "Which folder should the game be added to?",
          options: repo.workspaceFolders.map((f) => ({ value: f, label: f })),
        })) as string
        if (p.isCancel(parentFolder)) process.exit(0)
      }
    }

    gameDir = setupRepoGame(tmpDir, slug, repo.repoRoot, parentFolder)
  }

  // Step 7: Strategy-specific agent work
  if (strategy === "import") {
    const selectedAgent = await pickAgent(opts.agent)
    if (selectedAgent !== "none") {
      const repoContextLines = [
        `Repo type: ${repoType}`,
        `Package manager: ${repo.packageManager} (use this instead of npm/npx when running commands or adding dependencies)`,
      ]
      if (repoType === "multi-game")
        repoContextLines.push(
          "This is a multi-game repo with a shared root package.json. Do not create a per-game package.json or vite config.",
        )
      if (repoType === "workspace-monorepo") repoContextLines.push("This is a workspace monorepo. The game has its own package.json.")

      p.log.step("Running Puzzmo migration pipeline...")
      await runSkillsPipelineTUI(selectedAgent, gameDir, repoContextLines.join("\n"))
    }
  } else if (strategy === "prompt") {
    const selectedAgent = await pickAgent(opts.agent)
    const message = buildPromptStrategyMessage(userPrompt!, name)
    if (selectedAgent === "none") {
      p.log.warn("No agent selected; skipping LLM customization.")
      p.note(message, "Paste this prompt into your LLM agent:")
    } else {
      p.log.step("Running agent with your prompt...")
      const ok = runAgentWithBuildLoop(selectedAgent, message, gameDir, "from-prompt")
      if (!ok) p.log.warn("Agent step did not complete cleanly. The Minesweeper starter is still in place.")
    }
  }

  // Done
  const pm = opts.pm || repo.packageManager
  const runCmd = pm === "npm" ? "npx" : pm === "yarn" ? "yarn dlx" : "pnpm dlx"
  const relativePath = path.relative(process.cwd(), gameDir)

  p.note(
    [`cd ${relativePath}`, `${runCmd} vite        # Start development server`, `${runCmd} vite build  # Build for production`].join("\n"),
    "Next steps",
  )

  p.outro(`Done! Your game is in ./${relativePath}/`)
}
