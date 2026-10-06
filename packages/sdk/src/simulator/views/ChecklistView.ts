import { advanceChecklist, sanitizeDeeds, scopeFromDeeds, type ChecklistMode, type ItemEvaluation } from "../checklistProgress"
import type { SimulatorChecklist, SimulatorChecklistItem, SimulatorContext, SimulatorView } from "../types"

interface ChecklistRun {
  index: number
  /** Evaluation of the item at `index` from the last checkpoint or completion */
  head?: ItemEvaluation
}

/** A minimal take on puzzmo.com's tutorial checklist, driven by deeds from checkpoints and completion. */
export function createChecklistView(checklists: SimulatorChecklist[]): SimulatorView {
  const runs = new Map<string, ChecklistRun>()
  const expanded = new Set<string>()
  let slug: string | null = null
  let newlyCompleted = 0
  let lastSource: string | undefined
  let lastWarnings: string[] = []

  const storageKey = (stableID: string) => `simulator-checklist:${slug ?? "game"}:${stableID}`

  const loadIndex = (checklist: SimulatorChecklist): number => {
    try {
      const stored = Number(localStorage.getItem(storageKey(checklist.stableID))) || 0
      return Math.min(Math.max(stored, 0), checklist.items.length)
    } catch {
      return 0
    }
  }

  const saveIndex = (stableID: string, index: number) => {
    try {
      if (index === 0) localStorage.removeItem(storageKey(stableID))
      else localStorage.setItem(storageKey(stableID), String(index))
    } catch {
      // storage unavailable, progress stays in memory
    }
  }

  const renderItem = (checklist: SimulatorChecklist, item: SimulatorChecklistItem, idx: number, run: ChecklistRun) => {
    const state = idx < run.index ? "done" : idx === run.index ? "active" : "upcoming"
    const key = `${checklist.stableID}:${idx}`
    const isOpen = expanded.has(key)
    const showHelp = !!item.expandMD && state !== "done"
    const target = item.targetCount || 1
    const count = state === "active" && run.head ? `${Math.min(run.head.value, target)}/${target}` : ""

    const tooltip = [
      item.incrementExp && `increment: ${item.incrementExp}`,
      item.filterExp && `filter: ${item.filterExp}`,
      `target: ${target}`,
      item.liveUpdate ? "liveUpdate: checkpoints + completion" : "completion only",
    ]
      .filter(Boolean)
      .join("\n")

    const divider =
      checklist.instructionsVisibleFromItemIndex === idx && idx > 0
        ? `<div class="checklist-divider"><span>full instructions unlock</span></div>`
        : ""

    return `${divider}
      <div class="checklist-item ${state}" title="${escapeHTML(tooltip)}">
        <div class="checklist-row">
          <span class="checklist-tick">${state === "done" ? "■" : "□"}</span>
          <span class="checklist-title">${escapeHTML(item.title ?? `Step ${idx + 1}`)}</span>
          ${count ? `<span class="checklist-count">${count}</span>` : ""}
          ${showHelp ? `<button class="checklist-help${isOpen ? " open" : ""}" data-help="${escapeHTML(key)}">?</button>` : ""}
        </div>
        ${state === "active" && item.subtitle ? `<div class="checklist-subtitle">${escapeHTML(item.subtitle)}</div>` : ""}
        ${showHelp && isOpen ? `<pre class="checklist-expand">${escapeHTML(item.expandMD!)}</pre>` : ""}
      </div>`
  }

  const renderChecklist = (checklist: SimulatorChecklist) => {
    const run = runs.get(checklist.stableID) ?? { index: 0 }
    const total = checklist.items.length
    const done = run.index
    const error = run.head?.error && `${checklist.items[run.index]?.title ?? `Step ${run.index + 1}`}: ${run.head.error}`

    return `
      <div class="checklist-section">
        <div class="checklist-header">
          <span class="simulator-label">Checklist</span>
          <span class="checklist-progress${done === total ? " complete" : ""}">${done}/${total}</span>
          <button class="simulator-btn subtle small" data-reset="${escapeHTML(checklist.stableID)}">Reset</button>
        </div>
        <div class="checklist-items">
          ${checklist.items.map((item, idx) => renderItem(checklist, item, idx, run)).join("")}
        </div>
        ${lastSource ? `<div class="checklist-footer">last eval: ${escapeHTML(lastSource)}</div>` : ""}
        ${error ? `<div class="checklist-error">${escapeHTML(error)}</div>` : ""}
        ${lastWarnings.map((warning) => `<div class="checklist-error">${escapeHTML(warning)}</div>`).join("")}
      </div>`
  }

  const renderAll = () => {
    if (checklists.length === 0) {
      return `<div class="simulator-empty">No checklists in puzzmo.json → integrations.checklists
<pre class="checklist-expand">"checklists": [{
  "stableID": "my-game:tutorial",
  "type": "tutorial",
  "items": [{ "title": "Make a move", "incrementExp": "moves", "liveUpdate": true }]
}]</pre></div>`
    }
    return checklists.map(renderChecklist).join("")
  }

  const rerender = (ctx: SimulatorContext) => {
    const el = ctx.getElement<HTMLElement>("#simulator-checklist-list")
    if (el) el.innerHTML = renderAll()
  }

  const evaluate = (ctx: SimulatorContext, deeds: unknown, mode: ChecklistMode, source: string) => {
    let advanced = 0
    const sanitized = sanitizeDeeds(deeds, mode)
    const scope = scopeFromDeeds(sanitized.deeds)
    lastSource = source
    lastWarnings = sanitized.warnings

    for (const checklist of checklists) {
      const index = runs.get(checklist.stableID)?.index ?? 0
      const result = advanceChecklist({ items: checklist.items, index, scope, mode })
      advanced += result.index - index
      runs.set(checklist.stableID, result)
      if (result.index !== index) saveIndex(checklist.stableID, result.index)
    }

    if (advanced > 0) {
      newlyCompleted += advanced
      ctx.updateBadge("checklist", newlyCompleted)
    }
    rerender(ctx)
  }

  return {
    id: "checklist",
    label: "Cklst",

    render() {
      return `<div id="simulator-checklist-list" class="checklist-view-container">${renderAll()}</div>`
    },

    bind(ctx: SimulatorContext) {
      slug = ctx.gameSlug
      for (const checklist of checklists) runs.set(checklist.stableID, { index: loadIndex(checklist) })
      rerender(ctx)

      ctx.getElement<HTMLElement>("#simulator-checklist-list")?.addEventListener("click", (e) => {
        const target = e.target as HTMLElement
        const resetID = target.closest<HTMLElement>("[data-reset]")?.dataset.reset
        const helpKey = target.closest<HTMLElement>("[data-help]")?.dataset.help

        if (resetID) {
          runs.set(resetID, { index: 0 })
          saveIndex(resetID, 0)
          lastSource = undefined
          lastWarnings = []
          newlyCompleted = 0
          ctx.updateBadge("checklist", 0)
        } else if (helpKey) {
          if (expanded.has(helpKey)) expanded.delete(helpKey)
          else expanded.add(helpKey)
        } else return
        rerender(ctx)
      })
    },

    onActivate() {
      newlyCompleted = 0
    },

    onMessage(type: string, data: any, ctx: SimulatorContext) {
      if (type === "HIT_CHECKPOINT") evaluate(ctx, data?.augConfig?.deeds, "checkpoint", `checkpoint "${data?.checkpointName ?? "?"}"`)
      else if (type === "GAME_COMPLETED") evaluate(ctx, data?.config?.deeds, "completion", "completion")
    },
  }
}

const escapeHTML = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
