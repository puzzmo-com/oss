import type { AppBundle, ThumbnailConfig } from "../../types"
import type { SimulatorContext, SimulatorView } from "../types"

// Storage key for saved states (global across all puzzles)
const savedStatesKey = "simulator-saved-states"

/** Find thumbnail function on globalThis (looks for functions ending in "Thumbnail") */
function findThumbnailFn(): { name: string; fn: AppBundle["renderThumbnail"] } | null {
  const globalObj = globalThis as Record<string, unknown>
  for (const key of Object.keys(globalObj)) {
    if (key.endsWith("Thumbnail") && typeof globalObj[key] === "function") {
      return { name: key, fn: globalObj[key] as AppBundle["renderThumbnail"] }
    }
  }
  return null
}

/** Generate a small thumbnail SVG for a given input string */
function generateMiniThumbnail(ctx: SimulatorContext, inputStr: string): string {
  const thumbFn = findThumbnailFn()
  if (!thumbFn) return ""

  try {
    const puzzleStr = ctx.state.puzzleData ?? ""
    const thumbnailConfig: ThumbnailConfig = {
      viewerIsOwner: true,
      theme: ctx.state.selectedTheme,
      strict: true,
      renderHost: "game",
    }
    return thumbFn.fn(puzzleStr, inputStr, thumbnailConfig)
  } catch {
    return ""
  }
}

// Input string history entry
interface HistoryEntry {
  value: string
  timestamp: number
}

// Saved state entry (includes puzzle since you can save any puzzle + input combination)
interface SavedState {
  name: string
  puzzleStr: string
  inputStr: string
  timestamp: number
}

// Module-level state for history (persists across tab switches)
let inputHistory: HistoryEntry[] = []

// Helper to auto-resize a textarea based on content
function autoResizeTextarea(textarea: HTMLTextAreaElement, maxRows: number = 8) {
  const lineHeight = 14 // Based on font size 10px with line-height 1.4
  const padding = 8 // 4px padding top + bottom
  const border = 4 // 2px border top + bottom
  const minHeight = lineHeight * 2 + padding + border // Minimum 2 rows
  const maxHeight = lineHeight * maxRows + padding + border

  textarea.style.height = "auto"
  const newHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight)
  textarea.style.height = `${newHeight}px`
}

