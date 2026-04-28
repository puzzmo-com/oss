---
name: introduce-puzzmo-sdk
description: Integrate the Puzzmo SDK into a Vite game project for host communication
---

# Introduce Puzzmo SDK

Add the `@puzzmo/sdk` package and wire up the game lifecycle.

## Steps

1. Install `@puzzmo/sdk`:

   ```
   Install `@puzzmo/sdk` using the project's package manager (e.g. npm, yarn, pnpm).
   ```

2. In the main game entry file, import and initialize the SDK:

   ```ts
   import { createPuzzmoSDK } from "@puzzmo/sdk"

   const sdk = createPuzzmoSDK()
   ```

3. Replace the game's initialization flow with the SDK lifecycle:

   ```ts
   // Wait for puzzle data from the host
   const { puzzleString, inputString, theme, completed } = await sdk.gameReady()

   // Parse puzzle data and set up the game
   const puzzle = JSON.parse(puzzleString)
   initializeGame(puzzle)

   // If there's saved state, restore it
   if (inputString) restoreState(inputString)

   // Apply the Puzzmo theme colors
   if (theme) applyTheme(theme)

   // Signal that the game is ready to start
   sdk.gameLoaded()
   ```

4. Handle the `start` event to trigger the game start:

   ```ts
   sdk.on("start", () => {
     startGame()
   })
   ```

5. Wire up other lifecycle events if there is relevant game logic for pause/resume/retry:

   ```ts
   sdk.on("pause", () => {
     /* pause game was triggered, system timer auto-pauses */
   })
   sdk.on("resume", () => {
     /* resume game was triggered, system timer auto-resumes */
   })
   sdk.on("retry", () => {
     /* retry game was triggered, system timer auto-resets, */
   })
   ```

6. Wire up state saving - call `sdk.updateGameState(stateString)` whenever the game state changes so the host can save progress.

7. Create puzzle fixture files for local testing. Make a `fixtures/puzzles/` directory and add a few different puzzle JSON files that exercise different aspects of the game:

   ```
   fixtures/puzzles/
     easy/
       small-grid.json
       basic.json
     hard/
       large-grid.json
       tricky.json
   ```

   Each JSON file should contain puzzle data in the format the game expects. Try to create at least 2-3 puzzles with different characteristics (e.g. varying difficulty, size, or edge cases) so the game can be tested against realistic variety.

   If the original game already has a few puzzles hardcoded, use those as a starting point for creating the fixture files. Then delete the buttons which may have been used to load them, since the simulator will handle loading puzzles from the fixtures.

8. Set up the dev simulator for local testing. Add the Vite plugin to `vite.config.ts`:

   ```ts
   import { defineConfig } from "vite"
   import { puzzmoSimulator } from "@puzzmo/sdk/vite"

   export default defineConfig({
     plugins: [
       puzzmoSimulator({
         fixturesGlob: "/fixtures/puzzles/**/*.json",
       }),
     ],
   })
   ```

   The plugin automatically:
   - Injects the simulator UI in dev mode only (tree-shaken from production builds)
   - Loads fixtures from the glob pattern, organized by folder as categories
   - Handles OAuth callback routing for authenticated API features

   For non-Vite setups, load the SDK and simulator from jsDelivr:

   ```html
   <script>
     window.SIMULATOR_CONFIG = { slug: "my-game" }
   </script>
   <script src="https://cdn.jsdelivr.net/npm/@puzzmo/sdk/dist/simulator/standalone.js"></script>
   ```

## Key SDK APIs

- `sdk.gameReady()` - Async. Sends READY, waits for puzzle data. Returns `{ puzzleString, inputString, theme, completed }`.
- `sdk.gameLoaded()` - Signals game is ready. Host will send START_GAME.
- `sdk.on(event, handler)` - Listen for lifecycle events: `start`, `pause`, `resume`, `retry`, `settingsUpdate`.
- `sdk.updateGameState(stateString)` - Save current game state.
- `sdk.timer` - Auto-managed timer with `.timeMs()`, `.timeSecs()`, `.display()`, `.addPenalty(ms)`.

## Success Criteria

- The `build` script completes without errors
- Game initializes through SDK lifecycle (gameReady -> gameLoaded -> on start)
- Game state is saved via `updateGameState` on each user action
- Pause/resume/retry events are handled
- Fixture puzzles exist in `fixtures/puzzles/` with at least 2-3 varied puzzles
- Simulator appears in dev mode but is not included in production builds
