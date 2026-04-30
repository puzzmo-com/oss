import { spawn, type ChildProcess } from "node:child_process"

import type { AgentEvent, RunInput } from "./types.js"

/**
 * Shared driver for any CLI that emits NDJSON over stdout when given a prompt
 * in print/headless mode. Used by both the claude and gemini adapters.
 */
export type StreamJsonCliConfig = {
  cmd: string
  buildArgs: (prompt: string) => string[]
  /** Map one parsed JSON line to an AgentEvent (or null to drop). */
  parseLine: (line: string) => AgentEvent | null
  /** Optional env mutator. Receives a copy of process.env. */
  env?: (base: NodeJS.ProcessEnv) => NodeJS.ProcessEnv
}

export const runStreamJsonCli = async function* (config: StreamJsonCliConfig, input: RunInput): AsyncIterable<AgentEvent> {
  const args = config.buildArgs(input.prompt)
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

  const push = (e: AgentEvent) => {
    if (e.type === "result") sawResult = true
    queue.push(e)
    resolveWaiting?.()
    resolveWaiting = null
  }

  const flushLine = (line: string) => {
    if (!line.trim()) return
    const event = config.parseLine(line)
    if (event) push(event)
  }

  proc.stdout?.on("data", (chunk: Buffer) => {
    buf += chunk.toString("utf8")
    const lines = buf.split("\n")
    buf = lines.pop() ?? ""
    for (const line of lines) flushLine(line)
  })

  proc.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8").trim()
    if (text) push({ type: "error", message: text })
  })

  proc.on("close", (code) => {
    if (buf.trim()) flushLine(buf)
    if (code !== 0 && !sawResult) push({ type: "result", ok: false })
    done = true
    resolveWaiting?.()
    resolveWaiting = null
  })

  proc.on("error", (err) => {
    push({ type: "error", message: err.message })
    done = true
    resolveWaiting?.()
    resolveWaiting = null
  })

  while (true) {
    if (queue.length > 0) yield queue.shift()!
    else if (done) return
    else await new Promise<void>((r) => (resolveWaiting = r))
  }
}
