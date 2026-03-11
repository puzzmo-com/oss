import type { Theme } from "../../types"
import { themes } from "../../themes"
import type { SimulatorContext, SimulatorView } from "../types"
import { persistTheme } from "../state"

/**
 * Generate theme preview HTML showing key colors
 */
function generateThemePreview(theme: Theme): string {
  // Show key, subBrand, player, alt1, alt2, alt3 with g_bg as background
  const colors = [theme.key, theme.subBrand, theme.player, theme.alt1, theme.alt2, theme.alt3]
  const cells = colors.map((c) => `<div class="simulator-theme-preview-cell" style="background: ${c}"></div>`).join("")
  return `<div class="simulator-theme-preview" style="background: ${theme.g_bg}">${cells}</div>`
}

export function createThemeView(): SimulatorView {
  return {
    id: "theme",
    label: "Theme",

    render() {
      return `
        <div class="theme-view-container">
          <div class="theme-header">
            <span class="simulator-label">Select Theme</span>
          </div>
          <div id="simulator-themes" class="simulator-themes"></div>
        </div>
      `
    },

    bind(ctx: SimulatorContext) {
      const themesEl = ctx.getElement<HTMLElement>("#simulator-themes")
      if (!themesEl) return

      themes.forEach((theme) => {
        const themeItem = document.createElement("div")
        themeItem.className = `simulator-theme-item${theme.name === ctx.state.selectedTheme.name ? " selected" : ""}`
        themeItem.innerHTML = `
          ${generateThemePreview(theme)}
          <div class="simulator-theme-name">${theme.name}</div>
          <div class="simulator-theme-type">${theme.type}</div>
        `
        themeItem.addEventListener("click", () => {
          console.log("Simulator: Theme changed, reloading...", theme.name)
          persistTheme(theme.name)
          window.location.reload()
        })
        themesEl.appendChild(themeItem)
      })
    },
  }
}
