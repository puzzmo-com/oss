import { Codex } from "@openai/codex-sdk"

import type { Agent, AgentEvent, RunInput } from "./types.js"

/**
 * Codex adapter — wraps `@openai/codex-sdk`, which itself shells out to the
 * user's installed `codex` CLI and reuses its ChatGPT subscription auth.
 */
export const codexAgent: Agent = {
  name: "codex",
  run(input) {
    return runCodex(input)
  },
}

const runCodex = async function* (input: RunInput): AsyncIterable<AgentEvent> {
  const codex = new Codex()
  let thread
  try {
    thread = codex.startThread({
      workingDirectory: input.cwd ?? process.cwd(),
      skipGitRepoCheck: true,
    })
  } catch (e: any) {
    yield { type: "error", message: `Failed to start codex thread: ${e.message}` }
    return
  }

  let streamed
  try {
    streamed = await thread.runStreamed(input.prompt, { signal: input.signal })
  } catch (e: any) {
    yield { type: "error", message: `Codex run failed: ${e.message}` }
    return
  }

  try {
    for await (const event of streamed.events) {
      const mapped = mapCodexEvent(event)
      for (const m of mapped) yield m
    }
  } catch (e: any) {
    yield { type: "error", message: e.message ?? String(e) }
    return
  }
}

const mapCodexEvent = (event: any): AgentEvent[] => {
  if (event.type === "item.completed" || event.type === "item.updated") {
    const item = event.item
    if (!item) return []
    if (item.type === "agent_message" && event.type === "item.completed") return [{ type: "text", text: appendNL(item.text ?? "") }]
    if (item.type === "reasoning" && event.type === "item.completed") return [{ type: "thinking", text: appendNL(item.text ?? "") }]
    if (item.type === "command_execution") {
      if (item.status === "in_progress" && event.type === "item.updated") return []
      if (item.status === "completed" || item.status === "failed")
        return [{ type: "tool_result", ok: item.status === "completed", summary: item.command ?? "" }]
      return [{ type: "tool_use", name: "Bash", summary: item.command ?? "" }]
    }
    if (item.type === "file_change") {
      const summary = (item.changes ?? []).map((c: any) => `${c.kind} ${c.path}`).join(", ")
      return [{ type: "tool_result", ok: item.status === "completed", summary }]
    }
    if (item.type === "mcp_tool_call") {
      if (item.status === "in_progress") return [{ type: "tool_use", name: `${item.server}/${item.tool}`, summary: "" }]
      return [{ type: "tool_result", ok: item.status === "completed", summary: item.error?.message ?? "" }]
    }
    if (item.type === "web_search") return [{ type: "tool_use", name: "WebSearch", summary: item.query ?? "" }]
    if (item.type === "todo_list") return []
    if (item.type === "error") return [{ type: "error", message: item.message ?? "" }]
    return []
  }
  if (event.type === "turn.completed") return [{ type: "result", ok: true }]
  if (event.type === "turn.failed")
    return [
      { type: "error", message: event.error?.message ?? "turn failed" },
      { type: "result", ok: false },
    ]
  if (event.type === "thread.started") return [{ type: "system", text: "Thread started" }]
  if (event.type === "error") return [{ type: "error", message: event.message ?? "" }]
  return []
}

const appendNL = (s: string) => (s.endsWith("\n") ? s : s + "\n")
