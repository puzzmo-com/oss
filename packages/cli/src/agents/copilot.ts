import { runStreamJsonCli } from "./stream-json-cli.js"
import type { Agent, AgentEvent } from "./types.js"

/**
 * Copilot adapter — wraps the local `copilot` CLI (`@github/copilot`) in
 * `--output-format json` mode so the user's existing OAuth/Copilot Pro
 * subscription auth keeps working.
 */
export const copilotAgent: Agent = {
  name: "copilot",
  run: (input) =>
    runStreamJsonCli(
      {
        cmd: "copilot",
        buildArgs: (prompt) => ["-p", prompt, "--output-format", "json", "--stream", "on", "--allow-all-tools"],
        parseLine: parseCopilotLine,
      },
      input,
    ),
}

/**
 * Map one JSONL event from `copilot --output-format json` to an AgentEvent.
 * Schema: `node_modules/@github/copilot/schemas/session-events.schema.json`.
 */
const parseCopilotLine = (line: string): AgentEvent | null => {
  let event: any
  try {
    event = JSON.parse(line)
  } catch {
    return { type: "system", text: line }
  }

  if (event.type === "assistant.message_delta") return { type: "text", text: event.data?.deltaContent ?? "" }
  if (event.type === "assistant.reasoning_delta") return { type: "thinking", text: event.data?.deltaContent ?? event.data?.delta ?? "" }
  if (event.type === "tool.execution_start") {
    const name = event.data?.toolName ?? "tool"
    return { type: "tool_use", name, summary: summarizeToolArgs(event.data?.arguments) }
  }
  if (event.type === "tool.execution_complete") {
    const ok = event.data?.success === true
    const summary = event.data?.result?.content?.slice(0, 200) ?? event.data?.error?.message ?? ""
    return { type: "tool_result", ok, summary }
  }
  if (event.type === "session.error") return { type: "error", message: event.data?.message ?? "session error" }
  if (event.type === "assistant.turn_end") return { type: "result", ok: true }
  return null
}

const summarizeToolArgs = (args: any): string => {
  if (!args || typeof args !== "object") return ""
  if (typeof args.command === "string") return args.command.slice(0, 200)
  if (typeof args.file_path === "string") return args.file_path
  if (typeof args.path === "string") return args.path
  if (typeof args.pattern === "string") return args.pattern
  return ""
}
