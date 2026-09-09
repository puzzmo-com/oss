import type { KeyboardConfig, KeyStyleRule, KeyStyles } from "./types"

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

/**
 * Expands per-key-set styling rules into the `individualKeyStyles` map a `KeyboardConfig` carries,
 * so a game can style a group of keys in one go. Later rules win where two name the same key.
 *
 * @example
 *   sdk.keyboard.show({
 *     ...defaultKeyboardConfig,
 *     individualKeyStyles: keyStylesFromRules([{ keys: usedLetters, text: { opacity: "0.4" } }]),
 *   })
 */
export const keyStylesFromRules = (rules: KeyStyleRule[]): Record<string, KeyStyles> => {
  const styles: Record<string, KeyStyles> = {}
  for (const rule of rules) {
    for (const key of rule.keys) {
      const merged: KeyStyles = {}
      const text = { ...styles[key]?.text, ...rule.text }
      const background = { ...styles[key]?.background, ...rule.background }
      // Only the groups a rule actually set, so a text-only rule doesn't carry an empty background
      // for every key it names.
      if (Object.keys(text).length) merged.text = text
      if (Object.keys(background).length) merged.background = background
      styles[key] = merged
    }
  }
  return styles
}
