import fs from "node:fs"
import path from "node:path"

import { getAgent } from "../agents/index.js"
import { skillsPipeline, type SkillDefinition } from "./registry.js"
import { verifyBuild, runCommand, gitCommit } from "../util/exec.js"
import { fetchSkillPrompt } from "./mcp-client.js"
import { runPipelineTUI } from "../tui/pipeline.js"

const agentTimeoutMs = 300000 // 5 minute timeout per agent invocation

/** Fetches step instructions from the MCP server and wraps them as an agent prompt */
const buildPrompt = async (stepName: string, gameDir: string, repoContext: string): Promise<string> => {
  const instructions = await fetchSkillPrompt(stepName, gameDir)
  return `Follow these instructions. The game source is in the current directory.\n\n${repoContext}\n\n${instructions}`
}

/**
 * Invokes an LLM agent with a prompt, streaming its text and tool activity to the console.
 * When `transcript` is provided, an ANSI-stripped copy of everything printed is appended to it.
 */
const invokeAgent = async (agentName: string, prompt: string, cwd: string, transcript?: string[]): Promise<boolean> => {
  const agent = getAgent(agentName)
  if (!agent) {
    const line = `  Unknown agent: ${agentName}`
    console.error(line)
    transcript?.push(line)
    return false
  }

  let resultOk: boolean | null = null
  let sawError = false
  let midLine = false
  let lineBuf = "" // streamed text accumulated until a newline, so the transcript is line-oriented

  const record = (line: string) => transcript?.push(stripAnsi(line))
  const flushBuf = () => {
    if (!lineBuf) return
    record(lineBuf)
    lineBuf = ""
  }

  // Text arrives as token deltas; track whether we are mid-line so discrete
  // events (tool calls, results) always start on a fresh line.
  const endLine = () => {
    if (!midLine) return
    process.stdout.write("\n")
    midLine = false
  }
  const printLine = (line: string) => {
    endLine()
    flushBuf()
    console.log(line)
    record(line)
  }

  try {
    for await (const event of agent.run({ prompt, cwd, signal: AbortSignal.timeout(agentTimeoutMs) })) {
      if (event.type === "text") {
        process.stdout.write(dim(event.text))
        midLine = !event.text.endsWith("\n")
        lineBuf += event.text
        let nl
        while ((nl = lineBuf.indexOf("\n")) !== -1) {
          record(lineBuf.slice(0, nl))
          lineBuf = lineBuf.slice(nl + 1)
        }
      } else if (event.type === "tool_result") {
        printLine(`    ${event.ok ? green("✓") : red("✗")} ${dim(event.summary)}`)
      } else if (event.type === "system") {
        printLine(`  ${dim(event.text)}`)
      } else if (event.type === "result") {
        resultOk = event.ok
        const cost = event.costUSD != null ? ` ($${event.costUSD.toFixed(4)})` : ""
        printLine((event.ok ? green : red)(`  Agent finished${cost}`))
      } else if (event.type === "error") {
        sawError = true
        printLine(red(`  ${event.message}`))
      }
    }
  } catch (e: any) {
    printLine(red(`  Agent error: ${e?.message ?? e}`))
    return false
  }
  endLine()
  flushBuf()

  return resultOk ?? !sawError
}

/** Runs the skills pipeline with plain console output (no TUI) */
export const runSkillsPipeline = async (agent: string, gameDir: string, repoContext: string) => {
  const total = skillsPipeline.length

  for (let i = 0; i < total; i++) {
    const skill = skillsPipeline[i]
    const step = i + 1
    console.log(`[${step}/${total}] Running step: ${skill.name}`)

    const prompt = await buildPrompt(skill.name, gameDir, repoContext)
    let success = await invokeAgent(agent, prompt, gameDir)

    if (!success) {
      console.log(`  Agent failed, retrying...`)
      success = await invokeAgent(agent, prompt, gameDir)
      if (!success) {
        console.error(`  Step ${skill.name} failed after retry. Stopping pipeline.`)
        process.exit(1)
      }
    }

    // Verify build
    const buildResult = verifyBuild(gameDir)
    if (!buildResult.success) {
      console.log(`  Build failed after ${skill.name}, asking agent to fix...`)
      const fixPrompt = `The vite build failed after the "${skill.name}" step. Fix the build errors:\n\n${buildResult.error}`
      await invokeAgent(agent, fixPrompt, gameDir)

      const retryBuild = verifyBuild(gameDir)
      if (!retryBuild.success) {
        console.error(`  Build still failing after fix attempt. Stopping.`)
        process.exit(1)
      }
    }

    // Commit
    try {
      runCommand("git add -A", { cwd: gameDir })
      gitCommit(`step: ${skill.name}`, { cwd: gameDir })
      console.log(`  Committed.`)
    } catch {
      console.log(`  No changes to commit.`)
    }
  }

  console.log(`\nAll skills completed!`)
}

/** Runs the skills pipeline with a split-pane TUI */
export const runSkillsPipelineTUI = async (agent: string, gameDir: string, repoContext: string) => {
  await runPipelineTUI(agent, gameDir, repoContext)
}

