import * as p from "@clack/prompts"

import { listMcpPrompts } from "../skills/mcp-client.js"

/** Lists available migration skills from the MCP server */
export const migrate = async () => {
  p.intro("Puzzmo Migration Skills")

  const gameDir = process.cwd()

  const s = p.spinner()
  s.start("Fetching available skills from MCP server...")
  const prompts = await listMcpPrompts(gameDir)
  s.stop("Done.")

  if (!prompts || prompts.length === 0) {
    p.log.error("No skills found. Make sure .mcp.json is configured in the current directory.")
    process.exit(1)
  }

  const selected = await p.select({
    message: "Which skill would you like to run?",
    options: prompts.map((prompt) => ({
      value: prompt.name,
      label: prompt.name,
      hint: prompt.description,
    })),
  })

  if (p.isCancel(selected)) process.exit(0)

  p.log.success(`Selected: ${selected}`)
  p.outro(`Run this skill with your agent using the prompt name "${selected}"`)
}
