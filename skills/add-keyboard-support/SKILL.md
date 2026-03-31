---
name: add-keyboard-support
description: Add Puzzmo on-screen keyboard support to a game using the SDK
---

# Add Keyboard Support

Wire up the Puzzmo on-screen keyboard so mobile players can type without a hardware keyboard.
The runtime shows the keyboard automatically on touch devices when the game calls `sdk.keyboard.show()`.

## Steps

1. Import `defaultKeyboardConfig` alongside the SDK:

   ```ts
   import { createPuzzmoSDK, defaultKeyboardConfig } from "@puzzmo/sdk"
   import type { KeyboardConfig } from "@puzzmo/sdk"

   const sdk = createPuzzmoSDK()
   ```

2. Show the keyboard when the player focuses an input (e.g. selects a tile or cell).
   Start from `defaultKeyboardConfig` and customize for your game:

   ```ts
   // Simple case — show the default QWERTY keyboard
   sdk.keyboard.show(defaultKeyboardConfig)

   // Extended case — disable letters that are no longer valid
   sdk.keyboard.show({ ...defaultKeyboardConfig, disabled: usedLetters })
   ```

   The keyboard is only visible on touch devices; calling `show` on desktop is a no-op.

3. Hide the keyboard when input is dismissed (tile deselected, game completed, etc.):

   ```ts
   sdk.keyboard.hide()
   ```

4. Listen for key presses via the SDK event system:

   ```ts
   sdk.on("keyboardKeyPress", ({ key }) => {
     if (key === "⌫") {
       handleBackspace()
     } else if (key === "↵") {
       handleEnter()
     } else {
       handleLetter(key)
     }
   })
   ```

   The `key` value is always the raw character from the layout — not the display label from `symbols`.

5. Keep the keyboard config in sync with game state. Call `sdk.keyboard.show()` again whenever
   the set of valid/invalid keys changes — for example, after each letter is placed:

   ```ts
   function onTileSelected(tile) {
     sdk.keyboard.show({
       ...defaultKeyboardConfig,
       disabled: getUsedLetters(gameState), // update disabled letters
     })
   }
   ```

6. For games that use custom key layouts (multiple panels, special action keys), define the
   config with non-letter Unicode tokens for action keys:

   ```ts
   const backspace = "⌫"
   const enter = "↵"

   const keyboardConfig: KeyboardConfig = {
     layout: ["qwertyuiop", "asdfghjkl", `${enter}zxcvbnm${backspace}`, undefined],
     symbols: { [backspace]: "bsp", [enter]: "Enter" },
     highlight: [backspace, enter],
     disabled: [],
     xl: [],
     l: [backspace, enter],
     supportsDragCursor: false,
   }

   sdk.keyboard.show(keyboardConfig)
   ```

7. If your game has a spatial input model (e.g. selecting a grid cell by dragging), enable
   the drag cursor and handle the additional events:

   ```ts
   sdk.keyboard.show({ ...keyboardConfig, supportsDragCursor: true })

   sdk.on("keyboardCursorChange", ({ position }) => {
     // position is [x, y] in keyboard-relative coordinates
     // use it to preview which cell the cursor is over
     highlightCellAtPosition(position)
   })

   sdk.on("keyboardCursorEnd", () => {
     // player released — confirm the selection
     confirmCellSelection()
   })
   ```

## Key APIs

- `sdk.keyboard.show(config)` — show or update the keyboard. Pass the full config every time.
- `sdk.keyboard.hide()` — hide the keyboard.
- `sdk.on("keyboardKeyPress", handler)` — key tapped; `handler` receives `{ key: string }`.
- `sdk.on("keyboardCursorChange", handler)` — drag cursor moved; `handler` receives `{ position: [number, number] }`.
- `sdk.on("keyboardCursorEnd", handler)` — drag cursor released.
- `defaultKeyboardConfig` — ready-to-use QWERTY layout with Enter and Backspace.

## KeyboardConfig fields

| Field | Type | Purpose |
|---|---|---|
| `layout` | `string[]` | Rows of keys — each character is one key |
| `symbols` | `Record<string, string>` | Maps token chars to display labels |
| `highlight` | `string[]` | Keys rendered with accent background |
| `disabled` | `string[]` | Keys that are non-interactive/dimmed |
| `xl` | `string[]` | Extra-large width keys (~17.85% of row) |
| `l` | `string[]` | Large width keys (~14.7% of row) |
| `supportsDragCursor` | `boolean` | Enable drag-cursor mode |
| `rowPositioning` | `("start"\|"center"\|"end")[]` | Per-row alignment |
| `flexGrowSymbols` | `string[]` | Keys that stretch to fill row width |
| `keyStyles` | `Record<string, string>` | CSS applied to every key face |
| `kbdStyles` | `Record<string, string>` | CSS applied to the keyboard container |

## Success Criteria

- The `build` script completes without errors
- On a touch device (or browser dev tools touch emulation), the keyboard appears when a tile is selected
- Tapping a key triggers the correct game action
- Keyboard hides when input focus is lost or the game completes
- `disabled` keys update correctly as game state changes
