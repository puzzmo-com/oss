import type { KeyboardConfig } from "../../types"
import type { SimulatorContext, SimulatorView } from "../types"

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

  const renderContent = (): string => {
    if (!currentConfig) {
      return '<div class="sim-kb-empty">No keyboard config received from game yet.<br>The game calls <code>sdk.keyboard.show(config)</code> to display a keyboard.</div>'
    }
    return renderKeyboard(currentConfig)
  }

  return {
    id: "kbd",
    label: "Kbd",

    render() {
      return `
        <div class="keyboard-view-container">
          <div id="sim-kb-content">
            ${renderContent()}
          </div>
        </div>
      `
    },

    bind(ctx: SimulatorContext) {
      bindKeyClicks(ctx)
    },

    onMessage(type, data, ctx) {
      if (type !== "KEYBOARD_UPDATE_CONFIG") return
      const isEmpty = !data?.layout?.length || data.layout.every((r: string | null) => !r)
      currentConfig = isEmpty ? null : (data as KeyboardConfig)

      const content = ctx.getElement<HTMLElement>("#sim-kb-content")
      if (content) {
        content.innerHTML = renderContent()
        bindKeyClicks(ctx)
      }

      ctx.updateBadge("kbd", currentConfig ? undefined : undefined)
    },
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
