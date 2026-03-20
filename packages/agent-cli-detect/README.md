# @puzzmo/agent-cli-detect

Detect installed AI coding agent CLI tools on the system. Works cross-platform (macOS, Linux, Windows) without shelling out to `which` or `where`.

## Install

```bash
npm install @puzzmo/agent-cli-detect
```

## Usage

```ts
import { detectAgentCLIs, detectAgentCLI } from "@puzzmo/agent-cli-detect"

// Find all installed agent CLIs
const agents = detectAgentCLIs()
for (const agent of agents) {
  console.log(`${agent.displayName}: ${agent.path}`)
}
// => Claude Code: /Users/you/.claude/bin/claude
// => Codex CLI: /usr/local/bin/codex

// Check for a specific agent
const claude = detectAgentCLI("claude")
if (claude) {
  console.log(`Found Claude Code at ${claude.path}`)
}
```

## Supported Agents

<!-- cspell:ignore sourcegraph auggie augmentcode kiro opencode PATHEXT -->

| ID         | Agent              | Binary     | Install                              |
| ---------- | ------------------ | ---------- | ------------------------------------ |
| `aider`    | Aider              | `aider`    | `pip install aider-chat`             |
| `amp`      | Amp (Sourcegraph)  | `amp`      | `npm i -g @sourcegraph/amp`          |
| `augment`  | Augment CLI        | `auggie`   | `npm i -g @augmentcode/auggie`       |
| `claude`   | Claude Code        | `claude`   | `npm i -g @anthropic-ai/claude-code` |
| `cline`    | Cline              | `cline`    | `npm i -g cline`                     |
| `codex`    | Codex CLI          | `codex`    | `npm i -g @openai/codex`             |
| `copilot`  | GitHub Copilot CLI | `copilot`  | `npm i -g @github/copilot`           |
| `cursor`   | Cursor             | `cursor`   | Install from cursor.com              |
| `gemini`   | Gemini CLI         | `gemini`   | `npm i -g @google/gemini-cli`        |
| `goose`    | Goose (Block)      | `goose`    | `brew install block-goose-cli`       |
| `kiro`     | Kiro CLI           | `kiro-cli` | Installer from kiro.dev              |
| `opencode` | OpenCode           | `opencode` | `npm i -g opencode-ai`               |

## How It Works

Instead of shelling out to `which` (Unix) or `where` (Windows), this package scans PATH directories directly using Node's `fs` module. On Windows, it checks all `PATHEXT` extensions (`.exe`, `.cmd`, etc.). It also checks well-known install locations for agents that install outside of PATH (e.g. `~/.claude/bin/claude`).

Results are sorted by binary modification time (most recent first), which is a rough proxy for "most actively used."

## API

### `detectAgentCLIs(): DetectedAgentCLI[]`

Returns all detected agent CLIs, sorted by most recently modified.

### `detectAgentCLI(id: string): DetectedAgentCLI | null`

Checks for a specific agent by registry ID.

### `agentRegistry: Record<string, AgentCLIDefinition>`

The full registry of known agents. You can extend this at runtime:

```ts
import { agentRegistry, detectAgentCLIs } from "@puzzmo/agent-cli-detect"

agentRegistry["my-agent"] = {
  displayName: "My Agent",
  binaries: ["my-agent"],
}

const agents = detectAgentCLIs() // now includes my-agent
```

### Types

```ts
type DetectedAgentCLI = {
  id: string // Registry key
  displayName: string // Human-readable name
  binary: string // Binary name found
  path: string // Full path to binary
  mtime: number // Last modified timestamp (ms)
}

type AgentCLIDefinition = {
  displayName: string
  binaries: string[]
  npmPackage?: string
  knownPaths?: string[]
}
```
