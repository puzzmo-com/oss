import fs from "node:fs"

import * as p from "@clack/prompts"

import { agentNames, getAgent } from "../agents/index.js"

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`

/** Undocumented: send "say hello world" to a chosen agent through the meta-library
 *  and stream events to stdout. Use this to verify each adapter end-to-end. */
export const agentTest = async () => {
  p.intro("Agent SDK Test")

  const choice = await p.select({
    message: "Which agent?",
    options: agentNames().map((name) => ({ value: name, label: name })),
    initialValue: "claude",
  })
  if (p.isCancel(choice)) process.exit(0)
  const agent = getAgent(String(choice))
  if (!agent) {
    p.log.error(`Unknown agent: ${choice}`)
    process.exit(1)
  }

  const prompt = "say hello world"
  const cwd = process.cwd()
  const debugPath = "/tmp/puzzmo-agent-test.log"
  fs.writeFileSync(debugPath, "")
  const log = (msg: string) => fs.appendFileSync(debugPath, `[${new Date().toISOString()}] ${msg}\n`)

  log(`agent=${agent.name} cwd=${cwd}`)
  log(`prompt=${JSON.stringify(prompt)}`)

  process.stderr.write(`\n${dim("[agent]")} ${agent.name}\n`)
  process.stderr.write(`${dim("[cwd]")}   ${cwd}\n`)
  process.stderr.write(`${dim("[log]")}   ${debugPath}\n`)
  process.stderr.write(`${dim("---- events below (Ctrl+C to abort) ----")}\n\n`)

  const controller = new AbortController()
  const onSig = () => {
    process.stderr.write(`\n${dim("[interrupt]")}\n`)
    controller.abort()
  }
  process.on("SIGINT", onSig)

  const start = Date.now()
  let count = 0
  try {
    for await (const event of agent.run({ prompt, cwd, signal: controller.signal })) {
      count++
      const elapsed = ((Date.now() - start) / 1000).toFixed(3)
      log(`+${elapsed}s ${event.type} ${JSON.stringify(event).slice(0, 400)}`)
      printEvent(event)
    }
  } catch (e: any) {
    process.stderr.write(`\n${red("[run threw]")} ${e.message ?? e}\n`)
    log(`THROW ${e.message ?? e}`)
    process.exit(1)
  } finally {
    process.off("SIGINT", onSig)
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(3)
  process.stderr.write(`\n${dim(`[+${elapsed}s done]`)} events=${count}\n`)
  log(`done events=${count} elapsed=${elapsed}s`)
}

const printEvent = (e: { type: string } & Record<string, any>) => {
  if (e.type === "text") process.stdout.write(e.text)
  else if (e.type === "thinking") process.stdout.write(dim(e.text))
  else if (e.type === "tool_use") process.stdout.write(`\n${yellow(`[${e.name}]`)} ${dim(e.summary ?? "")}\n`)
  else if (e.type === "tool_result") process.stdout.write(`${e.ok ? green("  ✓") : red("  ✗")} ${dim(e.summary ?? "")}\n`)
  else if (e.type === "system") process.stdout.write(dim(`\n[${e.text}]\n`))
  else if (e.type === "result")
    process.stdout.write(`\n${e.ok ? green("== Done") : red("== Failed")}${e.costUSD ? ` ($${e.costUSD.toFixed(4)})` : ""}\n`)
  else if (e.type === "error") process.stdout.write(red(`\n[error] ${e.message}\n`))
}
