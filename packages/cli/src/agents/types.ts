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

/**
 * A conversation carried across several agent invocations. Reusing one keeps the
 * agent's knowledge of the project (and its prompt cache) between pipeline steps
 * instead of paying for a cold re-read of the codebase every time.
 */
export type AgentSession = {
  /** Stable id, for CLIs that let us name the session up front */
  id: string
  /** Set once a run has established the session; later runs resume rather than start cold */
  started: boolean
}

export type RunInput = {
  prompt: string
  cwd?: string
  signal?: AbortSignal
  /** Continue this conversation instead of starting a fresh one, where the agent supports it */
  session?: AgentSession
  /** Abort the run when the agent has produced no output for this long */
  idleTimeoutMs?: number
}

export interface Agent {
  readonly name: string
  /** Yield events as the agent runs. Should complete (or throw) when the run finishes. */
  run(input: RunInput): AsyncIterable<AgentEvent>
}
