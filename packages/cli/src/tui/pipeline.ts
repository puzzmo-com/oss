import { execSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { getAgent, type Agent, type AgentEvent } from "../agents/index.js"
import { skillsPipeline } from "../skills/registry.js"
import { fetchSkillPrompt } from "../skills/mcp-client.js"

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
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g
const stripAnsi = (s: string) => s.replace(ANSI_RE, "")

const buildPrompt = async (stepName: string, gameDir: string, repoContext: string): Promise<string> => {
  const instructions = await fetchSkillPrompt(stepName, gameDir)
  return `Follow these instructions. The game source is in the current directory.\n\n${repoContext}\n\n${instructions}`
}

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

  constructor(
    private agent: Agent,
    private gameDir: string,
    private repoContext: string,
  ) {
    this.states = skillsPipeline.map(() => "pending")
    this.logsDir = path.join(gameDir, ".puzzmo", "logs")
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

    const headerLabel = this.done ? "Done" : `${skillsPipeline[this.currentStep]?.name ?? ""} ${dim(`(${this.phase})`)}`
    const styledHeader = phaseColor[this.phase](bold(headerLabel))
    const headerVisible = stripAnsi(headerLabel).length
    buf += " " + styledHeader + " ".repeat(Math.max(0, outputWidth - headerVisible - 1)) + "│"

    buf += moveTo(3, 1)
    buf += "├" + "─".repeat(sidebarWidth - 2) + "┼" + "─".repeat(outputWidth) + "┤"

    for (let row = 0; row < contentRows; row++) {
      buf += moveTo(row + 4, 1)

      const skillIndex = row
      if (skillIndex < skillsPipeline.length) {
        const skill = skillsPipeline[skillIndex]
        const state = this.states[skillIndex]
        const isActive = skillIndex === this.currentStep && !this.done
        const icon = stateIcon[state]
        const colorFn = stateColor[state]
        const label = `${icon} ${skill.name}`
        const styled = isActive ? bold(colorFn(label)) : colorFn(label)
        const rawLen = stripAnsi(styled).length
        buf += "│ " + styled + " ".repeat(Math.max(0, sidebarWidth - rawLen - 3)) + "│"
      } else if (skillIndex === skillsPipeline.length + 1) {
        const completedCount = this.states.filter((s) => s === "success").length
        const failedCount = this.states.filter((s) => s === "failed").length
        const status = this.done
          ? failedCount > 0
            ? red(`${failedCount} failure(s)`)
            : green("All complete!")
          : dim(`${completedCount}/${skillsPipeline.length} done`)
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

  private async runAgent(prompt: string): Promise<boolean> {
    this.abortController = new AbortController()
    let sawError = false
    let resultOk: boolean | null = null
    try {
      for await (const event of this.agent.run({ prompt, cwd: this.gameDir, signal: this.abortController.signal })) {
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
    }
    this.lockCurrent()
    if (resultOk != null) return resultOk
    return !sawError
  }

  private runCmd(cmd: string): { success: boolean; output: string } {
    try {
      const output = execSync(cmd, { cwd: this.gameDir, encoding: "utf-8", stdio: "pipe" })
      if (output.trim()) this.appendLines(output.trim().split("\n"))
      return { success: true, output }
    } catch (e: any) {
      const output = (e.stdout || "") + (e.stderr || "") || e.message
      if (output.trim()) this.appendLines(output.trim().split("\n"))
      return { success: false, output }
    }
  }

  private async runStep(stepIndex: number): Promise<boolean> {
    const skill = skillsPipeline[stepIndex]
    this.states[stepIndex] = "running"
    this.currentStep = stepIndex
    this.outputLines = []
    this.currentLine = ""
    this.chatLines = []
    this.phase = "agent"
    this.render()

    let prompt: string
    try {
      prompt = await buildPrompt(skill.name, this.gameDir, this.repoContext)
    } catch (e: any) {
      this.appendLines([red(`Failed to fetch instructions: ${e.message}`)])
      this.writeSkillLog(skill.name)
      this.states[stepIndex] = "failed"
      return false
    }

    let success = await this.runAgent(prompt)
    if (!success) {
      this.appendLines(["", dim("--- Retrying ---")])
      success = await this.runAgent(prompt)
      if (!success) {
        this.writeSkillLog(skill.name)
        this.states[stepIndex] = "failed"
        return false
      }
    }

    this.phase = "build"
    this.render()
    this.appendLines([dim("Verifying build...")])
    const buildResult = this.runCmd("npx vite build")
    if (!buildResult.success) {
      this.appendLines([dim("Asking agent to fix...")])
      const fixPrompt = `The vite build failed after the "${skill.name}" step. Fix the build errors:\n\n${buildResult.output}`
      await this.runAgent(fixPrompt)
      const retry = this.runCmd("npx vite build")
      if (!retry.success) {
        this.writeSkillLog(skill.name)
        this.states[stepIndex] = "failed"
        return false
      }
    }

    this.phase = "commit"
    this.render()
    this.runCmd("git add -A")
    const commitResult = this.runCmd(`git commit -m "step: ${skill.name}"`)
    this.appendLines([dim(commitResult.success ? "Committed." : "No changes to commit.")])

    this.writeSkillLog(skill.name)

    this.states[stepIndex] = "success"
    this.render()
    return true
  }

  private writeSkillLog(skillName: string) {
    const logPath = path.join(this.logsDir, `${skillName}.txt`)
    fs.writeFileSync(logPath, this.chatLines.join("\n") + "\n")
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
    this.write(showCursor())
    if (process.stdin.isTTY) process.stdin.setRawMode(false)
    process.stdin.pause()
  }

  async run() {
    this.write(hideCursor())
    this.setupInput()
    this.render()

    process.stdout.on("resize", () => this.render())

    for (let i = 0; i < skillsPipeline.length; i++) {
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

export const runPipelineTUI = async (agentName: string, gameDir: string, repoContext: string): Promise<void> => {
  const agent = getAgent(agentName)
  if (!agent) throw new Error(`Unknown agent: ${agentName}`)
  const tui = new PipelineTUI(agent, gameDir, repoContext)
  await tui.run()
}
