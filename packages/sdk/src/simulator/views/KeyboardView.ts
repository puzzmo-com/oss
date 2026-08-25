import type { KeyboardConfig } from "../../types"
import type { SimulatorContext, SimulatorView } from "../types"
import { createDockedKeyboard, dockedKeyboardHeight, type DockedKeyboard } from "../dockedKeyboard"
import { persistKeyboardDocked } from "../state"

/** Renders a single keyboard key as an HTML button string */
const renderKey = (char: string, config: KeyboardConfig): string => {
  const label = config.symbols[char] ?? char
  const isDisabled = config.disabled.includes(char)
  const isHighlight = config.highlight.includes(char)
  const isXL = config.xl.includes(char)
  const isL = config.l.includes(char)
  const isFlexGrow = config.flexGrowSymbols?.includes(char)

  const classes = [
    "sim-kb-key",
    isDisabled ? "disabled" : "",
    isHighlight ? "highlight" : "",
    isXL ? "xl" : "",
    isL ? "l" : "",
    isFlexGrow ? "grow" : "",
  ]
    .filter(Boolean)
    .join(" ")

  return `<button class="${classes}" data-key="${char}" ${isDisabled ? "disabled" : ""}>${label}</button>`
}

/** Renders the full keyboard HTML from a KeyboardConfig */
const renderKeyboard = (config: KeyboardConfig): string => {
  const rows = config.layout
    .filter((row): row is string => row != null)
    .map((row) => {
      const keys = [...row].map((char) => renderKey(char, config)).join("")
      return `<div class="sim-kb-row">${keys}</div>`
    })
    .join("")

  return `<div class="sim-kb">${rows}</div>`
}

export function createKeyboardView(): SimulatorView {
  let currentConfig: KeyboardConfig | null = null
  let docked: DockedKeyboard | null = null

  const renderContent = (isDocked: boolean): string => {
    if (!currentConfig) {
      return '<div class="sim-kb-empty">No keyboard config received from game yet.<br>The game calls <code>sdk.keyboard.show(config)</code> to display a keyboard.</div>'
    }
    // While the dock is up it is the live keyboard; a second set of keys here would just be a copy.
    if (isDocked) {
      return `<div class="sim-kb-empty">Shown under the game at production size, taking ${dockedKeyboardHeight}px off the bottom.<br>Uncheck to preview the layout here instead.</div>`
    }
    return renderKeyboard(currentConfig)
  }

  return {
    id: "kbd",
    label: "Kbd",

    render() {
      return `
        <div class="keyboard-view-container">
          <div class="simulator-field">
            <label class="sim-settings-row">
              <input type="checkbox" id="sim-kb-dock" />
              <span class="simulator-label">Show keyboard under game</span>
            </label>
          </div>
          <div id="sim-kb-content">
            ${renderContent(false)}
          </div>
        </div>
      `
    },

    bind(ctx: SimulatorContext) {
      // Created once. The Theme tab reloads the page on change, so the theme captured here holds.
      docked ??= createDockedKeyboard({ theme: ctx.state.selectedTheme, sendToGame: ctx.sendToGame })
      docked.setEnabled(ctx.state.keyboardDocked)

      const checkbox = ctx.getElement<HTMLInputElement>("#sim-kb-dock")
      if (checkbox) {
        checkbox.checked = ctx.state.keyboardDocked
        checkbox.addEventListener("change", () => {
          ctx.state.keyboardDocked = checkbox.checked
          persistKeyboardDocked(checkbox.checked)
          docked?.setEnabled(checkbox.checked)
          renderPanel(ctx)
        })
      }

      bindKeyClicks(ctx)
    },

    onMessage(type, data, ctx) {
      if (type !== "KEYBOARD_UPDATE_CONFIG") return
      const isEmpty = !data?.layout?.length || data.layout.every((r: string | null) => !r)
      currentConfig = isEmpty ? null : (data as KeyboardConfig)

      docked?.setConfig(currentConfig)
      renderPanel(ctx)

      // No badge update needed for the keyboard tab.
    },
  }

  /** Re-render the tab's own content (not the dock) and rebind its keys. */
  function renderPanel(ctx: SimulatorContext) {
    const content = ctx.getElement<HTMLElement>("#sim-kb-content")
    if (!content) return
    content.innerHTML = renderContent(ctx.state.keyboardDocked)
    bindKeyClicks(ctx)
  }
}

/** Attach click handlers to all rendered keys */
function bindKeyClicks(ctx: SimulatorContext) {
  const keys = ctx.getElement<HTMLElement>("#sim-kb-content")?.querySelectorAll(".sim-kb-key")
  keys?.forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-key")
      if (key) ctx.sendToGame("KEYBOARD_KEY_PRESS", { key })
    })
  })
}
