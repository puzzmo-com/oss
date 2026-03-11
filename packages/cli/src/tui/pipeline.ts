import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { skillsPipeline, agentSkillsDir } from "../skills/registry.js"
import { verifyBuild, runCommand, gitCommit } from "../lib/exec.js"

type StepState = "pending" | "running" | "success" | "failed" | "skipped"
type Phase = "agent" | "build" | "commit" | "idle"

// ANSI escape helpers
const ESC = "\x1b"
const CSI = `${ESC}[`
const moveTo = (row: number, col: number) => `${CSI}${row};${col}H`
const clearScreen = () => `${CSI}2J`
const hideCursor = () => `${CSI}?25l`
const showCursor = () => `${CSI}?25h`
const bold = (s: string) => `${CSI}1m${s}${CSI}0m`
const dim = (s: string) => `${CSI}2m${s}${CSI}0m`
const fg = (code: number, s: string) => `${CSI}${code}m${s}${CSI}0m`

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

/** Build agent-specific command for non-interactive mode */
const buildAgentCmd = (agent: string, prompt: string): { cmd: string; args: string[] } => {
  if (agent === "claude") return { cmd: "claude", args: ["-p", "--verbose", "--output-format", "stream-json", prompt] }
  if (agent === "codex") return { cmd: "codex", args: ["--quiet", prompt] }
  return { cmd: agent, args: [prompt] }
}

const buildPrompt = (skillName: string, agent: string): string => {
  const skillDir = agentSkillsDir(agent)
  return `Run the skill ${skillName}. Follow the instructions in ${skillDir}/${skillName}/SKILL.md. The game source is in the current directory.`
}

class PipelineTUI {
  private states: StepState[]
  private currentStep = 0
  private outputLines: string[] = []
  private phase: Phase = "idle"
  private done = false
  private activeProc: ChildProcess | null = null
  private sidebarWidth = 30

  constructor(
    private agent: string,
    private gameDir: string,
  ) {
    this.states = skillsPipeline.map(() => "pending")
  }

  private get rows(): number {
    return process.stdout.rows || 24
  }

  private get cols(): number {
    return process.stdout.columns || 80
  }

  private get maxOutputLines(): number {
    return Math.max(this.rows - 4, 8)
  }

  private write(s: string) {
    process.stdout.write(s)
  }

  /** Draw the entire screen */
  private render() {
    const { rows, cols, sidebarWidth } = this
    const outputWidth = cols - sidebarWidth - 1
    let buf = ""

    buf += clearScreen()
    buf += moveTo(1, 1)

    // Top border
    buf += "╭" + "─".repeat(sidebarWidth - 2) + "┬" + "─".repeat(outputWidth - 1) + "╮"

    // Sidebar header
    buf += moveTo(2, 1)
    buf += "│ " + bold("Migration Pipeline") + " ".repeat(Math.max(0, sidebarWidth - 21)) + "│"

    // Output panel header
    const headerLabel = this.done
      ? "Done"
      : `${skillsPipeline[this.currentStep]?.name ?? ""} ${dim(`(${this.phase})`)}`
    const headerColor = phaseColor[this.phase]
    buf += " " + headerColor(bold(headerLabel))
    buf += " ".repeat(Math.max(0, outputWidth - this.stripAnsi(headerLabel).length - 2)) + "│"

    // Separator
    buf += moveTo(3, 1)
    buf += "├" + "─".repeat(sidebarWidth - 2) + "┼" + "─".repeat(outputWidth - 1) + "┤"

    // Content rows
    const contentRows = rows - 4 // top border + header + separator + bottom border
    for (let row = 0; row < contentRows; row++) {
      buf += moveTo(row + 4, 1)

      // Sidebar column
      const skillIndex = row
      if (skillIndex < skillsPipeline.length) {
        const skill = skillsPipeline[skillIndex]
        const state = this.states[skillIndex]
        const isActive = skillIndex === this.currentStep && !this.done
        const icon = stateIcon[state]
        const colorFn = stateColor[state]
        const label = `${icon} ${skill.name}${skill.optional ? " *" : ""}`
        const styled = isActive ? bold(colorFn(label)) : colorFn(label)
        const rawLen = this.stripAnsi(styled).length
        buf += "│ " + styled + " ".repeat(Math.max(0, sidebarWidth - rawLen - 3)) + "│"
      } else if (skillIndex === skillsPipeline.length + 1) {
        // Status line
        const completedCount = this.states.filter((s) => s === "success").length
        const failedCount = this.states.filter((s) => s === "failed").length
        const status = this.done
          ? failedCount > 0
            ? red(`${failedCount} failure(s)`)
            : green("All complete!")
          : dim(`${completedCount}/${skillsPipeline.length} done`)
        const rawLen = this.stripAnsi(status).length
        buf += "│ " + status + " ".repeat(Math.max(0, sidebarWidth - rawLen - 3)) + "│"
      } else if (skillIndex === skillsPipeline.length + 2) {
        buf += "│ " + dim("* = optional") + " ".repeat(Math.max(0, sidebarWidth - 15)) + "│"
      } else {
        buf += "│" + " ".repeat(sidebarWidth - 2) + "│"
      }

      // Output column
      const lineIndex = this.outputLines.length - contentRows + row
      const line = lineIndex >= 0 ? this.outputLines[lineIndex] ?? "" : ""
      const truncated = this.truncateVisible(line, outputWidth - 2)
      const visibleLen = this.stripAnsi(truncated).length
      buf += " " + truncated + " ".repeat(Math.max(0, outputWidth - visibleLen - 1)) + "│"
    }

    // Bottom border
    buf += moveTo(rows, 1)
    buf += "╰" + "─".repeat(sidebarWidth - 2) + "┴" + "─".repeat(outputWidth - 1) + "╯"

    this.write(buf)
  }

