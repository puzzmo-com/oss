export type SkillDefinition = {
  name: string
  /** Human-readable label shown in interactive pickers */
  label?: string
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

/** Recommended optional skills offered as pre-checked tick boxes after the "from a prompt" flow */
export const optionalPromptSkills: SkillDefinition[] = [
  { name: "add-deeds", label: "Add deeds (in-game achievements)" },
  { name: "setup-augmentations", label: "Set up augmentations" },
  { name: "setup-deploy", label: "Set up deployment" },
]
