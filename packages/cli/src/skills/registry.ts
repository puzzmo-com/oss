import { spawnSync } from "node:child_process"

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

/** Installs all Puzzmo skills from the OSS repo using `npx skills add` */
export const installSkills = (agent: string, gameDir: string): number => {
  const result = spawnSync("npx", ["skills", "add", "puzzmo-com/oss", "--agent", agent, "--skill", "*", "--copy", "-y"], {
    cwd: gameDir,
    stdio: "inherit",
    encoding: "utf-8",
  })

  if (result.status !== 0) {
    console.error("Failed to install skills from puzzmo-com/oss")
    process.exit(1)
  }

  return skillsPipeline.length
}
