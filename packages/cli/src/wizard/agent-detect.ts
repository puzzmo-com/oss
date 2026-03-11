import { detectAgentCLIs, type DetectedAgentCLI } from "@puzzmo/agent-cli-detect"

export type { DetectedAgentCLI as AgentInfo }

/** Detects installed LLM agent CLIs on the system */
export const detectAgent = (): DetectedAgentCLI[] => detectAgentCLIs()
