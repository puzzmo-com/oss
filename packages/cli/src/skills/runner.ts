import { spawnSync } from "node:child_process"

import { skillsPipeline } from "./registry.js"
import { verifyBuild, runCommand, gitCommit } from "../util/exec.js"
import { fetchSkillPrompt } from "./mcp-client.js"
import { runPipelineTUI } from "../tui/pipeline.js"

/** Fetches step instructions from the MCP server and wraps them as an agent prompt */
const buildPrompt = async (stepName: string, gameDir: string, repoContext: string): Promise<string> => {
  const instructions = await fetchSkillPrompt(stepName, gameDir)
  return `Follow these instructions. The game source is in the current directory.\n\n${repoContext}\n\n${instructions}`
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
export const runSkillsPipeline = async (agent: string, gameDir: string, repoContext: string) => {
  const total = skillsPipeline.length

  for (let i = 0; i < total; i++) {
    const skill = skillsPipeline[i]
    const step = i + 1
    console.log(`[${step}/${total}] Running step: ${skill.name}`)

    const prompt = await buildPrompt(skill.name, gameDir, repoContext)
    let result = invokeAgent(agent, prompt, gameDir)

    if (!result.success) {
      console.log(`  Agent failed, retrying...`)
      result = invokeAgent(agent, prompt, gameDir)
      if (!result.success) {
        console.error(`  Step ${skill.name} failed after retry. Stopping pipeline.`)
        process.exit(1)
      }
    }

    // Verify build
    const buildResult = verifyBuild(gameDir)
    if (!buildResult.success) {
      console.log(`  Build failed after ${skill.name}, asking agent to fix...`)
      const fixPrompt = `The vite build failed after the "${skill.name}" step. Fix the build errors:\n\n${buildResult.error}`
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
      gitCommit(`step: ${skill.name}`, { cwd: gameDir })
      console.log(`  Committed.`)
    } catch {
      console.log(`  No changes to commit.`)
    }
  }

  console.log(`\nAll skills completed!`)
}

/** Runs the skills pipeline with a split-pane TUI */
export const runSkillsPipelineTUI = async (agent: string, gameDir: string, repoContext: string) => {
  await runPipelineTUI(agent, gameDir, repoContext)
}

/** Runs a single agent invocation, verifies the build, and commits. Used by one-shot prompt-driven flows. */
export const runAgentWithBuildLoop = (agent: string, prompt: string, gameDir: string, label: string): boolean => {
  console.log(`Running agent: ${label}`)
  let result = invokeAgent(agent, prompt, gameDir)
  if (!result.success) {
    console.log(`  Agent failed, retrying...`)
    result = invokeAgent(agent, prompt, gameDir)
    if (!result.success) {
      console.error(`  Agent failed after retry. Stopping.`)
      return false
    }
  }

  const buildResult = verifyBuild(gameDir)
  if (!buildResult.success) {
    console.log(`  Build failed, asking agent to fix...`)
    const fixPrompt = `The vite build failed after the "${label}" step. Fix the build errors:\n\n${buildResult.error}`
    invokeAgent(agent, fixPrompt, gameDir)
    const retry = verifyBuild(gameDir)
    if (!retry.success) {
      console.error(`  Build still failing after fix attempt.`)
      return false
    }
  }

  try {
    runCommand("git add -A", { cwd: gameDir })
    gitCommit(`step: ${label}`, { cwd: gameDir })
    console.log(`  Committed.`)
  } catch {
    console.log(`  No changes to commit.`)
  }
  return true
}