  /** Strip ANSI escape codes for length calculation */
  private stripAnsi(s: string): string {
    // oxlint-disable-next-line no-control-regex
    return s.replace(/\x1b\[[0-9;]*m/g, "")
  }

  /** Truncate a string to a visible width, preserving ANSI codes */
  private truncateVisible(s: string, maxWidth: number): string {
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
    // Include any trailing ANSI sequences (like reset codes) right after the cut point
    while (i < s.length && s[i] === "\x1b" && s[i + 1] === "[") {
      const end = s.indexOf("m", i)
      if (end !== -1) {
        i = end + 1
      } else break
    }
    return s.slice(0, i)
  }

  /** Parse stream-json output from claude, or plain text from other agents */
  private appendOutput(text: string) {
    const rawLines = text.split("\n").filter((l) => l.trim())
    for (const line of rawLines) {
      const parsed = this.parseStreamLine(line)
      if (parsed) {
        // Split multi-line parsed output into separate display lines
        for (const displayLine of parsed.split("\n")) {
          this.outputLines.push(displayLine)
        }
      }
    }
    // Keep buffer bounded
    if (this.outputLines.length > 500) {
      this.outputLines = this.outputLines.slice(-this.maxOutputLines)
    }
    this.render()
  }

  /** Format a tool use block into a display line */
  private formatToolUse(t: any): string {
    const name = t.name ?? "unknown"
    if (name === "Edit") return `${yellow("Edit")} ${t.input?.file_path ?? ""}`
    if (name === "Write") return `${yellow("Write")} ${t.input?.file_path ?? ""}`
    if (name === "Read") return `${yellow("Read")} ${t.input?.file_path ?? ""}`
    if (name === "Bash") return `${yellow("Bash")} ${t.input?.command ?? ""}`
    if (name === "Glob") return `${yellow("Glob")} ${t.input?.pattern ?? ""}`
    if (name === "Grep") return `${yellow("Grep")} ${t.input?.pattern ?? ""}`
    return `${yellow(name)}`
  }

  /** Extract human-readable text from a stream-json line, or pass through raw text */
  private parseStreamLine(line: string): string | null {
    try {
      const obj = JSON.parse(line)

      // Assistant messages - may contain text, tool_use, thinking, or a mix
      if (obj.type === "assistant" && obj.message?.content) {
        const content = obj.message.content as any[]
        const parts: string[] = []

        const texts = content.filter((c) => c.type === "text").map((c) => c.text)
        if (texts.length > 0) parts.push(texts.join(""))

        const toolUses = content.filter((c) => c.type === "tool_use")
        if (toolUses.length > 0) parts.push(toolUses.map((t) => this.formatToolUse(t)).join("\n"))

        // Thinking blocks - skip silently, they're just internal reasoning
        if (parts.length > 0) return parts.join("\n")
        if (content.some((c) => c.type === "thinking")) return null
        return null
      }

      // Content block delta (streaming text chunks)
      if (obj.type === "content_block_delta" && obj.delta?.text) {
        return obj.delta.text
      }

      // Standalone tool use event
      if (obj.type === "tool_use") {
        return this.formatToolUse(obj)
      }

      // User messages (tool results coming back)
      if (obj.type === "user") {
        const content = obj.message?.content as any[] | undefined
        if (!content) return null
        // Show file create/update results
        const result = obj.tool_use_result
        if (result?.type === "create") return dim(`Created ${result.filePath}`)
        if (result?.type === "update") return dim(`Updated ${result.filePath}`)
        return null
      }

      // Rate limit events - suppress
      if (obj.type === "rate_limit_event") return null

      // Tool results
      if (obj.type === "result") {
        const cost = obj.cost_usd ? ` ($${obj.cost_usd.toFixed(4)})` : ""
        return green(`Done${cost}`)
      }

      // System messages
      if (obj.type === "system") {
        if (obj.subtype === "init") return dim(`Session started`)
        if (obj.subtype === "hook_started") return null
        if (obj.subtype === "hook_response") return null
        return dim(`[system:${obj.subtype}]`)
      }

      // Show unrecognized types so we can add support
      return dim(`[${obj.type}${obj.subtype ? ":" + obj.subtype : ""}]`)
    } catch {
      // Not JSON - show as-is
      return line
    }
  }

  /** Spawn agent and stream output */
  private runAgent(prompt: string): Promise<boolean> {
    return new Promise((resolve) => {
      const { cmd, args } = buildAgentCmd(this.agent, prompt)
      const env: Record<string, string | undefined> = { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" }
      // Remove env vars that prevent nested claude sessions
      delete env.CLAUDECODE
      const proc = spawn(cmd, args, {
        cwd: this.gameDir,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      })

      this.activeProc = proc
      const debugLog = path.join(this.gameDir, "pipeline-debug.log")

      proc.stdout?.on("data", (data: Buffer) => {
        fs.appendFileSync(debugLog, data.toString())
        this.appendOutput(data.toString())
      })
      proc.stderr?.on("data", (data: Buffer) => {
        fs.appendFileSync(debugLog, `[stderr] ${data.toString()}`)
        this.appendOutput(data.toString())
      })

      proc.on("close", (code) => {
        fs.appendFileSync(debugLog, `\n[close] code=${code}\n`)

        this.activeProc = null
        resolve(code === 0)
      })
      proc.on("error", (err) => {
        this.appendOutput(`Error: ${err.message}`)
        this.activeProc = null
        resolve(false)
      })
    })
  }

  /** Run one pipeline step */
  private async runStep(stepIndex: number): Promise<boolean> {
    const skill = skillsPipeline[stepIndex]
    this.states[stepIndex] = "running"
    this.currentStep = stepIndex
    this.outputLines = []
    this.phase = "agent"
    this.render()

    const prompt = buildPrompt(skill.name, this.agent)
    let success = await this.runAgent(prompt)

    if (!success) {
      if (skill.optional) {
        this.states[stepIndex] = "skipped"
        this.render()
        return true
      }
      this.appendOutput("\n--- Retrying ---\n")
      success = await this.runAgent(prompt)
      if (!success) {
        this.states[stepIndex] = "failed"
        this.render()
        return false
      }
    }

    // Verify build
    this.phase = "build"
    this.render()
    this.appendOutput("Verifying build...")
    const buildResult = verifyBuild(this.gameDir)
    if (!buildResult.success) {
      this.appendOutput(`Build failed: ${buildResult.error}\nAsking agent to fix...`)
      const fixPrompt = `The vite build failed after running skill ${skill.name}. Fix the build errors:\n\n${buildResult.error}`
      await this.runAgent(fixPrompt)

      const retry = verifyBuild(this.gameDir)
      if (!retry.success) {
        if (skill.optional) {
          this.states[stepIndex] = "skipped"
          this.render()
          return true
        }
        this.states[stepIndex] = "failed"
        this.render()
        return false
      }
    }

    // Commit
    this.phase = "commit"
    this.render()
    try {
      runCommand("git add -A", { cwd: this.gameDir })
      gitCommit(`skill: ${skill.name}`, { cwd: this.gameDir })
      this.appendOutput("Committed.")
    } catch {
      this.appendOutput("No changes to commit.")
    }

    this.states[stepIndex] = "success"
    this.render()
    return true
  }

  /** Set up keyboard handling (Ctrl+C to quit) */
  private setupInput() {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true)
    }
    process.stdin.resume()
    process.stdin.on("data", (data: Buffer) => {
      // Ctrl+C
      if (data[0] === 3) {
        if (this.activeProc) this.activeProc.kill()
        this.cleanup()
        process.exit(0)
      }
    })
  }

  private cleanup() {
    this.write(showCursor())
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false)
    }
    process.stdin.pause()
  }

  /** Run the full pipeline */
  async run() {
    this.write(hideCursor())
    this.setupInput()
    this.render()

    // Redraw on terminal resize
    process.stdout.on("resize", () => this.render())

    for (let i = 0; i < skillsPipeline.length; i++) {
      const ok = await this.runStep(i)
      if (!ok) {
        this.appendOutput("\nPipeline stopped due to failure.")
        break
      }
    }

    this.phase = "idle"
    this.done = true
    this.render()
    this.cleanup()
  }
}

/** Render the pipeline TUI and wait for it to complete */
export const runPipelineTUI = async (agent: string, gameDir: string): Promise<void> => {
  const tui = new PipelineTUI(agent, gameDir)
  await tui.run()
}
