# @puzzmo/cli

Command-line tool for Puzzmo game developers. Authenticate, upload game builds, and create new game projects.

## Install

```bash
npm install -g @puzzmo/cli
```

## Commands

### `puzzmo login <token>`

Save a CLI auth token. Generate one from studio.puzzmo.com.

```bash
puzzmo login pzt-your-token-here
```

### `puzzmo games upload <dir>`

Upload a game build directory to Puzzmo. The game slug is read from `puzzmo.json` in the build directory.

```bash
puzzmo games upload dist/
```

The command collects all files in the directory, validates the `puzzmo.json`, computes a SHA from git (or file contents), and uploads them in batches.

### `puzzmo games validate [dir]`

Validate every `puzzmo.json` under `dir` (defaults to the current directory) against the schema, without uploading anything.

```bash
puzzmo games validate
```

> The older `puzzmo upload` and `puzzmo validate` (without `games`) still work as aliases, but the `puzzmo games …` forms are preferred.

### `puzzmo game create [token]`

Interactive wizard to create a new Puzzmo game project.

```bash
puzzmo game create --name my-game --url https://example.com/game/
```

Options:

| Option            | Description                                               |
| ----------------- | --------------------------------------------------------- |
| `[token]`         | Optional access token (runs `puzzmo login` automatically) |
| `--name <name>`   | Game name                                                 |
| `--url <url>`     | Source URL to import                                      |
| `--agent <agent>` | LLM agent: `claude`, `codex`, `gemini`, `none`            |

The wizard:

1. Downloads the source HTML page and assets
2. Detects installed LLM coding agents
3. Installs migration skills via the Vercel skills ecosystem
4. Runs each skill through the selected agent with build verification
5. Commits after each successful step

## Configuration

Config is stored in `~/.puzzmo/config.json`, one entry per server:

```json
{
  "tokens": [{ "source": "api.puzzmo.com", "token": "pzt-..." }]
}
```

Tokens can also come from the environment, which replaces the config file entirely:

| Variable                | Description                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `PUZZMO_TOKEN`          | A team access token                                                                      |
| `PUZZMO_TOKEN_<NAME>`   | Additional tokens, so one environment can cover several teams (e.g. `PUZZMO_TOKEN_ACME`) |
| `PUZZMO_API_URL`        | Server those tokens belong to (defaults to `https://api.puzzmo.com`)                     |
| `PUZZMO_API_URL_<NAME>` | Server for `PUZZMO_TOKEN_<NAME>` specifically                                            |

`<NAME>` is only a label — each token states its own team, and the CLI picks the token whose team matches the game's `puzzmo.json`.

## Also available via

```bash
yarn create puzzmo game
```

This uses the `create-puzzmo` package which forwards to `puzzmo game create`.
