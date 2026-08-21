// Drives the migration TUI with a scripted agent, so rendering changes can be eyeballed
// without paying for a real agent run.
// Run: yarn workspace @puzzmo/cli demo-tui
//
// Ctrl+C quits. Pass --fast to skip the typing delays, --fail to watch a step go red.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"

const { AGENTS } = await import("../lib/agents/index.js")
const { runPipelineTUI } = await import("../lib/tui/pipeline.js")
const { newSession } = await import("../lib/skills/step.js")

const fast = process.argv.includes("--fast")
const shouldFail = process.argv.includes("--fail")
const gameDir = seedGameDir()

// The registry is a plain object, so a demo agent can be slotted in from outside.
AGENTS.demo = { name: "demo", run: ({ prompt }) => replay(scriptFor(prompt)) }

await runPipelineTUI(
  {
    agent: "demo",
    gameDir,
    repoContext: "Demo repo context",
    // Cheap stand-ins for a real build, so the build phase renders without one.
    buildCmd: shouldFail ? "false" : "true",
    session: newSession(),
  },
  [
    { name: "port-source", skills: [], preamble: "Port the source.", skipBuild: true },
    { name: "puzzmo-lifecycle", skills: [], preamble: "Wire up the SDK." },
    { name: "thumbnail", skills: [], preamble: "Make a thumbnail.", skipBuild: true },
  ],
)

console.log(`\nDemo project: ${gameDir}`)

/** Events for one step. The middle step repeats an edit so the repeat-folding shows up. */
function scriptFor(prompt) {
  const file = `${gameDir}/src/main.ts`
  const events = [
    { type: "system", text: "Session started" },
    { type: "thinking", text: "Looking at what is already on disk.\n" },
    { type: "text", text: "I'll start by reading the existing source.\n" },
    { type: "tool_use", name: "Read", summary: file },
    { type: "tool_result", ok: true, summary: "1 import { createPuzzmoSDK } from '@puzzmo/sdk'" },
    { type: "text", text: "Now the port itself.\n" },
    { type: "tool_use", name: "Write", summary: `${gameDir}/src/puzzle.ts` },
    { type: "tool_result", ok: true, summary: `Created ${gameDir}/src/puzzle.ts` },
  ]

  // Five identical call/result pairs — the pane should fold these into one row.
  if (prompt.includes("Wire up the SDK")) {
    for (let i = 0; i < 5; i++) {
      events.push({ type: "tool_use", name: "Edit", summary: file })
      events.push({ type: "tool_result", ok: true, summary: `The file ${file} has been updated successfully.` })
    }
    events.push({ type: "text", text: "The lifecycle is wired up.\n" })
  }

  if (prompt.includes("thumbnail")) {
    events.push({ type: "tool_use", name: "Bash", summary: "npm run build" })
    events.push({ type: "tool_result", ok: false, summary: "Exit code 1" })
    events.push({ type: "text", text: "Retrying with the right script name.\n" })
  }

  events.push({ type: "result", ok: true, costUSD: 0.0421 })
  return events
}

/** Yields the scripted events, streaming text a word at a time like a real agent. */
async function* replay(events) {
  for (const event of events) {
    if (event.type === "text" || event.type === "thinking") {
      for (const word of event.text.split(/(?<= )/)) {
        yield { type: event.type, text: word }
        await pause(fast ? 0 : 45)
      }
      continue
    }
    yield event
    await pause(fast ? 0 : 320)
  }
}

// A declaration, not a const: the top-level await above runs before this line is reached.
function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** A throwaway git repo with enough in it that the project summary has something to say. */
function seedGameDir() {
  const dir = path.join(os.tmpdir(), "puzzmo-tui-demo")
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(path.join(dir, "src"), { recursive: true })
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "tui-demo", scripts: { build: "true" } }, null, 2))
  fs.writeFileSync(path.join(dir, "src", "main.ts"), "export const main = () => {}\n")
  // commitStep runs git add/commit, which needs a repo to land in.
  const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "ignore" })
  git("init", "-q")
  git("config", "user.email", "demo@example.com")
  git("config", "user.name", "Demo")
  git("add", "-A")
  git("commit", "-qm", "initial")
  return dir
}
