import type { SimulatorContext, SimulatorView } from "../types"
import { renderFixtureSelector, updatePuzzleOptions, getFixturePuzzle } from "../fixtures"
import { persistFixtureCategory, persistFixturePuzzle, clearFixturePuzzle } from "../state"

export function createCtrlView(): SimulatorView {
  return {
    id: "ctrl",
    label: "Ctrl",

    render() {
      return `
        <div id="simulator-fixtures-container"></div>
        <div id="simulator-status">
          <span class="indicator waiting"></span>
          <span class="text">Waiting for READY...</span>
        </div>
        <div class="simulator-row">
          <button class="simulator-btn primary" id="simulator-start" disabled>Start</button>
          <button class="simulator-btn" id="simulator-pause" disabled>Pause</button>
        </div>
        <div class="simulator-row">
          <button class="simulator-btn danger" id="simulator-retry" disabled>Retry</button>
        </div>
      `
    },

    bind(ctx: SimulatorContext) {
      const startBtn = ctx.getElement<HTMLButtonElement>("#simulator-start")
      const pauseBtn = ctx.getElement<HTMLButtonElement>("#simulator-pause")
      const retryBtn = ctx.getElement<HTMLButtonElement>("#simulator-retry")
      const fixturesContainer = ctx.getElement<HTMLElement>("#simulator-fixtures-container")

      console.log("Simulator: CtrlView.bind called", {
        hasFixtures: !!ctx.fixtures,
        categories: ctx.fixtureCategories,
        selectedCategory: ctx.state.selectedCategory,
        selectedPuzzle: ctx.state.selectedPuzzle,
      })

      // Set up fixtures UI if fixtures are provided
      if (ctx.fixtures && ctx.fixtureCategories.length > 0 && fixturesContainer) {
        // Clear any existing content (in case bind is called multiple times)
        fixturesContainer.innerHTML = renderFixtureSelector(ctx.fixtureCategories, ctx.state.selectedCategory)

        const categorySelect = ctx.getElement<HTMLSelectElement>("#simulator-fixture-category")
        const puzzleSelect = ctx.getElement<HTMLSelectElement>("#simulator-fixture-puzzle")

        if (categorySelect && puzzleSelect && ctx.state.selectedCategory) {
          // Update puzzle options
          ctx.state.selectedPuzzle = updatePuzzleOptions(puzzleSelect, ctx.fixtures, ctx.state.selectedCategory, ctx.state.selectedPuzzle)

          // Load initial puzzle data
          const puzzleData = getFixturePuzzle(ctx.fixtures, ctx.state.selectedCategory, ctx.state.selectedPuzzle)
          console.log("Simulator: Loading fixture puzzle", {
            category: ctx.state.selectedCategory,
            puzzle: ctx.state.selectedPuzzle,
            hasPuzzleData: !!puzzleData,
          })
          if (puzzleData) {
            ctx.state.puzzleData = puzzleData
            ctx.state.originalPuzzle = puzzleData
            if (ctx.state.selectedCategory) persistFixtureCategory(ctx.state.selectedCategory)
            if (ctx.state.selectedPuzzle) persistFixturePuzzle(ctx.state.selectedPuzzle)
          }

          // Category change handler
          categorySelect.addEventListener("change", () => {
            console.log("Simulator: Category changed, reloading...", categorySelect.value)
            persistFixtureCategory(categorySelect.value)
            clearFixturePuzzle()
            window.location.reload()
          })

          // Puzzle change handler
          puzzleSelect.addEventListener("change", () => {
            console.log("Simulator: Puzzle changed, reloading...", puzzleSelect.value)
            persistFixturePuzzle(puzzleSelect.value)
            window.location.reload()
          })
        }
      }

      // Button handlers
      startBtn?.addEventListener("click", () => {
        if (ctx.state.isPaused) {
          ctx.sendToGame("RESUME_GAME", {})
          ctx.state.isPaused = false
          if (pauseBtn) pauseBtn.textContent = "Pause"
          ctx.updateStatus("Running", "ready")
        } else {
          ctx.sendToGame("START_GAME", undefined)
          ctx.state.hasStarted = true
          if (pauseBtn) pauseBtn.disabled = false
          if (startBtn) startBtn.textContent = "Resume"
          ctx.updateStatus("Running", "ready")
        }
      })

      pauseBtn?.addEventListener("click", () => {
        if (ctx.state.isPaused) {
          ctx.sendToGame("RESUME_GAME", {})
          ctx.state.isPaused = false
          pauseBtn.textContent = "Pause"
          ctx.updateStatus("Running", "ready")
        } else {
          ctx.sendToGame("PAUSE_GAME", {})
          ctx.state.isPaused = true
          pauseBtn.textContent = "Resume"
          ctx.updateStatus("Paused", "paused")
        }
      })

      retryBtn?.addEventListener("click", () => {
        ctx.sendToGame("RETRY_PUZZLE", {})
        ctx.state.hasStarted = false
        ctx.state.isPaused = false
        if (pauseBtn) {
          pauseBtn.disabled = true
          pauseBtn.textContent = "Pause"
        }
        if (startBtn) startBtn.textContent = "Start"
        ctx.updateStatus("Ready to retry", "ready")
      })
    },

    onMessage(type: string, _data: any, ctx: SimulatorContext) {
      const startBtn = ctx.getElement<HTMLButtonElement>("#simulator-start")
      const pauseBtn = ctx.getElement<HTMLButtonElement>("#simulator-pause")
      const retryBtn = ctx.getElement<HTMLButtonElement>("#simulator-retry")

      if (type === "READY_GAME_LOADED") {
        if (startBtn) startBtn.disabled = false
        if (retryBtn) retryBtn.disabled = false
        ctx.updateStatus("Ready", "ready")
      }

      if (type === "GAME_COMPLETED") {
        ctx.state.hasStarted = false
        if (pauseBtn) pauseBtn.disabled = true
        if (startBtn) startBtn.disabled = true
        ctx.updateStatus("Completed!", "complete")
      }
    },
  }
}
