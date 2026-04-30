import { runStreamJsonCli } from "./stream-json-cli.js"
import type { AgentEvent, Agent } from "./types.js"

/** Codex adapter — wraps the local `codex` CLI in `exec --json` mode so the
 *  user's existing ChatGPT subscription auth keeps working. */
export const codexAgent: Agent = {
  name: "codex",
  run: (input) =>
    runStreamJsonCli(
      {
        cmd: "codex",
        buildArgs: (prompt) => ["exec", "--json", "--skip-git-repo-check", prompt],
        parseLine: parseCodexLine,
      },
      input,
    ),
}

/** Map one JSONL event from `codex exec --json` to an AgentEvent. Schema matches
 *  the `ThreadEvent` union in `@openai/codex-sdk`. */
const parseCodexLine = (line: string): AgentEvent | null => {
  let event: any
  try {
    event = JSON.parse(line)
  } catch {
    return { type: "system", text: line }
  }

  if (event.type === "item.completed" || event.type === "item.updated") {
    const item = event.item
    if (!item) return null
    if (item.type === "agent_message" && event.type === "item.completed") return { type: "text", text: appendNL(item.text ?? "") }
    if (item.type === "reasoning" && event.type === "item.completed") return { type: "thinking", text: appendNL(item.text ?? "") }
    if (item.type === "command_execution") {
      if (item.status === "in_progress" && event.type === "item.updated") return null
      if (item.status === "completed" || item.status === "failed")
        return { type: "tool_result", ok: item.status === "completed", summary: item.command ?? "" }
      return { type: "tool_use", name: "Bash", summary: item.command ?? "" }
    }
    if (item.type === "file_change") {
      const summary = (item.changes ?? []).map((c: any) => `${c.kind} ${c.path}`).join(", ")
      return { type: "tool_result", ok: item.status === "completed", summary }
    }
    if (item.type === "mcp_tool_call") {
      if (item.status === "in_progress") return { type: "tool_use", name: `${item.server}/${item.tool}`, summary: "" }
      return { type: "tool_result", ok: item.status === "completed", summary: item.error?.message ?? "" }
    }
    if (item.type === "web_search") return { type: "tool_use", name: "WebSearch", summary: item.query ?? "" }
    if (item.type === "error") return { type: "error", message: item.message ?? "" }
    return null
  }
  if (event.type === "turn.completed") return { type: "result", ok: true }
  if (event.type === "turn.failed") return { type: "error", message: event.error?.message ?? "turn failed" }
  if (event.type === "thread.started") return { type: "system", text: "Thread started" }
  if (event.type === "error") return { type: "error", message: event.message ?? "" }
  return null
}

const appendNL = (s: string) => (s.endsWith("\n") ? s : s + "\n")
