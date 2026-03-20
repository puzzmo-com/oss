# create-puzzmo

Scaffold a new Puzzmo game project.

```bash
yarn create puzzmo game
npm create puzzmo game
pnpm create puzzmo game
```

## What it does

This is a thin shim that forwards to the `puzzmo game create` command from `@puzzmo/cli`. If the CLI isn't installed, it will be installed automatically.

## Options

All options are forwarded to `puzzmo game create`:

```bash
yarn create puzzmo game [accesstoken] --name <name> --url <url> --agent <agent>
```

<!-- cspell:ignore accesstoken -->

| Option            | Description                                              |
| ----------------- | -------------------------------------------------------- |
| `[accesstoken]`   | Optional Puzzmo API token for deployment setup           |
| `--name <name>`   | Game name (prompted if not provided)                     |
| `--url <url>`     | Source URL to import an HTML game from                   |
| `--agent <agent>` | LLM agent to use: `claude`, `codex`, `gemini`, or `none` |

## Workflow

1. Asks for a game name
2. Selects creation mode (currently: import from HTML page)
3. Downloads the HTML page and all referenced assets
4. Detects installed LLM agents (Claude Code, Codex, etc.)
5. Installs Puzzmo migration skills
6. Runs an automated pipeline that converts the game step-by-step:
   - Convert to Vite
   - Integrate Puzzmo SDK
   - Wire up game completion
   - Apply Puzzmo theme tokens
   - Add gameplay statistics (deeds)
   - Configure leaderboards
   - Create app metadata
   - Set up deployment

Each step is verified with a build check and committed to git.
