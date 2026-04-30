/**
 * Normalized event union emitted by every agent adapter. Keep this small —
 * adapters fold their richer native event shapes into one of these.
 */
export type AgentEvent =
  | { type: "text"; text: string } // assistant text (delta or full chunk)
  | { type: "tool_use"; name: string; summary: string } // tool starting
  | { type: "tool_result"; ok: boolean; summary: string } // tool finished
  | { type: "thinking"; text: string }
  | { type: "system"; text: string }
  | { type: "result"; ok: boolean; costUSD?: number }
  | { type: "error"; message: string }

export type RunInput = {
  prompt: string
  cwd?: string
  signal?: AbortSignal
}

export interface Agent {
  readonly name: string
  /** Yield events as the agent runs. Should complete (or throw) when the run finishes. */
  run(input: RunInput): AsyncIterable<AgentEvent>
}
