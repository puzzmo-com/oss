---
name: write-game-help
description: Write or revise a game's in-game help (the how-to-play page players see beside the game) as a Markdown file synced from puzzmo.json
---

# Write Game Help

Every game on Puzzmo has a help page. It is Markdown, shown in the Instructions panel beside the game, and it is often the first thing a new player reads. New games start with a placeholder template (a goal, controls and tips), which players see until someone replaces it.

The help lives in the game's repo as a Markdown file, named by `game.helpPath` in `puzzmo.json` (like `game.iconPath` for the icon). Every `puzzmo games upload` sends the file along and replaces the game's help with it, live straight away, and nobody at Puzzmo reviews it first. Only upload text the user has read and approved.

## Finding the token

The user's access tokens live in `~/.puzzmo/config.json` as `pzt-`-prefixed JWTs. Read every token, call the `list_accessible_games` MCP tool with all of them, and use the one whose games include the `game.slug` from the user's `puzzmo.json`. If none match, ask the user to create a token in Workshop (team Settings → Access Tokens).

## Steps

1. Call `get_game_help` with the token and `gameSlug`.
   - `bodyMD` is the help players see today. If `isPlaceholder` is false and `puzzmo.json` has no `helpPath` yet, the user wrote it in Workshop: start the file from that text and revise it, rather than starting over. Keep anything they wrote on purpose.
   - `oneliner` and `description` are how the game introduces itself elsewhere on Puzzmo. The help should agree with them.
   - `examples` are help pages from two of Puzzmo's own games. Read them for tone, length and structure; don't copy their wording.

2. Learn the rules from the game itself, not from memory or the game's name. Read:
   - The game's README and any design notes.
   - The code which decides when a move is legal, when the puzzle is solved, and how it is scored.
   - The input handling, for every control: taps, drags, buttons and keyboard shortcuts.
   - The puzzle format and a few files in `fixtures/puzzles/`, to see what varies between puzzles.
   - The `integrations` block in `puzzmo.json`. If it has a `checklists` entry with `type: "tutorial"`, new players see that tutorial before the help. Make sure the two teach the same thing, and don't repeat the tutorial's steps word for word.

   Anything you can't confirm in the code, ask the user rather than guessing.

3. Write the page to `help.md` next to `puzzmo.json` (or edit the file `helpPath` already names). Structure:
   - `# How to play <Game name>`
   - A short opening paragraph: the goal of a puzzle in one or two sentences, so someone who reads nothing else still knows what they are trying to do.
   - `## Controls`: each action as a bullet, covering touch and mouse first, then keyboard shortcuts if the game has them.
   - `## Rules` (only if there are rules beyond the goal): what makes a move legal, what ends the puzzle.
   - `## Scoring` (only if the game scores): what earns points and what costs them, in the game's own terms.
   - `## Tips`: two to four things a good player notices, for someone stuck on their first puzzle.

   Headings use sentence case ("How to play", "Keyboard shortcuts").

4. Keep it readable in the panel:
   - The panel is a narrow sidebar, and on phones it is the full screen width. Use short paragraphs and bullets, not tables or wide code blocks.
   - Aim for about 150–400 words. If it runs longer, the rules probably need simplifying, or a tutorial checklist would teach them better. The upload rejects anything over 20,000 characters.
   - Use the names the game's UI uses for things (pieces, buttons, modes). Bold a term the first time it appears.
   - Write for someone who has never seen the game. Explain every term you use.
   - Plain Markdown only: headings, paragraphs, lists, bold, italics and links. Images need a public HTTPS URL; only use one if the user has one hosted.

5. Set `"helpPath": "./help.md"` in the `game` block of `puzzmo.json` if it isn't there yet, and run `npx @puzzmo/cli games validate`. It fails if the path doesn't point at a file.

6. Show the user the draft and make any changes they ask for. Tell them that from now on the file is the source of truth: each upload replaces the help, so edits made under In-game help in Workshop will be overwritten by the next upload.

7. Once they approve it, upload with `npx @puzzmo/cli games upload`. The CLI prints "In-game help updated" when the help changed. The upload is rejected if the file is empty or still the placeholder template.

8. If the "Help editorial" item on `get_game_todo` isn't ticked yet, call `set_game_features` to mark it done.

## Success criteria

- Every rule and control in the help matches what the game's code does.
- A player who reads only the opening paragraph knows the goal.
- `puzzmo.json` names the file in `game.helpPath`, and `games validate` passes.
- The user approved the final text before uploading.
