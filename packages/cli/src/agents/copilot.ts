import { CopilotClient, approveAll } from "@github/copilot-sdk"

import type { Agent, AgentEvent, RunInput } from "./types.js"

/**
 * Copilot adapter — wraps `@github/copilot-sdk`, which spawns the bundled
 * `@github/copilot` CLI and reuses its OAuth/Copilot Pro subscription auth.
 */
export const copilotAgent: Agent = {
  name: "copilot",
  run(input) {
    return runCopilot(input)
  },
}

const runCopilot = async function* (input: RunInput): AsyncIterable<AgentEvent> {
  const client = new CopilotClient({ cwd: input.cwd ?? process.cwd() })
  try {
    await client.start()
  } catch (e: any) {
    yield { type: "error", message: `Copilot client failed to start: ${e.message}` }
    return
  }

  const events: AgentEvent[] = []
  let waiting: (() => void) | null = null
  const push = (e: AgentEvent) => {
    events.push(e)
    waiting?.()
    waiting = null
  }

  let session
  try {
    session = await client.createSession({
      streaming: true,
      workingDirectory: input.cwd ?? process.cwd(),
      onPermissionRequest: approveAll,
      onEvent: (event: any) => {
        const mapped = mapCopilotEvent(event)
        for (const m of mapped) push(m)
      },
    })
  } catch (e: any) {
    yield { type: "error", message: `Copilot session creation failed: ${e.message}` }
    await safeStop(client)
    return
  }

  const cancel = () => {
    session.disconnect().catch(() => {})
  }
  if (input.signal) input.signal.addEventListener("abort", cancel)

  let runError = null as Error | null
  let runDone = false
  session
    .sendAndWait({ prompt: input.prompt }, 600_000)
    .catch((e: Error) => {
      runError = e
    })
    .finally(() => {
      runDone = true
      waiting?.()
      waiting = null
    })

  try {
    while (true) {
      if (events.length > 0) {
        yield events.shift()!
        continue
      }
      if (runDone) {
        if (runError) yield { type: "error", message: runError.message }
        yield { type: "result", ok: !runError }
        return
      }
      await new Promise<void>((r) => (waiting = r))
    }
  } finally {
    await session.disconnect().catch(() => {})
    await safeStop(client)
  }
}

const safeStop = async (client: CopilotClient) => {
  try {
    await client.stop()
  } catch {
    /* ignore */
  }
}

const mapCopilotEvent = (event: any): AgentEvent[] => {
  if (event.type === "assistant.message_delta") return [{ type: "text", text: event.data?.deltaContent ?? "" }]
  if (event.type === "assistant.reasoning_delta") return [{ type: "thinking", text: event.data?.deltaContent ?? event.data?.delta ?? "" }]
  if (event.type === "tool.execution_start") {
    const name = event.data?.toolName ?? "tool"
    const args = event.data?.arguments
    return [{ type: "tool_use", name, summary: summarizeToolArgs(name, args) }]
  }
  if (event.type === "tool.execution_complete") {
    const ok = event.data?.success === true
    const summary = event.data?.result?.content?.slice(0, 200) ?? event.data?.error?.message ?? ""
    return [{ type: "tool_result", ok, summary }]
  }
  if (event.type === "session.error") return [{ type: "error", message: event.data?.message ?? "session error" }]
  if (event.type === "session.start") return [{ type: "system", text: "Session started" }]
  return []
}

const summarizeToolArgs = (name: string, args: any): string => {
  if (!args || typeof args !== "object") return ""
  if (typeof args.command === "string") return args.command.slice(0, 200)
  if (typeof args.file_path === "string") return args.file_path
  if (typeof args.path === "string") return args.path
  if (typeof args.pattern === "string") return args.pattern
  return ""
}
