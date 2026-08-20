import fs from "node:fs"
import path from "node:path"

import { getAgent, type Agent, type AgentEvent } from "../agents/index.js"
import type { PipelineStep } from "../skills/registry.js"
import { prefetchSkillPrompts } from "../skills/mcp-client.js"
import { agentIdleTimeoutMs, buildStepPrompt, commitStep, resetSession, type PipelineContext } from "../skills/step.js"
import { verifyBuild } from "../util/exec.js"
import { formatDuration, formatElapsed } from "../util/duration.js"

type StepState = "pending" | "running" | "success" | "failed" | "skipped"
type Phase = "agent" | "build" | "commit" | "idle"

const ESC = "\x1b"
const CSI = `${ESC}[`
const moveTo = (row: number, col: number) => `${CSI}${row};${col}H`
const clearScreen = () => `${CSI}2J`
const hideCursor = () => `${CSI}?25l`
const showCursor = () => `${CSI}?25h`
const reset = () => `${CSI}0m`
const bold = (s: string) => `${CSI}1m${s}${reset()}`
const dim = (s: string) => `${CSI}2m${s}${reset()}`
const fg = (code: number, s: string) => `${CSI}${code}m${s}${reset()}`

const green = (s: string) => fg(32, s)
const yellow = (s: string) => fg(33, s)
const red = (s: string) => fg(31, s)
const cyan = (s: string) => fg(36, s)
const gray = (s: string) => dim(s)
const magenta = (s: string) => fg(35, s)

const stateIcon: Record<StepState, string> = {
  pending: "○",
  running: "●",
  success: "✓",
  failed: "✗",
  skipped: "–",
}

const stateColor: Record<StepState, (s: string) => string> = {
  pending: gray,
  running: yellow,
  success: green,
  failed: red,
  skipped: gray,
}

const phaseColor: Record<Phase, (s: string) => string> = {
  agent: yellow,
  build: cyan,
  commit: magenta,
  idle: gray,
}

