import type { KeyboardConfig } from "./types"

/**
 * A standard QWERTY layout with Enter and Backspace — a reasonable default for
 * any game that needs text input. Customize from here by spreading and overriding.
 *
 * @example
 *   // Use as-is
 *   sdk.keyboard.show(defaultKeyboardConfig)
 *
 * @example
 *   // Extend with dynamic disabled letters
 *   sdk.keyboard.show({ ...defaultKeyboardConfig, disabled: usedLetters })
 */
export const defaultKeyboardConfig: KeyboardConfig = {
  layout: ["qwertyuiop", "asdfghjkl", "↵zxcvbnm⌫", undefined],
  symbols: { "↵": "enter", "⌫": "bsp" },
  highlight: ["↵", "⌫"],
  disabled: [],
  xl: [],
  l: ["↵", "⌫"],
  supportsDragCursor: false,
}
