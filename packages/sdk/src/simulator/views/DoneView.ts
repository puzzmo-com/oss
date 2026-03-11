import type { SimulatorContext, SimulatorView } from "../types"

export function createDoneView(): SimulatorView {
  return {
    id: "done",
    label: "Done",

    render() {
      return `
        <div id="simulator-done-empty" class="simulator-empty">Game not completed yet</div>
        <div id="simulator-done-content" style="display:none;">
          <div class="simulator-field">
            <label class="simulator-label">Completion Text</label>
            <div id="simulator-done-text" class="simulator-value"></div>
          </div>
          <div class="simulator-divider"></div>
          <div class="simulator-field">
            <label class="simulator-label">Board State</label>
            <textarea class="simulator-textarea" id="simulator-done-input" rows="2" readonly></textarea>
          </div>
          <div class="simulator-divider"></div>
          <div class="simulator-field">
            <label class="simulator-label">Deeds</label>
            <div id="simulator-done-deeds" class="simulator-deeds"></div>
          </div>
          <div class="simulator-divider"></div>
          <div class="simulator-field">
            <label class="simulator-label">Raw Data</label>
            <textarea class="simulator-textarea" id="simulator-done-raw" rows="4" readonly></textarea>
          </div>
        </div>
      `
    },

    bind(_ctx: SimulatorContext) {
      // No event bindings needed for done view (read-only)
    },

    onMessage(type: string, data: any, ctx: SimulatorContext) {
      if (type !== "GAME_COMPLETED") return

      ctx.state.completionData = data

      const emptyEl = ctx.getElement<HTMLElement>("#simulator-done-empty")
      const contentEl = ctx.getElement<HTMLElement>("#simulator-done-content")
      const textEl = ctx.getElement<HTMLElement>("#simulator-done-text")
      const inputEl = ctx.getElement<HTMLTextAreaElement>("#simulator-done-input")
      const deedsEl = ctx.getElement<HTMLElement>("#simulator-done-deeds")
      const rawEl = ctx.getElement<HTMLTextAreaElement>("#simulator-done-raw")

      if (emptyEl) emptyEl.style.display = "none"
      if (contentEl) contentEl.style.display = "block"

      // Completion text (from input if available)
      const completionText = data.input?.completionText || data.completionText || "(no completion text)"
      if (textEl) textEl.textContent = completionText

      // Board state (from input.boardState)
      const boardState = data.input?.boardState || data.boardState || ctx.state.currentInputStr || ""
      if (inputEl) inputEl.value = boardState

      // Deeds (from config.deeds, each deed has id/value)
      if (deedsEl) {
        deedsEl.innerHTML = ""
        const deeds = data.config?.deeds || data.deeds
        if (deeds && Array.isArray(deeds)) {
          deeds.forEach((deed: { id: string; value: any }) => {
            const deedEl = document.createElement("div")
            deedEl.className = "simulator-deed"
            deedEl.innerHTML = `
              <span class="simulator-deed-name">${deed.id}</span>
              <span class="simulator-deed-value">${deed.value}</span>
            `
            deedsEl.appendChild(deedEl)
          })
        } else {
          deedsEl.innerHTML = '<div class="simulator-empty">No deeds</div>'
        }
      }

      // Raw data
      if (rawEl) rawEl.value = JSON.stringify(data, null, 2)

      // Switch to done tab
      ctx.setCollapsed(false)
      ctx.switchTab("done")
    },
  }
}
