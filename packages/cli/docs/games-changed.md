# `puzzmo games changed`

Find out **which of your games have changed since their last deployed build** — so your CI can
build and upload only the games that actually changed, instead of rebuilding everything.

## How it works

From anywhere in your repository, the command:

1. Finds every `puzzmo.json` under the current directory (each one marks a game project).
2. Looks up each game's currently-deployed build and reads the commit it was built from.
3. Runs a `git diff` between that commit and your current checkout, scoped to each game's folder.
4. Reports which game folders changed.

The result is a list of folders you can feed straight into a build-and-deploy step.

## Usage

```text
puzzmo games changed [dir] [options]
```

| Argument | Description                                             |
| -------- | ------------------------------------------------------- |
| `dir`    | Directory to scan for games. Defaults to `.` (current). |

### Options

| Option                  | Description                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| `--list`                | Print only the changed game folders, one per line. Ideal for shell loops.                   |
| `--json`                | Print a JSON report with full detail for every game (changed or not).                       |
| `--matrix`              | Print a GitHub Actions matrix of the changed games, ready for `strategy.matrix`.            |
| `--ref <ref>`           | Compare against this git ref instead of your current checkout (`HEAD`).                     |
| `--against <which>`     | Which deployed build to use as the baseline: `latest` (default), `next`, `previous`.        |
| `--include-uncommitted` | Also count uncommitted working-tree changes. Useful when running locally before committing. |

`latest` is the build your team currently sees — the staged "next" build when you have one
waiting, otherwise the live one. That is almost always the right baseline for "what do I still
need to ship". Use `next` or `previous` to target a specific slot.

## Output formats

### Default (human-readable)

A table of every game with its slug, the build it was compared against, its status, and how many
files changed.

### `--list`

The folder of every changed game, one per line — nothing else. Empty output means there is
nothing to build:

```text
games/minesweeper
games/sudoku
```

### `--json`

An array with one entry per discovered game:

```json
[
  {
    "slug": "minesweeper",
    "displayName": "Minesweeper",
    "teamID": "team-abc",
    "dir": "games/minesweeper",
    "baseSha": "a1b2c3d",
    "ref": "e4f5a6b",
    "status": "changed",
    "changedFiles": 7
  },
  {
    "slug": "wordbind",
    "displayName": "Wordbind",
    "teamID": "team-abc",
    "dir": "games/wordbind",
    "baseSha": "9f8e7d6",
    "ref": "e4f5a6b",
    "status": "unchanged",
    "changedFiles": 0
  }
]
```

| Field          | Description                                                                                |
| -------------- | ------------------------------------------------------------------------------------------ |
| `slug`         | The game's slug, from its `puzzmo.json`.                                                   |
| `displayName`  | The game's display name, from its `puzzmo.json`.                                           |
| `teamID`       | The owning team, from its `puzzmo.json`.                                                   |
| `dir`          | The game's folder, relative to the repo root. Pass this to your build step.                |
| `baseSha`      | The commit the deployed build was made from. `null` if the game was never deployed.        |
| `ref`          | The commit you compared against (your checkout, or `--ref`).                               |
| `status`       | `changed`, `unchanged`, `new` (never deployed — build it), or `skipped` (no usable token). |
| `changedFiles` | How many files differ inside the game's folder.                                            |
| `skipReason`   | Why the game was skipped. Only present on `skipped` entries.                               |

### `--matrix`

A GitHub Actions matrix containing only the games that need building. When nothing changed it
prints `{"include":[]}`, which makes a job using it skip automatically:

```json
{ "include": [{ "dir": "games/minesweeper", "slug": "minesweeper" }] }
```

## Authentication

The command only works with your own games, so it needs a token:

- Run `puzzmo login <token>` once on your machine, **or**
- Set the `PUZZMO_TOKEN` environment variable (best for CI). Optionally set `PUZZMO_API_URL`
  to target a different server (defaults to `https://api.puzzmo.com`).

