import { spawnSync } from "node:child_process"

import { skillsPipeline } from "./registry.js"
import { verifyBuild, runCommand, gitCommit } from "../util/exec.js"
import { fetchSkillPrompt } from "./mcp-client.js"
import { runPipelineTUI } from "../tui/pipeline.js"

/** Fetches skill instructions from the MCP server, then builds a self-contained prompt for the agent */
const buildPrompt = async (skillName: string, gameDir: string): Promise<string> => {
  const instructions = await fetchSkillPrompt(skillName, gameDir)
  if (instructions) return `${instructions}\n\nThe game source is in the current directory.`
  return `Run the skill "${skillName}". The game source is in the current directory.`
}

/** Invokes an LLM agent with a prompt (plain mode, stdio inherited) */
const invokeAgent = (agent: string, prompt: string, cwd: string): { success: boolean; output: string } => {
  const env = { ...process.env }
  delete (env as Record<string, string | undefined>).CLAUDECODE
  const result = spawnSync(agent, [prompt], {
    cwd,
    env,
    stdio: ["inherit", "pipe", "pipe"],
    encoding: "utf-8",
    timeout: 300000, // 5 minute timeout per skill
  })

  const output = (result.stdout ?? "") + (result.stderr ?? "")
  return {
    success: result.status === 0,
    output,
  }
}

/** Runs the skills pipeline with plain console output (no TUI) */
export const runSkillsPipeline = async (agent: string, gameDir: string) => {
  const total = skillsPipeline.length

  for (let i = 0; i < total; i++) {
    const skill = skillsPipeline[i]
    const step = i + 1
    console.log(`[${step}/${total}] Running skill: ${skill.name}`)

    const prompt = await buildPrompt(skill.name, gameDir)
    let result = invokeAgent(agent, prompt, gameDir)

    if (!result.success) {
      console.log(`  Agent failed, retrying...`)
      result = invokeAgent(agent, prompt, gameDir)
      if (!result.success) {
        console.error(`  Skill ${skill.name} failed after retry. Stopping pipeline.`)
        process.exit(1)
      }
    }

    // Verify build
    const buildResult = verifyBuild(gameDir)
    if (!buildResult.success) {
      console.log(`  Build failed after ${skill.name}, asking agent to fix...`)
      const fixPrompt = `The vite build failed after running skill ${skill.name}. Fix the build errors:\n\n${buildResult.error}`
      invokeAgent(agent, fixPrompt, gameDir)

      const retryBuild = verifyBuild(gameDir)
      if (!retryBuild.success) {
        console.error(`  Build still failing after fix attempt. Stopping.`)
        process.exit(1)
      }
    }

    // Commit
    try {
      runCommand("git add -A", { cwd: gameDir })
      gitCommit(`skill: ${skill.name}`, { cwd: gameDir })
      console.log(`  Committed.`)
    } catch {
      console.log(`  No changes to commit.`)
    }
  }

  console.log(`\nAll skills completed!`)
}

/** Runs the skills pipeline with a split-pane TUI */
export const runSkillsPipelineTUI = async (agent: string, gameDir: string) => {
  await runPipelineTUI(agent, gameDir)
}
