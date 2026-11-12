---
name: add-achievements
description: Add achievements to a repeat-play game (log rounds, write the server bundle that measures them) and debug why one did or didn't unlock, using the workshop.puzzmo.com MCP
---

# Add Achievements

Achievements are for repeat-play games, played over and over one puzzle after another. Puzzmo decides every unlock: the game logs what the player did in each round, Puzzmo replays that log through the game's **server bundle** to measure it, and achievement rules read the measurements. Your code is the logging and the server bundle. The achievements themselves (names, tiers, rules) live on Puzzmo so players can't read them out of the game; you draft them as a file and Puzzmo imports it.

## Finding the token

The user's access tokens live in `~/.puzzmo/config.json` as `pzt-`-prefixed JWTs. Read every token, call the `list_accessible_games` MCP tool with all of them, and use the one whose games include the `game.slug` from the user's `puzzmo.json`. If none match, ask the user to create a token in Workshop (team Settings → Access Tokens).

## Steps

1. Call `get_achievements_status` to see where the game is: whether its build has a server bundle and what that measures, which achievements exist and any problems with their rules, and the team's recent rounds. It reads the staged build (what the team plays before it ships) unless you pass `build: "live"`.

2. Log rounds in the game client with the SDK:
   - `sdk.rounds.start({ reason: "new", puzzleKey })` as each puzzle begins, `reason: "reset"` when the player restarts it.
   - `sdk.rounds.log([msSinceRoundStart, "move", 3, 7])` for everything needed to replay the round: each move, draw, undo. An event is its time, then up to seven numbers, booleans, nulls or strings of at most 64 characters. Put the event's kind first after the time.
   - `sdk.completeRepeatableRun()` on a win.