```yaml
env:
  PUZZMO_TOKEN: ${{ secrets.PUZZMO_TOKEN }}
```

When a repo holds games from more than one team, add a token per team with `PUZZMO_TOKEN_<NAME>`.
`<NAME>` is just a label; each token states its own team and the CLI matches it to each game's
`puzzmo.json`. A per-token server can be set with `PUZZMO_API_URL_<NAME>`.

```yaml
env:
  PUZZMO_TOKEN_ACME: ${{ secrets.PUZZMO_TOKEN_ACME }}
  PUZZMO_TOKEN_ZENITH: ${{ secrets.PUZZMO_TOKEN_ZENITH }}
```

Games whose team has no usable token are reported as `skipped` and left out of `--list` and
`--matrix`, so CI only builds what it can actually upload. The skipped games and the reason are
printed to stderr.

## Using it in CI

### Make sure git history is available

The command compares against the commit your build was deployed from, which is usually older than
the latest one. Most CI systems do a **shallow** checkout that only includes recent commits, so
that older commit won't be present and the comparison will fail.

Tell your checkout to fetch full history. With GitHub Actions:

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0 # fetch full history so the deployed build's commit is available
```

If a deployed build's commit still can't be found, the command stops with an error rather than
guessing — so you'll know to deepen your checkout.

### Exit codes

| Code | Meaning                                                                                   |
| ---- | ----------------------------------------------------------------------------------------- |
| `0`  | Ran fine. There may or may not be changes — look at the output to decide what to build.   |
| `1`  | Something went wrong: a `puzzmo.json` couldn't be read, or a deployed build wasn't found. |

A game with no usable token is a skip, not an error, so it does not affect the exit code. Missing
tokens entirely (nothing saved and nothing in the environment) still exits `1`.

Decide whether to deploy based on the **output** (e.g. an empty list or matrix), not the exit code.

### Examples

```bash
# See a summary of every game under the repo
puzzmo games changed

# Build each changed game
for dir in $(puzzmo games changed --list); do
  yarn --cwd "$dir" build
done

# Only look at games inside a subfolder
puzzmo games changed games/word-games --list
```

### Full GitHub Actions workflow

Detect changed games once, then build and upload each one in parallel:

```yaml
name: Deploy changed games
on:
  push:
    branches: [main]

jobs:
  detect:
    runs-on: ubuntu-latest
    outputs:
      matrix: ${{ steps.changed.outputs.matrix }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # full history so deployed builds' commits are available
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: yarn install --immutable
      - id: changed
        env:
          PUZZMO_TOKEN: ${{ secrets.PUZZMO_TOKEN }}
        run: echo "matrix=$(yarn puzzmo games changed --matrix)" >> "$GITHUB_OUTPUT"

  deploy:
    needs: detect
    if: ${{ fromJSON(needs.detect.outputs.matrix).include[0] != null }} # skip when nothing changed
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix: ${{ fromJSON(needs.detect.outputs.matrix) }}
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: yarn install --immutable
      - name: Build ${{ matrix.slug }}
        run: yarn --cwd "${{ matrix.dir }}" build
      - name: Upload ${{ matrix.slug }}
        env:
          PUZZMO_TOKEN: ${{ secrets.PUZZMO_TOKEN }}
        run: yarn puzzmo games upload "${{ matrix.dir }}"
```

Uploading a game records the commit it was built from, so the next `games changed` run uses it as
the new baseline.

## Related commands

`puzzmo games` groups the commands that work across all the games in your repo:

| Command                 | What it does                                               |
| ----------------------- | ---------------------------------------------------------- |
| `puzzmo games changed`  | Report which game folders changed since their last deploy. |
| `puzzmo games validate` | Check every `puzzmo.json` against the schema.              |
| `puzzmo games upload`   | Build-output upload and `puzzmo.json` sync for each game.  |
