import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export type SkillDefinition = {
  name: string
  optional: boolean
}

/** Ordered list of skills for the migration pipeline */
export const skillsPipeline: SkillDefinition[] = [
  { name: "convert-to-vite", optional: false },
  { name: "introduce-puzzmo-sdk", optional: false },
  { name: "game-completion", optional: false },
  { name: "puzzmo-theme", optional: true },
  { name: "add-deeds", optional: false },
  { name: "setup-augmentations", optional: false },
  { name: "create-app-bundle", optional: false },
  { name: "setup-deploy", optional: false },
]

/** Returns the skills directory for a given agent inside the game dir */
export const agentSkillsDir = (agent: string): string => {
  if (agent === "claude") return ".claude/skills"
  if (agent === "codex") return ".codex/skills"
  if (agent === "gemini") return ".gemini/skills"
  return `.${agent}/skills`
}

/**
 * Copies SKILL.md files from the bundled skills source into the game
 * directory under the agent-specific skills path.
 */
/** Maps npm commands to their equivalents in other package managers */
const rewriteForPM = (content: string, pm: string): string => {
  if (pm === "npm") return content
  if (pm === "yarn") {
    return content
      .replace(/npm install --save-dev /g, "yarn add --dev ")
      .replace(/npm install /g, "yarn add ")
      .replace(/npm run /g, "yarn ")
      .replace(/npx /g, "yarn dlx ")
  }
  if (pm === "pnpm") {
    return content
      .replace(/npm install --save-dev /g, "pnpm add --save-dev ")
      .replace(/npm install /g, "pnpm add ")
      .replace(/npm run /g, "pnpm ")
      .replace(/npx /g, "pnpm dlx ")
  }
  return content
}

export const installSkills = (agent: string, gameDir: string, pm?: string): number => {
  const skillsRoot = agentSkillsDir(agent)

  // Locate the bundled skills source (packages/skills/ relative to this file)
  // This file is at packages/cli/src/skills/registry.ts (or lib/skills/registry.js when built)
  const thisDir = path.dirname(fileURLToPath(import.meta.url))
  // Walk up to packages/cli, then over to packages/skills
  const packagesDir = path.resolve(thisDir, "..", "..", "..")
  const skillsSrcDir = path.join(packagesDir, "skills")

  let installed = 0

  for (const skill of skillsPipeline) {
    const srcFile = path.join(skillsSrcDir, skill.name, "SKILL.md")
    if (!fs.existsSync(srcFile)) continue

    const destDir = path.join(gameDir, skillsRoot, skill.name)
    fs.mkdirSync(destDir, { recursive: true })

    if (pm && pm !== "npm") {
      const content = fs.readFileSync(srcFile, "utf-8")
      fs.writeFileSync(path.join(destDir, "SKILL.md"), rewriteForPM(content, pm))
    } else {
      fs.copyFileSync(srcFile, path.join(destDir, "SKILL.md"))
    }
    installed++
  }

  return installed
}
