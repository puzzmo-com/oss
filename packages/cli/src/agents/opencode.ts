import { createOpencodeClient, createOpencodeServer } from "@opencode-ai/sdk"

import type { Agent, AgentEvent, RunInput } from "./types.js"

/**
 * OpenCode adapter — spawns a local opencode server, opens an SSE stream
 * against it, creates a session, and sends a prompt. Auth lives in the
 * user's `opencode` CLI config / `client.auth.set()`.
 */
export const opencodeAgent: Agent = {
  name: "opencode",
  run(input) {
    return runOpencode(input)
  },
}

const runOpencode = async function* (input: RunInput): AsyncIterable<AgentEvent> {
  const cwd = input.cwd ?? process.cwd()

  let server
  try {
    server = await createOpencodeServer({ signal: input.signal, config: { project: cwd } as any })
  } catch (e: any) {
    yield { type: "error", message: `Opencode server failed to start: ${e.message}` }
    return
  }

  const client = createOpencodeClient({ baseUrl: server.url as `${string}://${string}` })

  // Buffered event queue + waiter, so the SSE consumer pushes and the generator yields.
  const events: AgentEvent[] = []
  let waiting: (() => void) | null = null
  const wake = () => {
    waiting?.()
    waiting = null
  }
  const push = (e: AgentEvent) => {
    events.push(e)
    wake()
  }

  let done = false
  let sessionID: string | null = null

  // Start SSE before sending a prompt so we don't lose early events.
  const sseTask = (async () => {
    try {
      const sub = await client.event.subscribe()
      for await (const event of sub.stream as AsyncIterable<any>) {
        if (event.type === "session.idle" && event.properties?.sessionID && event.properties.sessionID === sessionID) {
          push({ type: "result", ok: true })
          done = true
          wake()
          return
        }
        const mapped = mapOpencodeEvent(event, sessionID)
        for (const m of mapped) push(m)
      }
    } catch (e: any) {
      push({ type: "error", message: `SSE stream error: ${e.message}` })
      done = true
      wake()
    }
  })()

  // Create the session, then fire the prompt. We use promptAsync so we don't block
  // on completion — the SSE stream's session.idle event is our signal to stop.
  let session
  try {
    const created = await client.session.create({ body: { title: "puzzmo-cli" }, query: { directory: cwd } })
    session = created.data
    if (!session?.id) throw new Error("session.create returned no id")
    sessionID = session.id
  } catch (e: any) {
    push({ type: "error", message: `Session creation failed: ${e.message}` })
    done = true
    wake()
  }

  if (sessionID) {
    client.session
      .promptAsync({
        path: { id: sessionID },
        body: { parts: [{ type: "text", text: input.prompt }] as any },
        query: { directory: cwd },
      })
      .catch((e: Error) => {
        push({ type: "error", message: `Prompt failed: ${e.message}` })
        done = true
        wake()
      })
  }

  if (input.signal)
    input.signal.addEventListener("abort", () => {
      done = true
      wake()
    })

  try {
    while (true) {
      if (events.length > 0) {
        yield events.shift()!
        continue
      }
      if (done) return
      await new Promise<void>((r) => (waiting = r))
    }
  } finally {
    server.close()
    await sseTask.catch(() => {})
  }
}

const mapOpencodeEvent = (event: any, sessionID: string | null): AgentEvent[] => {
  if (event.type === "message.part.updated") {
    const part = event.properties?.part
    const delta = event.properties?.delta as string | undefined
    if (!part) return []
    // Deltas flow inline; complete-snapshot text gets a trailing newline so consecutive messages don't run together.
    if (part.type === "text") {
      if (delta != null) return [{ type: "text", text: delta }]
      const text = part.text ?? ""
      if (!text) return []
      return [{ type: "text", text: text.endsWith("\n") ? text : text + "\n" }]
    }
    if (part.type === "reasoning") {
      if (delta != null) return [{ type: "thinking", text: delta }]
      const text = part.text ?? ""
      if (!text) return []
      return [{ type: "thinking", text: text.endsWith("\n") ? text : text + "\n" }]
    }
    if (part.type === "tool") {
      const state = part.state?.status ?? part.state
      if (state === "completed" || state === "error")
        return [{ type: "tool_result", ok: state === "completed", summary: summarizeToolPart(part) }]
      return [{ type: "tool_use", name: part.tool ?? "tool", summary: summarizeToolPart(part) }]
    }
    return []
  }
  if (event.type === "file.edited") return [{ type: "tool_result", ok: true, summary: `Edited ${event.properties?.file ?? ""}` }]
  if (event.type === "command.executed") return [{ type: "tool_use", name: "Bash", summary: event.properties?.arguments ?? "" }]
  if (event.type === "session.error" && (!sessionID || event.properties?.sessionID === sessionID))
    return [{ type: "error", message: event.properties?.error?.message ?? "session error" }]
  return []
}

const summarizeToolPart = (part: any): string => {
  const input = part.state?.input ?? part.input
  if (!input || typeof input !== "object") return part.tool ?? ""
  if (typeof input.command === "string") return input.command.slice(0, 200)
  if (typeof input.file_path === "string") return input.file_path
  if (typeof input.path === "string") return input.path
  if (typeof input.pattern === "string") return input.pattern
  return part.tool ?? ""
}
