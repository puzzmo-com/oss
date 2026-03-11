import type { SimulatorContext, SimulatorView, MessageLogEntry } from "../types"

export interface MsgsViewExtended extends SimulatorView {
  addLogEntry: (entry: MessageLogEntry, ctx: SimulatorContext) => void
}

// Helper to escape HTML
function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

export function createMsgsView(): MsgsViewExtended {
  let messageCount = 0

  return {
    id: "msgs",
    label: "Msgs",

    render() {
      return `
        <div class="msgs-view-container">
          <div class="msgs-header">
            <span class="simulator-label">Message Log</span>
            <button class="simulator-btn tiny" id="simulator-msgs-clear">Clear</button>
          </div>
          <div id="simulator-msgs-log"></div>
        </div>
      `
    },

    bind(ctx: SimulatorContext) {
      const clearBtn = ctx.getElement<HTMLButtonElement>("#simulator-msgs-clear")

      clearBtn?.addEventListener("click", () => {
        const logEl = ctx.getElement<HTMLElement>("#simulator-msgs-log")
        if (logEl) {
          logEl.innerHTML = ""
        }
        messageCount = 0
        ctx.updateBadge("msgs", 0)
      })
    },

    addLogEntry(entry: MessageLogEntry, ctx: SimulatorContext) {
      const logEl = ctx.getElement<HTMLElement>("#simulator-msgs-log")
      if (!logEl) return

      messageCount++
      ctx.updateBadge("msgs", messageCount)

      const msgEl = document.createElement("div")
      msgEl.className = `simulator-msg ${entry.direction}`
      const dataStr = entry.data !== undefined ? JSON.stringify(entry.data, null, 2) : ""
      msgEl.innerHTML = `
        <div class="simulator-msg-header">
          <span class="simulator-msg-type">${entry.direction === "out" ? "\u2192" : "\u2190"} ${entry.type}</span>
          <span class="simulator-msg-time">${entry.time}</span>
        </div>
        ${dataStr ? `<div class="simulator-msg-data">${escapeHtml(dataStr)}</div>` : ""}
      `

      // Add click handler to expand/collapse message data
      const dataEl = msgEl.querySelector(".simulator-msg-data")
      if (dataEl) {
        dataEl.addEventListener("click", () => {
          // Collapse any other expanded messages first
          logEl.querySelectorAll(".simulator-msg.expanded").forEach((el) => {
            if (el !== msgEl) el.classList.remove("expanded")
          })
          // Toggle this message
          msgEl.classList.toggle("expanded")
        })
      }

      logEl.insertBefore(msgEl, logEl.firstChild)

      // Limit displayed messages
      while (logEl.children.length > 50) {
        logEl.removeChild(logEl.lastChild!)
      }
    },
  }
}