3. Write `src/serverBundle.ts`. Import from `@puzzmo/sdk/bundles`, not `@puzzmo/sdk`, as it doesn't run in a browser:

   ```ts
   import { createServerBundle } from "@puzzmo/sdk/bundles"

   export default createServerBundle({
     achievements: {
       describe: () => ({
         contract: 1,
         facts: {
           won: { type: "boolean", about: "Every card ended up home" },
           moves: { type: "number", about: "Moves made, restarts included" },
         },
         counters: { fewestWinningMoves: { from: "moves", op: "min", when: "won", windows: ["lifetime", "puzzle"] } },
         events: { move: { about: "Moved cards", values: ["from", "to", "count"] } },
       }),
       replayRound: ({ puzzle, log, outcome }, config) => {
         const board = startingBoard(puzzle)
         for (const [i, event] of log.entries())
           if (!applyEvent(board, event)) {
             if (config.purpose === "debug") console.log(`board before event ${i}:`, describeBoard(board))
             return { valid: false, reason: `Event ${i} (${JSON.stringify(event)}) isn't a legal move` }
           }
         if (outcome === "completed" && !isWon(board)) return { valid: false, reason: "The log doesn't end on a win" }
         return { valid: true, facts: { won: isWon(board), moves: board.moves } }
       },
     },
   })
   ```

   - Reuse the game's own rules engine rather than writing a second one, so the replay can't disagree with play.
   - It runs with no DOM, network or filesystem, 2 seconds and 128 MB per call, with `Date` and `Math.random` fixed per round.
   - Return `{ valid: false, reason }` rather than throwing, and give each fact a type and an `about` line.
   - Name each event kind the game logs in `events`, with a name for each value after the kind (at most six). It's optional and changes nothing about how a round is measured, but Workshop shows the log in those words and `explain_round` hands them over with it.
   - Check that a `completed` round's log really ends on a win: a player who reloads mid-puzzle leaves a log cut short.
   - Log extra detail when `config.purpose === "debug"`. Those logs show up in `explain_round` and in Workshop, never to players.

4. Add `serverBundlePlugin()` to the game's Vite plugins (from `@puzzmo/sdk/vite`) and build. Check that `dist-server/server-bundle.js` appears beside `dist`, never inside it.

5. Test `replayRound` locally with the game's test runner, on hand-written logs to start with. Once the team has played real rounds (step 7), pull them as fixtures:

   ```sh
   npx @puzzmo/cli rounds pull --game <slug>
   ```

   This writes each of the team's traced rounds to `fixtures/rounds/` as JSON holding `input` and `config` (exactly what Puzzmo passed to `replayRound`), `expected` (what that build answered) and `clock`. A test can run all of them:

   ```ts
   import { readdirSync, readFileSync } from "node:fs"
   import { expect, it, vi } from "vitest"

   import bundle from "../src/serverBundle"

   const dir = new URL("../fixtures/rounds/", import.meta.url)
   for (const name of readdirSync(dir).filter((file) => file.endsWith(".json")))
     it(`replays ${name}`, () => {
       const fixture = JSON.parse(readFileSync(new URL(name, dir), "utf8"))
       vi.setSystemTime(fixture.clock.now)
       expect(bundle.achievements!.replayRound(fixture.input, fixture.config)).toEqual(fixture.expected)
     })
   ```

   When you change what `replayRound` measures on purpose, update the expectations to match, and say why in the commit.

6. Upload with `npx @puzzmo/cli games upload`. It refuses a server bundle whose `describe()` Puzzmo can't use and lists every problem. It also warns when a live achievement reads a fact or counter the new build doesn't provide. Treat those warnings as bugs: rename the fact back, or ask Puzzmo to change the rule. The upload prints its build ID and is staged for the team before it goes live.

7. Ask the user to play a round or two on puzzmo.com, signed in as themselves. Only team members' rounds are traced, the last ten each. Then call `list_achievement_rounds`. After uploading a change to `replayRound`, call `replay_round` with `all: true` to run every traced round through the staged build: `summary.noLongerVerify` and `flips` are the regressions to look at before it ships.

8. To answer "why didn't this unlock?", call `explain_round` with the achievement's `stableID` (leave out `at` for the latest round). It goes through the checks Puzzmo makes, in order: the achievement is live and offered, the round verified, the player didn't already hold it, then the rule. A rule that fails is split at its `&&` and `||` to show which part failed and what each name it reads came to. Pass `includeEvents` to see what the player did, or `eventsFrom` and `eventsTo` for a few events either side of one `replayRound` rejected; `events.kinds` says what each kind among them means. Common causes:
   - The round didn't verify: the `reason` is your `replayRound`'s, so fix the replay and test it against the fixture.
   - The rule reads a name with no value: a fact renamed in `describe()`, or a typo in the rule.
   - The player already held it: unlocks are once per player per game.

9. To draft achievements, write a file in this shape and check it with `validate_achievements` (`build: "staged"` checks the rules against the build you just uploaded):

   ```json
   {
     "game": "<game slug>",
     "team": "<team slug>",
     "achievements": [
       {
         "stableID": "efficient",
         "name": "Efficient",
         "description": "Win a deal in under 100 moves",
         "icon": "⚡",
         "tier": "basic",
         "unlockExp": "round.won && round.moves < 100"
       }
     ]
   }
   ```

   - Rules can read `round.*` (your facts), `game.player.*` and `game.everyone.*` (your counters), and Puzzmo's own names, which `get_achievements_status` lists under `vocabulary`.
   - Tiers are basic, fancy, rare and mythic. `status` defaults to draft, and `timing: "duringRound"` marks one that can unlock mid-round.
   - Use `evaluate_expression` against the team's rounds to tune a threshold before settling on it.
   - `problems` stop the import. `warnings` mean it imports but won't unlock on that build. Leave `siteMapping` out unless Puzzmo asks for it.
   - Give the file to the user to send to Puzzmo, who import it. Nothing here writes achievements.

10. Once a build with the server bundle is live and the game's achievements are in, mark "Achievements" done with `set_game_features`.

## Limits

- `replay_round` runs in Puzzmo's sandbox and is capped per team (40 a minute, 400 an hour), so loop on the local fixtures and use it to check a staged build. It keeps each round's totals as they were, so rules reading counters won't move.
- A round's log over 64 KB isn't kept, so it can't be explained in full or pulled as a fixture.
- Rules are evaluated as they are today, so an achievement edited since a round shows its new verdict.
