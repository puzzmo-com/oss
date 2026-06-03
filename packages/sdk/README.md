# Puzzmo Game Infra

Over the years we have a pretty refined route for making web games: prototype in HTML with no concern for code quality, share with people you like, then migrate it to a "real" codebase.

LLMs have changed this, and we're finding that the 'prototype in HTML' phase is getting close enough to production quality that it does not always warrant a a multi-month conversion to React/TypeScript/Redux to ensure the codebase can live forever.

So, after shipping two full games with this pipeline, we've knocked enough kinks out that it's ready for a more public space.

So, how do you make a game? Well first, you need a game idea - we can't help there! However, once you do, then you can start migrating it to run on Puzzmo by: `yarn create puzzmo game`.

## @puzzmo/sdk

This repo is the SDK for building games on the Puzzmo platform. Handles communication between your game and Puzzmo.

There are a few parts here!

1. The SDK, e.g. the runtime API for launching a game, completing it and other essentials
2. The simulator, which provides the same message sending infrastructure Puzzmo.com will send to your game
3. App integration information, e.g. how to make custom thumbnails for your puzzles (and more)
4. Vite plugins which can help you get up and running faster

## Install

```bash
npm install @puzzmo/sdk

yarn add @puzzmo/sdk
```

## Quick Start

```ts
import { createPuzzmoSDK } from "@puzzmo/sdk"

const sdk = createPuzzmoSDK()

// 1. Wait for puzzle data from Puzzmo
const { puzzleString, inputString, theme, completed } = await sdk.gameReady()

// 2. Set up your game with the puzzle data
const puzzle = JSON.parse(puzzleString)
initializeGame(puzzle)
if (inputString) restoreState(inputString)

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

| Method                    | Description                                                               |
| ------------------------- | ------------------------------------------------------------------------- |
| `sdk.gameReady()`         | Async. Signals readiness, returns puzzle data and theme.                  |
| `sdk.gameLoaded(state?)`  | Signals game UI is ready. Host will send `start`.                         |
| `sdk.on(event, handler)`  | Listen for events: `start`, `pause`, `resume`, `retry`, `settingsUpdate`. |
| `sdk.off(event, handler)` | Remove an event listener.                                                 |

### Game State

| Method                                                    | Description                                          |
| --------------------------------------------------------- | ---------------------------------------------------- |
| `sdk.updateGameState(stateString, play?)`                 | Save current game state for persistence.             |
| `sdk.gameCompleted(play, config?)`                        | Signal game completion with metrics and deeds.       |
| `sdk.showCompletionScreen(results, gameplay, showRetry?)` | Show the Puzzmo completion UI.                       |
| `sdk.hitCheckpoint(name, config, augConfig?)`             | Signal a gameplay milestone (for ads, leaderboards). |

### Timer

The SDK manages a timer automatically (starts on `start`, pauses on `pause`, resets on `retry`).

```ts
sdk.timer.timeMs() // Elapsed time in ms
sdk.timer.timeSecs() // Elapsed time in seconds
sdk.timer.display() // ["1:23", "0:05"] (elapsed, penalty)
sdk.timer.addPenalty(5000) // Add 5s penalty
sdk.timer.isPaused() // Check if paused
sdk.timer.isRunning() // Check if running
```

## Theme

The `theme` object from `gameReady()` contains color tokens for the current Puzzmo theme:

```ts
const { theme } = await sdk.gameReady()

// Key colors
theme.g_bg // Game background
theme.fg // Foreground text
theme.key // Primary accent
theme.player // Player color (blue)
theme.alt1 // Accent green
theme.alt2 // Accent yellow
theme.alt3 // Accent purple
theme.type // "light" or "dark"
```

See the `Theme` type export for the full list of tokens.

## Deeds

Deeds are gameplay statistics sent on completion:

```ts
sdk.gameCompleted(metrics, {
  deeds: [
    { id: "moves", value: 42 },
    { id: "accuracy", value: 95 },
    { id: "hit-streak", value: 8 },
  ],
})
```

The SDK automatically adds `points` and `time` deeds.

## On-Screen Keyboard

For games that need text input on touch devices, the SDK can show Puzzmo's on-screen keyboard.
The keyboard is only visible on touch devices — calling these methods on desktop is a no-op.

```ts
import { createPuzzmoSDK, defaultKeyboardConfig } from "@puzzmo/sdk"

