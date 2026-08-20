import { runStreamJsonCli } from "./stream-json-cli.js"
import type { Agent, AgentEvent, AgentSession } from "./types.js"

/**
 * Claude adapter — wraps the local `claude` CLI in subprocess + stream-json mode
 * so the user's existing subscription auth keeps working. The Claude Agent SDK
 * requires an API key, which we explicitly want to avoid here.
 */
export const claudeAgent: Agent = {
  name: "claude",
  run: (input) =>
    runStreamJsonCli(
      {
        cmd: "claude",
        buildArgs: (prompt, session) => [
          "-p",
          "--output-format",
          "stream-json",
          "--include-partial-messages",
          "--verbose",
          // Nothing can answer a permission prompt in headless mode, so the default mode
          // silently denies the installs and file writes the migration is made of.
          "--permission-mode",
          "bypassPermissions",
          ...sessionArgs(session),
          prompt,
        ],
        parseLine: parseClaudeLine,
        env: (base) => {
          delete base.CLAUDECODE // claude refuses to start nested otherwise
          return base
        },
      },
      input,
    ),
}

/** Names the session on the first run so later runs can resume it by id. */
const sessionArgs = (session?: AgentSession): string[] => {
  if (!session) return []
  return session.started ? ["--resume", session.id] : ["--session-id", session.id]
}

/** Map one stream-json line from claude to AgentEvents (or null to skip). */
export const parseClaudeLine = (line: string): AgentEvent | AgentEvent[] | null => {
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
    // A tool call is announced here with an empty `input` — its arguments only follow as
    // input_json_delta fragments, so the call is reported from the assistant message instead.
    return null
  }

  // Per-turn messages repeat text we already streamed, but they are the one place a tool
  // call's arguments arrive assembled. A turn can open several tools, hence an array.
  if (obj.type === "assistant" && Array.isArray(obj.message?.content))
    return obj.message.content
      .filter((block: any) => block?.type === "tool_use")
      .map((block: any): AgentEvent => ({ type: "tool_use", name: block.name, summary: summarizeToolInput(block.name, block.input) }))

  if (obj.type === "user") {
    const r = obj.tool_use_result
    if (r?.type === "create") return { type: "tool_result", ok: true, summary: `Created ${r.filePath}` }
    if (r?.type === "update") return { type: "tool_result", ok: true, summary: `Updated ${r.filePath}` }
    const blocks = Array.isArray(obj.message?.content) ? obj.message.content : []
    return blocks.filter((block: any) => block?.type === "tool_result").map(toolResultEvent)
  }

  if (obj.type === "result") {
    const cost = typeof obj.total_cost_usd === "number" ? obj.total_cost_usd : obj.cost_usd
    return { type: "result", ok: obj.is_error !== true, costUSD: cost }
  }

  if (obj.type === "system" && obj.subtype === "init") return { type: "system", text: "Session started" }

  return null
}

/** What the tool is actually doing, as one line — a bare "Bash" tells the reader nothing. */
const summarizeToolInput = (name: string, input: any): string => {
  if (!input || typeof input !== "object") return ""
  if (name === "Bash" || name === "BashOutput") return oneLine(input.command ?? input.description)
  if (name === "Edit" || name === "Write" || name === "Read") return oneLine(input.file_path)
  if (name === "NotebookEdit") return oneLine(input.notebook_path)
  if (name === "Glob" || name === "Grep") return oneLine([input.pattern, input.path].filter(Boolean).join(" in "))
  if (name === "WebFetch") return oneLine(input.url)
  if (name === "WebSearch") return oneLine(input.query)
  if (name === "TodoWrite") return oneLine(`${input.todos?.length ?? 0} todos`)
  // Task and any MCP tool: the description is the only human-readable field they share.
  return oneLine(input.description)
}

/** Renders a tool result as one line, so a failed command isn't silent in the output */
const toolResultEvent = (block: any): AgentEvent => ({
  type: "tool_result",
  ok: block.is_error !== true,
  summary: oneLine(blockText(block.content)),
})

/** Tool results are usually a string, but can be content blocks when a tool returns images */
const blockText = (content: unknown): string => {
  if (typeof content === "string") return content
  if (Array.isArray(content)) return content.map((part: any) => (typeof part?.text === "string" ? part.text : "")).join(" ")
  return ""
}

/** Collapses whitespace and clips, so a heredoc or multi-line output can't break the TUI's rows */
const oneLine = (value: unknown, max = 160): string => {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