/** Runs a chosen subset of skills (the optional add-ons after the prompt flow); warns but never exits on failure */
export const runSelectedSkills = async (agent: string, gameDir: string, repoContext: string, skills: SkillDefinition[]) => {
  const total = skills.length

  for (let i = 0; i < total; i++) {
    const skill = skills[i]
    console.log(`[${i + 1}/${total}] Running step: ${skill.name}`)

    const prompt = await buildPrompt(skill.name, gameDir, repoContext)
    let success = await invokeAgent(agent, prompt, gameDir)
    if (!success) {
      console.log(`  Agent failed, retrying...`)
      success = await invokeAgent(agent, prompt, gameDir)
    }
    if (!success) {
      console.error(`  Step ${skill.name} did not complete cleanly, skipping.`)
      continue
    }

    // Verify build; ask the agent to fix but keep going regardless
    const buildResult = verifyBuild(gameDir)
    if (!buildResult.success) {
      console.log(`  Build failed after ${skill.name}, asking agent to fix...`)
      const fixPrompt = `The vite build failed after the "${skill.name}" step. Fix the build errors:\n\n${buildResult.error}`
      await invokeAgent(agent, fixPrompt, gameDir)
    }

    try {
      runCommand("git add -A", { cwd: gameDir })
      gitCommit(`step: ${skill.name}`, { cwd: gameDir })
      console.log(`  Committed.`)
    } catch {
      console.log(`  No changes to commit.`)
    }
  }
}

/**
 * Outcome of a build loop. `logPath` points at the persisted run transcript.
 * On failure `reason` is a human-readable summary and `buildError` holds captured build output.
 */
export type BuildLoopResult = { ok: true; logPath: string } | { ok: false; reason: string; buildError?: string; logPath: string }

/** Runs a single agent invocation, verifies the build, and commits. Used by one-shot prompt-driven flows. */
export const runAgentWithBuildLoop = async (agent: string, prompt: string, gameDir: string, label: string): Promise<BuildLoopResult> => {
  const transcript: string[] = []
  // Print to the console and record the same line to the run transcript.
  const say = (line: string) => {
    console.log(line)
    transcript.push(stripAnsi(line))
  }

  say(`Running agent: ${label}`)
  let success = await invokeAgent(agent, prompt, gameDir, transcript)
  if (!success) {
    say(`  Agent failed, retrying...`)
    success = await invokeAgent(agent, prompt, gameDir, transcript)
    if (!success) {
      say(`  Agent failed after retry. Stopping.`)
      const logPath = writeRunLog(gameDir, label, transcript)
      return { ok: false, reason: "the agent did not finish successfully after two attempts", logPath }
    }
  }

  const buildResult = verifyBuild(gameDir)
  if (!buildResult.success) {
    say(`  Build failed, asking agent to fix...`)
    recordBuildError(say, buildResult.error)
    const fixPrompt = `The vite build failed after the "${label}" step. Fix the build errors:\n\n${buildResult.error}`
    await invokeAgent(agent, fixPrompt, gameDir, transcript)
    const retry = verifyBuild(gameDir)
    if (!retry.success) {
      say(`  Build still failing after fix attempt.`)
      recordBuildError(say, retry.error)
      const logPath = writeRunLog(gameDir, label, transcript)
      return { ok: false, reason: "the vite build is still failing after the agent's fix attempt", buildError: retry.error, logPath }
    }
  }

  try {
    runCommand("git add -A", { cwd: gameDir })
    gitCommit(`step: ${label}`, { cwd: gameDir })
    say(`  Committed.`)
  } catch {
    say(`  No changes to commit.`)
  }
  return { ok: true, logPath: writeRunLog(gameDir, label, transcript) }
}

/** Emits captured build output via `say`, trimmed to the trailing lines that usually hold the actual error */
const recordBuildError = (say: (line: string) => void, error?: string) => {
  if (!error) return
  const lines = error.trimEnd().split("\n")
  const maxLines = 40
  const shown = lines.slice(-maxLines)
  if (lines.length > shown.length) say(dim(`  │ ... (${lines.length - shown.length} earlier lines omitted)`))
  for (const line of shown) say(dim(`  │ ${line}`))
}

/** Persists a run transcript under the game's .puzzmo/logs dir, matching the TUI pipeline, and returns the path */
const writeRunLog = (gameDir: string, label: string, lines: string[]): string => {
  const logsDir = path.join(gameDir, ".puzzmo", "logs")
  fs.mkdirSync(logsDir, { recursive: true })
  const logPath = path.join(logsDir, `${label}.txt`)
  fs.writeFileSync(logPath, lines.join("\n") + "\n")
  return logPath
}

// oxlint-disable-next-line no-control-regex
const ansiRe = /\x1b\[[0-9;]*[A-Za-z]/g
/** Strips ANSI colour codes so recorded transcript lines are plain text */
const stripAnsi = (s: string) => s.replace(ansiRe, "")

/** Wraps a string in ANSI dim codes */
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
/** Wraps a string in ANSI green codes */
const green = (s: string) => `\x1b[32m${s}\x1b[0m`
/** Wraps a string in ANSI red codes */
const red = (s: string) => `\x1b[31m${s}\x1b[0m`
