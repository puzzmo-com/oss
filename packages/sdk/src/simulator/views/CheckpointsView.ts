import type { SimulatorContext, SimulatorView } from "../types"
import type { AugmentationConfig } from "../../types"

interface CheckpointEntry {
  checkpointName: string
  augConfig: AugmentationConfig
  time: string
}

export function createCheckpointsView(): SimulatorView {
  let checkpoints: CheckpointEntry[] = []

  const formatTime = () => {
    const now = new Date()
    return now.toLocaleTimeString("en-US", { hour12: false })
  }

  const renderCheckpoint = (checkpoint: CheckpointEntry): string => {
    const { checkpointName, augConfig, time } = checkpoint
    const deeds = augConfig?.deeds as Array<{ id: string; value: any }> | undefined

    return `
      <div class="checkpoint-item">
        <div class="checkpoint-header">
          <span class="checkpoint-name">${checkpointName}</span>
          <span class="checkpoint-time">${time}</span>
        </div>
        ${
          deeds && deeds.length > 0
            ? `<div class="simulator-deeds">
            ${deeds.map((deed) => `<div class="simulator-deed"><span class="simulator-deed-name">${deed.id}</span><span class="simulator-deed-value">${deed.value}</span></div>`).join("")}
          </div>`
            : ""
        }
      </div>
    `
  }

  const renderList = (): string => {
    if (checkpoints.length === 0) {
      return '<div class="simulator-empty">No checkpoints received yet</div>'
    }
    return checkpoints.map((cp) => renderCheckpoint(cp)).join("")
  }

  return {
    id: "checkpoints",
    label: "Chkpt",

    render() {
      return `
        <div class="checkpoints-view-container">
          <div class="checkpoints-header">
            <span class="simulator-label">Checkpoints</span>
            <button class="simulator-btn subtle small" id="simulator-checkpoints-clear">Clear</button>
          </div>
          <div id="simulator-checkpoints-list" class="checkpoints-list">
            ${renderList()}
          </div>
        </div>
      `
    },

    bind(ctx: SimulatorContext) {
      const clearBtn = ctx.getElement<HTMLButtonElement>("#simulator-checkpoints-clear")
      const listEl = ctx.getElement<HTMLElement>("#simulator-checkpoints-list")

      clearBtn?.addEventListener("click", () => {
        checkpoints = []
        if (listEl) listEl.innerHTML = renderList()
        ctx.updateBadge("checkpoints", 0)
      })
    },

    onMessage(type: string, data: any, ctx: SimulatorContext) {
      if (type !== "HIT_CHECKPOINT") return

      const entry: CheckpointEntry = {
        checkpointName: data.checkpointName,
        augConfig: data.augConfig,
        time: formatTime(),
      }

      checkpoints.push(entry)
      ctx.updateBadge("checkpoints", checkpoints.length)

      const listEl = ctx.getElement<HTMLElement>("#simulator-checkpoints-list")
      if (listEl) {
        listEl.innerHTML = renderList()
        // Scroll to bottom to show newest
        listEl.scrollTop = listEl.scrollHeight
      }
    },
  }
}
