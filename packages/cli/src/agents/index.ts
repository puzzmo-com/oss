import { claudeAgent } from "./claude.js"
import { codexAgent } from "./codex.js"
import { copilotAgent } from "./copilot.js"
import { geminiAgent } from "./gemini.js"
import { opencodeAgent } from "./opencode.js"
import type { Agent } from "./types.js"

export type { Agent, AgentEvent, AgentSession, RunInput } from "./types.js"

export const AGENTS: Record<string, Agent> = {
  claude: claudeAgent,
  codex: codexAgent,
  copilot: copilotAgent,
  gemini: geminiAgent,
  opencode: opencodeAgent,
}

export const getAgent = (name: string): Agent | undefined => AGENTS[name]

export const agentNames = (): string[] => Object.keys(AGENTS)
