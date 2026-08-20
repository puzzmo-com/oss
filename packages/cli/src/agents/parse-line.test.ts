import fs from "node:fs"
import { describe, expect, it } from "vitest"

import { parseClaudeLine } from "./claude.js"
import { parseCodexLine } from "./codex.js"
import { parseCopilotLine } from "./copilot.js"
import { parseGeminiLine } from "./gemini.js"
import { mapOpencodeEvent } from "./opencode.js"
import type { AgentEvent } from "./types.js"

type LineParser = (line: string) => AgentEvent | AgentEvent[] | null

/** Reads a fixture .jsonl, running `parser` over each line and keeping the events it yields. */
const parseFixture = (name: string, parser: LineParser): AgentEvent[] => {
  const raw = fs.readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf-8")
  return raw
    .split("\n")
    .filter((l) => l.trim())
    .flatMap((line) => {
      const parsed = parser(line)
      if (!parsed) return []
      return Array.isArray(parsed) ? parsed : [parsed]
    })
}

describe("parseClaudeLine (real capture)", () => {
  it("maps a text + tool-use transcript", () => {
    expect(parseFixture("claude.jsonl", parseClaudeLine)).toEqual([
      { type: "system", text: "Session started" },
      { type: "text", text: "p" },
      { type: "text", text: "ong" },
      { type: "tool_use", name: "Write", summary: "/tmp/game/ping.txt" },
      { type: "tool_result", ok: true, summary: "Created /tmp/game/ping.txt" },
      { type: "result", ok: true, costUSD: 0.061597 },
    ])
  })

  // content_block_start announces each tool with an empty `input`, so a summary can only come
  // from the assistant message. Two Bash calls in one turn also exercise the multi-event return.
  it("summarizes bash commands and surfaces failed tools", () => {
    const events = parseFixture("claude-bash.jsonl", parseClaudeLine)
    expect(events.filter((e) => e.type !== "text" && e.type !== "thinking")).toEqual([
      { type: "system", text: "Session started" },
      { type: "tool_use", name: "Bash", summary: "ls -la" },
      { type: "tool_use", name: "Bash", summary: "node --version" },
      { type: "tool_result", ok: true, summary: "(Bash completed with no output)" },
      { type: "tool_result", ok: true, summary: "v24.19.0" },
      { type: "tool_use", name: "Write", summary: "/tmp/game/notes.txt" },
      { type: "tool_result", ok: true, summary: "Created /tmp/game/notes.txt" },
      { type: "tool_use", name: "Bash", summary: "cat /nope/missing.txt" },
      { type: "tool_result", ok: false, summary: "Exit code 1 cat: /nope/missing.txt: No such file or directory" },
      { type: "result", ok: true, costUSD: 0.072234 },
    ])
  })

  it("keeps multi-line commands and output on one line", () => {
    const toolUse = parseClaudeLine(
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Bash", input: { command: "cat <<'EOF' > a.txt\nhello\nEOF" } }] },
      }),
    )
    expect(toolUse).toEqual([{ type: "tool_use", name: "Bash", summary: "cat <<'EOF' > a.txt hello EOF" }])
  })
})

describe("parseCodexLine", () => {
  it("maps reasoning, commands, file changes and completion", () => {
    expect(parseFixture("codex.jsonl", parseCodexLine)).toEqual([
      { type: "system", text: "Thread started" },
      { type: "thinking", text: "**Scanning docs for exec JSON schema**\n" },
      { type: "tool_result", ok: true, summary: "bash -lc ls" },
      { type: "tool_result", ok: true, summary: "add docs/exec-json-cheatsheet.md, update docs/exec.md" },
      { type: "text", text: "Done. I updated the docs and added examples.\n" },
      { type: "result", ok: true },
    ])
  })
})

describe("parseGeminiLine", () => {
  it("maps thinking delta, tool call, text and a costed result", () => {
    expect(parseFixture("gemini.jsonl", parseGeminiLine)).toEqual([
      { type: "system", text: "Session started" },
      { type: "thinking", text: "Let me list the files" },
      { type: "tool_use", name: "Bash", summary: "echo hello" },
      { type: "tool_result", ok: true, summary: "hello" },
      { type: "text", text: "The command output `hello`.\n" },
      { type: "result", ok: true, costUSD: 0.0025 },
    ])
  })
})

describe("parseCopilotLine", () => {
  it("maps reasoning/message deltas, a tool call and turn end", () => {
    expect(parseFixture("copilot.jsonl", parseCopilotLine)).toEqual([
      { type: "thinking", text: "thinking chunk text" },
      { type: "text", text: "Here are " },
      { type: "text", text: "the files." },
      { type: "tool_use", name: "bash", summary: "ls -la" },
      { type: "tool_result", ok: true, summary: "total 0\ndrwxr-xr-x  2 user  staff" },
      { type: "result", ok: true },
    ])
  })
})

describe("mapOpencodeEvent (SSE objects, not JSONL)", () => {
  const sid = "ses_1"
  it("maps a text delta", () => {
    const ev = { type: "message.part.updated", properties: { part: { type: "text" }, delta: "hi" } }
    expect(mapOpencodeEvent(ev, sid)).toEqual([{ type: "text", text: "hi" }])
  })
  it("maps a completed tool part", () => {
    const ev = {
      type: "message.part.updated",
      properties: { part: { type: "tool", tool: "bash", state: { status: "completed", input: { command: "ls" } } } },
    }
    expect(mapOpencodeEvent(ev, sid)).toEqual([{ type: "tool_result", ok: true, summary: "ls" }])
  })
  it("maps a session error scoped to our session", () => {
    const ev = { type: "session.error", properties: { sessionID: sid, error: { message: "boom" } } }
    expect(mapOpencodeEvent(ev, sid)).toEqual([{ type: "error", message: "boom" }])
  })
})

// Contract shared by every line-based adapter: parsing never throws, unknown
// lines are dropped (not crashed on), and a transcript ends in exactly one result.
describe("parser contract", () => {
  const cases: [string, string, LineParser][] = [
    ["claude", "claude.jsonl", parseClaudeLine],
    ["claude (bash)", "claude-bash.jsonl", parseClaudeLine],
    ["codex", "codex.jsonl", parseCodexLine],
    ["gemini", "gemini.jsonl", parseGeminiLine],
    ["copilot", "copilot.jsonl", parseCopilotLine],
  ]

  it.each(cases)("%s: emits exactly one terminal result event", (_name, fixture, parser) => {
    const events = parseFixture(fixture, parser)
    expect(events.filter((e) => e.type === "result")).toHaveLength(1)
    expect(events.at(-1)?.type).toBe("result")
  })

  it.each(cases)("%s: tolerates malformed JSON without throwing", (_name, _fixture, parser) => {
    expect(() => parser("this is not json")).not.toThrow()
    // Unparseable lines surface as a system event rather than crashing the stream.
    expect(parser("this is not json")).toEqual({ type: "system", text: "this is not json" })
  })
})
