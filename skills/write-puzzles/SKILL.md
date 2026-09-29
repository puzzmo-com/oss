---
name: write-puzzles
description: Write new puzzles for a game and add them to its daily schedule using the workshop.puzzmo.com MCP
---

# Write Puzzles

A game's daily puzzles come from its puzzle pool: a folder of puzzle files which the scheduler drains in filename order. Each night it takes one file for the scheduled day `lookaheadDays` (about three weeks) ahead. This skill fills that pool.

Puzzles you upload go out to players without anyone at Puzzmo reviewing them. Only upload puzzles the user has asked for, and check them properly first.

## Finding the token

The user's access tokens live in `~/.puzzmo/config.json` as `pzt-`-prefixed JWTs. Read every token, call the `list_accessible_games` MCP tool with all of them, and use the one whose games include the `game.slug` from the user's `puzzmo.json`. If none match, ask the user to create a token in Workshop (team Settings → Access Tokens).

## Steps

1. Call `get_puzzle_schedule` with the token and `gameSlug`.
   - If `isScheduled` is false, nothing drains the pool. Tell the user to ask Puzzmo to set up a community pool schedule, then stop.
   - `poolFilenames` are the files already waiting. `poolLastsUntil` is the last day they cover; new uploads start the day after.
   - `unfilledDates` are days the scheduler has already passed without a puzzle. Uploading does not fill them on its own: after uploading, tell the user to press "Run scheduler" in the Scheduling section of the game's page in Workshop, which fills them from the pool first (and so moves `poolLastsUntil` earlier).
   - Work out how many puzzles are needed with the user, e.g. enough for `unfilledDates` plus the next month past `poolLastsUntil`.

2. Learn the puzzle format.
   - Call `get_puzzle_format` for recent real puzzles and the game's remixes.
   - Read the game's own puzzle parser and its `fixtures/puzzles/` folder. The platform treats the puzzle body as an opaque string, so the game's code is the only definition of what is valid.

3. Write the puzzles as files in the game's repo (e.g. `puzzles/2026-10/`), so the user can review and edit them.
   - Name files so they sort in the order they should be played, e.g. `2026-10-01-harbour.txt`. Pool files already waiting sort by upload time, so new files always go after them.
   - Don't add front matter (a `---` JSON block at the top of the file). Puzzmo only reads it for its own internal teams and strips it unread for everyone else.
   - Vary difficulty and theme across the batch the way the existing puzzles do.

4. Check the puzzle bodies with the game itself: run its parser or tests over every new file, and fix anything it rejects. If the game has no way to check a puzzle, write a small script which loads each file through the game's parsing code.

5. Call `validate_puzzles` with the files and fix every error it reports.

6. Show the user what you wrote and get their go-ahead, then upload:
   - With shell access, run `npx @puzzmo/cli puzzles upload <dir> --game <slug>`. It validates every file first and uploads nothing if any fail.
   - Otherwise call `upload_puzzles`, at most 100 files and about 900KB of content per call.

7. Call `get_puzzle_schedule` again and confirm `poolCount` and `poolLastsUntil` moved as expected. If `unfilledDates` is not empty, remind the user about "Run scheduler".

## Fixing mistakes

Files still in `poolFilenames` can be removed with `remove_pool_puzzles`, using the names exactly as listed there. They carry an upload-timestamp prefix, so they differ from the names you uploaded. Puzzles which have moved into `upcoming` are already scheduled; the user manages those on the game's page in Workshop.