const sdk = createPuzzmoSDK()

// Show the keyboard when the player selects an input
sdk.keyboard.show(defaultKeyboardConfig)

// Listen for key presses
sdk.on("keyboardKeyPress", ({ key }) => {
  if (key === "⌫") handleBackspace()
  else if (key === "↵") handleEnter()
  else handleLetter(key)
})

// Hide when input is dismissed
sdk.keyboard.hide()
```

`defaultKeyboardConfig` is a standard QWERTY layout with Enter and Backspace. Customize it by spreading:

```ts
// Disable letters that are no longer valid given the current game state
sdk.keyboard.show({ ...defaultKeyboardConfig, disabled: usedLetters })
```

For games with a spatial input model (e.g. selecting a grid cell by dragging across the keyboard),
enable drag cursor support and listen for the additional events:

```ts
sdk.keyboard.show({ ...defaultKeyboardConfig, supportsDragCursor: true })

sdk.on("keyboardCursorChange", ({ position }) => highlightCellAtPosition(position))
sdk.on("keyboardCursorEnd", () => confirmCellSelection())
```

See the `KeyboardConfig` type export and the `add-keyboard-support` skill for full field documentation.

## App Integration

For games to show a dynamic thumbnail, you will need an App Bundle

```ts
import type { EditorBundle, ValidationReport } from "@puzzmo/sdk"
import { puzzleToSVG } from "./src/puzzleToSVG"

export const AppBundle = {
  renderThumbnail(puzzleString, inputString, config) {
    return puzzleToSVG(puzzleString, inputString, config)
  },
} satisfies EditorBundle
```

This and the editor bundle are separate JavaScript files from your main game.

There are Vite plugins to make this easy, but otherwise, they should be files in your upload named `app-bundle.js` and `editor-bundle.js` with ESM exports which match the shapes of the TypeScript types.

### Thumbnail JSX

We have found over time that using JSX for thumbnails makes it a lot easier to ensure correct SVG output, but React/Preact are big runtimes, so we have a smaller JSX runtime built just for non-interactive SVGs based on [understated](https://github.com/callmecavs/understated).

To use it, configure your file's JSX pragma to use `h` and `render` from `@puzzmo/sdk/svgJSX`:

```tsx
/** @jsxRuntime classic @jsx h */
import { h, render } from "@puzzmo/sdk/svgJSX"

// Needed for fragments
const React = { Fragment: "g" }

export function renderThumbnail(puzzleStr: string, inputStr?: string, config?: ThumbnailConfig): string {
  const puzzle = JSON.parse(puzzleStr)
  const size = 200

  const svg = (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${size} ${size}`}>
      <rect width={size} height={size} fill={config?.theme?.g_bg ?? "#1a1a2e"} />
      <text x={size / 2} y={size / 2} textAnchor="middle" fill={config?.theme?.fg ?? "#fff"} fontSize="24">
        {puzzle.title}
      </text>
    </svg>
  )

  const el = render(svg)
  return el instanceof Element ? el.outerHTML : ""
}
```

The `h` function is a JSX factory that creates virtual DOM nodes, and `render` converts them into real DOM elements. Since thumbnails can run server-side or in a DOM-shimmed environment, the result is serialized to an SVG string via `outerHTML`.

## Editor Integration

For games that support puzzle editing in Puzzmo Workshop, you will need an Editor Bundle:

```ts
import type { EditorBundle, ValidationReport } from "@puzzmo/sdk"

export const validator = {
  validate(data) {
    return { success: true, issues: [] }
  },
} satisfies EditorBundle
```