// oxlint-disable-next-line no-control-regex
const ansiRe = /\x1b\[[0-9;]*[A-Za-z]/g
const stripAnsi = (s: string) => s.replace(ansiRe, "")

/**
 * Format a non-streaming event into discrete lines. text/thinking are handled
 * separately by appendText so token deltas merge into one in-progress line.
 */
const formatDiscreteEvent = (e: AgentEvent): string[] => {
  if (e.type === "tool_use") return [`${yellow(e.name)} ${dim(e.summary)}`]
  if (e.type === "tool_result") return [(e.ok ? green("  ✓ ") : red("  ✗ ")) + dim(e.summary)]
  if (e.type === "system") return [dim(e.text)]
  if (e.type === "result") {
    const cost = e.costUSD != null ? ` ($${e.costUSD.toFixed(4)})` : ""
    return [(e.ok ? green : red)(`Done${cost}`)]
  }
  if (e.type === "error") return [red(`Error: ${e.message}`)]
  return []
}

/** Where a step's wall-clock went, so it's clear whether a slow run is the agent or the build */
type StepTiming = { name: string; state: StepState; agentMs: number; buildMs: number; totalMs: number }

class PipelineTUI {
  private states: StepState[]
  private currentStep = 0
  private phase: Phase = "idle"
  private done = false
  private outputLines: string[] = []
  private currentLine = ""
  private chatLines: string[] = []
  private renderScheduled = false
  private sidebarWidth = 30
  private logsDir: string
  private abortController: AbortController | null = null
  private timings: StepTiming[] = []
  /** Accumulated inside the running step, folded into `timings` when it finishes */
  private agentMs = 0
  private buildMs = 0
  private stepStartedAt: number | null = null
  private ticker: NodeJS.Timeout | null = null

  constructor(
    private agent: Agent,
    private ctx: PipelineContext,
    private steps: PipelineStep[],
  ) {
    this.states = steps.map(() => "pending")
    this.logsDir = path.join(ctx.gameDir, ".puzzmo", "logs")
    fs.mkdirSync(this.logsDir, { recursive: true })
  }

  private get rows(): number {
    return process.stdout.rows || 24
  }

  private get cols(): number {
    return process.stdout.columns || 80
  }

  private get outputWidth(): number {
    return Math.max(this.cols - this.sidebarWidth - 1, 20)
  }

  private get contentRows(): number {
    return Math.max(this.rows - 4, 8)
  }

  private write(s: string) {
    process.stdout.write(s)
  }

  private scheduleRender() {
    if (this.renderScheduled) return
    this.renderScheduled = true
    setImmediate(() => {
      this.renderScheduled = false
      this.render()
    })
  }

  /** Lock the in-progress streaming line as a complete entry. */
  private lockCurrent() {
    if (this.currentLine.length === 0) return
    this.outputLines.push(this.currentLine)
    this.chatLines.push(stripAnsi(this.currentLine))
    this.currentLine = ""
  }

  /**
   * Append streaming text. Newlines lock the in-progress line; the trailing
   * fragment continues as the in-progress line. Optional styler wraps each
   * fragment in ANSI codes (e.g. gray() for thinking).
   */
  private appendText(text: string, styler?: (s: string) => string) {
    if (text.length === 0) return
    const parts = text.split("\n")
    this.currentLine += styler ? styler(parts[0]) : parts[0]
    for (let i = 1; i < parts.length; i++) {
      this.lockCurrent()
      this.currentLine = styler ? styler(parts[i]) : parts[i]
    }
    if (this.outputLines.length > 1000) this.outputLines = this.outputLines.slice(-this.contentRows * 4)
    this.scheduleRender()
  }

  /**
   * Append discrete pre-formatted lines (each becomes its own row). Locks any
   * in-progress streaming line first so token streams don't bleed into a
   * following tool_use marker.
   */
  private appendLines(lines: string[]) {
    if (lines.length === 0) return
    this.lockCurrent()
    for (const line of lines) {
      this.outputLines.push(line)
      this.chatLines.push(stripAnsi(line))
    }
    if (this.outputLines.length > 1000) this.outputLines = this.outputLines.slice(-this.contentRows * 4)
    this.scheduleRender()
  }

  private render() {
    const { rows, sidebarWidth, outputWidth, contentRows } = this
    let buf = ""

    buf += clearScreen()
    buf += moveTo(1, 1)

    buf += "╭" + "─".repeat(sidebarWidth - 2) + "┬" + "─".repeat(outputWidth) + "╮"

    buf += moveTo(2, 1)
    buf += "│ " + bold("Migration Steps") + " ".repeat(Math.max(0, sidebarWidth - 18)) + "│"

    const headerLabel = this.done ? "Done" : `${this.steps[this.currentStep]?.name ?? ""} ${dim(`(${this.phase})`)}`
    const styledHeader = phaseColor[this.phase](bold(headerLabel))
    const headerVisible = stripAnsi(headerLabel).length
    buf += " " + styledHeader + " ".repeat(Math.max(0, outputWidth - headerVisible - 1)) + "│"

    buf += moveTo(3, 1)
    buf += "├" + "─".repeat(sidebarWidth - 2) + "┼" + "─".repeat(outputWidth) + "┤"

    for (let row = 0; row < contentRows; row++) {
      buf += moveTo(row + 4, 1)

      const skillIndex = row
      if (skillIndex < this.steps.length) {
        const skill = this.steps[skillIndex]
        const state = this.states[skillIndex]
        const isActive = skillIndex === this.currentStep && !this.done
        const colorFn = stateColor[state]
        // The elapsed time sits right-aligned in the sidebar; the step name gives way to it.
        const elapsed = this.stepDuration(skillIndex)
        const tail = elapsed ? `${elapsed} ` : ""
        const room = sidebarWidth - 3
        const label = `${stateIcon[state]} ${skill.name}`.slice(0, room - tail.length - 1)
        const styled = isActive ? bold(colorFn(label)) : colorFn(label)
        const gap = Math.max(1, room - label.length - tail.length)
        buf += "│ " + styled + " ".repeat(gap) + dim(tail) + "│"
      } else if (skillIndex === this.steps.length + 1) {
        const completedCount = this.states.filter((s) => s === "success").length
        const failedCount = this.states.filter((s) => s === "failed").length
        const status = this.done
          ? failedCount > 0
            ? red(`${failedCount} failure(s)`)
            : green("All complete!")
          : dim(`${completedCount}/${this.steps.length} done`)
        const rawLen = stripAnsi(status).length
        buf += "│ " + status + " ".repeat(Math.max(0, sidebarWidth - rawLen - 3)) + "│"
      } else {
        buf += "│" + " ".repeat(sidebarWidth - 2) + "│"
      }

      const visibleCount = this.outputLines.length + (this.currentLine.length > 0 ? 1 : 0)
      const lineIndex = visibleCount - contentRows + row
      const rawLine = lineIndex < 0 ? "" : lineIndex < this.outputLines.length ? (this.outputLines[lineIndex] ?? "") : this.currentLine
      const truncated = truncateVisible(rawLine, outputWidth - 2)
      const visibleLen = stripAnsi(truncated).length
      buf += " " + truncated + " ".repeat(Math.max(0, outputWidth - visibleLen - 1)) + "│"
    }

    buf += moveTo(rows, 1)
    buf += "╰" + "─".repeat(sidebarWidth - 2) + "┴" + "─".repeat(outputWidth) + "╯"

    this.write(buf)
  }

  /** Runs the agent, continuing the pipeline's conversation unless `cold` asks for a fresh one. */
  private async runAgent(prompt: string, cold = false): Promise<boolean> {
    this.abortController = new AbortController()
    if (cold) resetSession(this.ctx.session)
    const started = Date.now()
    let sawError = false
    let resultOk: boolean | null = null
    try {
      const run = this.agent.run({
        prompt,
        cwd: this.ctx.gameDir,
        signal: this.abortController.signal,
        session: this.ctx.session,
        idleTimeoutMs: agentIdleTimeoutMs,
      })
      for await (const event of run) {
        if (event.type === "error") sawError = true
        if (event.type === "result") resultOk = event.ok
        if (event.type === "text") {
          this.appendText(event.text)
          continue
        }
        if (event.type === "thinking") {
          this.appendText(event.text, gray)
          continue
        }
        const lines = formatDiscreteEvent(event)
        if (lines.length > 0) this.appendLines(lines)
      }
    } catch (e: any) {
      this.appendLines([red(`Error: ${e.message ?? e}`)])
      return false
    } finally {
      this.abortController = null
      this.agentMs += Date.now() - started
    }
    this.lockCurrent()
    this.appendLines([dim(`Agent run took ${formatDuration(Date.now() - started)}`)])
    if (resultOk != null) return resultOk
    return !sawError
  }

  /** Elapsed so far for the step in flight, final wall-clock for the ones that have finished */
  private stepDuration(index: number): string {
    const finished = this.timings[index]
    if (finished) return formatDuration(finished.totalMs)
    if (this.states[index] === "running" && this.stepStartedAt != null) return formatElapsed(Date.now() - this.stepStartedAt)
    return ""
  }

  /** Times a step and files the result under its index, however the step exits */
  private async runStep(stepIndex: number): Promise<boolean> {
    this.agentMs = 0
    this.buildMs = 0
    const started = Date.now()
    this.stepStartedAt = started
    try {
      return await this.executeStep(stepIndex)
    } finally {
      this.timings[stepIndex] = {
        name: this.steps[stepIndex].name,
        state: this.states[stepIndex],
        agentMs: this.agentMs,
        buildMs: this.buildMs,
        totalMs: Date.now() - started,
      }
      this.stepStartedAt = null
      this.render() // repaint so the row swaps its live counter for the final time
    }
  }

  /** Runs the project's build, echoing its output into the pane */
  private async verify(): Promise<{ success: boolean; error?: string }> {
    const started = Date.now()
    const result = await verifyBuild(this.ctx.gameDir, this.ctx.buildCmd)
    this.buildMs += Date.now() - started
    if (result.error?.trim()) this.appendLines(result.error.trim().split("\n"))
    return result
  }

  private async executeStep(stepIndex: number): Promise<boolean> {
    const step = this.steps[stepIndex]
    this.states[stepIndex] = "running"
    this.currentStep = stepIndex
    this.outputLines = []
    this.currentLine = ""
    this.chatLines = []
    this.phase = "agent"
    this.render()

    let prompt: string
    try {
      prompt = await buildStepPrompt(step, this.ctx)
    } catch (e: any) {
      this.appendLines([red(`Failed to fetch instructions: ${e.message}`)])
      this.writeSkillLog(step.name)
      this.states[stepIndex] = "failed"
      return false
    }

    let success = await this.runAgent(prompt)
    if (!success) {
      // Retry cold: whatever went wrong may have been the resumed conversation itself
      // (an agent that can't resume, or one that wedged partway through).
      this.appendLines(["", dim("--- Retrying in a fresh session ---")])
      success = await this.runAgent(prompt, true)
      if (!success) {
        this.writeSkillLog(step.name)
        this.states[stepIndex] = "failed"
        return false
      }
    }

    if (!step.skipBuild) {
      this.phase = "build"
      this.render()
      this.appendLines([dim(`Verifying build (${this.ctx.buildCmd})...`)])
      const buildResult = await this.verify()
      if (!buildResult.success) {
        this.appendLines([dim("Asking agent to fix...")])
        const fixPrompt = `The build (${this.ctx.buildCmd}) failed after the "${step.name}" step. Fix the build errors:\n\n${buildResult.error}`
        await this.runAgent(fixPrompt)
        const retry = await this.verify()
        if (!retry.success) {
          this.writeSkillLog(step.name)
          this.states[stepIndex] = "failed"
          return false
        }
      }
    }

    this.phase = "commit"
    this.render()
    const committed = await commitStep(this.ctx.gameDir, step.name)
    this.appendLines([dim(committed ? "Committed." : "No changes to commit.")])

    this.writeSkillLog(step.name)

    this.states[stepIndex] = "success"
    this.render()
    return true
  }

  private writeSkillLog(skillName: string) {
    const logPath = path.join(this.logsDir, `${skillName}.txt`)
    const timing = `Timing: agent ${formatDuration(this.agentMs)}, build ${formatDuration(this.buildMs)}`
    fs.writeFileSync(logPath, [...this.chatLines, "", timing].join("\n") + "\n")
  }

  /** Prints where the run's time went, once the full-screen view has been torn down */
  private printSummary(totalMs: number) {
    if (this.timings.length === 0) return
    const width = Math.max(...this.timings.map((t) => t.name.length))
    const lines = [``, bold(`Migration finished in ${formatDuration(totalMs)}`)]
    for (const t of this.timings) {
      const icon = stateColor[t.state](stateIcon[t.state])
      const spent = dim(`(agent ${formatDuration(t.agentMs)}, build ${formatDuration(t.buildMs)})`)
      lines.push(`  ${icon} ${t.name.padEnd(width)}  ${formatDuration(t.totalMs).padStart(7)}  ${spent}`)
    }
    lines.push(dim(`  logs: ${this.logsDir}`))
    console.log(lines.join("\n"))
  }

  private setupInput() {
    if (process.stdin.isTTY) process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.on("data", (data: Buffer) => {
      // Ctrl+C
      if (data[0] === 3) {
        this.abortController?.abort()
        this.cleanup()
        process.exit(0)
      }
    })
  }

  private cleanup() {
    if (this.ticker) clearInterval(this.ticker)
    this.ticker = null
    this.write(showCursor())
    if (process.stdin.isTTY) process.stdin.setRawMode(false)
    process.stdin.pause()
  }

  async run() {
    const startedAll = Date.now()
    this.write(hideCursor())
    this.setupInput()
    this.render()

    process.stdout.on("resize", () => this.render())

    // Steps run for minutes at a time, so repaint on a timer to keep the elapsed column moving
    // even while the agent is silent.
    this.ticker = setInterval(() => this.scheduleRender(), 1000)
    this.ticker.unref()

    // Warm every skill doc up front, in parallel, so no step waits on the network mid-run.
    await prefetchSkillPrompts(
      this.steps.flatMap((s) => s.skills),
      this.ctx.gameDir,
    )

    for (let i = 0; i < this.steps.length; i++) {
      const ok = await this.runStep(i)
      if (!ok) {
        this.appendLines(["", red("Pipeline stopped due to failure.")])
        break
      }
    }

    this.phase = "idle"
    this.done = true
    this.render()
    this.cleanup()
    this.printSummary(Date.now() - startedAll)
  }
}

/** Truncate a string to a visible width, preserving ANSI codes. */
const truncateVisible = (s: string, maxWidth: number): string => {
  let visible = 0
  let i = 0
  while (i < s.length && visible < maxWidth) {
    if (s[i] === "\x1b" && s[i + 1] === "[") {
      const end = s.indexOf("m", i)
      if (end !== -1) {
        i = end + 1
        continue
      }
    }
    visible++
    i++
  }
  while (i < s.length && s[i] === "\x1b" && s[i + 1] === "[") {
    const end = s.indexOf("m", i)
    if (end !== -1) i = end + 1
    else break
  }
  return s.slice(0, i)
}

export const runPipelineTUI = async (ctx: PipelineContext, steps: PipelineStep[]): Promise<void> => {
  const agent = getAgent(ctx.agent)
  if (!agent) throw new Error(`Unknown agent: ${ctx.agent}`)
  const tui = new PipelineTUI(agent, ctx, steps)
  await tui.run()
}