export function createDataView(): SimulatorView {
  // Track original values for change detection
  let originalPuzzleValue = ""
  let originalInputValue = ""

  return {
    id: "data",
    label: "Data",

    render() {
      return `
        <div class="data-view-container">
          <div class="data-subtabs">
            <button class="data-subtab active" data-subtab="edit">Edit</button>
            <button class="data-subtab" data-subtab="history">History</button>
            <button class="data-subtab" data-subtab="saves">Saves</button>
          </div>

          <div class="data-subtab-content active" id="data-subtab-edit">
            <div class="simulator-field">
              <label class="simulator-label">Puzzle String</label>
              <textarea class="simulator-textarea auto-resize" id="simulator-puzzle" placeholder="Loading..."></textarea>
              <div class="simulator-row">
                <button class="simulator-btn subtle" id="simulator-puzzle-reset">Reset</button>
                <button class="simulator-btn primary" id="simulator-puzzle-apply" disabled>Apply</button>
              </div>
            </div>
            <div class="simulator-divider"></div>
            <div class="simulator-field">
              <label class="simulator-label">Input String</label>
              <textarea class="simulator-textarea auto-resize" id="simulator-input" placeholder="No input yet..."></textarea>
              <div class="simulator-row">
                <button class="simulator-btn subtle" id="simulator-input-reset">Reset</button>
                <button class="simulator-btn primary" id="simulator-input-apply" disabled>Apply</button>
              </div>
            </div>
          </div>

          <div class="data-subtab-content" id="data-subtab-history">
            <div class="history-header">
              <span class="simulator-label">Input String Timeline</span>
              <button class="simulator-btn tiny" id="simulator-history-clear">Clear</button>
            </div>
            <div class="history-list" id="simulator-history-list">
              <div class="simulator-empty">No history yet</div>
            </div>
          </div>

          <div class="data-subtab-content" id="data-subtab-saves">
            <div class="save-new">
              <input type="text" class="simulator-input" id="simulator-save-name" placeholder="Save name..." />
              <button class="simulator-btn primary" id="simulator-save-btn">Save</button>
            </div>
            <div class="simulator-divider"></div>
            <div class="saves-list" id="simulator-saves-list">
              <div class="simulator-empty">No saved states</div>
            </div>
          </div>
        </div>
      `
    },

    bind(ctx: SimulatorContext) {
      // Sub-tab switching
      const subtabs = ctx.getElement<HTMLElement>(".data-subtabs")
      subtabs?.querySelectorAll(".data-subtab").forEach((tab) => {
        tab.addEventListener("click", () => {
          const subtabName = tab.getAttribute("data-subtab")
          if (!subtabName) return

          // Update active tab button
          subtabs.querySelectorAll(".data-subtab").forEach((t) => t.classList.remove("active"))
          tab.classList.add("active")

          // Update active content
          const container = ctx.getElement<HTMLElement>(".data-view-container")
          container?.querySelectorAll(".data-subtab-content").forEach((content) => {
            content.classList.toggle("active", content.id === `data-subtab-${subtabName}`)
          })

          // Refresh content when switching
          if (subtabName === "edit") {
            refreshEditTab(ctx)
          } else if (subtabName === "history") {
            renderHistory(ctx)
          } else if (subtabName === "saves") {
            renderSaves(ctx)
          }
        })
      })

      // Edit tab elements
      const puzzleTextarea = ctx.getElement<HTMLTextAreaElement>("#simulator-puzzle")
      const inputTextarea = ctx.getElement<HTMLTextAreaElement>("#simulator-input")
      const puzzleResetBtn = ctx.getElement<HTMLButtonElement>("#simulator-puzzle-reset")
      const puzzleApplyBtn = ctx.getElement<HTMLButtonElement>("#simulator-puzzle-apply")
      const inputResetBtn = ctx.getElement<HTMLButtonElement>("#simulator-input-reset")
      const inputApplyBtn = ctx.getElement<HTMLButtonElement>("#simulator-input-apply")
      const startBtn = ctx.getElement<HTMLButtonElement>("#simulator-start")
      const pauseBtn = ctx.getElement<HTMLButtonElement>("#simulator-pause")

      // Initialize puzzle textarea - defer to allow CtrlView to set state first
      setTimeout(() => {
        if (puzzleTextarea && ctx.state.originalPuzzle) {
          puzzleTextarea.value = ctx.state.originalPuzzle
          originalPuzzleValue = ctx.state.originalPuzzle
          autoResizeTextarea(puzzleTextarea)
        }

        // Initialize input textarea
        if (inputTextarea && ctx.state.currentInputStr) {
          inputTextarea.value = ctx.state.currentInputStr
          originalInputValue = ctx.state.currentInputStr
          autoResizeTextarea(inputTextarea)
        }
      }, 0)

      // Auto-resize and change detection for puzzle
      puzzleTextarea?.addEventListener("input", () => {
        autoResizeTextarea(puzzleTextarea)
        const hasChanges = puzzleTextarea.value !== originalPuzzleValue
        if (puzzleApplyBtn) puzzleApplyBtn.disabled = !hasChanges
      })

      // Auto-resize and change detection for input
      inputTextarea?.addEventListener("input", () => {
        autoResizeTextarea(inputTextarea)
        const hasChanges = inputTextarea.value !== originalInputValue
        if (inputApplyBtn) inputApplyBtn.disabled = !hasChanges
      })

      // Puzzle reset
      puzzleResetBtn?.addEventListener("click", () => {
        if (puzzleTextarea) {
          puzzleTextarea.value = ctx.state.originalPuzzle
          originalPuzzleValue = ctx.state.originalPuzzle
          autoResizeTextarea(puzzleTextarea)
          if (puzzleApplyBtn) puzzleApplyBtn.disabled = true
        }
      })

      // Puzzle apply - the puzzle is an opaque string; the game parses it, so no validation here
      puzzleApplyBtn?.addEventListener("click", () => {
        if (!puzzleTextarea) return
        ctx.state.puzzleData = puzzleTextarea.value
        ctx.state.originalPuzzle = puzzleTextarea.value
        originalPuzzleValue = puzzleTextarea.value
        // Trigger a retry with the new puzzle
        ctx.sendToGame("RETRY_PUZZLE", {})
        ctx.state.hasStarted = false
        ctx.state.isPaused = false
        if (pauseBtn) {
          pauseBtn.disabled = true
          pauseBtn.textContent = "Pause"
        }
        if (startBtn) startBtn.textContent = "Start"
        ctx.updateStatus("Puzzle updated", "ready")
        puzzleApplyBtn.disabled = true
      })

      // Input reset
      inputResetBtn?.addEventListener("click", () => {
        if (inputTextarea) {
          inputTextarea.value = originalInputValue
          autoResizeTextarea(inputTextarea)
          if (inputApplyBtn) inputApplyBtn.disabled = true
        }
      })

      // Input apply
      inputApplyBtn?.addEventListener("click", () => {
        if (inputTextarea) {
          ctx.state.currentInputStr = inputTextarea.value
          originalInputValue = inputTextarea.value
          console.log("Simulator: Input string updated (game restart required to apply)")
          ctx.updateStatus("Input stored", "ready")
          inputApplyBtn.disabled = true
        }
      })

      // History tab
      const historyClearBtn = ctx.getElement<HTMLButtonElement>("#simulator-history-clear")
      historyClearBtn?.addEventListener("click", () => {
        inputHistory = []
        renderHistory(ctx)
      })

      // Saves tab
      const saveNameInput = ctx.getElement<HTMLInputElement>("#simulator-save-name")
      const saveBtn = ctx.getElement<HTMLButtonElement>("#simulator-save-btn")

      saveBtn?.addEventListener("click", () => {
        if (!saveNameInput || !saveNameInput.value.trim()) return

        const savedStates = getSavedStates()
        const newState: SavedState = {
          name: saveNameInput.value.trim(),
          puzzleStr: ctx.state.originalPuzzle,
          inputStr: ctx.state.currentInputStr,
          timestamp: Date.now(),
        }
        savedStates.push(newState)
        localStorage.setItem(savedStatesKey, JSON.stringify(savedStates))
        saveNameInput.value = ""
        renderSaves(ctx)
      })

      // Initial render of saves
      renderSaves(ctx)
    },

    onActivate(ctx: SimulatorContext) {
      // Update original values for change detection
      originalPuzzleValue = ctx.state.originalPuzzle
      originalInputValue = ctx.state.currentInputStr

      // Refresh edit tab content
      refreshEditTab(ctx)

      // Refresh history
      renderHistory(ctx)
    },

    onMessage(type: string, data: any, ctx: SimulatorContext) {
      const inputTextarea = ctx.getElement<HTMLTextAreaElement>("#simulator-input")
      const inputApplyBtn = ctx.getElement<HTMLButtonElement>("#simulator-input-apply")

      // boardState can be at data.boardState (legacy) or data.input.boardState (current SDK format)
      const boardState = data?.input?.boardState ?? data?.boardState
      if (type === "UPLOAD_NEW_GAME_STATE" && boardState) {
        ctx.state.currentInputStr = boardState

        // Add to history if different from last entry
        if (inputHistory.length === 0 || inputHistory[inputHistory.length - 1].value !== boardState) {
          inputHistory.push({ value: boardState, timestamp: Date.now() })
          // Keep history reasonable (last 100 entries)
          if (inputHistory.length > 100) {
            inputHistory = inputHistory.slice(-100)
          }

          // Update history view live if it's currently visible
          const historyTab = ctx.getElement<HTMLElement>("#data-subtab-history")
          if (historyTab?.classList.contains("active")) {
            renderHistory(ctx)
          }
        }

        if (inputTextarea) {
          inputTextarea.value = ctx.state.currentInputStr
          originalInputValue = ctx.state.currentInputStr
          autoResizeTextarea(inputTextarea)
          if (inputApplyBtn) inputApplyBtn.disabled = true
        }
      }
    },
  }
}

