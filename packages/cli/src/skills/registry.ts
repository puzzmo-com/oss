export type SkillDefinition = {
  name: string
}

/** Ordered list of skills for the migration pipeline */
export const skillsPipeline: SkillDefinition[] = [
  { name: "convert-to-vite" },
  { name: "introduce-puzzmo-sdk" },
  { name: "game-completion" },
  { name: "add-deeds" },
  { name: "setup-augmentations" },
  { name: "create-app-bundle" },
  { name: "setup-deploy" },
]
