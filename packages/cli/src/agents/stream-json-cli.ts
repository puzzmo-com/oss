import { spawn, type ChildProcess } from "node:child_process"

import type { AgentEvent, AgentSession, RunInput } from "./types.js"

/**
 * Shared driver for any CLI that emits NDJSON over stdout when given a prompt
 * in print/headless mode. Used by both the claude and gemini adapters.
 */
export type StreamJsonCliConfig = {
  cmd: string
  /** Build argv for a run. `session` is set when the caller wants this run to continue an earlier one. */
  buildArgs: (prompt: string, session?: AgentSession) => string[]
  /** Map one parsed JSON line to an AgentEvent, several (a turn can start multiple tools), or null to drop. */
  parseLine: (line: string) => AgentEvent | AgentEvent[] | null
  /** Optional env mutator. Receives a copy of process.env. */
  env?: (base: NodeJS.ProcessEnv) => NodeJS.ProcessEnv
}

export const runStreamJsonCli = async function* (config: StreamJsonCliConfig, input: RunInput): AsyncIterable<AgentEvent> {
  const args = config.buildArgs(input.prompt, input.session)
  const env = config.env ? config.env({ ...process.env }) : { ...process.env }

  let proc: ChildProcess
  try {
    proc = spawn(config.cmd, args, {
      cwd: input.cwd ?? process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    })
  } catch (e: any) {
    yield { type: "error", message: `Failed to spawn ${config.cmd}: ${e.message}` }
    return
  }

  if (input.signal) input.signal.addEventListener("abort", () => proc.kill())

  // Bridge node streams + child events into an async generator.
  const queue: AgentEvent[] = []
  let done = false
  let resolveWaiting: (() => void) | null = null
  let buf = ""
  let sawResult = false

  let idleTimer: NodeJS.Timeout | null = null
  let idleFired = false

  // Agents can think for minutes at a time, so cap silence rather than total runtime:
  // a wedged run dies quickly while a productive long one is left alone.
  const armIdleTimer = () => {
    if (!input.idleTimeoutMs || idleFired || done) return
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      idleFired = true
      push({ type: "error", message: `No output for ${Math.round(input.idleTimeoutMs! / 1000)}s, stopping the agent` })
      proc.kill()
    }, input.idleTimeoutMs)
  }

  const push = (e: AgentEvent) => {
    if (e.type === "result") sawResult = true
    queue.push(e)
    armIdleTimer()
    resolveWaiting?.()
    resolveWaiting = null
  }

  const flushLine = (line: string) => {
    if (!line.trim()) return
    const parsed = config.parseLine(line)
    if (!parsed) return
    for (const event of Array.isArray(parsed) ? parsed : [parsed]) push(event)
  }

  proc.stdout?.on("data", (chunk: Buffer) => {
    buf += chunk.toString("utf8")
    const lines = buf.split("\n")
    buf = lines.pop() ?? ""
    for (const line of lines) flushLine(line)
  })

  // Warnings on stderr are noise, not failure — a run is judged by its result event
  // and exit code, so a deprecation notice can't trigger a spurious retry.
  proc.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8").trim()
    if (text) push({ type: "system", text })
  })

  proc.on("close", (code) => {
    if (buf.trim()) flushLine(buf)
    if (code !== 0 && !sawResult) push({ type: "result", ok: false })
    done = true
    if (idleTimer) clearTimeout(idleTimer)
    resolveWaiting?.()
    resolveWaiting = null
  })

  proc.on("error", (err) => {
    push({ type: "error", message: err.message })
    done = true
    if (idleTimer) clearTimeout(idleTimer)
    resolveWaiting?.()
    resolveWaiting = null
  })

  armIdleTimer()

  while (true) {
    if (queue.length > 0) yield queue.shift()!
    else if (done) return
    else await new Promise<void>((r) => (resolveWaiting = r))
  }
}