// Helper to get saved states from localStorage
function getSavedStates(): SavedState[] {
  try {
    const stored = localStorage.getItem(savedStatesKey)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

// Render the history list
function renderHistory(ctx: SimulatorContext) {
  const historyList = ctx.getElement<HTMLElement>("#simulator-history-list")
  if (!historyList) return

  // Set theme background for thumbnails
  historyList.style.setProperty("--history-thumb-bg", ctx.state.selectedTheme.a_bg)

  if (inputHistory.length === 0) {
    historyList.innerHTML = '<div class="simulator-empty">No history yet</div>'
    return
  }

  // Show most recent first
  const reversedHistory = [...inputHistory].reverse()
  historyList.innerHTML = reversedHistory
    .map((entry, idx) => {
      const realIdx = inputHistory.length - 1 - idx
      const time = new Date(entry.timestamp).toLocaleTimeString()
      const preview = entry.value.length > 60 ? entry.value.slice(0, 60) + "..." : entry.value
      const thumbnail = generateMiniThumbnail(ctx, entry.value)
      return `
        <div class="history-item" data-history-idx="${realIdx}">
          <div class="history-item-thumb">${thumbnail}</div>
          <div class="history-item-content">
            <div class="history-item-header">
              <span class="history-item-num">#${realIdx + 1}</span>
              <span class="history-item-time">${time}</span>
              <button class="simulator-btn tiny history-restore-btn" data-history-idx="${realIdx}">Restore</button>
            </div>
            <div class="history-item-preview">${escapeHtml(preview)}</div>
          </div>
        </div>
      `
    })
    .join("")

  // Bind restore buttons
  historyList.querySelectorAll(".history-restore-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = parseInt((e.target as HTMLElement).getAttribute("data-history-idx") || "0")
      const entry = inputHistory[idx]
      if (entry) {
        ctx.state.currentInputStr = entry.value
        const inputTextarea = ctx.getElement<HTMLTextAreaElement>("#simulator-input")
        if (inputTextarea) {
          inputTextarea.value = entry.value
          autoResizeTextarea(inputTextarea)
        }
        ctx.updateStatus("Input restored from history", "ready")

        // Switch to edit tab
        const editTab = ctx.getElement<HTMLElement>('.data-subtab[data-subtab="edit"]')
        editTab?.click()
      }
    })
  })
}

