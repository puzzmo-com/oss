export type SkillDefinition = {
  name: string
  /** Human-readable label shown in interactive pickers */
  label?: string
}

/**
 * One step of the migration. A step is a single agent invocation: its prompt is the local
 * `preamble` followed by the skill docs fetched from the MCP server, so several related
 * skills can be handled in one pass instead of one cold agent run each.
 */
export type PipelineStep = {
  /** Short id — used for the sidebar label, the commit message and the log file name */
  name: string
  /** Skill docs to fetch from the MCP server and append to the prompt, in order */
  skills: string[]
  /** Local instructions leading the fetched docs */
  preamble: string
  /** Set for steps that can't affect the build, so the build check is skipped */
  skipBuild?: boolean
}

const portSourcePreamble = `Port the imported game into this Puzzmo project.

\`original/\` holds the game exactly as it was downloaded from the web — its HTML entry point
plus the scripts, styles and assets it referenced. Everything else in this directory is the
Minesweeper starter: a complete, working Puzzmo game that already builds.

Replace the starter's gameplay with the game from \`original/\`:
- Move the game's logic into \`src/main.ts\`, adding modules under \`src/\` where that keeps things
  readable. Keep the SDK lifecycle calls that are already there (gameReady, gameLoaded,
  on("start"), on("retry"), updateGameState, gameCompleted) and point them at the ported game.
- Update \`index.html\` and \`src/style.css\` to match what the ported game renders.
- Replace the puzzles in \`fixtures/puzzles/\` with puzzles for this game, in whatever format the
  ported code parses out of \`puzzleString\`. Two or three with different characteristics.
- Delete \`original/\` once its contents have been ported or deliberately dropped.

A pristine copy of the starter stays in \`.puzzmo/reference/\` — read it whenever you need to see
how a finished Puzzmo game is wired. Leave the \`game\` block in puzzmo.json alone, and keep the
build green.`

const lifecyclePreamble = `Audit and complete this game's Puzzmo integration.

The SDK is already installed and the starter already wired up the lifecycle, so most of what
follows may be done — check each point against the ported game and fill in what is missing or
still describes Minesweeper rather than re-scaffolding it. Deeds and the leaderboards built on
them are the part most likely to be absent.

Do all of it in this one pass, in the order the instructions appear.`

const thumbnailPreamble = `Give this game a real thumbnail.

\`vite.config.ts\` already registers \`appBundlePlugin()\` and \`src/appBundle.tsx\` already exists
from the starter, so skip the plugin wiring below — the work is rewriting \`renderThumbnail\` so
it renders this game rather than a Minesweeper board.`

/**
 * Steps for a game imported from a URL. The project is scaffolded from the bundled starter
 * before any of this runs, so these steps only cover work that genuinely needs judgement.
 */
export const importPipeline: PipelineStep[] = [
  { name: "port-source", skills: [], preamble: portSourcePreamble },
  {
    name: "puzzmo-lifecycle",
    skills: ["introduce-puzzmo-sdk", "game-completion", "add-deeds", "setup-augmentations"],
    preamble: lifecyclePreamble,
  },
  { name: "thumbnail", skills: ["create-app-bundle"], preamble: thumbnailPreamble },
]

/**
 * Recommended optional skills offered as pre-checked tick boxes after the "from a prompt" flow.
 * Deploy setup isn't here because the starter ships it: deploy scripts, .gitignore and README.
 */
export const optionalPromptSkills: SkillDefinition[] = [
  { name: "add-deeds", label: "Add deeds (in-game achievements)" },
  { name: "setup-augmentations", label: "Set up augmentations" },
]
