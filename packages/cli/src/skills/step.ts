import { randomUUID } from "node:crypto"

import type { AgentSession } from "../agents/index.js"
import type { PipelineStep } from "./registry.js"
import { runCapture } from "../util/exec.js"
import { fetchSkillPrompt } from "./mcp-client.js"
import { describeProject } from "./context.js"

/** Stop an agent that has produced no output at all for this long — a wedged run, not a thinking one */
export const agentIdleTimeoutMs = 120000

/** Everything a step needs to run: which agent, where, how to build, and the conversation to continue */
export type PipelineContext = {
  agent: string
  gameDir: string
  repoContext: string
  /** Command that builds the game, resolved from the detected package manager */
  buildCmd: string
  /** Shared across steps so the agent keeps its picture of the project between them */
  session: AgentSession
}

/** A fresh conversation. Steps share one of these; a retry rotates to a new one. */
export const newSession = (): AgentSession => ({ id: randomUUID(), started: false })

/** Points the context at a new conversation, so the next run starts cold */
export const resetSession = (session: AgentSession) => {
  session.id = randomUUID()
  session.started = false
}

/**
 * Assembles a step's prompt: local instructions, the state of the project, then the skill
 * docs from the MCP server. Several skills in one step become one agent invocation.
 */
export const buildStepPrompt = async (step: PipelineStep, ctx: PipelineContext): Promise<string> => {
  const docs = await Promise.all(step.skills.map((name) => fetchSkillPrompt(name, ctx.gameDir)))
  const parts = [step.preamble, ctx.repoContext, describeProject(ctx.gameDir), ...docs]
  return parts.filter(Boolean).join("\n\n---\n\n")
}

/** Stages and commits whatever the step changed. False when there was nothing to commit. */
export const commitStep = async (gameDir: string, label: string): Promise<boolean> => {
  await runCapture("git add -A", { cwd: gameDir })
  const result = await runCapture(`git commit -m "step: ${label}"`, { cwd: gameDir })
  return result.success
}
