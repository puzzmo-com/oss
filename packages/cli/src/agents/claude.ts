import { runStreamJsonCli } from "./stream-json-cli.js"
import type { Agent, AgentEvent } from "./types.js"

/** Claude adapter — wraps the local `claude` CLI in subprocess + stream-json mode
 *  so the user's existing subscription auth keeps working. The Claude Agent SDK
 *  requires an API key, which we explicitly want to avoid here. */
export const claudeAgent: Agent = {
  name: "claude",
  run: (input) =>
    runStreamJsonCli(
      {
        cmd: "claude",
        buildArgs: (prompt) => ["-p", "--output-format", "stream-json", "--include-partial-messages", "--verbose", prompt],
        parseLine: parseClaudeLine,
        env: (base) => {
          delete base.CLAUDECODE // claude refuses to start nested otherwise
          return base
        },
      },
      input,
    ),
}

/** Map one stream-json line from claude to an AgentEvent (or null to skip). */
const parseClaudeLine = (line: string): AgentEvent | null => {
  let obj: any
  try {
    obj = JSON.parse(line)
  } catch {
    return { type: "system", text: line }
  }

  // Token-level deltas via --include-partial-messages
  if (obj.type === "stream_event" && obj.event) {
    const ev = obj.event
    if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") return { type: "text", text: ev.delta.text }
    if (ev.type === "content_block_delta" && ev.delta?.type === "thinking_delta") return { type: "thinking", text: ev.delta.thinking ?? "" }
    if (ev.type === "content_block_start" && ev.content_block?.type === "tool_use")
      return {
        type: "tool_use",
        name: ev.content_block.name,
        summary: summarizeToolInput(ev.content_block.name, ev.content_block.input ?? {}),
      }
    return null
  }

  // Per-turn full messages — suppress to avoid duplicating the deltas
  if (obj.type === "assistant" && obj.message?.content) return null

  if (obj.type === "user") {
    const r = obj.tool_use_result
    if (r?.type === "create") return { type: "tool_result", ok: true, summary: `Created ${r.filePath}` }
    if (r?.type === "update") return { type: "tool_result", ok: true, summary: `Updated ${r.filePath}` }
    return null
  }

  if (obj.type === "result") {
    const cost = typeof obj.total_cost_usd === "number" ? obj.total_cost_usd : obj.cost_usd
    return { type: "result", ok: obj.is_error !== true, costUSD: cost }
  }

  if (obj.type === "system" && obj.subtype === "init") return { type: "system", text: "Session started" }

  return null
}

const summarizeToolInput = (name: string, input: any): string => {
  if (name === "Edit" || name === "Write" || name === "Read") return input.file_path ?? ""
  if (name === "Bash") return String(input.command ?? "").slice(0, 200)
  if (name === "Glob" || name === "Grep") return String(input.pattern ?? "")
  return ""
}
