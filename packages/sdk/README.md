# @puzzmo/sdk

SDK for building games on the Puzzmo platform. Handles communication between your game and the Puzzmo host (puzzmo.com, embeds, native apps).

## Install

```bash
npm install @puzzmo/sdk
```

## Quick Start

```ts
import { createPuzzmoSDK } from "@puzzmo/sdk"

const sdk = createPuzzmoSDK()

// 1. Wait for puzzle data from Puzzmo
const { puzzleString, boardState, theme, completed } = await sdk.gameReady()

// 2. Set up your game with the puzzle data
const puzzle = JSON.parse(puzzleString)
initializeGame(puzzle)
if (boardState) restoreState(boardState)

// 3. Signal that you're ready
sdk.gameLoaded()

// 4. Listen for lifecycle events
sdk.on("start", () => startGameLoop())
sdk.on("pause", () => pauseGameLoop())
sdk.on("resume", () => resumeGameLoop())
sdk.on("retry", () => resetGame())
```

## API

### `createPuzzmoSDK(options?)`

Creates an SDK instance. Options:

- `timeout` - Timeout in ms waiting for puzzle data (default: 5000)

### Lifecycle

| Method                     | Description                                                                |
| -------------------------- | -------------------------------------------------------------------------- |
| `sdk.gameReady()`          | Async. Signals readiness, returns puzzle data and theme.                   |
| `sdk.gameLoaded(state?)`   | Signals game UI is ready. Host will send `start`.                          |
| `sdk.on(event, handler)`   | Listen for events: `start`, `pause`, `resume`, `retry`, `settingsUpdate`.  |
| `sdk.off(event, handler)`  | Remove an event listener.                                                  |

### Game State

| Method                                                      | Description                                                |
| ----------------------------------------------------------- | ---------------------------------------------------------- |
| `sdk.updateGameState(stateString, play?)`                   | Save current game state for persistence.                   |
| `sdk.gameCompleted(play, config?)`                          | Signal game completion with metrics and deeds.             |
| `sdk.showCompletionScreen(results, gameplay, showRetry?)`   | Show the Puzzmo completion UI.                             |
| `sdk.hitCheckpoint(name, config, augConfig?)`               | Signal a gameplay milestone (for ads, leaderboards).       |

### Timer

The SDK manages a timer automatically (starts on `start`, pauses on `pause`, resets on `retry`).

```ts
sdk.timer.timeMs()              // Elapsed time in ms
sdk.timer.timeSecs()            // Elapsed time in seconds
sdk.timer.display()             // ["1:23", "0:05"] (elapsed, penalty)
sdk.timer.addPenalty(5000)      // Add 5s penalty
sdk.timer.isPaused()            // Check if paused
sdk.timer.isRunning()           // Check if running
```

## Theme

The `theme` object from `gameReady()` contains color tokens for the current Puzzmo theme:

```ts
const { theme } = await sdk.gameReady()

// Key colors
theme.g_bg       // Game background
theme.fg         // Foreground text
theme.key        // Primary accent
theme.player     // Player color (blue)
theme.alt1       // Accent green
theme.alt2       // Accent yellow
theme.alt3       // Accent purple
theme.type       // "light" or "dark"
```

See the `Theme` type export for the full list of tokens.

## Deeds

Deeds are gameplay statistics sent on completion:

```ts
sdk.gameCompleted(metrics, {
  deeds: [
    { id: "moves", value: 42 },
    { id: "accuracy", value: 95 },
    { id: "streak", value: 8 },
  ],
})
```

The SDK automatically adds `points` and `time` deeds.

## Workshop Types

For games that support puzzle editing in Puzzmo Workshop:

```ts
import type { WorkshopBundle, ValidationReport } from "@puzzmo/sdk"

export const validator = {
  validate(data: string): ValidationReport {
    return { success: true, issues: [] }
  },
}
```