// Render the saves list
function renderSaves(ctx: SimulatorContext) {
  const savesList = ctx.getElement<HTMLElement>("#simulator-saves-list")
  if (!savesList) return

  const savedStates = getSavedStates()

  if (savedStates.length === 0) {
    savesList.innerHTML = '<div class="simulator-empty">No saved states</div>'
    return
  }

  // Show most recent first
  const reversedSaves = [...savedStates].reverse()
  savesList.innerHTML = reversedSaves
    .map((state, idx) => {
      const realIdx = savedStates.length - 1 - idx
      const date = new Date(state.timestamp).toLocaleDateString()
      const time = new Date(state.timestamp).toLocaleTimeString()
      return `
        <div class="save-item">
          <div class="save-item-header">
            <span class="save-item-name">${escapeHtml(state.name)}</span>
            <span class="save-item-time">${date} ${time}</span>
          </div>
          <div class="save-item-actions">
            <button class="simulator-btn tiny save-load-btn" data-save-idx="${realIdx}">Load</button>
            <button class="simulator-btn tiny danger save-delete-btn" data-save-idx="${realIdx}">Delete</button>
          </div>
        </div>
      `
    })
    .join("")

  // Bind load buttons
  savesList.querySelectorAll(".save-load-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = parseInt((e.target as HTMLElement).getAttribute("data-save-idx") || "0")
      const state = savedStates[idx]
      if (state) {
        // Update puzzle - stored as a raw string, passed to the game verbatim
        ctx.state.puzzleData = state.puzzleStr
        ctx.state.originalPuzzle = state.puzzleStr

        // Update input
        ctx.state.currentInputStr = state.inputStr

        // Refresh UI
        const puzzleTextarea = ctx.getElement<HTMLTextAreaElement>("#simulator-puzzle")
        const inputTextarea = ctx.getElement<HTMLTextAreaElement>("#simulator-input")
        if (puzzleTextarea) {
          puzzleTextarea.value = state.puzzleStr
          autoResizeTextarea(puzzleTextarea)
        }
        if (inputTextarea) {
          inputTextarea.value = state.inputStr
          autoResizeTextarea(inputTextarea)
        }

        ctx.updateStatus(`Loaded: ${state.name}`, "ready")

        // Switch to edit tab
        const editTab = ctx.getElement<HTMLElement>('.data-subtab[data-subtab="edit"]')
        editTab?.click()
      }
    })
  })

  // Bind delete buttons
  savesList.querySelectorAll(".save-delete-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = parseInt((e.target as HTMLElement).getAttribute("data-save-idx") || "0")
      const updatedStates = savedStates.filter((_, i) => i !== idx)
      localStorage.setItem(savedStatesKey, JSON.stringify(updatedStates))
      renderSaves(ctx)
    })
  })
}

// Helper to escape HTML
function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

// Helper to refresh the edit tab content
function refreshEditTab(ctx: SimulatorContext) {
  const puzzleTextarea = ctx.getElement<HTMLTextAreaElement>("#simulator-puzzle")
  const inputTextarea = ctx.getElement<HTMLTextAreaElement>("#simulator-input")
  const puzzleApplyBtn = ctx.getElement<HTMLButtonElement>("#simulator-puzzle-apply")
  const inputApplyBtn = ctx.getElement<HTMLButtonElement>("#simulator-input-apply")

  if (puzzleTextarea && ctx.state.originalPuzzle) {
    puzzleTextarea.value = ctx.state.originalPuzzle
    autoResizeTextarea(puzzleTextarea)
    if (puzzleApplyBtn) puzzleApplyBtn.disabled = true
  }

  if (inputTextarea) {
    inputTextarea.value = ctx.state.currentInputStr
    autoResizeTextarea(inputTextarea)
    if (inputApplyBtn) inputApplyBtn.disabled = true
  }
}
