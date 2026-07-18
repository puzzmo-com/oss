import { runStreamJsonCli } from "./stream-json-cli.js"
import type { Agent, AgentEvent } from "./types.js"

/**
 * Gemini adapter — wraps the local `gemini` CLI in subprocess + stream-json
 * mode. Auth delegates to the user's `gemini` CLI login (Google account /
 * Code Assist) or falls back to GEMINI_API_KEY.
 */
export const geminiAgent: Agent = {
  name: "gemini",
  run: (input) =>
    runStreamJsonCli(
      {
        cmd: "gemini",
        buildArgs: (prompt) => ["-p", prompt, "--output-format", "stream-json"],
        parseLine: parseGeminiLine,
      },
      input,
    ),
}

/**
 * Map one stream-json line from gemini to an AgentEvent (or null to skip).
 * Event union per `@google/gemini-cli-core`'s `JsonStreamEvent`:
 * init / message / tool_use / tool_result / error / result.
 */
export const parseGeminiLine = (line: string): AgentEvent | null => {
  let obj: any
  try {
    obj = JSON.parse(line)
  } catch {
    return { type: "system", text: line }
  }

  if (obj.type === "init") return { type: "system", text: "Session started" }

  if (obj.type === "message") {
    // Streaming deltas flow inline; complete `content` chunks get a trailing newline
    // so consecutive messages don't glue together in the rendered output.
    if (typeof obj.delta === "string") {
      return obj.role === "thinking" ? { type: "thinking", text: obj.delta } : { type: "text", text: obj.delta }
    }
    const text = obj.content ?? ""
    if (!text) return null
    const withNL = text.endsWith("\n") ? text : text + "\n"
    return obj.role === "thinking" ? { type: "thinking", text: withNL } : { type: "text", text: withNL }
  }

  if (obj.type === "tool_use") {
    const name = obj.tool_name ?? "tool"
    return { type: "tool_use", name, summary: summarizeToolInput(name, obj.parameters ?? {}) }
  }

  if (obj.type === "tool_result") {
    const ok = obj.status === "success" || obj.status === "ok"
    const summary = String(obj.output ?? obj.error ?? "").slice(0, 200)
    return { type: "tool_result", ok, summary }
  }

  if (obj.type === "error") return { type: "error", message: obj.message ?? "" }

  if (obj.type === "result") {
    const ok = obj.status === "success" || obj.status === "ok"
    const cost = typeof obj.stats?.cost_usd === "number" ? obj.stats.cost_usd : undefined
    return { type: "result", ok, costUSD: cost }
  }

  return null
}

const summarizeToolInput = (name: string, input: any): string => {
  if (!input || typeof input !== "object") return ""
  if (typeof input.command === "string") return input.command.slice(0, 200)
  if (typeof input.file_path === "string") return input.file_path
  if (typeof input.path === "string") return input.path
  if (typeof input.pattern === "string") return input.pattern
  return name
}
